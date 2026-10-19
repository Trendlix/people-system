import type { SessionUser } from '../auth/session-user.js';
import { decidesStage, hrMayCancel, noLeaveMessage, othersWhere, scopeWhere, seesRequest, waitingWhere, waitsFor, type Caller } from './access.js';

// Who sees, decides and cancels a leave request (owner, 18 October 2026: the direct manager, then HR; no manager:
// straight to HR; nobody decides their own).

const user = (roles: SessionUser['roles']): SessionUser => ({ id: 'user', email: 'x@test.local', roles }) as SessionUser;
const caller = (roles: SessionUser['roles'], employeeId: string | null): Caller => ({ user: user(roles), employeeId });
const request = { employeeId: 'ben', managerId: 'mona', currentManagerId: 'mona' };

describe('leave access', () => {
  it('its employee, the manager it was sent to, their manager now, HR and the CEO see it; Finance and others don’t', () => {
    expect(seesRequest(request, caller(['employee'], 'ben'))).toBe(true);
    expect(seesRequest(request, caller(['manager'], 'mona'))).toBe(true);
    expect(seesRequest({ ...request, currentManagerId: 'omar' }, caller(['manager'], 'omar'))).toBe(true);
    expect(seesRequest(request, caller(['hr'], null))).toBe(true);
    expect(seesRequest(request, caller(['ceo'], null))).toBe(true);
    expect(seesRequest(request, caller(['finance'], 'fay'))).toBe(false);
    expect(seesRequest(request, caller(['employee'], 'sam'))).toBe(false);
  });

  it('the manager decides the manager stage, HR the HR stage; nobody their own', () => {
    expect(decidesStage('manager', request, caller(['manager'], 'mona'))).toBe(true);
    expect(decidesStage('manager', request, caller(['hr'], 'hana'))).toBe(false);
    expect(decidesStage('hr', request, caller(['hr'], 'hana'))).toBe(true);
    expect(decidesStage('hr', request, caller(['manager'], 'mona'))).toBe(false);
    expect(decidesStage('hr', { ...request, employeeId: 'hana' }, caller(['hr'], 'hana'))).toBe(false);
    expect(waitsFor({ ...request, status: 'with_manager' }, caller(['manager'], 'mona'))).toBe(true);
    expect(waitsFor({ ...request, status: 'with_hr' }, caller(['manager'], 'mona'))).toBe(false);
    expect(waitsFor({ ...request, status: 'approved' }, caller(['hr'], null))).toBe(false);
  });

  it('HR cancels approved leave, never its own', () => {
    expect(hrMayCancel({ ...request, status: 'approved' }, caller(['hr'], 'hana'))).toBe(true);
    expect(hrMayCancel({ ...request, status: 'with_hr' }, caller(['hr'], 'hana'))).toBe(false);
    expect(hrMayCancel({ ...request, employeeId: 'hana', status: 'approved' }, caller(['hr'], 'hana'))).toBe(false);
    expect(hrMayCancel({ ...request, status: 'approved' }, caller(['ceo'], null))).toBe(false);
  });

  it('waiting: the manager’s with them, HR’s with HR, never their own; lists: everyone’s for HR and the CEO, a manager’s team', () => {
    expect(waitingWhere(caller(['hr', 'manager'], 'hana'))).toEqual({ OR: [{ status: 'with_manager', managerId: 'hana' }, { status: 'with_hr' }], employeeId: { not: 'hana' } });
    expect(waitingWhere(caller(['employee'], null))).toEqual({ id: { in: [] } });
    expect(scopeWhere(caller(['ceo'], null))).toEqual({});
    expect(othersWhere(caller(['hr'], 'hana'))).toEqual({});
    expect(othersWhere(caller(['manager'], 'mona'))).toMatchObject({ employeeId: { not: 'mona' } });
    expect(scopeWhere(caller(['employee'], null))).toEqual({ id: { in: [] } });
  });

  it('says why there is no leave outside the labour law: a freelancer’s, and an unpaid intern’s (19 October 2026)', () => {
    expect(noLeaveMessage('freelance', 'Farid Freelance')).toBe('Farid Freelance is a freelancer, outside the labour law: there is no leave to record for a freelance employment.');
    expect(noLeaveMessage('freelance', null)).toBe('You work freelance, outside the labour law: there is no leave to ask for under a freelance employment.');
    expect(noLeaveMessage('intern', 'Ilham Intern')).toBe('Ilham Intern is an unpaid intern, outside the labour law: there is no leave to record for an unpaid internship.');
    expect(noLeaveMessage('intern', null)).toBe('You are an unpaid intern, outside the labour law: there is no leave to ask for under an unpaid internship.');
  });
});

// A C-level person's leave (owner, 19 October 2026: "make C level Employees details not visible to HR"; their HR stages
// go to the CEO): HR's stage is the CEO's; HR and their manager now don't see it, the manager it was sent to does.
describe('a C-level person’s leave', () => {
  const asC = (roles: SessionUser['roles'], employeeId: string | null): Caller => {
    const sees = roles.includes('ceo') || roles.includes('super_admin');
    return { ...caller(roles, employeeId), confidential: { sees, all: new Set(['ben']), hidden: new Set(sees || employeeId === 'ben' ? [] : ['ben']) } };
  };

  it('is seen by its employee, the manager it was sent to and the CEO; not HR, nor their manager now', () => {
    expect(seesRequest(request, asC(['employee'], 'ben'))).toBe(true);
    expect(seesRequest(request, asC(['manager'], 'mona'))).toBe(true);
    expect(seesRequest(request, asC(['ceo'], null))).toBe(true);
    expect(seesRequest(request, asC(['hr'], null))).toBe(false);
    expect(seesRequest({ ...request, currentManagerId: 'omar' }, asC(['manager'], 'omar'))).toBe(false);
    expect(seesRequest(request, asC(['hr', 'super_admin'], null))).toBe(true);
  });

  it('has HR’s stage decided by the CEO or HR with Super Admin, never their own; HR cancels it only with Super Admin', () => {
    expect(decidesStage('hr', request, asC(['ceo'], null))).toBe(true);
    expect(decidesStage('hr', request, asC(['hr'], null))).toBe(false);
    expect(decidesStage('hr', request, asC(['hr', 'super_admin'], null))).toBe(true);
    expect(decidesStage('hr', request, asC(['ceo'], 'ben'))).toBe(false);
    expect(decidesStage('manager', request, asC(['manager'], 'mona'))).toBe(true);
    expect(hrMayCancel({ ...request, status: 'approved' }, asC(['hr'], 'hana'))).toBe(false);
    expect(hrMayCancel({ ...request, status: 'approved' }, asC(['hr', 'super_admin'], 'hana'))).toBe(true);
  });

  it('waits for the CEO at HR’s stage, and is left out of HR’s queue and lists', () => {
    expect(waitsFor({ ...request, status: 'with_hr' }, asC(['ceo'], null))).toBe(true);
    expect(waitingWhere(asC(['ceo'], null))).toEqual({ OR: [{ status: 'with_hr', employeeId: { in: ['ben'] } }] });
    expect(waitingWhere(asC(['hr'], null))).toEqual({ OR: [{ status: 'with_hr', employeeId: { notIn: ['ben'] } }] });
    expect(scopeWhere(asC(['hr'], null))).toEqual({ employeeId: { notIn: ['ben'] } });
    expect(scopeWhere(asC(['hr'], 'hana'))).toEqual({ OR: [{ employeeId: { notIn: ['ben'] } }, { managerId: 'hana' }] });
    expect(othersWhere(asC(['ceo'], null))).toEqual({});
  });
});
