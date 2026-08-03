import { describe, expect, it } from 'vitest';
import { decidePromotion, type VoteBucket } from '../src/shared/voting';

function bucket(available: string[], taken: string[]): VoteBucket {
  return { available, taken, firstSeen: 0 };
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
