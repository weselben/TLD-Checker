import type {
  ChallengeResponse,
  ChallengeToken,
  CheckResponse,
  DomainStatus,
  ReportEntry,
  ReportResponse,
} from './types';

/** Same-origin by default; overridable for local dev against a wrangler dev server. */
const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

/** Hard cap enforced by the Worker on /api/challenge. */
export const CHALLENGE_BATCH_SIZE = 50;

/** Keep cache-check URLs comfortably short. */
const CHECK_BATCH_SIZE = 100;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new ApiError(`API request failed: ${res.status} ${res.statusText}`, res.status);
  }
  return (await res.json()) as T;
}

/** GET /api/check — trusted, unexpired cache rows for the given FQDNs. */
export async function fetchCached(fqdns: string[]): Promise<Record<string, DomainStatus>> {
  const merged: Record<string, DomainStatus> = {};
  for (const batch of chunk(fqdns, CHECK_BATCH_SIZE)) {
    const res = await fetch(`${API_BASE}/api/check?fqdns=${encodeURIComponent(batch.join(','))}`);
    const body = await parseJson<CheckResponse>(res);
    Object.assign(merged, body.cached);
  }
  return merged;
}

/** POST /api/challenge — signed report tokens, max 50 FQDNs per call. */
export async function requestChallenge(
  fqdns: string[],
): Promise<Record<string, ChallengeToken>> {
  const merged: Record<string, ChallengeToken> = {};
  for (const batch of chunk(fqdns, CHALLENGE_BATCH_SIZE)) {
    const res = await fetch(`${API_BASE}/api/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fqdns: batch }),
    });
    const body = await parseJson<ChallengeResponse>(res);
    Object.assign(merged, body.tokens);
  }
  return merged;
}

/** POST /api/report — submit one vote per FQDN, each carrying its challenge token. */
export async function reportVotes(entries: ReportEntry[]): Promise<ReportResponse> {
  const res = await fetch(`${API_BASE}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ results: entries }),
  });
  return parseJson<ReportResponse>(res);
}

/**
 * Full vote round-trip for a set of freshly looked-up results:
 * challenge → report. Returns the aggregate report response.
 * Unknown lookups are never reported — only decisive available/taken votes.
 */
export async function submitVotes(
  results: Record<string, DomainStatus>,
): Promise<ReportResponse | null> {
  const fqdns = Object.keys(results);
  if (fqdns.length === 0) return null;
  const tokens = await requestChallenge(fqdns);
  const entries: ReportEntry[] = [];
  for (const fqdn of fqdns) {
    const t = tokens[fqdn];
    if (!t) continue;
    entries.push({ fqdn, status: results[fqdn], token: t.token, ts: t.ts });
  }
  if (entries.length === 0) return null;
  return reportVotes(entries);
}
