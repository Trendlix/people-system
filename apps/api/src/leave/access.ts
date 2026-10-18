import { isOpenLeave, leaveStage, type LeaveStage } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';

// Who may see, decide and cancel a leave request (owner, 18 October 2026: the direct manager, then HR; no manager:
// straight to HR). Pure code: the rules themselves are packages/shared leaves.ts.

/** The caller, and their own employee profile (the one whose work email they sign in with), if any. */
export interface Caller {
  user: SessionUser;
  employeeId: string | null;
}

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

/** Who sees a request: its employee, the manager it was sent to, their manager now, HR and the CEO. */
export const seesRequest = (r: RequestParties, caller: Caller) =>
  seesEveryRequest(caller.user) || isRequester(r, caller) || isRequestManager(r, caller) || isTeamManager(r, caller);

/**
 * Whether the caller decides a stage of the request: the manager stage the direct manager it was sent to, HR's stage
 * HR; nobody their own request.
 */
export function decidesStage(stage: LeaveStage, r: RequestParties, caller: Caller): boolean {
  if (isRequester(r, caller)) return false;
  if (stage === 'manager') return isRequestManager(r, caller);
  return isHr(caller.user);
}

/** Whether the request waits for the caller's decision now. */
export function waitsFor(r: RequestParties & { status: string }, caller: Caller): boolean {
  const stage = leaveStage(r.status);
  return stage !== null && decidesStage(stage, r, caller);
}

/** Whether HR may cancel it (an approved one, restoring the balance): HR, never their own. */
export const hrMayCancel = (r: RequestParties & { status: string }, caller: Caller) => r.status === 'approved' && isHr(caller.user) && !isRequester(r, caller);

/** The requests waiting for the caller's decision: those with them as the direct manager, those with HR for HR; never their own. */
export function waitingWhere(caller: Caller): Prisma.LeaveRequestWhereInput {
  const or: Prisma.LeaveRequestWhereInput[] = [];
  if (caller.employeeId) or.push({ status: 'with_manager', managerId: caller.employeeId });
  if (isHr(caller.user)) or.push({ status: 'with_hr' });
  if (!or.length) return { id: { in: [] } };
  return { OR: or, ...(caller.employeeId && { employeeId: { not: caller.employeeId } }) };
}

/**
 * The requests the caller sees in lists and the calendar: everyone's for HR and the CEO; a manager's, those sent to them
 * and their team's now (and their own); anyone else's, their own.
 */
export function scopeWhere(caller: Caller): Prisma.LeaveRequestWhereInput {
  if (seesEveryRequest(caller.user)) return {};
  if (!caller.employeeId) return { id: { in: [] } };
  return {
    OR: [
      { employeeId: caller.employeeId },
      { managerId: caller.employeeId },
      { employee: { employments: { some: { endDate: null, managerId: caller.employeeId } } } },
    ],
  };
}

/** The requests of the others the caller sees in Leave Requests: as scopeWhere, without their own unless HR or the CEO. */
export function othersWhere(caller: Caller): Prisma.LeaveRequestWhereInput {
  if (seesEveryRequest(caller.user)) return {};
  if (!caller.employeeId) return { id: { in: [] } };
  return {
    employeeId: { not: caller.employeeId },
    OR: [{ managerId: caller.employeeId }, { employee: { employments: { some: { endDate: null, managerId: caller.employeeId } } } }],
  };
}

/** An open request, or one approved: what takes days and blocks the same days for another request. */
export const takesDays = (status: string) => isOpenLeave(status) || status === 'approved';
