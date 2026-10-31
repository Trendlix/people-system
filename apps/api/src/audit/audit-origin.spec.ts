import { createHmac } from 'node:crypto';
import {
  ACCESS_IP_TOKEN,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  CLIENT_META_HEADER,
  CLIENT_META_SIGNATURE_HEADER,
  clientMetaPayload,
  countryName,
  parseAppLocation,
  placeText,
  shownAddress,
  SIGN_IN_METHOD_LABELS,
  SIGN_IN_METHODS,
  SIGN_IN_OUTCOME_LABELS,
  SIGN_IN_OUTCOMES,
  signInOutcomeOk,
  userAgentSummary,
  vercelCity,
} from '@trendlix/shared';
import { signatureOf, tokenHash } from '../attendance/signed-ip.js';
import { auditOriginOf, verifySignedMeta } from './audit-origin.js';

// Where an audit entry came from (owner, 31 October 2026: "with location and ip capture"; the app's position "with each
// sign-in and action"): the website's signed address and place are taken, a forged or stale one isn't, the app's own
// address and position are, and the words the log shows them in.

const KEY = 'k'.repeat(48);
const NOW = 1_793_500_000_000;
const TOKEN = 'session-token';
const APP_UA = 'Trendlix People/0.6.13 (android) TrendLIXPeople';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function signedIp(ip: string, token = TOKEN, at = NOW) {
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: String(at), [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(KEY, ip, String(at), token) };
}

function signedMeta(meta: object, token = TOKEN, key = KEY) {
  const encoded = Buffer.from(JSON.stringify(meta)).toString('base64url');
  return { [CLIENT_META_HEADER]: encoded, [CLIENT_META_SIGNATURE_HEADER]: createHmac('sha256', key).update(clientMetaPayload(encoded, tokenHash(token))).digest('base64url') };
}

describe('where an audit entry came from', () => {
  it('takes the website’s signed address, browser and place', () => {
    const headers = { ...signedIp('41.33.10.2'), ...signedMeta({ at: NOW, ua: CHROME, country: 'EG', region: 'C', city: 'Cairo' }), 'user-agent': 'node', 'x-forwarded-for': '76.76.21.9' };
    expect(auditOriginOf(headers, TOKEN, KEY, NOW, '10.0.0.5')).toEqual({
      ip: '41.33.10.2',
      ipSource: 'website',
      country: 'EG',
      region: 'C',
      city: 'Cairo',
      userAgent: CHROME,
      location: null,
    });
  });

  it('binds a call without a session to the stand-in token', () => {
    const headers = { ...signedIp('41.33.10.2', ACCESS_IP_TOKEN), ...signedMeta({ at: NOW, city: 'Giza' }, ACCESS_IP_TOKEN) };
    const o = auditOriginOf(headers, undefined, KEY, NOW, '127.0.0.1');
    expect([o.ip, o.ipSource, o.city]).toEqual(['41.33.10.2', 'website', 'Giza']);
  });

  it('ignores a forged, stale or other session’s signature: the connection’s own address, no place', () => {
    const forged = { ...signedIp('41.33.10.2'), [CLIENT_IP_SIGNATURE_HEADER]: 'A'.repeat(43), ...signedMeta({ at: NOW, city: 'Cairo' }, TOKEN, 'x'.repeat(48)), 'x-forwarded-for': '1.2.3.4, 197.55.1.1' };
    expect(auditOriginOf(forged, TOKEN, KEY, NOW, '10.0.0.5')).toMatchObject({ ip: '197.55.1.1', ipSource: 'connection', city: null, country: null });
    const stale = { ...signedIp('41.33.10.2', TOKEN, NOW - 120_000), ...signedMeta({ at: NOW - 120_000, city: 'Cairo' }) };
    expect(auditOriginOf(stale, TOKEN, KEY, NOW, '::ffff:127.0.0.1')).toMatchObject({ ip: '127.0.0.1', ipSource: 'connection', city: null });
    expect(auditOriginOf(signedIp('41.33.10.2', 'another'), TOKEN, KEY, NOW, '127.0.0.1').ip).toBe('127.0.0.1');
    // a plain header naming an address counts for nothing
    expect(auditOriginOf({ [CLIENT_IP_HEADER]: '41.33.10.2' }, TOKEN, KEY, NOW, '127.0.0.1').ip).toBe('127.0.0.1');
    // nothing is trusted without the key here
    expect(auditOriginOf(signedIp('41.33.10.2'), TOKEN, undefined, NOW, '127.0.0.1').ipSource).toBe('connection');
  });

  it('reads the meta strictly', () => {
    expect(verifySignedMeta(signedMeta({ at: NOW, country: 'Egypt', city: '  ' }), TOKEN, KEY, NOW)).toEqual({ at: NOW });
    expect(verifySignedMeta(signedMeta({ city: 'Cairo' }), TOKEN, KEY, NOW)).toBeNull();
    expect(verifySignedMeta(signedMeta(['x']), TOKEN, KEY, NOW)).toBeNull();
    expect(verifySignedMeta({ [CLIENT_META_HEADER]: '!!', [CLIENT_META_SIGNATURE_HEADER]: 'x' }, TOKEN, KEY, NOW)).toBeNull();
  });

  it('takes the app’s own address and position, never a website request’s, and no garbage', () => {
    const app = { 'user-agent': APP_UA, 'x-forwarded-for': '197.55.1.1', 'x-people-location': '30.044420,31.235712,12' };
    expect(auditOriginOf(app, TOKEN, KEY, NOW, '172.18.0.3')).toEqual({
      ip: '197.55.1.1',
      ipSource: 'connection',
      country: null,
      region: null,
      city: null,
      userAgent: APP_UA,
      location: { latitude: 30.04442, longitude: 31.235712, accuracyMetres: 12, mock: false },
    });
    expect(auditOriginOf({ ...app, 'x-people-location': '30.04,31.23,40,mock' }, TOKEN, KEY, NOW, null).location?.mock).toBe(true);
    expect(auditOriginOf({ ...app, 'user-agent': CHROME }, TOKEN, KEY, NOW, null).location).toBeNull();
    expect(auditOriginOf({ ...app, ...signedMeta({ at: NOW, ua: APP_UA }) }, TOKEN, KEY, NOW, null).location).toBeNull();
    for (const bad of ['91,31,10', '30,181,10', '30,31,-1', '30,31,100001', '30,31', '30,31,10,fake', 'x,y,z', '30.1234567,31,10', '30,31,10,mock,more'])
      expect(parseAppLocation(bad)).toBeNull();
    expect(parseAppLocation('-33.8688,151.2093,0')).toEqual({ latitude: -33.8688, longitude: 151.2093, accuracyMetres: 0, mock: false });
  });
});

describe('the sign-ins and where-from in words', () => {
  it('names every outcome and method', () => {
    for (const o of SIGN_IN_OUTCOMES) expect(SIGN_IN_OUTCOME_LABELS[o]).toMatch(/^[A-Z]/);
    for (const m of SIGN_IN_METHODS) expect(SIGN_IN_METHOD_LABELS[m]).toMatch(/^[A-Z]/);
    expect(SIGN_IN_OUTCOME_LABELS.wrong_password).toBe('Wrong password');
    expect(SIGN_IN_OUTCOME_LABELS.locked_out).toBe('Locked out');
    expect(signInOutcomeOk('signed_in')).toBe(true);
    expect(signInOutcomeOk('signed_out')).toBe(true);
    expect(signInOutcomeOk('unknown_email')).toBe(false);
    expect(signInOutcomeOk('fingerprint_refused')).toBe(false);
  });

  it('says a browser or the app in a few words', () => {
    expect(userAgentSummary(CHROME)).toBe('Chrome 141 on macOS');
    expect(userAgentSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(
      'Safari 18 on iPhone',
    );
    expect(userAgentSummary('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe(
      'Edge 141 on Windows',
    );
    expect(userAgentSummary('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36')).toBe(
      'Samsung Internet 25 on Android',
    );
    expect(userAgentSummary(APP_UA)).toBe('Trendlix People app 0.6.13 on Android');
    expect(userAgentSummary('Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile TrendLIXPeople')).toBe('Trendlix People app on Android');
    expect(userAgentSummary('curl/8.7.1')).toBe('curl/8.7.1');
    expect(userAgentSummary('')).toBeNull();
    expect(userAgentSummary(null)).toBeNull();
  });

  it('says the place and the address as the log shows them', () => {
    expect(placeText({ city: 'Cairo', country: 'EG' })).toBe('Cairo, Egypt');
    expect(placeText({ country: 'AE' })).toBe('United Arab Emirates');
    expect(placeText({ city: 'Giza' })).toBe('Giza');
    expect(placeText({})).toBeNull();
    expect(countryName('zz')).toBe('ZZ');
    expect(vercelCity('S%C3%A3o%20Paulo')).toBe('São Paulo');
    expect(vercelCity('%E0%A4%A')).toBe('%E0%A4%A');
    expect(shownAddress('::ffff:41.33.10.2')).toBe('41.33.10.2');
    for (const internal of ['10.0.0.5', '127.0.0.1', '::ffff:127.0.0.1', '192.168.1.4', '172.18.0.3', '::1', 'fd12::1']) expect(shownAddress(internal)).toBeNull();
    expect(shownAddress('172.32.0.1')).toBe('172.32.0.1');
    expect(shownAddress(null)).toBeNull();
  });
});
