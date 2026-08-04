/** GET /api/check?fqdns=a.com,b.net
 *  Returns consensus-promoted cache rows that are still inside their 30d TTL. */

import { json } from '../lib/http';
import { normalizeFqdnList } from '../lib/fqdn';
import { checkRateLimit } from '../lib/rate-limit';
import type { DomainStatus } from '../../shared/status';

const MAX_FQDNS = 50;
const RATE_LIMIT_PER_MINUTE = 120;

export async function handleCheck(
  request: Request,
  env: { DB: D1Database },
  ip: string,
): Promise<Response> {
  const rl = await checkRateLimit(env.DB, 'check', ip, RATE_LIMIT_PER_MINUTE);
  if (!rl.allowed) return json({ error: 'rate limit exceeded' }, 429);

  const url = new URL(request.url);
  const raw = url.searchParams.get('fqdns');
  if (!raw) return json({ error: 'missing fqdns parameter' }, 400);

  const fqdns = normalizeFqdnList(raw.split(','));
  if (fqdns.length === 0) return json({ error: 'no valid fqdns' }, 400);
  if (fqdns.length > MAX_FQDNS) return json({ error: `max ${MAX_FQDNS} fqdns per call` }, 400);

  const now = Math.floor(Date.now() / 1000);
  const placeholders = fqdns.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT fqdn, status FROM cache WHERE fqdn IN (${placeholders}) AND expires_at > ?`,
  )
    .bind(...fqdns, now)
    .all<{ fqdn: string; status: DomainStatus }>();

  const cached: Record<string, DomainStatus> = {};
  for (const row of rows.results) cached[row.fqdn] = row.status;
  return json({ cached });
}
