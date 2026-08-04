/** POST /api/challenge { fqdns: [...] }
 *  Issues HMAC-signed vote tokens (TTL 60s) so /api/report can trust that a
 *  result was requested through us. Max 50 fqdns per call. */

import { json } from '../lib/http';
import { normalizeFqdnList } from '../lib/fqdn';
import { isUsableVoteTokenSecret, signVoteToken, TOKEN_TTL_MS } from '../lib/crypto';
import { checkRateLimit } from '../lib/rate-limit';

export const CHALLENGE_MAX_FQDNS = 50;
const RATE_LIMIT_PER_MINUTE = 120;

interface ChallengeBody {
  fqdns?: unknown;
}

export async function handleChallenge(
  request: Request,
  env: { DB: D1Database; VOTE_TOKEN_SECRET: string },
  ip: string,
): Promise<Response> {
  const rl = await checkRateLimit(env.DB, 'challenge', ip, RATE_LIMIT_PER_MINUTE);
  if (!rl.allowed) return json({ error: 'rate limit exceeded' }, 429);

  if (!isUsableVoteTokenSecret(env.VOTE_TOKEN_SECRET)) {
    return json({ error: 'server misconfigured: VOTE_TOKEN_SECRET not set' }, 500);
  }

  let body: ChallengeBody;
  try {
    body = (await request.json()) as ChallengeBody;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!Array.isArray(body.fqdns)) return json({ error: 'fqdns must be an array' }, 400);
  if (body.fqdns.length > CHALLENGE_MAX_FQDNS) {
    return json({ error: `max ${CHALLENGE_MAX_FQDNS} fqdns per call` }, 400);
  }

  const fqdns = normalizeFqdnList(body.fqdns.map(String));
  const ts = Date.now();
  const tokens: Record<string, { token: string; ts: number }> = {};
  for (const fqdn of fqdns) {
    tokens[fqdn] = { token: await signVoteToken(env.VOTE_TOKEN_SECRET, fqdn, ts), ts };
  }
  return json({ tokens, ttlMs: TOKEN_TTL_MS });
}
