import { describe, expect, it, vi, afterEach } from 'vitest';
import { lookupFqdn, lookupMany } from '../lib/dns';

function dohResponse(status: number): Response {
  return new Response(JSON.stringify({ Status: status }), {
    status: 200,
    headers: { 'content-type': 'application/dns-json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lookupFqdn', () => {
  it('maps Status 0 (NOERROR) to taken', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dohResponse(0)));
    expect(await lookupFqdn('example.com')).toBe('taken');
  });

  it('maps Status 3 (NXDOMAIN) to available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dohResponse(3)));
    expect(await lookupFqdn('no-such-name.example')).toBe('available');
  });

  it('maps other statuses (SERVFAIL=2, REFUSED=5) to unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dohResponse(2)));
    expect(await lookupFqdn('x.test')).toBe('unknown');
  });

  it('returns unknown on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await lookupFqdn('x.test')).toBe('unknown');
  });

  it('returns unknown on non-200 HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    expect(await lookupFqdn('x.test')).toBe('unknown');
  });

  it('returns unknown on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    expect(await lookupFqdn('x.test')).toBe('unknown');
  });

  it('encodes the fqdn in the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(dohResponse(0));
    vi.stubGlobal('fetch', fetchMock);
    await lookupFqdn('münchen.de');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('https://dns.google/resolve?name=');
    expect(url).toContain(encodeURIComponent('münchen.de'));
  });
});

describe('lookupMany', () => {
  it('resolves every fqdn and reports via onResult', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const name = new URL(url).searchParams.get('name') ?? '';
        return dohResponse(name.endsWith('.com') ? 0 : 3);
      }),
    );
    const seen: Array<[string, string]> = [];
    const out = await lookupMany(['a.com', 'b.net', 'c.org'], 2, (fqdn, status) =>
      seen.push([fqdn, status]),
    );
    expect(out).toEqual({ 'a.com': 'taken', 'b.net': 'available', 'c.org': 'available' });
    expect(seen).toHaveLength(3);
  });

  it('handles empty input without firing requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await lookupMany([], 4);
    expect(out).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never exceeds the concurrency budget', async () => {
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return dohResponse(0);
      }),
    );
    const fqdns = Array.from({ length: 20 }, (_, i) => `d${i}.test`);
    await lookupMany(fqdns, 4);
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});
