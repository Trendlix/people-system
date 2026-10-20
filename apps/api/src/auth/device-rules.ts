// The rules of fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first
// password sign-in"; apps/mobile/README.md, Phase 3). Pure code, tested (device-rules.spec.ts): the device credentials
// service (device-credentials.service.ts) and the sign-in (auth.service.ts) decide with it. The platforms, reasons, the
// 90 days and the words: packages/shared device-credentials.ts.
//
// A credential is a random secret the phone keeps behind its fingerprint; the database keeps only its SHA-256, compared
// in constant time. A refusal never says more than the person needs (the password this time): a credential that isn't
// there and a secret that isn't its own read the same ("unknown").

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  DEVICE_SECRET_BYTES,
  DEVICE_SIGN_IN_REFUSED,
  DEVICE_UNUSED_MS,
  deviceExpired,
  deviceNameOf,
  type DevicePlatform,
  type DeviceRefusal,
  type DeviceRevokeReason,
} from '@trendlix/shared';

/** A refused fingerprint sign-in counts against its credential this many times within the window, then it waits. */
export const MAX_DEVICE_FAILURES = 10;
/** … and against the address it came from (the office's people share one), this many. */
export const MAX_DEVICE_FAILURES_PER_IP = 20;
export const DEVICE_LOCKOUT_MINUTES = 15;

export const TOO_MANY_DEVICE_SIGN_INS = `Too many fingerprint sign-in attempts. Sign in with your password, or try again in ${DEVICE_LOCKOUT_MINUTES} minutes.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a credential id sent to the sign-in is one at all (anything else is simply unknown). */
export const isCredentialId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);

/** A new credential's secret: 32 random bytes, base64url (43 characters). Given to the phone once, never kept. */
export const newDeviceSecret = (): string => randomBytes(DEVICE_SECRET_BYTES).toString('base64url');

/** What the database keeps of a secret: its SHA-256, in hex. */
export const deviceSecretHash = (secret: string): string => createHash('sha256').update(secret, 'utf8').digest('hex');

const HASH = /^[0-9a-f]{64}$/;

/** Whether `secret` is the one whose hash is kept, compared in constant time. */
export function secretMatches(secret: string, storedHash: string): boolean {
  if (!HASH.test(storedHash)) return false;
  const sent = Buffer.from(deviceSecretHash(secret), 'hex');
  const kept = Buffer.from(storedHash, 'hex');
  return sent.length === kept.length && timingSafeEqual(sent, kept);
}

/** The part of a credential (and its account) the sign-in reads. */
export interface CredentialState {
  secretHash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  user: { isActive: boolean };
}

/** Why a sign-in was refused, as the audit log says it (never the secret). */
export type DeviceProblem = 'unknown' | 'wrong_secret' | 'revoked' | 'inactive' | 'expired';

/**
 * What the sign-in does with a credential: `ok`, or refused with the 401's `reason` (what the web acts on), the
 * `problem` for the audit log, and `revoke` when the credential ends now: 90 days without use ('expired'), or its account
 * deactivated without it having been revoked then ('deactivated').
 */
export type DeviceVerdict =
  | { ok: true }
  | { ok: false; reason: DeviceRefusal; problem: DeviceProblem; revoke?: Extract<DeviceRevokeReason, 'expired' | 'deactivated'> };

/**
 * The verdict on `credential` (null: no credential with the id sent) for `secret` at `now`. The secret first, so nothing
 * is said of a credential to someone who doesn't hold it; then revoked, the account, the 90 days.
 */
export function deviceVerdict(credential: CredentialState | null, secret: string, now: Date): DeviceVerdict {
  if (!credential) return { ok: false, reason: 'unknown', problem: 'unknown' };
  if (!secretMatches(secret, credential.secretHash)) return { ok: false, reason: 'unknown', problem: 'wrong_secret' };
  if (credential.revokedAt) return { ok: false, reason: 'revoked', problem: 'revoked' };
  if (!credential.user.isActive) return { ok: false, reason: 'revoked', problem: 'inactive', revoke: 'deactivated' };
  if (deviceExpired(credential.createdAt, credential.lastUsedAt, now)) return { ok: false, reason: 'expired', problem: 'expired', revoke: 'expired' };
  return { ok: true };
}

/** The body of the 401 refusing a fingerprint sign-in: the sign-in page's words and the reason's code. */
export function deviceRefusalBody(reason: DeviceRefusal): { statusCode: 401; error: 'Unauthorized'; message: string; reason: DeviceRefusal } {
  return { statusCode: 401, error: 'Unauthorized', message: DEVICE_SIGN_IN_REFUSED, reason };
}

/** The same phone: its name (whatever the case) and platform. */
const samePhone = (a: { deviceName: string; platform: string }, b: { deviceName: string; platform: string }) =>
  a.platform === b.platform && a.deviceName.toLowerCase() === b.deviceName.toLowerCase();

/** The user's active credentials a new one on `phone` replaces: those of the same phone (one active a user per phone). */
export function replacedByNew<T extends { deviceName: string; platform: string }>(active: readonly T[], phone: { deviceName: string; platform: DevicePlatform }): T[] {
  return active.filter((c) => samePhone(c, phone));
}

/** A device name as it is kept, or the platform's own word when the phone gave none. */
export function keptDeviceName(raw: unknown, platform: DevicePlatform): string {
  return deviceNameOf(raw) ?? (platform === 'ios' ? 'iPhone' : 'Android phone');
}

/** The oldest last use (or creation) a credential still signs in with at `now`: the list leaves older ones out. */
export const stillUsableSince = (now: Date): Date => new Date(now.getTime() - DEVICE_UNUSED_MS);
