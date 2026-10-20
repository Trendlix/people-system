import { createHash, createHmac } from 'node:crypto';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { signedIpHeaders, webKeySet } from './signed-ip';

// The visitor's address signed for the API (owner, 20 October 2026: check-ins locked to the office network): an
// HMAC-SHA256 with WEB_KEY over the address, the time and the session token's SHA-256, as the API checks it.

const KEY = 'web-key-for-the-tests-only-0123456789abcdef';
const TOKEN = 'header.payload.signature';
const NOW = Date.parse('2026-10-20T10:00:00Z');

describe('the signed address', () => {
  it('signs the address, the time and the token’s hash with the key', () => {
    const h = signedIpHeaders(KEY, TOKEN, '41.33.10.2', NOW);
    expect(h[CLIENT_IP_HEADER]).toBe('41.33.10.2');
    expect(h[CLIENT_IP_AT_HEADER]).toBe(String(NOW));
    const hash = createHash('sha256').update(TOKEN).digest('hex');
    const expected = createHmac('sha256', KEY).update(`people-client-ip-v1\n41.33.10.2\n${NOW}\n${hash}`).digest('base64url');
    expect(h[CLIENT_IP_SIGNATURE_HEADER]).toBe(expected);
    expect(h[CLIENT_IP_SIGNATURE_HEADER]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('differs for another token, address or time', () => {
    const sig = (token: string, ip: string, now: number) => signedIpHeaders(KEY, token, ip, now)[CLIENT_IP_SIGNATURE_HEADER];
    const base = sig(TOKEN, '41.33.10.2', NOW);
    expect(sig('another.token', '41.33.10.2', NOW)).not.toBe(base);
    expect(sig(TOKEN, '41.33.10.3', NOW)).not.toBe(base);
    expect(sig(TOKEN, '41.33.10.2', NOW + 1)).not.toBe(base);
  });

  it('signs nothing without a usable key, a token or an address', () => {
    expect(signedIpHeaders(undefined, TOKEN, '41.33.10.2', NOW)).toEqual({});
    expect(signedIpHeaders('too-short', TOKEN, '41.33.10.2', NOW)).toEqual({});
    expect(signedIpHeaders(KEY, undefined, '41.33.10.2', NOW)).toEqual({});
    expect(signedIpHeaders(KEY, TOKEN, undefined, NOW)).toEqual({});
    expect(webKeySet(KEY)).toBe(true);
    expect(webKeySet('')).toBe(false);
  });
});
