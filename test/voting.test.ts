import { describe, expect, it, vi } from 'vitest';
import { decidePromotion, type VoteBucket } from '../src/shared/voting';
import { VoteAgg } from '../src/worker/durable/vote-agg';
import { FakeVoteAggNamespace } from './fakes';

function bucket(available: string[], taken: string[]): VoteBucket {
  return { available, taken, firstSeen: 0 };
}

const NOW = 1_800_000_000_000;

/** Post a vote directly against the real VoteAgg via the fake namespace. */
async function vote(
  ns: FakeVoteAggNamespace,
  fqdn: string,
  status: 'available' | 'taken',
  voter: string,
) {
  const stub = ns.get(ns.idFromName(fqdn));
  const res = await stub.fetch('https://vote-agg/vote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fqdn, status, voter }),
  });
  return (await res.json()) as { decision?: { status: string | null; done: boolean }; voters?: number };
}

describe('promotion decision', () => {
  it('does nothing with fewer than 3 voters', () => {
    expect(decidePromotion(bucket(['a', 'b'], []))).toEqual({
      status: null,
      done: false,
      voters: 2,
    });
  });

  it('promotes at 3 voters with 100% agreement', () => {
    expect(decidePromotion(bucket(['a', 'b', 'c'], []))).toEqual({
      status: 'available',
      done: true,
      voters: 3,
    });
  });

  it('promotes taken when taken votes dominate', () => {
    expect(decidePromotion(bucket([], ['a', 'b', 'c'])).status).toBe('taken');
  });

  it('does not promote below 90% agreement', () => {
    // 3 available + 1 taken = 75% agreement
    const d = decidePromotion(bucket(['a', 'b', 'c'], ['d']));
    expect(d.done).toBe(false);
    expect(d.status).toBeNull();
  });

  it('promotes at exactly 90% (9/10)', () => {
    const d = decidePromotion(
      bucket(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], ['j']),
    );
    expect(d.status).toBe('available');
    expect(d.done).toBe(true);
    expect(d.voters).toBe(10);
  });

  it('gives up at max voters without consensus', () => {
    const d = decidePromotion(
      bucket(['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j']),
    );
    expect(d.status).toBeNull();
    expect(d.done).toBe(true); // exhausted — bucket is discarded
  });
});

describe('VoteAgg Durable Object', () => {
  it('conflicting second vote updates the voter to the latest side', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const ns = new FakeVoteAggNamespace();
    const fqdn = 'flip.example';

    // Two voters say available, one says taken.
    await vote(ns, fqdn, 'available', 'a');
    await vote(ns, fqdn, 'available', 'b');
    await vote(ns, fqdn, 'taken', 'c');

    // 'a' changes their mind: available → taken. Voter count must not grow.
    const res = await vote(ns, fqdn, 'taken', 'a');
    expect(res.voters).toBe(3); // still 3 distinct voters, not 4

    vi.useRealTimers();
  });

  it('expired bucket is cleared and treated as absent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const ns = new FakeVoteAggNamespace();
    const fqdn = 'stale.example';

    // Two voters land in the bucket.
    await vote(ns, fqdn, 'available', 'a');
    await vote(ns, fqdn, 'available', 'b');

    // Advance 25h — beyond the 24h bucket TTL.
    vi.setSystemTime(NOW + 25 * 60 * 60 * 1000);

    // A new vote starts a fresh bucket; only 1 voter now.
    const res = await vote(ns, fqdn, 'available', 'c');
    expect(res.voters).toBe(1);
    expect(res.decision?.done).toBe(false);

    vi.useRealTimers();
  });

  it('deny-listed fqdn rejects further votes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const ns = new FakeVoteAggNamespace();
    const fqdn = 'denied.example';

    const stub = ns.get(ns.idFromName(fqdn));
    await stub.fetch('https://vote-agg/deny', { method: 'POST' });

    const res = await vote(ns, fqdn, 'available', 'a');
    expect(res).toEqual({ denied: true });

    vi.useRealTimers();
  });
});
