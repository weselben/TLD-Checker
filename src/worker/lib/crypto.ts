/** HMAC-signed vote tokens. A token proves "this client asked for fqdn F at time T"
 *  without any server-side storage — the signature itself is the challenge. */

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Token payload: `${fqdn}:${ts}` signed with HMAC-SHA-256, returned as hex. */
export async function signVoteToken(secret: string, fqdn: string, ts: number): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${fqdn}:${ts}`));
  return toHex(sig);
}

export async function verifyVoteToken(
  secret: string,
  fqdn: string,
  ts: number,
  token: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const key = await hmacKey(secret);
  const sigBytes = new Uint8Array(token.length / 2);
  for (let i = 0; i < sigBytes.length; i++) {
    sigBytes[i] = parseInt(token.slice(i * 2, i * 2 + 2), 16);
  }
  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${fqdn}:${ts}`));
}

/** Token is valid only for TTL_MS after signing (default 60s). */
export const TOKEN_TTL_MS = 60_000;

export function isTokenFresh(ts: number, now: number, ttlMs: number = TOKEN_TTL_MS): boolean {
  return Number.isFinite(ts) && ts <= now && now - ts <= ttlMs;
}
