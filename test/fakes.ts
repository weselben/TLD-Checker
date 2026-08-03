/** In-memory fakes for D1 + the VoteAgg namespace so handler tests run
 *  without miniflare. The DO fake wraps the real VoteAgg class, so its
 *  behavior (dedupe, thresholds, deny list) is exercised for real. */

import { VoteAgg } from '../src/worker/durable/vote-agg';

export interface CacheRow {
  fqdn: string;
  status: string;
  confirmed_at: number;
  expires_at: number;
}

export class FakeD1 {
  cache: CacheRow[] = [];
  rateLimit = new Map<string, number>();

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        return {
          async all<T>() {
            if (sql.includes('FROM cache')) {
              const now = args[args.length - 1] as number;
              const fqdns = args.slice(0, -1) as string[];
              return {
                results: db.cache.filter(
                  (r) => fqdns.includes(r.fqdn) && r.expires_at > now,
                ) as T[],
              };
            }
            throw new Error(`unhandled all(): ${sql}`);
          },
          async first<T>() {
            if (sql.includes('rate_limit')) {
              const key = `${args[0]}:${args[1]}`;
              const next = (db.rateLimit.get(key) ?? 0) + 1;
              db.rateLimit.set(key, next);
              return { count: next } as T;
            }
            throw new Error(`unhandled first(): ${sql}`);
          },
          async run() {
            if (sql.includes('INSERT INTO cache')) {
              const [fqdn, status, confirmed_at, expires_at] = args as [
                string,
                string,
                number,
                number,
              ];
              db.cache = db.cache.filter((r) => r.fqdn !== fqdn);
              db.cache.push({ fqdn, status, confirmed_at, expires_at });
              return { success: true };
            }
            throw new Error(`unhandled run(): ${sql}`);
          },
        };
      },
    };
  }
}

class FakeStorage {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export class FakeVoteAggNamespace {
  instances = new Map<string, VoteAgg>();

  idFromName(name: string) {
    return name;
  }

  get(id: string) {
    if (!this.instances.has(id)) {
      const state = { storage: new FakeStorage() } as unknown as DurableObjectState;
      this.instances.set(id, new VoteAgg(state));
    }
    const agg = this.instances.get(id)!;
    return { fetch: (url: string, init?: RequestInit) => agg.fetch(new Request(url, init)) };
  }
}

export function fakeEnv(overrides: Partial<{ VOTE_TOKEN_SECRET: string }> = {}) {
  return {
    DB: new FakeD1() as unknown as D1Database,
    VOTE_AGG: new FakeVoteAggNamespace() as unknown as DurableObjectNamespace,
    VOTE_TOKEN_SECRET: overrides.VOTE_TOKEN_SECRET ?? 'test-secret',
  };
}

export type FakeEnv = ReturnType<typeof fakeEnv>;
