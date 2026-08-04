/** HMAC-signed vote tokens. A token proves "this client asked for fqdn F at time T"
 *  without any server-side storage — the signature itself is the challenge.
 *
 *  Format: `${fqdn}:${ts}` signed with HMAC-SHA-256, returned as hex.
 *  Verification is timing-safe and enforces both TTL and a small clock-skew
 *  window so a token minted for the future cannot be used. */

const encoder = new TextEncoder();

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let cached = keyCache.get(secret);
  if (!cached) {
    cached = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keyCache.set(secret, cached);
  }
  return cached;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Token payload: `${fqdn}:${ts}` signed with HMAC-SHA-256, returned as hex. */
export async function signVoteToken(secret: string, fqdn: string, ts: number): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${fqdn}:${ts}`));
  return toHex(sig);
}

/** Verify signature only — freshness is a separate concern (isTokenFresh). */
export async function verifyVoteToken(
  secret: string,
  fqdn: string,
  ts: number,
  token: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = await signVoteToken(secret, fqdn, ts);
  return timingSafeEqual(expected, token);
}

/** Token is valid only for TTL_MS after signing (default 60s). */
export const TOKEN_TTL_MS = 60_000;
/** Max future skew tolerated (ms) so a slightly-ahead client clock does not fail. */
export const TOKEN_CLOCK_SKEW_MS = 5_000;

/** Placeholder that used to be committed in wrangler.toml [vars]. Real
 *  deployments must set a Worker secret via `wrangler secret put VOTE_TOKEN_SECRET`.
 *  Handlers reject this exact value (and any empty string) so a misconfigured
 *  deploy fails closed instead of signing with a public secret. */
export const PLACEHOLDER_VOTE_TOKEN_SECRET = 'dev-only-insecure-secret-change-me';

/** Returns true when the secret is safe to sign/verify with — non-empty and
 *  not the committed placeholder. Empty strings can reach us when the env
 *  binding is declared but no secret was set. */
export function isUsableVoteTokenSecret(secret: unknown): secret is string {
  if (typeof secret !== 'string') return false;
  if (secret.length === 0) return false;
  if (secret === PLACEHOLDER_VOTE_TOKEN_SECRET) return false;
  return true;
}

export function isTokenFresh(
  ts: number,
  now: number,
  ttlMs: number = TOKEN_TTL_MS,
  clockSkewMs: number = TOKEN_CLOCK_SKEW_MS,
): boolean {
  if (!Number.isFinite(ts)) return false;
  if (ts > now + clockSkewMs) return false;
  return now - ts <= ttlMs;
}
