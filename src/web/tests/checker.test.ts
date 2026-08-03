import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildFqdns, runCheck } from '../lib/checker';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildFqdns', () => {
  it('joins base name with every TLD, lowercased', () => {
    expect(buildFqdns('Example', ['com', 'de'])).toEqual(['example.com', 'example.de']);
  });

  it('trims whitespace and trailing dots', () => {
    expect(buildFqdns('  foo. ', ['com'])).toEqual(['foo.com']);
  });

  it('returns an empty list for empty input', () => {
    expect(buildFqdns('   ', ['com'])).toEqual([]);
  });
});

describe('runCheck', () => {
  function stubNetwork(opts: {
    cached?: Record<string, string>;
    dohStatus?: (fqdn: string) => number;
    accepted?: number;
  }) {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/check')) {
        return json({ cached: opts.cached ?? {} });
      }
      if (url.startsWith('/api/challenge')) {
        const body = JSON.parse(init!.body as string) as { fqdns: string[] };
        return json({
          tokens: Object.fromEntries(body.fqdns.map((f) => [f, { token: `t-${f}`, ts: 7 }])),
        });
      }
      if (url.startsWith('/api/report')) {
        return json({ accepted: opts.accepted ?? 0, rejected: 0 });
      }
      // DoH
      const name = new URL(url).searchParams.get('name')!;
      return json({ Status: opts.dohStatus ? opts.dohStatus(name) : 3 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('serves cache hits without a DoH lookup and votes only on fresh misses', async () => {
    const fetchMock = stubNetwork({
      cached: { 'x.com': 'taken' },
      dohStatus: () => 3,
      accepted: 1,
    });

    const events: Array<[string, string, string]> = [];
    const summary = await runCheck('x', ['com', 'net'], {
      onResult: (fqdn, status, source) => events.push([fqdn, status, source]),
    });

    expect(summary.results).toEqual({ 'x.com': 'taken', 'x.net': 'available' });
    expect(summary.cached).toBe(1);
    expect(summary.fresh).toBe(1);
    expect(summary.reported).toBe(1);
    expect(events).toContainEqual(['x.com', 'taken', 'cache']);
    expect(events).toContainEqual(['x.net', 'available', 'doh']);

    // Only the fresh miss was challenged + reported.
    const challengeBody = JSON.parse(
      (fetchMock.mock.calls.find(([u]) => (u as string).includes('/api/challenge'))![1] as RequestInit)
        .body as string,
    ) as { fqdns: string[] };
    expect(challengeBody.fqdns).toEqual(['x.net']);
  });

  it('does not vote on unknown DoH results', async () => {
    stubNetwork({ dohStatus: () => 2 }); // SERVFAIL
    const summary = await runCheck('x', ['test'], {});
    expect(summary.results).toEqual({});
    expect(summary.fresh).toBe(0);
    expect(summary.reported).toBe(0);
  });

  it('completes even when the cache endpoint is down', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/check')) return new Response('down', { status: 503 });
      if (url.startsWith('/api/challenge')) {
        const body = JSON.parse(init!.body as string) as { fqdns: string[] };
        return json({
          tokens: Object.fromEntries(body.fqdns.map((f) => [f, { token: `t-${f}`, ts: 7 }])),
        });
      }
      if (url.startsWith('/api/report')) return json({ accepted: 1, rejected: 0 });
      return json({ Status: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const summary = await runCheck('y', ['com'], {});
    expect(summary.results).toEqual({ 'y.com': 'taken' });
    expect(summary.cached).toBe(0);
    expect(summary.fresh).toBe(1);
  });

  it('handles empty input gracefully', async () => {
    const summary = await runCheck('', ['com'], {});
    expect(summary.results).toEqual({});
  });
});
