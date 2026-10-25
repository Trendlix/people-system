import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, CV_PREFILL_IP_TOKEN } from '@trendlix/shared';
import { signatureOf } from '../attendance/signed-ip.js';
import { prefillIp } from './cv-prefill.service.js';

// The CV fill-in's hourly limit counts each visitor's own address, as the website signs it with CAREERS_KEY since the
// careers pages moved to www.trendlix.com (25 October 2026); signed with WEB_KEY it is the website's address, shared by all.

const CAREERS_KEY = 'careers-key-for-this-test-only-0123456789abcdef';
const WEB_KEY = 'web-key-for-this-test-only-0123456789abcdefghij';
const NOW = Date.parse('2026-10-25T18:00:00Z');

function signedBy(key: string, ip: string) {
  const at = String(NOW);
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(key, ip, at, CV_PREFILL_IP_TOKEN) };
}

describe('the CV fill-in’s address', () => {
  const env = { careers: process.env.CAREERS_KEY, web: process.env.WEB_KEY };
  beforeEach(() => {
    process.env.CAREERS_KEY = CAREERS_KEY;
    process.env.WEB_KEY = WEB_KEY;
  });
  afterEach(() => {
    process.env.CAREERS_KEY = env.careers;
    process.env.WEB_KEY = env.web;
  });

  it('trusts the visitor’s address the website signed with CAREERS_KEY', () => {
    expect(prefillIp(null, { ip: '10.0.0.1', userAgent: null, headers: signedBy(CAREERS_KEY, '197.32.1.2') }, undefined, NOW)).toBe('197.32.1.2');
  });

  it('counts an address signed with WEB_KEY (or not signed) as the connection’s own', () => {
    expect(prefillIp(null, { ip: '10.0.0.1', userAgent: null, headers: signedBy(WEB_KEY, '197.32.1.2') }, undefined, NOW)).toBe('10.0.0.1');
    expect(prefillIp('197.32.1.2', { ip: '10.0.0.1', userAgent: null, headers: {} }, undefined, NOW)).toBe('10.0.0.1');
  });
});
