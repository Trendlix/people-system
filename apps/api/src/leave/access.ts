import { decidesConfidentialStage, isOpenLeave, leaveStage, type LeaveStage } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ConfidentialView } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';

// Who may see, decide and cancel a leave request (owner, 18 October 2026: the direct manager, then HR; no manager:
// straight to HR). Pure code: the rules themselves are packages/shared leaves.ts. A C-level person's request (owner, 19
// October 2026: "make C level Employees details not visible to HR"; their HR stages go to the CEO): HR's stage is the
// CEO's (or HR's with Super Admin: packages/shared decidesConfidentialStage); HR and their manager now don't see it, the
// manager it was sent to still decides the manager stage, as the request is theirs to decide. Permission requests
// (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked "In the system, like leave") are
// decided exactly as leave is, so these rules serve both tables (RequestWhere).

/**
 * The caller, their own employee profile (the one whose work email they sign in with), if any, and the C-level people,
 * those hidden from the caller among them (none left out: nobody is C-level).
 */
export interface Caller {
  user: SessionUser;
  employeeId: string | null;
  confidential?: ConfidentialView;
}

/** Whether the request is a C-level person's (its HR stage the CEO's). */
export const isConfidentialRequest = (r: Pick<RequestParties, 'employeeId'>, caller: Caller) => caller.confidential?.all.has(r.employeeId) ?? false;

/** Whether the request's person is hidden from the caller: C-level, and not the caller themself. */
export const hiddenRequest = (r: Pick<RequestParties, 'employeeId'>, caller: Caller) => caller.confidential?.hidden.has(r.employeeId) ?? false;

/**
 * A filter on the requests decided as leave is: leave requests and permission requests (19 October 2026) have the same
 * fields for whose they are, who decides them and where they stand, so one filter serves both tables.
 */
export type RequestWhere = Prisma.LeaveRequestWhereInput & Prisma.PermissionRequestWhereInput;

/** The hidden people, for the lists' filters. */
const hiddenIds = (caller: Caller) => [...(caller.confidential?.hidden ?? [])];

/**
 * What a request's access is worked out from: whose it is, the direct manager it was sent to (who decides its first
 * stage), and the employee's direct manager now, who sees their team's leave too.
 */
export interface RequestParties {
  employeeId: string;
  managerId: string | null;
  currentManagerId?: string | null;
}

/** HR and the CEO see every request. */
export const seesEveryRequest = (user: SessionUser) => actsAs(user.roles, ['hr', 'ceo']);

/** Only HR records leave on an employee's behalf, adjusts balances and closes a year. */
export const isHr = (user: SessionUser) => actsAs(user.roles, ['hr']);

/** The employee whose leave it is. */
export const isRequester = (r: RequestParties, caller: Caller) => caller.employeeId !== null && r.employeeId === caller.employeeId;

/** The direct manager it was sent to. */
export const isRequestManager = (r: RequestParties, caller: Caller) => caller.employeeId !== null && r.managerId === caller.employeeId;

/** The employee's direct manager now. */
export const isTeamManager = (r: RequestParties, caller: Caller) => caller.employeeId !== null && !!r.currentManagerId && r.currentManagerId === caller.employeeId;

/**
 * Who sees a request: its employee, the manager it was sent to, their manager now, HR and the CEO; a C-level person's,
 * not HR nor their manager now (owner, 19 October 2026), but the manager it was sent to.
 */
export const seesRequest = (r: RequestParties, caller: Caller) =>
  isRequester(r, caller) || isRequestManager(r, caller) || (!hiddenRequest(r, caller) && (seesEveryRequest(caller.user) || isTeamManager(r, caller)));

/**
 * Whether the caller decides a stage of the request: the manager stage the direct manager it was sent to, HR's stage
 * HR; a C-level person's HR stage the CEO (or HR with Super Admin); nobody their own request.
 */
export function decidesStage(stage: LeaveStage, r: RequestParties, caller: Caller): boolean {
  if (isRequester(r, caller)) return false;
  if (stage === 'manager') return isRequestManager(r, caller);
  if (isConfidentialRequest(r, caller)) return decidesConfidentialStage(caller.user, ['hr']);
  return isHr(caller.user);
}

/** Whether the request waits for the caller's decision now. */
export function waitsFor(r: RequestParties & { status: string }, caller: Caller): boolean {
  const stage = leaveStage(r.status);
  return stage !== null && decidesStage(stage, r, caller);
}

/**
 * Whether HR may cancel it (an approved one, restoring the balance): HR, never their own; a C-level person's only HR who
 * sees them (with Super Admin).
 */
export const hrMayCancel = (r: RequestParties & { status: string }, caller: Caller) =>
  r.status === 'approved' && isHr(caller.user) && !isRequester(r, caller) && !hiddenRequest(r, caller);

/**
 * The requests waiting for the caller's decision: those with them as the direct manager, those with HR for HR, a C-level
 * person's with HR for the CEO (and HR with Super Admin), not for HR; never their own.
 */
export function waitingWhere(caller: Caller): RequestWhere {
  const or: RequestWhere[] = [];
  const confidential = [...(caller.confidential?.all ?? [])];
  if (caller.employeeId) or.push({ status: 'with_manager', managerId: caller.employeeId });
  const ordinary = isHr(caller.user);
  const theirs = confidential.length > 0 && decidesConfidentialStage(caller.user, ['hr']);
  if (ordinary && (theirs || !confidential.length)) or.push({ status: 'with_hr' });
  else if (ordinary) or.push({ status: 'with_hr', employeeId: { notIn: confidential } });
  else if (theirs) or.push({ status: 'with_hr', employeeId: { in: confidential } });
  if (!or.length) return { id: { in: [] } };
  return { OR: or, ...(caller.employeeId && { employeeId: { not: caller.employeeId } }) };
}

/**
 * The requests the caller sees in lists and the calendar: everyone's for HR and the CEO; a manager's, those sent to them
 * and their team's now (and their own); anyone else's, their own.
 */
export function scopeWhere(caller: Caller): RequestWhere {
  const hidden = hiddenIds(caller);
  const shown = hidden.length ? { employeeId: { notIn: hidden } } : {};
  if (seesEveryRequest(caller.user)) {
    // a C-level person's only for the CEO and a Super Admin, and the manager it was sent to (owner, 19 October 2026)
    if (!hidden.length) return {};
    return caller.employeeId ? { OR: [shown, { managerId: caller.employeeId }] } : shown;
  }
  if (!caller.employeeId) return { id: { in: [] } };
  return {
    OR: [
      { employeeId: caller.employeeId },
      { managerId: caller.employeeId },
      { employee: { employments: { some: { endDate: null, managerId: caller.employeeId } } }, ...shown },
    ],
  };
}

/** The requests of the others the caller sees in Leave Requests: as scopeWhere, without their own unless HR or the CEO. */
export function othersWhere(caller: Caller): RequestWhere {
  const hidden = hiddenIds(caller);
  const shown = hidden.length ? { employeeId: { notIn: hidden } } : {};
  if (seesEveryRequest(caller.user)) {
    if (!hidden.length) return {};
    return caller.employeeId ? { OR: [shown, { managerId: caller.employeeId }] } : shown;
  }
  if (!caller.employeeId) return { id: { in: [] } };
  return {
    employeeId: { not: caller.employeeId },
    OR: [{ managerId: caller.employeeId }, { employee: { employments: { some: { endDate: null, managerId: caller.employeeId } } }, ...shown }],
  };
}

/** An open request, or one approved: what takes days and blocks the same days for another request. */
export const takesDays = (status: string) => isOpenLeave(status) || status === 'approved';

/**
 * Why there is no leave to ask for or record for someone outside the labour law, whose leave (Arts. 124–133) isn't
 * theirs: a freelancer (owner, 18 October 2026; Art. 1(1)), and an unpaid intern (owner, 19 October 2026: the unpaid
 * internship, outside the labour law). `name`: the employee's when HR records it, null for the employee's own request.
 */
export function noLeaveMessage(employmentType: string, name: string | null): string {
  if (employmentType === 'intern') {
    return name
      ? `${name} is an unpaid intern, outside the labour law: there is no leave to record for an unpaid internship.`
      : 'You are an unpaid intern, outside the labour law: there is no leave to ask for under an unpaid internship.';
  }
  return name
    ? `${name} is a freelancer, outside the labour law: there is no leave to record for a freelance employment.`
    : 'You work freelance, outside the labour law: there is no leave to ask for under a freelance employment.';
}
