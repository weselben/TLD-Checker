/** D1-backed per-minute rate limiting. Buckets are `${scope}:${ip}` keyed
 *  against the unix epoch floored to 60 seconds. Old buckets are pruned
 *  once per window (per isolate) to keep the table bounded. */

const WINDOW_SECONDS = 60;

// Last window in which this isolate ran the prune; avoids a DELETE on every call.
let lastPruneWindow = -1;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function checkRateLimit(
  db: D1Database,
  scope: string,
  ip: string,
  limit: number,
): Promise<RateLimitResult> {
  const bucket = `${scope}:${ip}`;
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  // Cheap, bounded prune: drop everything older than the previous window.
  // Skip the DELETE on calls within the same window — one prune per isolate
  // per minute is plenty to keep the table small.
  if (window !== lastPruneWindow) {
    lastPruneWindow = window;
    await db.prepare('DELETE FROM rate_limit WHERE window < ?').bind(window - 1).run();
  }
  const row = await db
    .prepare(
      `INSERT INTO rate_limit (bucket, window, count) VALUES (?, ?, 1)
       ON CONFLICT (bucket, window) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(bucket, window)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
