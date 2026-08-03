import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  ApiError,
  CHALLENGE_BATCH_SIZE,
  fetchCached,
  reportVotes,
  requestChallenge,
  submitVotes,
} from '../lib/api';

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

describe('fetchCached', () => {
  it('returns the cached map from GET /api/check', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ cached: { 'a.com': 'taken', 'b.net': 'available' } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchCached(['a.com', 'b.net']);
    expect(out).toEqual({ 'a.com': 'taken', 'b.net': 'available' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('/api/check?fqdns=' + encodeURIComponent('a.com,b.net'));
  });

  it('merges results across chunked batches', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const fqdns = new URL(url, 'https://x.test').searchParams.get('fqdns')!.split(',');
      return json({ cached: Object.fromEntries(fqdns.map((f) => [f, 'taken'])) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const many = Array.from({ length: 250 }, (_, i) => `d${i}.test`);
    const out = await fetchCached(many);
    expect(Object.keys(out)).toHaveLength(250);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('throws ApiError on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'nope' }, 429)));
    await expect(fetchCached(['a.com'])).rejects.toBeInstanceOf(ApiError);
  });
});

describe('requestChallenge', () => {
  it('posts fqdns in batches of at most 50', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { fqdns: string[] };
      expect(body.fqdns.length).toBeLessThanOrEqual(CHALLENGE_BATCH_SIZE);
      return json({
        tokens: Object.fromEntries(body.fqdns.map((f) => [f, { token: `t-${f}`, ts: 123 }])),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const many = Array.from({ length: 120 }, (_, i) => `d${i}.test`);
    const out = await requestChallenge(many);
    expect(Object.keys(out)).toHaveLength(120);
    expect(out['d0.test']).toEqual({ token: 't-d0.test', ts: 123 });
    expect(fetchMock.mock.calls.length).toBe(3);
  });
});

describe('reportVotes', () => {
  it('posts results and returns the aggregate counts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ accepted: 2, rejected: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const entries = [
      { fqdn: 'a.com', status: 'taken' as const, token: 't1', ts: 1 },
      { fqdn: 'b.net', status: 'available' as const, token: 't2', ts: 1 },
    ];
    const out = await reportVotes(entries);
    expect(out).toEqual({ accepted: 2, rejected: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/report');
    expect(JSON.parse(init.body as string)).toEqual({ results: entries });
  });
});

describe('submitVotes', () => {
  it('round-trips challenge → report for decisive results only', async () => {
    const calls: Array<[string, unknown]> = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push([url, body]);
      if (url.includes('/api/challenge')) {
        return json({
          tokens: Object.fromEntries(
            (body.fqdns as string[]).map((f: string) => [f, { token: `tok-${f}`, ts: 42 }]),
          ),
        });
      }
      return json({ accepted: 2, rejected: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await submitVotes({ 'a.com': 'taken', 'b.net': 'available' });
    expect(out).toEqual({ accepted: 2, rejected: 0 });

    const reportBody = calls.find(([url]) => url.includes('/api/report'))![1] as {
      results: Array<{ fqdn: string; status: string; token: string; ts: number }>;
    };
    expect(reportBody.results).toContainEqual({
      fqdn: 'a.com',
      status: 'taken',
      token: 'tok-a.com',
      ts: 42,
    });
  });

  it('returns null and skips the API entirely for empty input', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await submitVotes({})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits fqdns the challenge endpoint refused to sign', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/challenge')) return json({ tokens: {} });
      return json({ accepted: 0, rejected: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await submitVotes({ 'a.com': 'taken' })).toBeNull();
  });
});
