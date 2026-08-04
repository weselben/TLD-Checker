import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TLDS } from '../lib/tlds';

describe('TLDS', () => {
  // Drift guard: exact snapshot of the IANA-derived list (see header in lib/tlds.ts).
  // After an intentional list update, recompute the hash of TLDS.join('\n') and pin it here.
  it('matches the pinned snapshot of the IANA list', () => {
    expect(TLDS.length).toBe(1414);
    const hash = createHash('sha256').update(TLDS.join('\n'), 'utf8').digest('hex');
    expect(hash).toBe('8149f4a946df89d7ca4a7017bf2889e084d2903fda08d8f7c65d89bfa5744ecd');
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
