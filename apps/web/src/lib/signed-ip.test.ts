import { createHash, createHmac } from 'node:crypto';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, CLIENT_META_HEADER, CLIENT_META_SIGNATURE_HEADER } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { clientMetaHeaders, clientMetaOf, signedIpHeaders, webKeySet } from './signed-ip';

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

// the visitor's browser and place, signed for the audit log (owner, 31 October 2026: "with location and ip capture")
describe('the signed browser and place', () => {
  it('reads Vercel’s place and the browser', () => {
    const h = new Headers({ 'user-agent': ' Mozilla/5.0 ', 'x-vercel-ip-country': 'EG', 'x-vercel-ip-country-region': 'C', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' });
    expect(clientMetaOf(h)).toEqual({ ua: 'Mozilla/5.0', country: 'EG', region: 'C', city: 'São Paulo' });
    expect(clientMetaOf(new Headers())).toEqual({});
  });

  it('signs them as JSON with the time, for the token, with the key', () => {
    const h = clientMetaHeaders(KEY, TOKEN, { ua: 'UA', city: 'Cairo' }, NOW);
    const encoded = h[CLIENT_META_HEADER];
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).toEqual({ at: NOW, ua: 'UA', city: 'Cairo' });
    const hash = createHash('sha256').update(TOKEN).digest('hex');
    expect(h[CLIENT_META_SIGNATURE_HEADER]).toBe(createHmac('sha256', KEY).update(`people-client-meta-v1\n${encoded}\n${hash}`).digest('base64url'));
    expect(clientMetaHeaders(KEY, 'another', { ua: 'UA', city: 'Cairo' }, NOW)[CLIENT_META_SIGNATURE_HEADER]).not.toBe(h[CLIENT_META_SIGNATURE_HEADER]);
    expect(clientMetaHeaders(undefined, TOKEN, { ua: 'UA' }, NOW)).toEqual({});
    expect(clientMetaHeaders(KEY, undefined, { ua: 'UA' }, NOW)).toEqual({});
  });
});
