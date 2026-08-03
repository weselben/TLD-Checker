/** Per-fqdn vote bucket state kept inside the VoteAgg Durable Object. */
export interface VoteBucket {
  available: string[]; // voter identities voting available
  taken: string[]; // voter identities voting taken
  firstSeen: number; // unix seconds
}

/** Rules for promoting a bucket into the D1 cache. */
export const PROMOTE_MIN_VOTERS = 3;
export const PROMOTE_MIN_AGREEMENT = 0.9;
/** Bucket dies when no side can ever reach the threshold again. */
export const PROMOTE_MAX_VOTERS = 10;

export interface PromotionDecision {
  status: 'available' | 'taken' | null;
  done: boolean;
  voters: number;
}

/** Pure function: decide whether a vote bucket is promotable or exhausted. */
export function decidePromotion(bucket: VoteBucket): PromotionDecision {
  const a = bucket.available.length;
  const t = bucket.taken.length;
  const voters = a + t;

  for (const [status, count] of [
    ['available', a],
    ['taken', t],
  ] as const) {
    if (count >= PROMOTE_MIN_VOTERS && count / voters >= PROMOTE_MIN_AGREEMENT) {
      return { status, done: true, voters };
    }
  }
  // No consensus ever possible once we hit the cap.
  if (voters >= PROMOTE_MAX_VOTERS) return { status: null, done: true, voters };
  return { status: null, done: false, voters };
}
