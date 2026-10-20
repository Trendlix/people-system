import { IDLE_TIMEOUT_MS, idleTimeoutApplies, isSignedOutReason, sessionKindOf, signedOutMessage } from '@trendlix/shared';
import {
  ACTIVITY_THROTTLE_MS,
  endedBySignIn,
  idleMsLeft,
  idleTimeoutFor,
  keptIp,
  keptUserAgent,
  sessionVerdict,
  signedOutBody,
  type SessionState,
} from './session-rules.js';

// Sessions kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes
// inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session"; a second
// sign-in of the same kind: the new one wins; the 15 minutes for HR, Admin and Super Admin on the website and the app).

const USER = '0b6f4a59-1d0e-4d55-9a3c-5f4c1b1e2a01';
const NOW = new Date('2026-10-20T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

function session(over: Partial<SessionState> = {}): SessionState {
  return { userId: USER, kind: 'web', lastActiveAt: ago(MIN), expiresAt: new Date(NOW.getTime() + 60 * MIN), endedAt: null, endReason: null, ...over };
}

describe('sessionKindOf', () => {
  it('is the app for the TrendLIX People app, whose web view adds its mark at the end of the user agent', () => {
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 TrendLIXPeople';
    expect(sessionKindOf(android)).toBe('app');
    expect(sessionKindOf(`${android}  `)).toBe('app');
  });

  it('is the website for any browser, a phone browser too, or no user agent', () => {
    expect(sessionKindOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('web');
    expect(sessionKindOf('Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36')).toBe('web');
    expect(sessionKindOf('TrendLIXPeople Mozilla/5.0')).toBe('web'); // the mark is at the end, as the app adds it
    expect(sessionKindOf('')).toBe('web');
    expect(sessionKindOf(null)).toBe('web');
    expect(sessionKindOf(undefined)).toBe('web');
  });
});

describe('the 15 minutes', () => {
  it('are for HR, Admin and Super Admin, whatever else they hold', () => {
    for (const roles of [['hr'], ['admin'], ['super_admin'], ['employee', 'hr'], ['manager', 'admin'], ['ceo', 'super_admin']]) {
      expect(idleTimeoutApplies(roles)).toBe(true);
      expect(idleTimeoutFor(roles)).toBe(15 * MIN);
    }
  });

  it('are not for an employee, a manager, Finance or the CEO', () => {
    for (const roles of [['employee'], ['manager'], ['finance'], ['ceo'], ['employee', 'manager', 'finance', 'ceo'], []]) {
      expect(idleTimeoutApplies(roles)).toBe(false);
      expect(idleTimeoutFor(roles)).toBeNull();
    }
  });

  it('say how long is left, never below zero', () => {
    expect(IDLE_TIMEOUT_MS).toBe(15 * MIN);
    expect(idleMsLeft(ago(MIN), IDLE_TIMEOUT_MS, NOW)).toBe(14 * MIN);
    expect(idleMsLeft(ago(20 * MIN), IDLE_TIMEOUT_MS, NOW)).toBe(0);
    expect(idleMsLeft(ago(MIN), null, NOW)).toBeNull();
  });
});

describe('sessionVerdict', () => {
  it('lets an open session through, counting the request as activity once the last kept is 30 seconds old', () => {
    expect(sessionVerdict(session(), USER, ['hr'], NOW, false)).toEqual({ ok: true, touch: true });
    expect(sessionVerdict(session({ lastActiveAt: ago(ACTIVITY_THROTTLE_MS - 1) }), USER, ['hr'], NOW, false)).toEqual({ ok: true, touch: false });
    expect(sessionVerdict(session({ lastActiveAt: ago(ACTIVITY_THROTTLE_MS) }), USER, ['hr'], NOW, false)).toEqual({ ok: true, touch: true });
  });

  it('never counts a request the web made by itself (x-background)', () => {
    expect(sessionVerdict(session({ lastActiveAt: ago(10 * MIN) }), USER, ['hr'], NOW, true)).toEqual({ ok: true, touch: false });
  });

  it('ends HR’s, an Admin’s and a Super Admin’s session after 15 minutes without activity, even for a background request', () => {
    for (const roles of [['hr'], ['admin'], ['super_admin']]) {
      for (const background of [false, true]) {
        expect(sessionVerdict(session({ lastActiveAt: ago(15 * MIN + 1) }), USER, roles, NOW, background)).toEqual({ ok: false, reason: 'idle', end: 'idle' });
      }
      // 15 minutes exactly: still valid
      expect(sessionVerdict(session({ lastActiveAt: ago(15 * MIN) }), USER, roles, NOW, false)).toMatchObject({ ok: true });
    }
  });

  it('never times out an employee, a manager, Finance or the CEO', () => {
    for (const roles of [['employee'], ['manager'], ['finance'], ['ceo']]) {
      expect(sessionVerdict(session({ lastActiveAt: ago(7 * 60 * MIN) }), USER, roles, NOW, false)).toEqual({ ok: true, touch: true });
    }
  });

  it('refuses an ended session with the reason it ended', () => {
    for (const endReason of ['signed_out', 'replaced', 'idle', 'expired', 'revoked']) {
      expect(sessionVerdict(session({ endedAt: ago(MIN), endReason }), USER, ['employee'], NOW, false)).toEqual({ ok: false, reason: endReason });
    }
    expect(sessionVerdict(session({ endedAt: ago(MIN), endReason: 'something else' }), USER, ['employee'], NOW, false)).toEqual({ ok: false, reason: 'ended' });
  });

  it('ends a session past its 8 hours', () => {
    expect(sessionVerdict(session({ expiresAt: NOW }), USER, ['employee'], NOW, false)).toEqual({ ok: false, reason: 'expired', end: 'expired' });
  });

  it('refuses a session that isn’t there, or is another user’s', () => {
    expect(sessionVerdict(null, USER, ['hr'], NOW, false)).toEqual({ ok: false, reason: 'ended' });
    expect(sessionVerdict(session({ userId: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e04' }), USER, ['hr'], NOW, false)).toEqual({ ok: false, reason: 'ended' });
  });
});

describe('endedBySignIn', () => {
  const open = [
    { id: 'web-1', kind: 'web', expiresAt: new Date(NOW.getTime() + MIN) },
    { id: 'app-1', kind: 'app', expiresAt: new Date(NOW.getTime() + MIN) },
    { id: 'web-old', kind: 'web', expiresAt: ago(MIN) },
  ];

  it('ends the open sessions of the same kind (the new one wins) and leaves the other kind', () => {
    expect(endedBySignIn(open, 'web', NOW).map((e) => [e.session.id, e.reason])).toEqual([
      ['web-1', 'replaced'],
      ['web-old', 'expired'], // already past its 8 hours: not replaced
    ]);
    expect(endedBySignIn(open, 'app', NOW).map((e) => [e.session.id, e.reason])).toEqual([['app-1', 'replaced']]);
    expect(endedBySignIn([], 'web', NOW)).toEqual([]);
  });
});

describe('what the sign-in page says', () => {
  it('says why, in the owner’s words', () => {
    expect(signedOutMessage('idle')).toBe('You were signed out after 15 minutes without activity.');
    expect(signedOutMessage('replaced')).toBe('You were signed out because you signed in on another device.');
    for (const reason of ['signed_out', 'expired', 'revoked', 'ended'] as const) expect(signedOutMessage(reason)).toBe('Your session ended.');
  });

  it('is the 401’s message, with the reason’s code', () => {
    expect(signedOutBody('idle')).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'You were signed out after 15 minutes without activity.', reason: 'idle' });
  });

  it('knows the reasons', () => {
    for (const r of ['signed_out', 'replaced', 'idle', 'expired', 'revoked', 'ended']) expect(isSignedOutReason(r)).toBe(true);
    for (const r of ['', 'other', null, undefined, 1]) expect(isSignedOutReason(r)).toBe(false);
  });
});

describe('what is kept of where a session was signed in', () => {
  it('keeps a user agent trimmed and at most 300 characters', () => {
    expect(keptUserAgent('  Mozilla/5.0  ')).toBe('Mozilla/5.0');
    expect(keptUserAgent('x'.repeat(400))).toHaveLength(300);
    expect(keptUserAgent('   ')).toBeNull();
    expect(keptUserAgent(undefined)).toBeNull();
  });

  it('keeps an IP address only when it looks like one', () => {
    expect(keptIp('41.33.10.2')).toBe('41.33.10.2');
    expect(keptIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(keptIp('2001:db8::1')).toBe('2001:db8::1');
    expect(keptIp('<script>')).toBeNull();
    expect(keptIp(null)).toBeNull();
  });
});
