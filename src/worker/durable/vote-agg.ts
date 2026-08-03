/** VoteAgg Durable Object.
 *  One instance per fqdn (idFromName). Holds the ephemeral vote bucket for
 *  that fqdn plus a 24h deny list for fqdns whose promotion failed the
 *  server-side DoH spot-check. State is kept in memory with Durable Object
 *  storage as the persistence layer; votes are ephemeral by design. */

import { decidePromotion, type VoteBucket } from '../../shared/voting';
import { isDomainStatus } from '../lib/http';

const DENY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const BUCKET_KEY = 'bucket';
const DENIED_KEY = 'deniedUntil';

interface VoteBody {
  fqdn?: unknown;
  status?: unknown;
  voter?: unknown;
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

    const deniedUntil = await this.state.storage.get<number>(DENIED_KEY);
    if (deniedUntil && deniedUntil > Date.now()) {
      return Response.json({ denied: true });
    }

    const bucket =
      (await this.state.storage.get<VoteBucket>(BUCKET_KEY)) ??
      ({ available: [], taken: [], firstSeen: Math.floor(Date.now() / 1000) } satisfies VoteBucket);

    // Distinct voter identities only — a repeat voter cannot inflate consensus.
    const list = bucket[body.status];
    if (!list.includes(body.voter)) {
      list.push(body.voter);
      await this.state.storage.put(BUCKET_KEY, bucket);
    }

    const decision = decidePromotion(bucket);
    if (decision.done) await this.state.storage.delete(BUCKET_KEY);
    return Response.json({ decision, voters: decision.voters });
  }

  /** Called by the worker when the DoH spot-check contradicts consensus —
   *  the fqdn is quarantined for 24h so a bad promotion cannot be retried. */
  private async handleDeny(): Promise<Response> {
    await this.state.storage.put(DENIED_KEY, Date.now() + DENY_TTL_MS);
    await this.state.storage.delete(BUCKET_KEY);
    return Response.json({ denied: true });
  }
}
