/** dns.google JSON-over-HTTPS client. The browser does the bulk lookups;
 *  the worker only calls this once per promotion candidate as a server-side
 *  spot-check before writing a canonical D1 cache row. */

import { DOH_STATUS_NOERROR, DOH_STATUS_NXDOMAIN, type DomainStatus } from '../../shared/status';

interface DohResponse {
  Status?: number;
}

export type FetchLike = (url: string) => Promise<{ json(): Promise<unknown> }>;

/** Returns 'taken' for NOERROR, 'available' for NXDOMAIN, null otherwise. */
export async function dohLookup(
  fqdn: string,
  fetcher: FetchLike = (url) => fetch(url),
): Promise<DomainStatus | null> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=A`;
  const res = await fetcher(url);
  const body = (await res.json()) as DohResponse;
  if (body.Status === DOH_STATUS_NOERROR) return 'taken';
  if (body.Status === DOH_STATUS_NXDOMAIN) return 'available';
  return null;
}
