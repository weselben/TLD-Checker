/** Canonical domain availability, shared with the Worker cache rows. */
export type DomainStatus = 'available' | 'taken';

/** Result of a client-side DoH lookup; `unknown` means the resolver gave no decisive answer. */
export type LookupStatus = DomainStatus | 'unknown';

export interface CheckResponse {
  /** fqdn → status for trusted, unexpired cache rows only. */
  cached: Record<string, DomainStatus>;
}

export interface ChallengeToken {
  token: string;
  /** Unix epoch milliseconds when the token was issued. TTL is 60 s. */
  ts: number;
}

export interface ChallengeResponse {
  /** fqdn → signed token. Caller must echo these back in /api/report. */
  tokens: Record<string, ChallengeToken>;
}

export interface ReportEntry {
  fqdn: string;
  status: DomainStatus;
  token: string;
  ts: number;
}

export interface ReportRejectedEntry {
  fqdn: string;
  reason: string;
}

export interface ReportResponse {
  accepted: number;
  rejected: ReportRejectedEntry[];
  /** fqdn → status for results promoted to the D1 cache after consensus + spot-check. */
  promoted: Record<string, DomainStatus>;
}
