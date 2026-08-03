import { describe, expect, it } from 'vitest';
import { isValidFqdn, normalizeFqdn, normalizeFqdnList } from '../src/worker/lib/fqdn';

describe('fqdn helpers', () => {
  it('normalizes case and trailing dots', () => {
    expect(normalizeFqdn('  Example.COM. ')).toBe('example.com');
  });

  it('accepts normal fqdns', () => {
    expect(isValidFqdn('example.com')).toBe(true);
    expect(isValidFqdn('a-b.c-d.io')).toBe(true);
    expect(isValidFqdn('sub.domain.example.co.uk')).toBe(true);
  });

  it('rejects invalid fqdns', () => {
    expect(isValidFqdn('')).toBe(false);
    expect(isValidFqdn('nodot')).toBe(false);
    expect(isValidFqdn('-bad.com')).toBe(false);
    expect(isValidFqdn('bad-.com')).toBe(false);
    expect(isValidFqdn('under_score.com')).toBe(false);
    expect(isValidFqdn('a'.repeat(64) + '.com')).toBe(false);
  });

  it('dedupes and drops invalid entries in lists', () => {
    expect(normalizeFqdnList(['A.com', 'a.com', 'bad..x', 'b.net'])).toEqual(['a.com', 'b.net']);
  });
});
