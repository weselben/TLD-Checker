/** VoteAgg Durable Object.
 *  One instance per fqdn (idFromName). Holds the ephemeral vote bucket for
 *  that fqdn plus a 24h deny list for fqdns whose promotion failed the
 *  server-side DoH spot-check. State is kept in memory with Durable Object
 *  storage as the persistence layer; votes are ephemeral by design. */

import { decidePromotion, type VoteBucket } from '../../shared/voting';
import { isDomainStatus } from '../lib/http';

const DENY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const BUCKET_TTL_MS = 24 * 60 * 60 * 1000; // 24h — matches deny/quarantine window
const BUCKET_KEY = 'bucket';
const DENIED_KEY = 'deniedUntil';

interface VoteBody {
  fqdn?: unknown;
  status?: unknown;
  voter?: unknown;
}

type VoteTxResult =
  | { denied: true }
  | { decision: ReturnType<typeof decidePromotion>; voters: number };

/** True when the bucket has outlived its TTL and must be discarded. */
function bucketExpired(bucket: VoteBucket, now: number): boolean {
  return now - bucket.firstSeen * 1000 > BUCKET_TTL_MS;
}

export class VoteAgg {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/vote' && request.method === 'POST') return this.handleVote(request);
    if (url.pathname === '/deny' && request.method === 'POST') return this.handleDeny();
    return new Response('not found', { status: 404 });
  }

  private async handleVote(request: Request): Promise<Response> {
    let body: VoteBody;
    try {
      body = (await request.json()) as VoteBody;
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    if (!isDomainStatus(body.status) || typeof body.voter !== 'string' || body.voter.length === 0) {
      return Response.json({ error: 'invalid vote' }, { status: 400 });
    }
    // Capture the narrowed fields as locals so the storage.transaction
    // callback (which runs in a fresh scope and cannot re-narrow `body`)
    // can use them without an unknown->string/index error.
    const status = body.status;
    const voter = body.voter;

    // Deny check + vote mutation are one atomic read-modify-write: concurrent
    // votes cannot lose or double-count each other.
    const result = await this.state.storage.transaction(async (): Promise<VoteTxResult> => {
      const now = Date.now();

      const deniedUntil = await this.state.storage.get<number>(DENIED_KEY);
      if (deniedUntil && deniedUntil > now) {
        return { denied: true };
      }

      let bucket =
        (await this.state.storage.get<VoteBucket>(BUCKET_KEY)) ??
        ({ available: [], taken: [], firstSeen: Math.floor(now / 1000) } satisfies VoteBucket);

      // A bucket that never reached consensus within the TTL is discarded —
      // keeping raw voter identities indefinitely contradicts "ephemeral by design".
      if (bucketExpired(bucket, now)) {
        bucket = { available: [], taken: [], firstSeen: Math.floor(now / 1000) };
      }

      // A second vote by the same voter UPDATES their position: remove them
      // from the opposite list before adding them here so each voter sits on
      // exactly one side and contributes to the count once.
      const opposite = status === 'available' ? bucket.taken : bucket.available;
      const idx = opposite.indexOf(voter);
      if (idx !== -1) opposite.splice(idx, 1);

      const list = bucket[status];
      if (!list.includes(voter)) list.push(voter);

      await this.state.storage.put(BUCKET_KEY, bucket);

      const decision = decidePromotion(bucket);
      if (decision.done) await this.state.storage.delete(BUCKET_KEY);
      return { decision, voters: decision.voters };
    });

    if ('denied' in result) return Response.json({ denied: true });
    return Response.json({ decision: result.decision, voters: result.voters });
  }

  /** Called by the worker when the DoH spot-check contradicts consensus —
   *  the fqdn is quarantined for 24h so a bad promotion cannot be retried. */
  private async handleDeny(): Promise<Response> {
    await this.state.storage.put(DENIED_KEY, Date.now() + DENY_TTL_MS);
    await this.state.storage.delete(BUCKET_KEY);
    return Response.json({ denied: true });
  }
}