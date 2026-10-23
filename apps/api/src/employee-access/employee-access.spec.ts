import type { ConfigService } from '@nestjs/config';
import {
  ACCESS_LINK_STATE_TEXT,
  ACCESS_STATE_LABELS,
  ACCESS_STATES,
  accessStateOf,
  accountEmail,
  FORGOT_PASSWORD_ANSWER,
  isAccessState,
  isAccessToken,
  isSignInEmailChoice,
  setPasswordPath,
  signInEmailOf,
  type AccessStateInput,
} from '@trendlix/shared';
import { randomBytes } from 'node:crypto';
import { accountableEmployment, inForceEmployment } from './access-state.js';
import { tokenHashOf, webOriginOf } from './employee-access.service.js';

// The rules of every employee's access (owner, 22 October 2026: "any active employee with active contract should have
// access"): the email they sign in with as HR chose it, where each one stands, and the set-password links' tokens.

const NOW = '2026-10-22T10:00:00.000Z';
const LATER = '2026-10-29T10:00:00.000Z';
const EARLIER = '2026-10-21T10:00:00.000Z';

const input = (over: Partial<AccessStateInput> = {}): AccessStateInput => ({ account: null, link: null, eligible: true, email: 'a@trendlix.com', clash: false, ...over });

describe('the sign-in email', () => {
  it('is the work email unless HR chose the personal one, kept in lower case and trimmed', () => {
    expect(signInEmailOf({ workEmail: ' Mona@Trendlix.com ', personalEmail: 'mona@gmail.com' })).toEqual({ choice: 'work', email: 'mona@trendlix.com' });
    expect(signInEmailOf({ workEmail: 'mona@trendlix.com', personalEmail: 'Mona@Gmail.com', signInEmail: 'personal' })).toEqual({ choice: 'personal', email: 'mona@gmail.com' });
    expect(signInEmailOf({ workEmail: 'mona@trendlix.com', personalEmail: 'mona@gmail.com', signInEmail: 'work' })).toEqual({ choice: 'work', email: 'mona@trendlix.com' });
  });

  it('falls back to the other email when the chosen one is missing, and is none without either', () => {
    expect(signInEmailOf({ workEmail: null, personalEmail: 'mona@gmail.com' })).toEqual({ choice: 'personal', email: 'mona@gmail.com' });
    expect(signInEmailOf({ workEmail: 'mona@trendlix.com', personalEmail: null, signInEmail: 'personal' })).toEqual({ choice: 'work', email: 'mona@trendlix.com' });
    expect(signInEmailOf({ workEmail: '  ', personalEmail: '', signInEmail: 'work' })).toBeNull();
    expect(signInEmailOf({ workEmail: null, personalEmail: null })).toBeNull();
  });

  it('knows its choices, and an account email is trimmed lower case', () => {
    expect(isSignInEmailChoice('work')).toBe(true);
    expect(isSignInEmailChoice('personal')).toBe(true);
    expect(isSignInEmailChoice('other')).toBe(false);
    expect(isSignInEmailChoice(null)).toBe(false);
    expect(accountEmail('  A@B.COM ')).toBe('a@b.com');
    expect(accountEmail('   ')).toBeNull();
    expect(accountEmail(undefined)).toBeNull();
  });
});

describe('where an employee stands', () => {
  it('without an account: no email, no active contract, being set up, or an email in use', () => {
    expect(accessStateOf(input({ email: null }), NOW)).toBe('no_email');
    expect(accessStateOf(input({ email: null, eligible: false }), NOW)).toBe('no_email');
    expect(accessStateOf(input({ eligible: false }), NOW)).toBe('not_eligible');
    expect(accessStateOf(input(), NOW)).toBe('pending');
    expect(accessStateOf(input({ clash: true }), NOW)).toBe('clash');
  });

  it('with an account: closed when turned off, active with a password, else invited while a link works', () => {
    const account = { isActive: true, passwordSet: false };
    expect(accessStateOf(input({ account }), NOW)).toBe('not_invited');
    expect(accessStateOf(input({ account, link: { expiresAt: LATER } }), NOW)).toBe('invited');
    expect(accessStateOf(input({ account, link: { expiresAt: EARLIER } }), NOW)).toBe('not_invited');
    expect(accessStateOf(input({ account: { isActive: true, passwordSet: true }, link: { expiresAt: LATER } }), NOW)).toBe('active');
    expect(accessStateOf(input({ account: { isActive: false, passwordSet: true } }), NOW)).toBe('closed');
    // an account kept while their contract isn't in force still says where it stands (listed, never closed by it)
    expect(accessStateOf(input({ account: { isActive: true, passwordSet: true }, eligible: false }), NOW)).toBe('active');
  });

  it('has a label for every state', () => {
    for (const s of ACCESS_STATES) {
      expect(isAccessState(s)).toBe(true);
      expect(ACCESS_STATE_LABELS[s]).toMatch(/^[A-Z]/);
    }
    expect(isAccessState('nope')).toBe(false);
  });
});

describe('set-password links', () => {
  it('carry a 43-character base64url token, of which only the SHA-256 is kept', () => {
    const token = randomBytes(32).toString('base64url');
    expect(isAccessToken(token)).toBe(true);
    expect(tokenHashOf(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHashOf(token)).toBe(tokenHashOf(token));
    expect(tokenHashOf(token)).not.toBe(tokenHashOf(randomBytes(32).toString('base64url')));
    expect(isAccessToken(token.slice(1))).toBe(false);
    expect(isAccessToken(`${token.slice(1)}=`)).toBe(false);
    expect(isAccessToken('../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(isAccessToken(42)).toBe(false);
    // the token after a #: never sent to a server, so never in a request log
    expect(setPasswordPath(token)).toBe(`/set-password#${token}`);
  });

  it('point at the website set on the server, never at the address a request came from', () => {
    const config = (origin?: string) => ({ get: () => origin }) as unknown as ConfigService;
    expect(webOriginOf(config())).toBe('https://people.trendlix.com');
    expect(webOriginOf(config('https://people.example.test/'))).toBe('https://people.example.test');
    expect(webOriginOf(config('  '))).toBe('https://people.trendlix.com');
  });

  it('say in words why one doesn’t work, and Forgot password answers the same whatever the email', () => {
    expect(ACCESS_LINK_STATE_TEXT.expired).toContain('expired');
    expect(ACCESS_LINK_STATE_TEXT.used).toContain('used');
    expect(ACCESS_LINK_STATE_TEXT.unknown).toContain('doesn’t work');
    expect(FORGOT_PASSWORD_ANSWER).toContain('If that email has an account');
  });
});

describe('an active employee with an active contract', () => {
  it('is a current employment with a signed contract in force today (a version replaced ahead of its start still counts)', () => {
    const where = inForceEmployment('2026-10-22');
    const day = new Date('2026-10-22T00:00:00.000Z');
    expect(where).toEqual({
      OR: [{ endDate: null }, { endDate: { gte: day } }],
      contracts: { some: { status: { in: ['active', 'superseded', 'ended'] }, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gte: day } }] } },
    });
  });

  it('gets an account once a signed contract has started, in force or on Hold or Grace since (23 October 2026)', () => {
    const day = new Date('2026-10-22T00:00:00.000Z');
    expect(accountableEmployment('2026-10-22')).toEqual({
      OR: [{ endDate: null }, { endDate: { gte: day } }],
      contracts: { some: { status: { in: ['active', 'superseded', 'ended'] }, startDate: { lte: day } } },
    });
  });
});
