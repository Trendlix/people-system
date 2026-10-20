import { changesData, msLeft, sessionClaims, tokenPayload, viewOnlyMessage } from './view-as.js';

const SUPER = '0b6f4a59-1d0e-4d55-9a3c-5f4c1b1e2a01';
const OTHER = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e04';
const SID = '3e2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b05'; // the session kept on the server (20 October 2026)
const EXP = 1_800_000_000;

describe('sessionClaims', () => {
  it('reads a session from signing in: no one viewed, never acting', () => {
    expect(sessionClaims({ sub: SUPER, sid: SID, iat: EXP - 100, exp: EXP })).toEqual({ sub: SUPER, sid: SID, viewAs: null, act: false, exp: EXP });
  });

  it('reads a switched session, view only or acting', () => {
    expect(sessionClaims({ sub: SUPER, sid: SID, viewAs: OTHER, act: false, exp: EXP })).toEqual({ sub: SUPER, sid: SID, viewAs: OTHER, act: false, exp: EXP });
    expect(sessionClaims({ sub: SUPER, sid: SID, viewAs: OTHER, act: true, exp: EXP })).toMatchObject({ sid: SID, viewAs: OTHER, act: true });
  });

  it('refuses claims this API never signs', () => {
    expect(() => sessionClaims(null)).toThrow();
    expect(() => sessionClaims({ exp: EXP })).toThrow();
    expect(() => sessionClaims({ sub: 'not-a-uuid', exp: EXP })).toThrow();
    expect(() => sessionClaims({ sub: SUPER, sid: SID })).toThrow(); // no expiry
    expect(() => sessionClaims({ sub: SUPER, sid: SID, act: true, exp: EXP })).toThrow(); // acting without viewing as anyone
    expect(() => sessionClaims({ sub: SUPER, sid: SID, viewAs: OTHER, exp: EXP })).toThrow(); // no act flag
    expect(() => sessionClaims({ sub: SUPER, sid: SID, viewAs: OTHER, act: 'yes', exp: EXP })).toThrow();
    expect(() => sessionClaims({ sub: SUPER, sid: SID, viewAs: SUPER, act: false, exp: EXP })).toThrow(); // as themself
    expect(() => sessionClaims({ sub: SUPER, sid: SID, viewAs: 'someone', act: false, exp: EXP })).toThrow();
  });

  it('refuses a token that names no session: one signed before sessions were kept (20 October 2026)', () => {
    expect(() => sessionClaims({ sub: SUPER, exp: EXP })).toThrow();
    expect(() => sessionClaims({ sub: SUPER, sid: 'not-a-uuid', exp: EXP })).toThrow();
    expect(() => sessionClaims({ sub: SUPER, viewAs: OTHER, act: false, exp: EXP })).toThrow();
  });
});

describe('tokenPayload', () => {
  it('keeps the session and expiry of the one it replaces, and only what is needed', () => {
    expect(tokenPayload({ sub: SUPER, sid: SID, viewAs: OTHER, act: true, exp: EXP })).toEqual({ sub: SUPER, sid: SID, viewAs: OTHER, act: true, exp: EXP });
    expect(tokenPayload({ sub: SUPER, sid: SID, viewAs: null, act: false, exp: EXP })).toEqual({ sub: SUPER, sid: SID, exp: EXP });
  });

  it('round-trips through sessionClaims', () => {
    const claims = { sub: SUPER, sid: SID, viewAs: OTHER, act: false, exp: EXP };
    expect(sessionClaims(tokenPayload(claims))).toEqual(claims);
  });
});

describe('msLeft', () => {
  it('is the time left before the session ends, never below zero', () => {
    expect(msLeft({ exp: EXP }, EXP * 1000 - 5000)).toBe(5000);
    expect(msLeft({ exp: EXP }, EXP * 1000 + 1)).toBe(0);
  });
});

describe('changesData', () => {
  it('lets reading through and counts everything else as a change', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) expect(changesData(m)).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) expect(changesData(m)).toBe(true);
  });
});

describe('viewOnlyMessage', () => {
  it('says whom and how to make changes', () => {
    expect(viewOnlyMessage('Nour Adel')).toBe('Viewing as Nour Adel: view only. Switch on Act as them to make changes.');
  });
});
