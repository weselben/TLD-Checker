import { lookupMany, lookupFqdn } from './dns';
import { fetchCached, submitVotes } from './api';
import type { DomainStatus, LookupStatus } from './types';

export interface RunOptions {
  /** Maximum parallel DoH requests (be polite to dns.google). */
  concurrency?: number;
  /** Called for each FQDN as soon as its status is decided — for live UI updates. */
  onResult?: (fqdn: string, status: LookupStatus, source: 'cache' | 'doh') => void;
  /** Called when all lookups (cache + DoH) have completed. */
  onComplete?: (summary: RunSummary) => void;
}

export interface RunSummary {
  /** fqdn → status, final state after cache + DoH. `unknown` entries are omitted. */
  results: Record<string, DomainStatus>;
  /** Number of FQDNs served straight from the trusted cache. */
  cached: number;
  /** Number of FQDNs that needed a fresh DoH lookup. */
  fresh: number;
  /** Number of decisive fresh votes submitted to /api/report. */
  reported: number;
}

/**
 * Build the candidate FQDN list for a base name + TLD set, returning them in
 * their canonical lowercase form. Empty / whitespace input yields an empty list.
 */
export function buildFqdns(baseName: string, tlds: readonly string[]): string[] {
  const name = baseName.trim().toLowerCase().replace(/\.+$/, '');
  if (!name) return [];
  return tlds.map((tld) => `${name}.${tld}`);
}

/**
 * Cache → DoH → vote round-trip:
 *   1. Ask the Worker for trusted, unexpired cache rows.
 *   2. Run a fresh DoH lookup for everything else.
 *   3. Submit each decisive fresh result back to /api/report.
 *
 * Cache hits are never re-voted on; the Worker holds the canonical truth for them.
 */
export async function runCheck(
  baseName: string,
  tlds: readonly string[],
  options: RunOptions = {},
): Promise<RunSummary> {
  const fqdns = buildFqdns(baseName, tlds);
  const summary: RunSummary = { results: {}, cached: 0, fresh: 0, reported: 0 };
  if (fqdns.length === 0) {
    options.onComplete?.(summary);
    return summary;
  }

  let cached: Record<string, DomainStatus> = {};
  try {
    cached = await fetchCached(fqdns);
  } catch {
    // Cache is best-effort; the DoH pass still produces authoritative-looking results.
  }

  const misses = fqdns.filter((f) => !(f in cached));
  for (const fqdn of fqdns) {
    const status = cached[fqdn];
    if (status) {
      summary.results[fqdn] = status;
      summary.cached++;
      options.onResult?.(fqdn, status, 'cache');
    }
  }

  if (misses.length > 0) {
    await lookupMany(misses, options.concurrency ?? 16, (fqdn, status) => {
      options.onResult?.(fqdn, status, 'doh');
      if (status === 'available' || status === 'taken') {
        summary.results[fqdn] = status;
        summary.fresh++;
      }
    });
  }

  const decisive = Object.entries(summary.results)
    .filter(([fqdn]) => !cached[fqdn])
    .reduce<Record<string, DomainStatus>>((acc, [fqdn, status]) => {
      acc[fqdn] = status;
      return acc;
    }, {});

  try {
    const report = await submitVotes(decisive);
    if (report) summary.reported = report.accepted;
  } catch {
    // Voting is best-effort; the displayed results are still authoritative for this session.
  }

  options.onComplete?.(summary);
  return summary;
}

export { lookupFqdn };