import { createHash } from 'node:crypto';
import { DEVICE_SIGN_IN_REFUSED } from '@trendlix/shared';
import {
  deviceRefusalBody,
  deviceSecretHash,
  deviceVerdict,
  isCredentialId,
  keptDeviceName,
  newDeviceSecret,
  replacedByNew,
  secretMatches,
  stillUsableSince,
  type CredentialState,
} from './device-rules.js';

// Fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password
// sign-in"; apps/mobile/README.md, Phase 3): the secret kept only hashed and compared in constant time, and what a
// sign-in with a credential does.

const NOW = new Date('2026-10-20T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const SECRET = 'q3Jx0m3x2f8cX1u6o0b9l0wV5bQkz1gk2Yb3QeR7m9s';

function credential(over: Partial<CredentialState> = {}): CredentialState {
  return { secretHash: deviceSecretHash(SECRET), createdAt: ago(10 * DAY), lastUsedAt: ago(DAY), revokedAt: null, user: { isActive: true }, ...over };
}

describe('the secret', () => {
  it('is 32 random bytes in base64url, a new one each time', () => {
    const a = newDeviceSecret();
    const b = newDeviceSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('is kept as its SHA-256 in hex, never as itself', () => {
    const hash = deviceSecretHash(SECRET);
    expect(hash).toBe(createHash('sha256').update(SECRET).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(SECRET);
  });

  it('matches only its own hash', () => {
    expect(secretMatches(SECRET, deviceSecretHash(SECRET))).toBe(true);
    expect(secretMatches(`${SECRET}x`, deviceSecretHash(SECRET))).toBe(false);
    expect(secretMatches('', deviceSecretHash(SECRET))).toBe(false);
    // a kept value that isn't a hash never matches (and never throws)
    expect(secretMatches(SECRET, 'not-a-hash')).toBe(false);
    expect(secretMatches(SECRET, deviceSecretHash(SECRET).toUpperCase())).toBe(false);
  });

  it('tells a credential id from anything else', () => {
    expect(isCredentialId('0b6f4a59-1d0e-4d55-9a3c-5f4c1b1e2a01')).toBe(true);
    expect(isCredentialId('nope')).toBe(false);
    expect(isCredentialId(42)).toBe(false);
    expect(isCredentialId("0b6f4a59-1d0e-4d55-9a3c-5f4c1b1e2a01' OR 1=1")).toBe(false);
  });
});

describe('signing in with a credential', () => {
  it('lets a credential through with its secret, its account active, used within the 90 days', () => {
    expect(deviceVerdict(credential(), SECRET, NOW)).toEqual({ ok: true });
    // never used yet: from when it was made
    expect(deviceVerdict(credential({ lastUsedAt: null, createdAt: ago(89 * DAY) }), SECRET, NOW)).toEqual({ ok: true });
  });

  it('says the same of no credential and of a secret that isn’t its own: unknown', () => {
    expect(deviceVerdict(null, SECRET, NOW)).toEqual({ ok: false, reason: 'unknown', problem: 'unknown' });
    expect(deviceVerdict(credential(), 'another-secret', NOW)).toEqual({ ok: false, reason: 'unknown', problem: 'wrong_secret' });
    // the secret first: nothing is said of a revoked or old one to someone without it
    expect(deviceVerdict(credential({ revokedAt: ago(DAY) }), 'another-secret', NOW)).toMatchObject({ reason: 'unknown' });
    expect(deviceVerdict(credential({ lastUsedAt: ago(200 * DAY), createdAt: ago(300 * DAY) }), 'x', NOW)).toMatchObject({ reason: 'unknown' });
  });

  it('refuses a revoked one, and one whose account is deactivated (revoking it then)', () => {
    expect(deviceVerdict(credential({ revokedAt: ago(DAY) }), SECRET, NOW)).toEqual({ ok: false, reason: 'revoked', problem: 'revoked' });
    expect(deviceVerdict(credential({ user: { isActive: false } }), SECRET, NOW)).toEqual({ ok: false, reason: 'revoked', problem: 'inactive', revoke: 'deactivated' });
  });

  it('refuses one not used for 90 days, revoking it as expired', () => {
    const old = credential({ createdAt: ago(200 * DAY), lastUsedAt: ago(90 * DAY) });
    expect(deviceVerdict(old, SECRET, NOW)).toEqual({ ok: false, reason: 'expired', problem: 'expired', revoke: 'expired' });
    expect(deviceVerdict(credential({ createdAt: ago(200 * DAY), lastUsedAt: ago(90 * DAY - 1000) }), SECRET, NOW)).toEqual({ ok: true });
    expect(deviceVerdict(credential({ lastUsedAt: null, createdAt: ago(91 * DAY) }), SECRET, NOW)).toMatchObject({ reason: 'expired' });
  });

  it('answers a refusal with the sign-in page’s words and the reason', () => {
    expect(deviceRefusalBody('expired')).toEqual({ statusCode: 401, error: 'Unauthorized', message: DEVICE_SIGN_IN_REFUSED, reason: 'expired' });
    expect(DEVICE_SIGN_IN_REFUSED).toBe('Sign in with your password this time.');
  });

  it('lists only what signed in within the 90 days', () => {
    expect(stillUsableSince(NOW)).toEqual(ago(90 * DAY));
  });
});

describe('one credential a user per phone', () => {
  const active = [
    { id: 'a', deviceName: 'Google Pixel 8', platform: 'android' },
    { id: 'b', deviceName: 'Samsung SM-S918B', platform: 'android' },
    { id: 'c', deviceName: 'Google Pixel 8', platform: 'ios' },
  ];

  it('replaces the one on the same phone (name, whatever the case, and platform) only', () => {
    expect(replacedByNew(active, { deviceName: 'google pixel 8', platform: 'android' }).map((c) => c.id)).toEqual(['a']);
    expect(replacedByNew(active, { deviceName: 'Xiaomi 14', platform: 'android' })).toEqual([]);
  });

  it('keeps a tidy device name, or the platform’s word', () => {
    expect(keptDeviceName('  Google\tPixel   8 ', 'android')).toBe('Google Pixel 8');
    expect(keptDeviceName('', 'android')).toBe('Android phone');
    expect(keptDeviceName('   ', 'ios')).toBe('iPhone');
    expect(keptDeviceName('x'.repeat(150), 'android')).toHaveLength(100);
  });
});
