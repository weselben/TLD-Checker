import { describe, expect, it, vi } from 'vitest';
import { handleReport } from '../src/worker/api/report';
import { signVoteToken } from '../src/worker/lib/crypto';
import { fakeEnv, FakeD1, FakeVoteAggNamespace } from './fakes';

const NOW = 1_800_000_000_000;

async function signedResult(
  secret: string,
  fqdn: string,
  status: 'available' | 'taken',
  ts = NOW,
) {
  return { fqdn, status, ts, token: await signVoteToken(secret, fqdn, ts) };
}

function req(results: unknown): Request {
  return new Request('https://worker.test/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ results }),
  });
}

/** Report handler calls global fetch for the DoH spot-check; stub dns.google. */
function stubDoh(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ Status: status }) })),
  );
}

describe('POST /api/report', () => {
  it('accepts a well-signed vote', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const e = fakeEnv();
    const res = await handleReport(req([await signedResult(e.VOTE_TOKEN_SECRET, 'a.com', 'taken')]), e, '1.1.1.1');
    const body = (await res.json()) as { accepted: number; rejected: unknown[] };
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([]);
    vi.useRealTimers();
  });

  it('rejects bad tokens, expired tokens, and bad statuses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const e = fakeEnv();
    const results = [
      { fqdn: 'a.com', status: 'taken', ts: NOW, token: 'ff'.repeat(32) }, // bad sig
      await signedResult(e.VOTE_TOKEN_SECRET, 'b.com', 'taken', NOW - 61_000), // expired
      await signedResult(e.VOTE_TOKEN_SECRET, 'c.com', 'taken').then((r) => ({
        ...r,
        status: 'bogus',
      })),
      await signedResult(e.VOTE_TOKEN_SECRET, 'not a fqdn!', 'taken'),
    ];
    const res = await handleReport(req(results), e, '1.1.1.1');
    const body = (await res.json()) as { accepted: number; rejected: { reason: string }[] };
    expect(body.accepted).toBe(0);
    expect(body.rejected.map((r) => r.reason)).toEqual([
      'bad token',
      'token expired',
      'invalid status',
      'invalid fqdn',
    ]);
    vi.useRealTimers();
  });

  it('enforces the 50 result cap', async () => {
    const e = fakeEnv();
    const results = Array.from({ length: 51 }, () => ({ fqdn: 'a.com' }));
    expect((await handleReport(req(results), e, '1.1.1.1')).status).toBe(400);
  });

  it('promotes to D1 after 3 agreeing voters + matching DoH spot-check', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    stubDoh(3); // NXDOMAIN == available
    const e = fakeEnv();
    const dohStatus = 'available';
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      const res = await handleReport(
        req([await signedResult(e.VOTE_TOKEN_SECRET, 'fresh.example', dohStatus)]),
        e,
        ip,
      );
      expect(res.status).toBe(200);
    }
    const db = e.DB as unknown as FakeD1;
    expect(db.cache).toHaveLength(1);
    expect(db.cache[0]).toMatchObject({ fqdn: 'fresh.example', status: 'available' });
    // TTL: 30 days out.
    expect(db.cache[0]!.expires_at - db.cache[0]!.confirmed_at).toBe(30 * 24 * 60 * 60);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does NOT promote when the DoH spot-check contradicts consensus', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    stubDoh(0); // NOERROR == taken, but voters said available
    const e = fakeEnv();
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await handleReport(
        req([await signedResult(e.VOTE_TOKEN_SECRET, 'lie.example', 'available')]),
        e,
        ip,
      );
    }
    expect((e.DB as unknown as FakeD1).cache).toHaveLength(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('same voter IP cannot inflate consensus', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    stubDoh(3);
    const e = fakeEnv();
    for (let i = 0; i < 5; i++) {
      await handleReport(
        req([await signedResult(e.VOTE_TOKEN_SECRET, 'solo.example', 'available')]),
        e,
        '1.1.1.1', // same voter every time
      );
    }
    expect((e.DB as unknown as FakeD1).cache).toHaveLength(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('deny-listed fqdns reject further votes for 24h', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const e = fakeEnv();
    const agg = e.VOTE_AGG as unknown as FakeVoteAggNamespace;
    // Manually deny through the DO's real handler.
    const stub = agg.get(agg.idFromName('deny.example'));
    await stub.fetch('https://vote-agg/deny', { method: 'POST' });
    const res = await handleReport(
      req([await signedResult(e.VOTE_TOKEN_SECRET, 'deny.example', 'taken')]),
      e,
      '1.1.1.1',
    );
    const body = (await res.json()) as { rejected: { reason: string }[] };
    expect(body.rejected[0]!.reason).toBe('denied');
    vi.useRealTimers();
  });
});
