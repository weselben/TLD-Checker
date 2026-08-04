/** Domain availability states shared between worker, SPA, and tests. */
export type DomainStatus = 'available' | 'taken';

/** dns.google JSON answer codes we care about. */
export const DOH_STATUS_NOERROR = 0; // domain exists  -> taken
export const DOH_STATUS_NXDOMAIN = 3; // domain missing -> available
