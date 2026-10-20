import { describe, expect, it, vi } from 'vitest';
import {
  afterSignIn,
  afterUnlock,
  devicesNotLoadedText,
  dismissOffer,
  FINGERPRINT_TEXT,
  OFFER_KEY,
  offerDismissed,
  phoneName,
  turnOnFingerprintFlow,
  type TurnOnSteps,
} from './fingerprint';
import type { BiometricEnrollResult } from './native';

// Fingerprint sign-in on the web's side (owner, 20 October 2026: chose Face ID / fingerprint sign-in for the app; README:
// "Sign-in: Face ID / fingerprint after the first password sign-in"): Home's "Not now", turning it on, and what the
// sign-in page does after the fingerprint was asked for.

/** A browser storage in memory, or one that refuses everything (a private window). */
function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map<string, string>();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) };
}
const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('Home’s offer, put off with Not now', () => {
  it('is offered until Not now, then remembered on the phone', () => {
    const storage = memory();
    expect(offerDismissed(storage)).toBe(false);
    dismissOffer(storage);
    expect(offerDismissed(storage)).toBe(true);
    expect(storage.getItem(OFFER_KEY)).toBe('not-now');
    expect(OFFER_KEY).toBe('trendlix-people:fingerprint-offer');
  });

  it('never fails with storage blocked or missing: offered again next time', () => {
    expect(offerDismissed(blocked)).toBe(false);
    expect(() => dismissOffer(blocked)).not.toThrow();
    expect(offerDismissed(null)).toBe(false);
    expect(offerDismissed(undefined)).toBe(false);
    expect(() => dismissOffer(null)).not.toThrow();
    const other = memory();
    other.setItem(OFFER_KEY, 'something else');
    expect(offerDismissed(other)).toBe(false);
  });
});

describe('turning it on', () => {
  const PIXEL = { deviceName: 'Google Pixel 8', platform: 'android' as const };
  const APP_UA = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 TrendLIXPeople';

  function steps(enrolled: BiometricEnrollResult | Error, made: Awaited<ReturnType<TurnOnSteps['make']>> = { id: 'cred-1', secret: 'the-secret' }) {
    return {
      make: vi.fn(async () => made),
      enroll: vi.fn(async () => {
        if (enrolled instanceof Error) throw enrolled;
        return enrolled;
      }),
      forget: vi.fn(async () => ({})),
    } satisfies TurnOnSteps;
  }

  it('makes the credential and keeps it behind the fingerprint', async () => {
    const s = steps({ kind: 'enrolled' });
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, s)).resolves.toEqual({ kind: 'on' });
    expect(s.make).toHaveBeenCalledWith({ deviceName: 'Google Pixel 8', platform: 'android' });
    expect(s.enroll).toHaveBeenCalledWith('cred-1', 'the-secret');
    expect(s.forget).not.toHaveBeenCalled();
  });

  it('names the phone from its user agent when the phone gives no name', async () => {
    const s = steps({ kind: 'enrolled' });
    await turnOnFingerprintFlow({ deviceName: null, platform: 'android' }, APP_UA, s);
    expect(s.make).toHaveBeenCalledWith({ deviceName: 'Trendlix People app on Android', platform: 'android' });
    expect(phoneName({ deviceName: null }, null)).toBe('Unknown device');
    // no platform known: the action refuses it in words
    const none = steps({ kind: 'enrolled' }, { error: 'Fingerprint sign-in is turned on in the Trendlix People app, on an Android phone or an iPhone.' });
    await expect(turnOnFingerprintFlow({ deviceName: 'X', platform: null }, APP_UA, none)).resolves.toMatchObject({ kind: 'error' });
    expect(none.make).toHaveBeenCalledWith({ deviceName: 'X', platform: '' });
    expect(none.enroll).not.toHaveBeenCalled();
  });

  it('says nothing when the prompt is closed, and signs the unkept credential out again', async () => {
    const s = steps({ kind: 'cancelled' });
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, s)).resolves.toEqual({ kind: 'cancelled' });
    expect(s.forget).toHaveBeenCalledWith('cred-1');
  });

  it('says so after too many tries or a failure, and signs the credential out again', async () => {
    const lockout = steps({ kind: 'lockout' });
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, lockout)).resolves.toEqual({ kind: 'error', message: FINGERPRINT_TEXT.turnOnLockout });
    expect(lockout.forget).toHaveBeenCalledWith('cred-1');
    const failed = steps({ kind: 'failed' });
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, failed)).resolves.toEqual({ kind: 'error', message: FINGERPRINT_TEXT.turnOnFailed });
    expect(failed.forget).toHaveBeenCalledWith('cred-1');
    const threw = steps(new Error('plugin broke'));
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, threw)).resolves.toEqual({ kind: 'error', message: FINGERPRINT_TEXT.turnOnFailed });
    expect(threw.forget).toHaveBeenCalledWith('cred-1');
  });

  it('goes quietly when the phone can’t after all, signing the credential out again', async () => {
    const s = steps({ kind: 'unavailable' });
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, s)).resolves.toEqual({ kind: 'unavailable' });
    expect(s.forget).toHaveBeenCalledWith('cred-1');
  });

  it('shows the API’s refusal, the phone never asked', async () => {
    const s = steps({ kind: 'enrolled' }, { error: 'Fingerprint sign-in is turned on in the app.' });
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, s)).resolves.toEqual({ kind: 'error', message: 'Fingerprint sign-in is turned on in the app.' });
    expect(s.enroll).not.toHaveBeenCalled();
    expect(s.forget).not.toHaveBeenCalled();
    const threw = { ...steps({ kind: 'enrolled' }), make: vi.fn(async () => Promise.reject(new Error('network'))) };
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, threw)).resolves.toEqual({ kind: 'error', message: FINGERPRINT_TEXT.turnOnFailed });
  });

  it('never fails when signing the credential out again does', async () => {
    const s = { ...steps({ kind: 'cancelled' }), forget: vi.fn(async () => Promise.reject(new Error('offline'))) };
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, s)).resolves.toEqual({ kind: 'cancelled' });
    const sync = {
      ...steps({ kind: 'failed' }),
      forget: vi.fn(() => {
        throw new Error('sync');
      }),
    };
    await expect(turnOnFingerprintFlow(PIXEL, APP_UA, sync)).resolves.toMatchObject({ kind: 'error' });
  });
});

describe('the phones, when they couldn’t be loaded', () => {
  it('says why in their place', () => {
    expect(devicesNotLoadedText({ kind: 'unavailable' })).toBe('Fingerprint sign-in isn’t on the server yet. Please try again after its next update.');
    expect(devicesNotLoadedText({ kind: 'forbidden' })).toBe('These phones aren’t yours to see.');
    expect(devicesNotLoadedText({ kind: 'failed', messages: ['Cannot reach the server. Please try again in a moment.'] })).toBe(
      'The phones couldn’t be loaded. Cannot reach the server. Please try again in a moment.',
    );
    expect(devicesNotLoadedText({ kind: 'failed', messages: [] })).toBe('The phones couldn’t be loaded.');
  });
});

describe('the sign-in page, after the fingerprint was asked for', () => {
  it('changes nothing when the prompt is closed', () => {
    expect(afterUnlock('cancelled')).toEqual({ clear: false, hide: false, notice: null });
  });

  it('forgets the phone’s copy when the fingerprints changed: the password', () => {
    expect(afterUnlock('key_invalidated')).toEqual({ clear: true, hide: true, notice: { tone: 'warn', text: 'Your fingerprints changed: sign in with your password.' } });
  });

  it('keeps the credential after too many tries, saying so', () => {
    expect(afterUnlock('lockout')).toEqual({ clear: false, hide: false, notice: { tone: 'warn', text: 'Too many tries with the fingerprint. Sign in with your password.' } });
  });

  it('hides the button when the fingerprint can’t be read, or isn’t there after all', () => {
    expect(afterUnlock('failed')).toEqual({ clear: false, hide: true, notice: { tone: 'warn', text: 'The fingerprint couldn’t be read. Sign in with your password.' } });
    expect(afterUnlock('unavailable')).toEqual({ clear: false, hide: true, notice: null });
  });

  it('forgets the phone’s copy when the API refuses it, whatever the reason', () => {
    for (const refusal of ['unknown', 'revoked', 'expired'] as const) {
      expect(afterSignIn({ refusal })).toEqual({ clear: true, hide: true, notice: { tone: 'warn', text: 'Sign in with your password this time.' } });
    }
  });

  it('shows what went wrong otherwise, the button kept to try again', () => {
    const tooMany = 'Too many fingerprint sign-in attempts. Sign in with your password, or try again in 15 minutes.';
    expect(afterSignIn({ error: tooMany })).toEqual({ clear: false, hide: false, notice: { tone: 'danger', text: tooMany } });
    expect(afterSignIn({ error: 'Cannot reach the server. Please try again in a moment.' }).notice?.tone).toBe('danger');
    expect(afterSignIn({})).toEqual({ clear: false, hide: false, notice: null });
  });
});
