import { describe, expect, it } from 'vitest';
import { signVoteToken, verifyVoteToken, isTokenFresh, TOKEN_TTL_MS } from '../src/worker/lib/crypto';

const SECRET = 'test-secret';
const FQDN = 'example.com';
const TS = 1_700_000_000_000;

describe('vote token crypto', () => {
  it('round-trips a signature', async () => {
    const token = await signVoteToken(SECRET, FQDN, TS);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyVoteToken(SECRET, FQDN, TS, token)).toBe(true);
  });

  it('rejects a token signed for another fqdn', async () => {
    const token = await signVoteToken(SECRET, 'other.net', TS);
    expect(await verifyVoteToken(SECRET, FQDN, TS, token)).toBe(false);
  });

  it('rejects a token signed for another timestamp', async () => {
    const token = await signVoteToken(SECRET, FQDN, TS);
    expect(await verifyVoteToken(SECRET, FQDN, TS + 1, token)).toBe(false);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signVoteToken('wrong-secret', FQDN, TS);
    expect(await verifyVoteToken(SECRET, FQDN, TS, token)).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyVoteToken(SECRET, FQDN, TS, 'not-hex')).toBe(false);
    expect(await verifyVoteToken(SECRET, FQDN, TS, 'ab'.repeat(16))).toBe(false);
  });
});

describe('token freshness', () => {
  it('accepts a token inside the TTL', () => {
    expect(isTokenFresh(TS, TS + TOKEN_TTL_MS - 1)).toBe(true);
    expect(isTokenFresh(TS, TS)).toBe(true);
  });

  it('rejects an expired token', () => {
    expect(isTokenFresh(TS, TS + TOKEN_TTL_MS + 1)).toBe(false);
  });

  it('rejects a token from the future beyond clock skew', () => {
    expect(isTokenFresh(TS + 10_000, TS)).toBe(false);
  });

  it('tolerates a token slightly in the future within clock skew', () => {
    expect(isTokenFresh(TS + 1_000, TS)).toBe(true);
  });

  it('rejects non-numeric timestamps', () => {
    expect(isTokenFresh(NaN, TS)).toBe(false);
  });
});
