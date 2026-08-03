import { describe, expect, it, vi } from 'vitest';
import { dohLookup } from '../src/worker/lib/doh';

function mockDoh(status: number | undefined) {
  return vi.fn(async () => ({ json: async () => ({ Status: status }) }));
}

describe('dohLookup', () => {
  it('maps NOERROR (0) to taken', async () => {
    expect(await dohLookup('example.com', mockDoh(0))).toBe('taken');
  });

  it('maps NXDOMAIN (3) to available', async () => {
    expect(await dohLookup('nope.example', mockDoh(3))).toBe('available');
  });

  it('returns null for other statuses (SERVFAIL etc.)', async () => {
    expect(await dohLookup('x.com', mockDoh(2))).toBeNull();
    expect(await dohLookup('x.com', mockDoh(undefined))).toBeNull();
  });

  it('encodes the fqdn into the dns.google url', async () => {
    const fetcher = mockDoh(0);
    await dohLookup('weird name.com', fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      'https://dns.google/resolve?name=weird%20name.com&type=A',
    );
  });
});
