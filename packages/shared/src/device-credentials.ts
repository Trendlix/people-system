// Fingerprint sign-in in the TrendLIX People app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the
// first password sign-in"; apps/mobile/README.md, Phase 3). After a password sign-in in the app, the person may turn it
// on: the API gives the phone a device credential (a random secret it keeps only hashed), which the phone keeps behind
// its fingerprint (an Android Keystore key that needs the fingerprint to be used). Next time, the fingerprint unlocks the
// secret and the website trades it for an ordinary app session. A credential not used for 90 days, revoked by its owner
// or an Admin, or of an account deactivated or whose password changed, no longer signs in: the password does.
// Pure: the API decides with these and the web shows the same words.

/** The phones a credential is kept on. iPhone comes with Phase 6. */
export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const DEVICE_PLATFORM_LABELS: Record<DevicePlatform, string> = { android: 'Android', ios: 'iPhone' };

export const isDevicePlatform = (value: unknown): value is DevicePlatform => (DEVICE_PLATFORMS as readonly unknown[]).includes(value);

/**
 * Why a credential no longer signs in: its owner signed the phone out (Your Sessions), a newer one on the same phone
 * replaced it, 90 days without use, an Admin signed it out (the Users page), the account was deactivated, its password
 * was changed by its owner, or reset by an Admin.
 */
export const DEVICE_REVOKE_REASONS = ['signed_out', 'replaced', 'expired', 'revoked', 'deactivated', 'password_changed', 'password_reset'] as const;
export type DeviceRevokeReason = (typeof DEVICE_REVOKE_REASONS)[number];

/** Days without a fingerprint sign-in after which a credential stops working (revoked as 'expired' when next tried). */
export const DEVICE_UNUSED_DAYS = 90;
export const DEVICE_UNUSED_MS = DEVICE_UNUSED_DAYS * 24 * 60 * 60 * 1000;

/** The secret's size: 32 random bytes, given to the phone once (base64url, 43 characters) and kept only as its SHA-256. */
export const DEVICE_SECRET_BYTES = 32;

/** The longest device name kept ("Samsung SM-S918B"). */
export const DEVICE_NAME_MAX = 100;

/**
 * What a refused fingerprint sign-in's 401 says (`reason`): no such credential (or the secret isn't its), revoked (or its
 * account deactivated), or unused for 90 days. Each means the same to the person: the password this time.
 */
export const DEVICE_REFUSALS = ['unknown', 'revoked', 'expired'] as const;
export type DeviceRefusal = (typeof DEVICE_REFUSALS)[number];

export const isDeviceRefusal = (value: unknown): value is DeviceRefusal => (DEVICE_REFUSALS as readonly unknown[]).includes(value);

/** The words of a refused fingerprint sign-in (the API's 401 message, the sign-in page's notice). */
export const DEVICE_SIGN_IN_REFUSED = 'Sign in with your password this time.';

/** When a credential stops working: 90 days after its last use, or after it was made when never used. */
export function deviceExpiresAt(createdAt: Date, lastUsedAt: Date | null): Date {
  return new Date((lastUsedAt ?? createdAt).getTime() + DEVICE_UNUSED_MS);
}

/** Whether a credential has gone 90 days without use at `now`. */
export const deviceExpired = (createdAt: Date, lastUsedAt: Date | null, now: Date): boolean =>
  deviceExpiresAt(createdAt, lastUsedAt).getTime() <= now.getTime();

/**
 * A device name as it is kept: control characters dropped, spaces collapsed, trimmed, at most DEVICE_NAME_MAX characters;
 * null when nothing is left.
 */
export function deviceNameOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, DEVICE_NAME_MAX).trim() : null;
}
