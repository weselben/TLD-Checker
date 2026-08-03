import { describe, expect, it } from 'vitest';
import { handleChallenge } from '../src/worker/api/challenge';
import { verifyVoteToken } from '../src/worker/lib/crypto';
import { fakeEnv } from './fakes';

function req(body: unknown): Request {
  return new Request('https://worker.test/api/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/challenge', () => {
  it('issues verifiable tokens per fqdn', async () => {
    const e = fakeEnv();
    const res = await handleChallenge(req({ fqdns: ['a.com', 'B.net.'] }), e, '1.2.3.4');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tokens: Record<string, { token: string; ts: number }>;
      ttlMs: number;
    };
    expect(Object.keys(body.tokens)).toEqual(['a.com', 'b.net']);
    expect(body.ttlMs).toBe(60_000);
    const t = body.tokens['a.com']!;
    expect(await verifyVoteToken(e.VOTE_TOKEN_SECRET, 'a.com', t.ts, t.token)).toBe(true);
  });

  it('enforces the 50 fqdn cap', async () => {
    const e = fakeEnv();
    const fqdns = Array.from({ length: 51 }, (_, i) => `d${i}.com`);
    expect((await handleChallenge(req({ fqdns }), e, '1.2.3.4')).status).toBe(400);
  });

  it('rejects malformed bodies', async () => {
    const e = fakeEnv();
    expect((await handleChallenge(req({}), e, '1.2.3.4')).status).toBe(400);
    expect((await handleChallenge(req({ fqdns: 'a.com' }), e, '1.2.3.4')).status).toBe(400);
  });

  it('rate limits per IP after 120 calls/min', async () => {
    const e = fakeEnv();
    const one = req({ fqdns: ['a.com'] });
    for (let i = 0; i < 120; i++) {
      expect((await handleChallenge(one.clone(), e, '9.9.9.9')).status).toBe(200);
    }
    expect((await handleChallenge(one.clone(), e, '9.9.9.9')).status).toBe(429);
    // A different IP is unaffected.
    expect((await handleChallenge(one.clone(), e, '8.8.8.8')).status).toBe(200);
  });
});
