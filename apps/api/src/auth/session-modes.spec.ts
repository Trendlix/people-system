import {
  choosesMode,
  DEVELOPER_ACTS_AS,
  IDLE_TIMEOUT_MS,
  isSessionMode,
  modeOfSession,
  modeSwitchText,
  otherMode,
  ownRoles,
  startingMode,
} from '@trendlix/shared';
import { idleTimeoutFor } from './session-rules.js';
import { inMode, sessionUserIn, viewedAs, type SessionUser } from './session-user.js';
import { sessionClaims, tokenPayload } from './view-as.js';

// A developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a developer signin,
// give hin a switched to use the account as the main role assigned to him or as a developer, to not confuse him"): the
// mode kept on the session decides whom the API answers.

const DEV_EMPLOYEE: SessionUser = { id: 'u1', email: 'dev@test.local', roles: ['employee', 'developer'], employeeId: 'e1' };
const DEV_ONLY: SessionUser = { id: 'u2', email: 'contractor@test.local', roles: ['developer'], employeeId: null };
const EMPLOYEE: SessionUser = { id: 'u3', email: 'staff@test.local', roles: ['employee'], employeeId: 'e3' };

describe('who chooses', () => {
  it('a developer who holds another role; neither a developer alone nor anyone else', () => {
    expect(choosesMode(['employee', 'developer'])).toBe(true);
    expect(choosesMode(['developer', 'employee'])).toBe(true);
    expect(choosesMode(['developer'])).toBe(false);
    expect(choosesMode(['employee'])).toBe(false);
    expect(choosesMode(['super_admin', 'hr'])).toBe(false);
    expect(ownRoles(['employee', 'developer'])).toEqual(['employee']);
    expect(isSessionMode('self')).toBe(true);
    expect(isSessionMode('developer')).toBe(true);
    expect(isSessionMode('admin')).toBe(false);
    expect(isSessionMode(null)).toBe(false);
  });

  it('the mode a session is used in: the app always as themselves, a connector as a developer, the website as chosen', () => {
    expect(modeOfSession('app', null)).toBe('self');
    expect(modeOfSession('app', 'developer')).toBe('self');
    expect(modeOfSession('connector', 'self')).toBe('developer');
    expect(modeOfSession('web', 'self')).toBe('self');
    expect(modeOfSession('web', 'developer')).toBe('developer');
    expect(modeOfSession('web', null)).toBeNull();
    expect(modeOfSession('web', 'something else')).toBeNull();
    // what a sign-in starts with: 'self' in the app for someone who chooses, else nothing kept
    expect(startingMode(['employee', 'developer'], 'app')).toBe('self');
    expect(startingMode(['employee', 'developer'], 'web')).toBeNull();
    expect(startingMode(['developer'], 'app')).toBeNull();
    expect(startingMode(['employee'], 'app')).toBeNull();
  });
});

describe('the mode → the user the API answers as', () => {
  it('as themselves: their own roles, no developer view', () => {
    const self = inMode(DEV_EMPLOYEE, 'self');
    expect(self).toEqual({ ...DEV_EMPLOYEE, roles: ['employee'], mode: 'self' });
    expect(self.developer).toBeUndefined();
    // their 15 minutes are their own roles' (an employee's: none)
    expect(idleTimeoutFor(self.roles)).toBeNull();
  });

  it('as a developer, and before they choose: the developer view, read only, with the 15 minutes of an Admin', () => {
    for (const mode of ['developer', null] as const) {
      const dev = inMode(DEV_EMPLOYEE, mode);
      expect(dev).toMatchObject({ id: 'u1', employeeId: 'e1', developer: true, mode });
      expect(dev.roles).toEqual([...DEVELOPER_ACTS_AS]);
      expect(idleTimeoutFor(dev.roles)).toBe(IDLE_TIMEOUT_MS);
    }
  });

  it('a developer alone has no choice: always the developer view, without a mode, whatever the session keeps', () => {
    for (const mode of ['self', 'developer', null] as const) {
      const dev = inMode(DEV_ONLY, mode);
      expect(dev.developer).toBe(true);
      expect(dev.roles).toEqual([...DEVELOPER_ACTS_AS]);
      expect('mode' in dev).toBe(false);
    }
  });

  it('anyone else as they are', () => {
    expect(inMode(EMPLOYEE, 'developer')).toEqual(EMPLOYEE);
    expect(inMode(EMPLOYEE, null)).toEqual(EMPLOYEE);
  });

  it('by the session: the website as chosen, the app as themselves', () => {
    expect(sessionUserIn(DEV_EMPLOYEE, { kind: 'web', mode: null })).toMatchObject({ developer: true, mode: null });
    expect(sessionUserIn(DEV_EMPLOYEE, { kind: 'web', mode: 'developer' })).toMatchObject({ developer: true, mode: 'developer' });
    expect(sessionUserIn(DEV_EMPLOYEE, { kind: 'web', mode: 'self' })).toEqual({ ...DEV_EMPLOYEE, roles: ['employee'], mode: 'self' });
    expect(sessionUserIn(DEV_EMPLOYEE, { kind: 'app', mode: null })).toMatchObject({ roles: ['employee'], mode: 'self' });
    expect(sessionUserIn(DEV_EMPLOYEE, { kind: 'app', mode: null }).developer).toBeUndefined();
  });

  it('viewed as by a Super Admin: as themselves unless the banner says as a developer', () => {
    expect(viewedAs(DEV_EMPLOYEE)).toMatchObject({ roles: ['employee'], mode: 'self' });
    expect(viewedAs(DEV_EMPLOYEE, 'developer')).toMatchObject({ developer: true, mode: 'developer' });
    expect(viewedAs(DEV_ONLY).developer).toBe(true);
    expect(viewedAs(EMPLOYEE, 'developer')).toEqual(EMPLOYEE);
  });

  it('the switch: the mode in use, one click to the other', () => {
    expect(modeSwitchText('developer')).toBe('Using as: Developer');
    expect(modeSwitchText('self')).toBe('Using as: Yourself');
    expect(otherMode('developer')).toBe('self');
    expect(otherMode('self')).toBe('developer');
  });
});

describe('the view-as token: seeing them as a developer', () => {
  const SUPER = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const SID = '33333333-3333-4333-8333-333333333333';
  const EXP = 2_000_000_000;

  it('kept only while viewing as someone, only as a developer (themselves is the default)', () => {
    const claims = { sub: SUPER, sid: SID, viewAs: OTHER, act: false, viewMode: 'developer' as const, exp: EXP };
    expect(tokenPayload(claims)).toEqual({ sub: SUPER, sid: SID, viewAs: OTHER, act: false, viewMode: 'developer', exp: EXP });
    expect(sessionClaims(tokenPayload(claims))).toEqual(claims);
    expect(sessionClaims({ sub: SUPER, sid: SID, viewAs: OTHER, act: false, exp: EXP })).toEqual({ sub: SUPER, sid: SID, viewAs: OTHER, act: false, exp: EXP });
    expect(tokenPayload({ sub: SUPER, sid: SID, viewAs: null, act: false, viewMode: 'developer', exp: EXP })).toEqual({ sub: SUPER, sid: SID, exp: EXP });
    expect(() => sessionClaims({ sub: SUPER, sid: SID, viewMode: 'developer', exp: EXP })).toThrow();
    expect(() => sessionClaims({ sub: SUPER, sid: SID, viewAs: OTHER, act: false, viewMode: 'admin', exp: EXP })).toThrow();
    expect(() => sessionClaims({ sub: SUPER, sid: SID, viewAs: OTHER, act: false, viewMode: 'self', exp: EXP })).toThrow();
  });
});
