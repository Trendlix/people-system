import { describe, expect, it } from 'vitest';
import { deviceOf } from './devices';
import { firstCheckInMs, GRACE_MS, NO_LIMIT_MS, RETRY_MS, stepAfter, warningText } from './idle-watch';
import { reasonOf, signedOutNotice, signInPath } from './signed-out';

// Sessions kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes
// inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session"): the
// sign-in page's words for why someone was signed out, the idle warning's timing, and the sessions' devices in words.

const MIN = 60_000;

describe('why someone was signed out', () => {
  it('says it in the owner’s words', () => {
    expect(signedOutNotice('idle')).toBe('You were signed out after 15 minutes without activity.');
    expect(signedOutNotice('replaced')).toBe('You were signed out because you signed in on another device.');
    for (const reason of ['signed_out', 'revoked', 'expired', 'ended']) expect(signedOutNotice(reason)).toBe('Your session ended.');
  });

  it('shows nothing for no reason, or one the API never gives', () => {
    for (const reason of [null, undefined, '', 'hacked', '<script>', ['idle']]) expect(signedOutNotice(reason)).toBeNull();
  });

  it('reads the reason from the API’s 401, and sends to the sign-in page with it', () => {
    expect(reasonOf({ statusCode: 401, message: 'You were signed out after 15 minutes without activity.', reason: 'idle' })).toBe('idle');
    expect(reasonOf({ statusCode: 401, message: 'Please sign in.' })).toBeNull();
    expect(reasonOf({ reason: 'whatever' })).toBeNull();
    expect(reasonOf(null)).toBeNull();
    expect(reasonOf('idle')).toBeNull();
    expect(signInPath('replaced')).toBe('/login?reason=replaced');
    expect(signInPath(null)).toBe('/login');
  });
});

describe('the idle warning’s timing', () => {
  const WARN = MIN;

  it('asks first before the warning is due, allowing for the API keeping activity every 30 seconds', () => {
    expect(firstCheckInMs(15 * MIN, WARN)).toBe(13 * MIN + 30_000);
    expect(firstCheckInMs(30_000, WARN)).toBe(0);
  });

  it('waits while more than a minute is left, then warns until the end', () => {
    expect(stepAfter({ status: 'active', idleMsLeft: 15 * MIN }, WARN)).toEqual({ kind: 'wait', checkInMs: 14 * MIN });
    expect(stepAfter({ status: 'active', idleMsLeft: MIN + 1 }, WARN)).toEqual({ kind: 'wait', checkInMs: 1 });
    expect(stepAfter({ status: 'active', idleMsLeft: MIN }, WARN)).toEqual({ kind: 'warn', endsInMs: MIN });
    expect(stepAfter({ status: 'active', idleMsLeft: 20_000 }, WARN)).toEqual({ kind: 'warn', endsInMs: 20_000 });
    expect(stepAfter({ status: 'active', idleMsLeft: -5 }, WARN)).toEqual({ kind: 'warn', endsInMs: 0 });
    expect(GRACE_MS).toBeGreaterThan(0);
  });

  it('goes to the sign-in page once the API says the session ended, with why', () => {
    expect(stepAfter({ status: 'ended', reason: 'idle' }, WARN)).toEqual({ kind: 'signedOut', reason: 'idle' });
    expect(stepAfter({ status: 'ended', reason: 'replaced' }, WARN)).toEqual({ kind: 'signedOut', reason: 'replaced' });
  });

  it('asks again later when the API can’t be reached, or has no limit for them any more', () => {
    expect(stepAfter({ status: 'unknown' }, WARN)).toEqual({ kind: 'wait', checkInMs: RETRY_MS });
    expect(stepAfter({ status: 'active', idleMsLeft: null }, WARN)).toEqual({ kind: 'wait', checkInMs: NO_LIMIT_MS });
  });

  it('counts down in its words', () => {
    expect(warningText(MIN)).toBe('You’ll be signed out in 1 minute.');
    expect(warningText(59_001)).toBe('You’ll be signed out in 1 minute.');
    expect(warningText(59_000)).toBe('You’ll be signed out in 59 seconds.');
    expect(warningText(2000)).toBe('You’ll be signed out in 2 seconds.');
    expect(warningText(400)).toBe('You’ll be signed out in 1 second.');
    expect(warningText(-10)).toBe('You’ll be signed out in 1 second.');
  });
});

describe('deviceOf', () => {
  it('names the browser and the system', () => {
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari on macOS');
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge on Windows');
    expect(deviceOf('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on Linux');
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe('Chrome on Android');
  });

  it('names the Trendlix People app', () => {
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 TrendLIXPeople')).toBe('Trendlix People app on Android');
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TrendLIXPeople')).toBe('Trendlix People app on iPhone');
  });

  it('says so when it can’t tell', () => {
    expect(deviceOf(null)).toBe('Unknown device');
    expect(deviceOf('')).toBe('Unknown device');
    expect(deviceOf('curl/8.4.0')).toBe('Unknown device');
  });
});
