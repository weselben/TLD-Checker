/** Normalize + validate an fqdn the client claims to have checked. */

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeFqdn(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, '');
}

export function isValidFqdn(fqdn: string): boolean {
  if (fqdn.length === 0 || fqdn.length > 253) return false;
  const labels = fqdn.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => LABEL_RE.test(label));
}

/** Returns normalized fqdns, silently dropping invalid entries. */
export function normalizeFqdnList(raw: string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const fqdn = normalizeFqdn(item);
    if (isValidFqdn(fqdn) && !out.includes(fqdn)) out.push(fqdn);
  }
  return out;
}
