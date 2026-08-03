/** POST /api/report { results: [{ fqdn, status, token, ts }] }
 *  Verifies each vote token, forwards valid votes to the VoteAgg Durable
 *  Object, and promotes a domain into the D1 cache once the DO signals
 *  consensus — but only after a server-side DoH spot-check matches. */

import { json } from '../lib/http';
import { isValidFqdn, normalizeFqdn } from '../lib/fqdn';
import { isTokenFresh, verifyVoteToken } from '../lib/crypto';
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
    // which is the strongest signal we get without accounts.
    const stub = env.VOTE_AGG.get(env.VOTE_AGG.idFromName(fqdn));
    const voteRes = await stub.fetch('https://vote-agg/vote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fqdn, status, voter: ip }),
    });
    const vote = (await voteRes.json()) as VoteResponse;
    if (vote.denied) {
      rejected.push({ fqdn, reason: 'denied' });
      continue;
    }
    accepted.push(fqdn);

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
      }
    }
  }

  return json({ accepted: accepted.length, rejected, promoted });
}
