import {
  DEVICE_PLATFORM_LABELS,
  DEVICE_PLATFORMS,
  DEVICE_REFUSALS,
  DEVICE_REVOKE_REASONS,
  DEVICE_UNUSED_DAYS,
  deviceExpired,
  deviceExpiresAt,
  deviceNameOf,
  isDevicePlatform,
  isDeviceRefusal,
} from '@trendlix/shared';

// The shared rules of fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the
// first password sign-in"; packages/shared device-credentials.ts): the API decides with them, the web shows the words.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T10:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('device credentials (shared)', () => {
  it('names the phones and the reasons the database allows', () => {
    expect(DEVICE_PLATFORMS).toEqual(['android', 'ios']);
    expect(DEVICE_PLATFORM_LABELS).toEqual({ android: 'Android', ios: 'iPhone' });
    expect(isDevicePlatform('android')).toBe(true);
    expect(isDevicePlatform('windows')).toBe(false);
    // the same list as migration 20261020110000_device_credentials's check
    expect(DEVICE_REVOKE_REASONS).toEqual(['signed_out', 'replaced', 'expired', 'revoked', 'deactivated', 'password_changed', 'password_reset']);
    expect(DEVICE_REFUSALS).toEqual(['unknown', 'revoked', 'expired']);
    expect(isDeviceRefusal('expired')).toBe(true);
    expect(isDeviceRefusal('idle')).toBe(false);
  });

  it('stops a credential 90 days after its last use, or after it was made when never used', () => {
    expect(DEVICE_UNUSED_DAYS).toBe(90);
    expect(deviceExpiresAt(ago(100), ago(10))).toEqual(new Date(ago(10).getTime() + 90 * DAY));
    expect(deviceExpiresAt(ago(10), null)).toEqual(new Date(ago(10).getTime() + 90 * DAY));
    expect(deviceExpired(ago(100), ago(89), NOW)).toBe(false);
    expect(deviceExpired(ago(100), ago(90), NOW)).toBe(true);
    expect(deviceExpired(ago(91), null, NOW)).toBe(true);
    expect(deviceExpired(ago(1), null, NOW)).toBe(false);
  });

  it('keeps a device name tidy: no control characters, spaces collapsed, at most 100 characters', () => {
    expect(deviceNameOf('  Samsung\u0000 SM-S918B\n ')).toBe('Samsung SM-S918B');
    expect(deviceNameOf('')).toBeNull();
    expect(deviceNameOf(' \t ')).toBeNull();
    expect(deviceNameOf(42)).toBeNull();
    expect(deviceNameOf(`${'a'.repeat(99)} b`)).toBe('a'.repeat(99));
    expect(deviceNameOf('b'.repeat(120))).toHaveLength(100);
  });
});
