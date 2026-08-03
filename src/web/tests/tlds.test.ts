import { describe, expect, it } from 'vitest';
import { TLDS } from '../lib/tlds';

describe('TLDS', () => {
  it('contains the full IANA set ported from the legacy site', () => {
    expect(TLDS.length).toBeGreaterThan(1400);
  });

  it('has no duplicates', () => {
    expect(new Set(TLDS).size).toBe(TLDS.length);
  });

  it('includes the common TLDs the legacy site checked', () => {
    for (const tld of ['com', 'net', 'org', 'de', 'io', 'xyz']) {
      expect(TLDS).toContain(tld);
    }
  });

  it('contains no empty or dotted entries', () => {
    for (const tld of TLDS) {
      expect(tld.length).toBeGreaterThan(0);
      expect(tld).not.toContain('.');
    }
  });
});
