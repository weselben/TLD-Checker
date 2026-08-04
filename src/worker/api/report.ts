/** POST /api/report { results: [{ fqdn, status, token, ts }] }
 *  Verifies each vote token, forwards valid votes to the VoteAgg Durable
 *  Object, and promotes a domain into the D1 cache once the DO signals
 *  consensus — but only after a server-side DoH spot-check matches. */

import { json } from '../lib/http';
import { isValidFqdn, normalizeFqdn } from '../lib/fqdn';
import { isTokenFresh, isUsableVoteTokenSecret, verifyVoteToken } from '../lib/crypto';
import { checkRateLimit } from '../lib/rate-limit';
import { dohLookup } from '../lib/doh';
import type { DomainStatus } from '../../shared/status';

export const REPORT_MAX_RESULTS = 50;
const RATE_LIMIT_PER_MINUTE = 120;
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30d

interface ReportItem {
  fqdn?: unknown;
  status?: unknown;
  token?: unknown;
  ts?: unknown;
}

interface ReportBody {
  results?: unknown;
}

interface VoteResponse {
  decision?: { status: DomainStatus | null; done: boolean };
  denied?: boolean;
}

export async function handleReport(
  request: Request,
  env: { DB: D1Database; VOTE_AGG: DurableObjectNamespace; VOTE_TOKEN_SECRET: string },
  ip: string,
): Promise<Response> {
  const rl = await checkRateLimit(env.DB, 'report', ip, RATE_LIMIT_PER_MINUTE);
  if (!rl.allowed) return json({ error: 'rate limit exceeded' }, 429);

  if (!isUsableVoteTokenSecret(env.VOTE_TOKEN_SECRET)) {
    return json({ error: 'server misconfigured: VOTE_TOKEN_SECRET not set' }, 500);
  }

  let body: ReportBody;
  try {
    body = (await request.json()) as ReportBody;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!Array.isArray(body.results)) return json({ error: 'results must be an array' }, 400);
  if (body.results.length > REPORT_MAX_RESULTS) {
    return json({ error: `max ${REPORT_MAX_RESULTS} results per call` }, 400);
  }

  const now = Date.now();
  const accepted: string[] = [];
  const rejected: { fqdn: string; reason: string }[] = [];
  const promoted: Record<string, DomainStatus> = {};

  for (const raw of body.results as ReportItem[]) {
    const fqdn = normalizeFqdn(String(raw.fqdn ?? ''));
    const status = raw.status === 'available' || raw.status === 'taken' ? raw.status : null;
    const token = String(raw.token ?? '');
    const ts = Number(raw.ts);

    if (!isValidFqdn(fqdn)) {
      rejected.push({ fqdn, reason: 'invalid fqdn' });
      continue;
    }
    if (!status) {
      rejected.push({ fqdn, reason: 'invalid status' });
      continue;
    }
    if (!isTokenFresh(ts, now)) {
      rejected.push({ fqdn, reason: 'token expired' });
      continue;
    }
    if (!(await verifyVoteToken(env.VOTE_TOKEN_SECRET, fqdn, ts, token))) {
      rejected.push({ fqdn, reason: 'bad token' });
      continue;
    }

    // Forward the vote to the per-fqdn VoteAgg stub. Voter identity = client IP,
    // which is the strongest signal we get without accounts. A DO failure must
    // only reject this one fqdn — never abort the rest of the batch.
    const stub = env.VOTE_AGG.get(env.VOTE_AGG.idFromName(fqdn));
    const voteRes = await stub
      .fetch('https://vote-agg/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fqdn, status, voter: ip }),
      })
      .catch(() => null);
    if (!voteRes?.ok) {
      rejected.push({ fqdn, reason: 'vote_agg_error' });
      continue;
    }
    let vote: VoteResponse;
    try {
      vote = (await voteRes.json()) as VoteResponse;
    } catch {
      rejected.push({ fqdn, reason: 'vote_agg_error' });
      continue;
    }
    if (vote.denied) {
      rejected.push({ fqdn, reason: 'denied' });
      continue;
    }

    // Consensus reached → one server-side DoH spot-check before the D1 write.
    if (vote.decision?.done && vote.decision.status) {
      const spot = await dohLookup(fqdn);
      if (spot === vote.decision.status) {
        const nowSec = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
          `INSERT INTO cache (fqdn, status, confirmed_at, expires_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (fqdn) DO UPDATE SET status = excluded.status,
             confirmed_at = excluded.confirmed_at, expires_at = excluded.expires_at`,
        )
          .bind(fqdn, spot, nowSec, nowSec + CACHE_TTL_SECONDS)
          .run();
        promoted[fqdn] = spot;
      } else if (spot !== null) {
        // DoH contradicts consensus → quarantine the fqdn for 24h via the DO
        // and report it as rejected, not promoted. A failed deny call is
        // non-fatal: the fqdn simply stays unpromoted.
        await stub.fetch('https://vote-agg/deny', { method: 'POST' }).catch(() => null);
        rejected.push({ fqdn, reason: 'spot-check mismatch' });
        continue;
      }
      // spot === null → spot-check inconclusive: neither promote nor deny.
    }
    accepted.push(fqdn);
  }

  return json({ accepted: accepted.length, rejected, promoted });
}
