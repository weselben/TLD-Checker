/** dns.google JSON-over-HTTPS client. The browser does the bulk lookups;
 *  the worker only calls this once per promotion candidate as a server-side
 *  spot-check before writing a canonical D1 cache row. */

import { DOH_STATUS_NOERROR, DOH_STATUS_NXDOMAIN, type DomainStatus } from '../../shared/status';

interface DohResponse {
  Status?: number;
}

export const DOH_TIMEOUT_MS = 5000;

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ json(): Promise<unknown> }>;

/** Returns 'taken' for NOERROR, 'available' for NXDOMAIN, null otherwise —
 *  including when the lookup fails or times out, in which case the
 *  spot-check is inconclusive and the caller must neither promote nor deny. */
export async function dohLookup(
  fqdn: string,
  fetcher: FetchLike = (url, init) => fetch(url, init),
): Promise<DomainStatus | null> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=A`;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(DOH_TIMEOUT_MS) });
    const body = (await res.json()) as DohResponse;
    if (body.Status === DOH_STATUS_NOERROR) return 'taken';
    if (body.Status === DOH_STATUS_NXDOMAIN) return 'available';
    return null;
  } catch {
    return null;
  }
}
