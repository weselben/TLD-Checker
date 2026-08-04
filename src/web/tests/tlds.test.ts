import { describe, expect, it } from 'vitest';
import { TLDS } from '../lib/tlds';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('TLDS', () => {
  // Drift guard: exact snapshot of the IANA-derived list (see header in lib/tlds.ts).
  // After an intentional list update, recompute the hash of TLDS.join('\n') and pin it here.
  it('matches the pinned snapshot of the IANA list', async () => {
    expect(TLDS.length).toBe(1414);
    const hash = await sha256Hex(TLDS.join('\n'));
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
