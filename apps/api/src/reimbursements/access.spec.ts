import type { Role } from '@trendlix/shared';
import { decidesStage, isClaimant, isClaimManager, seesClaim, seesEveryClaim, waitingWhere, waitsFor, type Caller } from './access.js';

// Who sees, decides and cancels a reimbursement claim (owner, 18 October 2026; asked, the owner chose the direct
// manager, then HR, then Finance): the employee who claimed it, the manager it was sent to, HR, Finance and the CEO see
// it; each stage's decider decides it; nobody their own.

const as = (roles: Role[], employeeId: string | null = null): Caller => ({ user: { id: `user-${employeeId ?? roles.join('-')}`, email: 'x@test.local', roles }, employeeId });
const CLAIM = { employeeId: 'ben', managerId: 'mona' };

describe('who sees a claim', () => {
  it('is the employee, the manager it was sent to, HR, Finance and the CEO', () => {
    expect(seesClaim(CLAIM, as(['employee'], 'ben'))).toBe(true);
    expect(seesClaim(CLAIM, as(['manager'], 'mona'))).toBe(true);
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(seesClaim(CLAIM, as([role]))).toBe(true);
    expect(seesClaim(CLAIM, as(['employee'], 'sam'))).toBe(false);
    expect(seesClaim(CLAIM, as(['manager'], 'other-manager'))).toBe(false);
    // an Admin or Super Admin isn't one of them
    expect(seesClaim(CLAIM, as(['admin']))).toBe(false);
    expect(seesClaim(CLAIM, as(['super_admin']))).toBe(false);
    expect(seesEveryClaim(as(['super_admin']).user)).toBe(false);
  });

  it('never matches a sign-in without an employee profile to a claim without a manager', () => {
    const noManager = { employeeId: 'ben', managerId: null };
    expect(isClaimManager(noManager, as(['manager']))).toBe(false);
    expect(isClaimant(noManager, as(['employee']))).toBe(false);
    expect(seesClaim(noManager, as(['employee']))).toBe(false);
  });
});

describe('who decides it', () => {
  it('is the manager it was sent to, then HR, then Finance', () => {
    expect(decidesStage('manager', CLAIM, as(['manager'], 'mona'))).toBe(true);
    expect(decidesStage('manager', CLAIM, as(['hr']))).toBe(false);
    expect(decidesStage('hr', CLAIM, as(['hr']))).toBe(true);
    expect(decidesStage('hr', CLAIM, as(['finance']))).toBe(false);
    expect(decidesStage('finance', CLAIM, as(['finance']))).toBe(true);
    expect(decidesStage('finance', CLAIM, as(['ceo']))).toBe(false);
    expect(decidesStage('hr', CLAIM, as(['super_admin']))).toBe(false);
  });

  it('is never the employee themself, whatever their roles', () => {
    expect(decidesStage('hr', CLAIM, as(['hr'], 'ben'))).toBe(false);
    expect(decidesStage('finance', CLAIM, as(['finance', 'hr'], 'ben'))).toBe(false);
  });

  it('waits for the caller only at their stage', () => {
    expect(waitsFor({ ...CLAIM, status: 'with_manager' }, as(['manager'], 'mona'))).toBe(true);
    expect(waitsFor({ ...CLAIM, status: 'with_hr' }, as(['manager'], 'mona'))).toBe(false);
    expect(waitsFor({ ...CLAIM, status: 'with_hr' }, as(['hr']))).toBe(true);
    expect(waitsFor({ ...CLAIM, status: 'with_finance' }, as(['hr', 'finance']))).toBe(true);
    for (const status of ['approved', 'rejected', 'cancelled']) expect(waitsFor({ ...CLAIM, status }, as(['hr', 'finance'], 'mona'))).toBe(false);
  });
});

describe('the claims waiting for the caller', () => {
  it('are their reports’ with them, HR’s and Finance’s stages by role, never their own', () => {
    expect(waitingWhere(as(['manager'], 'mona'))).toEqual({ OR: [{ status: 'with_manager', managerId: 'mona' }], employeeId: { not: 'mona' } });
    expect(waitingWhere(as(['hr', 'finance']))).toEqual({ OR: [{ status: 'with_hr' }, { status: 'with_finance' }] });
    expect(waitingWhere(as(['hr'], 'hana'))).toEqual({ OR: [{ status: 'with_manager', managerId: 'hana' }, { status: 'with_hr' }], employeeId: { not: 'hana' } });
  });

  it('are none for one who decides nothing', () => {
    expect(waitingWhere(as(['ceo']))).toEqual({ id: { in: [] } });
    expect(waitingWhere(as(['super_admin']))).toEqual({ id: { in: [] } });
  });
});

// A C-level person's claim (owner, 19 October 2026: "make C level Employees details not visible to HR"; their HR stages
// go to the CEO): HR's and Finance's stages are the CEO's; HR and Finance neither see nor count it.
describe('a C-level person’s claim', () => {
  const view = (sees: boolean, self: string | null = null) => ({ sees, all: new Set(['ben']), hidden: new Set(sees || self === 'ben' ? [] : ['ben']) });
  const asC = (roles: Role[], employeeId: string | null = null): Caller => ({ ...as(roles, employeeId), confidential: view(roles.includes('ceo') || roles.includes('super_admin'), employeeId) });

  it('is seen by its employee, the manager it was sent to and the CEO; not by HR nor Finance', () => {
    expect(seesClaim(CLAIM, asC(['employee'], 'ben'))).toBe(true);
    expect(seesClaim(CLAIM, asC(['manager'], 'mona'))).toBe(true);
    expect(seesClaim(CLAIM, asC(['ceo']))).toBe(true);
    expect(seesClaim(CLAIM, asC(['hr']))).toBe(false);
    expect(seesClaim(CLAIM, asC(['finance']))).toBe(false);
    expect(seesClaim(CLAIM, asC(['hr', 'super_admin']))).toBe(true);
  });

  it('has its HR and Finance stages decided by the CEO, or HR and Finance with Super Admin; the manager stage as before', () => {
    expect(decidesStage('manager', CLAIM, asC(['manager'], 'mona'))).toBe(true);
    expect(decidesStage('hr', CLAIM, asC(['ceo']))).toBe(true);
    expect(decidesStage('finance', CLAIM, asC(['ceo']))).toBe(true);
    expect(decidesStage('hr', CLAIM, asC(['hr']))).toBe(false);
    expect(decidesStage('finance', CLAIM, asC(['finance']))).toBe(false);
    expect(decidesStage('hr', CLAIM, asC(['hr', 'super_admin']))).toBe(true);
    expect(decidesStage('finance', CLAIM, asC(['hr', 'super_admin']))).toBe(false);
    // never the claimant's own, the CEO's neither
    expect(decidesStage('hr', CLAIM, asC(['ceo'], 'ben'))).toBe(false);
  });

  it('waits for the CEO at HR’s and Finance’s stages, and is left out of HR’s and Finance’s', () => {
    expect(waitsFor({ ...CLAIM, status: 'with_hr' }, asC(['ceo']))).toBe(true);
    expect(waitsFor({ ...CLAIM, status: 'with_finance' }, asC(['ceo']))).toBe(true);
    expect(waitsFor({ ...CLAIM, status: 'with_hr' }, asC(['hr']))).toBe(false);
    expect(waitingWhere(asC(['ceo']))).toEqual({ OR: [{ status: 'with_hr', employeeId: { in: ['ben'] } }, { status: 'with_finance', employeeId: { in: ['ben'] } }] });
    expect(waitingWhere(asC(['hr', 'finance']))).toEqual({ OR: [{ status: 'with_hr', employeeId: { notIn: ['ben'] } }, { status: 'with_finance', employeeId: { notIn: ['ben'] } }] });
    expect(waitingWhere(asC(['hr', 'super_admin']))).toEqual({ OR: [{ status: 'with_hr' }] });
    expect(waitingWhere(asC(['ceo', 'hr']))).toEqual({ OR: [{ status: 'with_hr' }, { status: 'with_finance', employeeId: { in: ['ben'] } }] });
  });
});
