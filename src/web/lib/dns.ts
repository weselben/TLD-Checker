import type { LookupStatus } from './types';

const DOH_ENDPOINT = 'https://dns.google/resolve';

interface DohResponse {
  Status?: number;
}

/**
 * Resolve a single FQDN via Google DNS-over-HTTPS.
 *
 * Status 0 (NOERROR) → the name exists → taken.
 * Status 3 (NXDOMAIN) → the name does not exist → available.
 * Anything else (SERVFAIL, REFUSED, network error, ...) → unknown.
 */
export async function lookupFqdn(fqdn: string): Promise<LookupStatus> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(fqdn)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/dns-json' } });
  } catch {
    return 'unknown';
  }
  if (!res.ok) return 'unknown';
  let body: DohResponse;
  try {
    body = (await res.json()) as DohResponse;
  } catch {
    return 'unknown';
  }
  if (body.Status === 0) return 'taken';
  if (body.Status === 3) return 'available';
  return 'unknown';
}

/**
 * Run `lookupFqdn` over a list of FQDNs with a bounded concurrency pool so a
 * full TLD sweep does not fire hundreds of parallel requests.
 */
export async function lookupMany(
  fqdns: string[],
  concurrency = 16,
  onResult?: (fqdn: string, status: LookupStatus) => void,
): Promise<Record<string, LookupStatus>> {
  const out: Record<string, LookupStatus> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < fqdns.length) {
      const fqdn = fqdns[cursor++];
      const status = await lookupFqdn(fqdn);
      out[fqdn] = status;
      onResult?.(fqdn, status);
    }
  };
  const lanes = Math.min(Math.max(1, concurrency), fqdns.length);
  await Promise.all(Array.from({ length: lanes }, worker));
  return out;
}
