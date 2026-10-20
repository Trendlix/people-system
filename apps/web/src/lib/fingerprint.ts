import { DEVICE_SIGN_IN_REFUSED, type DeviceRefusal } from '@trendlix/shared';
import { deviceOf } from './devices';
import type { BiometricEnrollResult, BiometricStatus, BiometricUnlockResult } from './native';

// Fingerprint sign-in on the web's side (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app; README:
// "Sign-in: Face ID / fingerprint after the first password sign-in"; apps/mobile/README.md, "Phase 3 contract"): the
// words the pages say, Home's offer remembered as "Not now" on the phone, turning it on (the API's credential, then the
// phone's fingerprint, the credential signed out again when the phone didn't keep it), and what the sign-in page does
// after the fingerprint was asked for. The secret only passes through a variable, from the API's answer to the phone's
// plugin: never kept, never logged. Pure code (no "@/" imports, the steps given): tested.

/** The words of fingerprint sign-in on the pages. */
export const FINGERPRINT_TEXT = {
  offer: 'Use your fingerprint to sign in next time?',
  offerHint: 'Your fingerprint stays on this phone; the system never sees it.',
  on: 'Fingerprint sign-in is on. Next time, sign in with your fingerprint.',
  refused: DEVICE_SIGN_IN_REFUSED,
  keyInvalidated: 'Your fingerprints changed: sign in with your password.',
  lockout: 'Too many tries with the fingerprint. Sign in with your password.',
  unreadable: 'The fingerprint couldn’t be read. Sign in with your password.',
  turnOnLockout: 'Too many tries with the fingerprint. Please try again in a little while.',
  turnOnFailed: 'Fingerprint sign-in couldn’t be turned on. Please try again.',
} as const;

/**
 * What Your Sessions and the Users page say in place of the phones they couldn't load: an API from before fingerprint
 * sign-in (404), a refusal, or what went wrong.
 */
export function devicesNotLoadedText(loaded: { kind: 'unavailable' } | { kind: 'forbidden' } | { kind: 'failed'; messages: string[] }): string {
  if (loaded.kind === 'unavailable') return 'Fingerprint sign-in isn’t on the server yet. Please try again after its next update.';
  if (loaded.kind === 'forbidden') return 'These phones aren’t yours to see.';
  return `The phones couldn’t be loaded. ${loaded.messages.join(' ')}`.trim();
}

// ---------- Home's offer: "Not now" ----------

/** Where the phone remembers Home's offer was put off. */
export const OFFER_KEY = 'trendlix-people:fingerprint-offer';
const NOT_NOW = 'not-now';

/** The browser's storage as used here; null when there is none (a private window, storage blocked). */
export type OfferStorage = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** Whether "Not now" was pressed on this phone. Nothing remembered (or storage blocked): not put off. */
export function offerDismissed(storage: OfferStorage): boolean {
  try {
    return storage?.getItem(OFFER_KEY) === NOT_NOW;
  } catch {
    return false;
  }
}

/** Remembers "Not now" on this phone; with storage blocked it isn't remembered, which is all. */
export function dismissOffer(storage: OfferStorage): void {
  try {
    storage?.setItem(OFFER_KEY, NOT_NOW);
  } catch {
    // a private window, or storage blocked: the offer comes back next time
  }
}

// ---------- turning it on ----------

/** What turning it on came to: on; closed (nothing said); the phone can't after all (the offer goes); or in words. */
export type TurnOnOutcome = { kind: 'on' } | { kind: 'cancelled' } | { kind: 'unavailable' } | { kind: 'error'; message: string };

/** The steps of turning it on: the server action, the phone's plugin, and signing a credential out again. */
export interface TurnOnSteps {
  make(input: { deviceName: string; platform: string }): Promise<{ id: string; secret: string } | { error: string }>;
  enroll(id: string, secret: string): Promise<BiometricEnrollResult>;
  forget(id: string): Promise<unknown>;
}

/** The name the phone is listed under: its own ("Google Pixel 8"), else what its user agent says. */
export function phoneName(status: Pick<BiometricStatus, 'deviceName'>, userAgent: string | null | undefined): string {
  return status.deviceName ?? deviceOf(userAgent);
}

/**
 * Turns on fingerprint sign-in for this phone: the API makes the credential, the phone keeps it behind the fingerprint.
 * When the phone didn't keep it (closed, too many tries, failed, can't), the credential is signed out again, best effort,
 * so the server keeps none the phone doesn't hold.
 */
export async function turnOnFingerprintFlow(status: Pick<BiometricStatus, 'deviceName' | 'platform'>, userAgent: string | null | undefined, steps: TurnOnSteps): Promise<TurnOnOutcome> {
  let made: Awaited<ReturnType<TurnOnSteps['make']>>;
  try {
    made = await steps.make({ deviceName: phoneName(status, userAgent), platform: status.platform ?? '' });
  } catch {
    return { kind: 'error', message: FINGERPRINT_TEXT.turnOnFailed };
  }
  if ('error' in made) return { kind: 'error', message: made.error };
  let kept: BiometricEnrollResult;
  try {
    kept = await steps.enroll(made.id, made.secret);
  } catch {
    kept = { kind: 'failed' };
  }
  if (kept.kind === 'enrolled') return { kind: 'on' };
  try {
    void steps.forget(made.id).catch(() => undefined);
  } catch {
    // best effort: one not used for 90 days stops by itself
  }
  if (kept.kind === 'cancelled') return { kind: 'cancelled' };
  if (kept.kind === 'unavailable') return { kind: 'unavailable' };
  return { kind: 'error', message: kept.kind === 'lockout' ? FINGERPRINT_TEXT.turnOnLockout : FINGERPRINT_TEXT.turnOnFailed };
}

// ---------- the sign-in page ----------

/** What the sign-in page does next: forget the phone's credential, hide Sign in with fingerprint, and what it says. */
export interface FingerprintStep {
  clear: boolean;
  hide: boolean;
  notice: { tone: 'warn' | 'danger'; text: string } | null;
}

const step = (clear: boolean, hide: boolean, notice: FingerprintStep['notice'] = null): FingerprintStep => ({ clear, hide, notice });

/**
 * After the fingerprint was asked for and gave nothing: closed (nothing changes); a changed fingerprint (the phone has
 * cleared it: the password); too many tries (kept, for later); unreadable (the password); none here (quietly gone).
 */
export function afterUnlock(kind: Exclude<BiometricUnlockResult['kind'], 'unlocked'>): FingerprintStep {
  switch (kind) {
    case 'cancelled':
      return step(false, false);
    case 'key_invalidated':
      return step(true, true, { tone: 'warn', text: FINGERPRINT_TEXT.keyInvalidated });
    case 'lockout':
      return step(false, false, { tone: 'warn', text: FINGERPRINT_TEXT.lockout });
    case 'failed':
      return step(false, true, { tone: 'warn', text: FINGERPRINT_TEXT.unreadable });
    case 'unavailable':
      return step(false, true);
  }
}

/**
 * After the sign-in action answered without signing in (it opens the page itself when it does): refused by the API (the
 * credential no longer signs in: forgotten on the phone, the password this time), or what went wrong (try again).
 */
export function afterSignIn(result: { refusal?: DeviceRefusal; error?: string }): FingerprintStep {
  if (result.refusal) return step(true, true, { tone: 'warn', text: FINGERPRINT_TEXT.refused });
  if (result.error) return step(false, false, { tone: 'danger', text: result.error });
  return step(false, false);
}
