import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER } from '@trendlix/shared';
import { signatureOf, tokenHash, verifySignedIp } from './signed-ip.js';

// The address the website signs for a check-in (owner, 20 October 2026: check-ins locked to the office network): trusted
// only with WEB_KEY's signature, within a minute either way, for the same session token; never a plain header.

const KEY = 'k3y-for-the-tests-only-0123456789abcdefghij';
const TOKEN = 'header.payload.signature';
const NOW = Date.parse('2026-10-20T10:00:00Z');

function signed(ip: string, at = NOW, token = TOKEN, key = KEY) {
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: String(at), [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(key, ip, String(at), token) };
}

describe('the signed address', () => {
  it('is trusted with the right signature, normalised', () => {
    expect(verifySignedIp(signed('41.33.10.2'), TOKEN, KEY, NOW)).toEqual({ ip: '41.33.10.2' });
    expect(verifySignedIp(signed('::ffff:41.33.10.2'), TOKEN, KEY, NOW + 59_000)).toEqual({ ip: '41.33.10.2' });
    expect(verifySignedIp(signed('2001:DB8::1'), TOKEN, KEY, NOW - 59_000)).toEqual({ ip: '2001:db8::1' });
    expect(tokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is never trusted without the key here', () => {
    expect(verifySignedIp(signed('41.33.10.2'), TOKEN, undefined, NOW)).toEqual({ problem: 'no_server_key' });
    expect(verifySignedIp(signed('41.33.10.2'), TOKEN, 'short', NOW)).toEqual({ problem: 'no_server_key' });
  });

  it('ignores a plain or forged address', () => {
    expect(verifySignedIp({}, TOKEN, KEY, NOW)).toEqual({ problem: 'unsigned' });
    expect(verifySignedIp({ [CLIENT_IP_HEADER]: '41.33.10.2' }, TOKEN, KEY, NOW)).toEqual({ problem: 'malformed' });
    expect(verifySignedIp({ 'x-forwarded-for': '41.33.10.2' }, TOKEN, KEY, NOW)).toEqual({ problem: 'unsigned' });
    // the address changed after signing
    expect(verifySignedIp({ ...signed('197.45.1.9'), [CLIENT_IP_HEADER]: '41.33.10.2' }, TOKEN, KEY, NOW)).toEqual({ problem: 'bad_signature' });
    // signed with another key
    expect(verifySignedIp(signed('41.33.10.2', NOW, TOKEN, `${KEY}-other`), TOKEN, KEY, NOW)).toEqual({ problem: 'bad_signature' });
    expect(verifySignedIp({ ...signed('41.33.10.2'), [CLIENT_IP_SIGNATURE_HEADER]: 'x'.repeat(43) }, TOKEN, KEY, NOW)).toEqual({ problem: 'bad_signature' });
    expect(verifySignedIp({ ...signed('41.33.10.2'), [CLIENT_IP_SIGNATURE_HEADER]: 'not base64url!' }, TOKEN, KEY, NOW)).toEqual({ problem: 'malformed' });
    expect(verifySignedIp(signed('not an address'), TOKEN, KEY, NOW)).toEqual({ problem: 'malformed' });
  });

  it('refuses another session’s token and a stale or future time', () => {
    expect(verifySignedIp(signed('41.33.10.2', NOW, 'another.session.token'), TOKEN, KEY, NOW)).toEqual({ problem: 'bad_signature' });
    expect(verifySignedIp(signed('41.33.10.2'), undefined, KEY, NOW)).toEqual({ problem: 'malformed' });
    expect(verifySignedIp(signed('41.33.10.2', NOW - 61_000), TOKEN, KEY, NOW)).toEqual({ problem: 'stale' });
    expect(verifySignedIp(signed('41.33.10.2', NOW + 61_000), TOKEN, KEY, NOW)).toEqual({ problem: 'stale' });
    expect(verifySignedIp({ ...signed('41.33.10.2'), [CLIENT_IP_AT_HEADER]: 'yesterday' }, TOKEN, KEY, NOW)).toEqual({ problem: 'malformed' });
  });
});
