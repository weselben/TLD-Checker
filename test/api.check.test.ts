import { describe, expect, it } from 'vitest';
import { handleCheck } from '../src/worker/api/check';
import { fakeEnv } from './fakes';

const env = () => fakeEnv();

function req(path: string): Request {
  return new Request(`https://worker.test${path}`);
}

describe('GET /api/check', () => {
  it('returns only fresh cache rows', async () => {
    const e = env();
    const now = Math.floor(Date.now() / 1000);
    (e.DB as unknown as { cache: unknown[] }).cache = [
      { fqdn: 'fresh.com', status: 'taken', confirmed_at: now - 10, expires_at: now + 1000 },
      { fqdn: 'stale.com', status: 'available', confirmed_at: now - 99999, expires_at: now - 1 },
    ];
    const res = await handleCheck(
      req('/api/check?fqdns=fresh.com,stale.com,missing.net'),
      e,
      '1.2.3.4',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cached: Record<string, string> };
    expect(body.cached).toEqual({ 'fresh.com': 'taken' });
  });

  it('normalizes fqdns before lookup', async () => {
    const e = env();
    const now = Math.floor(Date.now() / 1000);
    (e.DB as unknown as { cache: unknown[] }).cache = [
      { fqdn: 'example.com', status: 'taken', confirmed_at: now, expires_at: now + 100 },
    ];
    const res = await handleCheck(req('/api/check?fqdns=EXAMPLE.com.'), e, '1.2.3.4');
    const body = (await res.json()) as { cached: Record<string, string> };
    expect(body.cached).toEqual({ 'example.com': 'taken' });
  });

  it('rejects missing or invalid params', async () => {
    const e = env();
    expect((await handleCheck(req('/api/check'), e, '1.2.3.4')).status).toBe(400);
    expect((await handleCheck(req('/api/check?fqdns=!!!'), e, '1.2.3.4')).status).toBe(400);
  });

  it('caps at 50 fqdns per call', async () => {
    const e = env();
    const many = Array.from({ length: 51 }, (_, i) => `d${i}.com`).join(',');
    expect((await handleCheck(req(`/api/check?fqdns=${many}`), e, '1.2.3.4')).status).toBe(400);
  });

  it('rate limits per IP after 120 calls/min', async () => {
    const e = env();
    const one = req('/api/check?fqdns=a.com');
    for (let i = 0; i < 120; i++) {
      expect((await handleCheck(one.clone(), e, '9.9.9.9')).status).toBe(200);
    }
    expect((await handleCheck(one.clone(), e, '9.9.9.9')).status).toBe(429);
    // A different IP is unaffected.
    expect((await handleCheck(one.clone(), e, '8.8.8.8')).status).toBe(200);
  });
});
