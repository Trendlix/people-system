import { decidesConfidentialStage, isOpenLeave, leaveStage, movesToStandIn, type CoveragePerson, type LeaveStage } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { shownDate } from '../common/date-only.js';
import type { ConfidentialView } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { StandInView } from './stand-ins.js';

// Who may see, decide and cancel a leave request (owner, 18 October 2026: the direct manager, then HR; no manager:
// straight to HR). Pure code: the rules themselves are packages/shared leaves.ts. A C-level person's request (owner, 19
// October 2026: "make C level Employees details not visible to HR"; their HR stages go to the CEO): HR's stage is the
// CEO's (or HR's with Super Admin: packages/shared decidesConfidentialStage); HR and their manager now don't see it, the
// manager it was sent to still decides the manager stage, as the request is theirs to decide. Permission requests
// (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked "In the system, like leave") are
// decided exactly as leave is, so these rules serve both tables (RequestWhere).
// Stand-ins (owner, 25 October 2026: "To a stand-in"; stand-ins.ts): while an approver is on approved leave with a
// stand-in, what waits at their step (the manager stage) is the stand-in's to see and decide instead, never the stand-in's
// own, and never a C-level person's to a stand-in who doesn't see C-level people (it stays with the approver); HR's stage
// is a role's and never moves.

/**
 * The caller, their own employee profile (the one their account is linked to), if any, and the C-level people,
 * those hidden from the caller among them (none left out: nobody is C-level).
 */
export interface Caller {
  user: SessionUser;
  employeeId: string | null;
  confidential?: ConfidentialView;
  /** Whom the caller stands in for today, and their own stand-in while they are away (25 October 2026). */
  standIn?: StandInView;
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

const cLevelOf = (caller: Caller): ReadonlySet<string> => caller.confidential?.all ?? new Set<string>();

/**
 * The caller stands in today for the approver the request was sent to (stand-ins.ts): never on their own request, nor on
 * one hidden from them (a C-level person's), nor as HR on a C-level person's (HR never sees them as a stand-in).
 */
export function standsInFor(r: Pick<RequestParties, 'employeeId' | 'managerId'>, caller: Caller): boolean {
  const entry = r.managerId ? caller.standIn?.for.get(r.managerId) : undefined;
  if (!entry || r.employeeId === caller.employeeId || hiddenRequest(r, caller)) return false;
  return !entry.viaHr || !cLevelOf(caller).has(r.employeeId);
}

/** The caller is the approver the request was sent to, away today: it waits with their stand-in (movesToStandIn). */
export function movedToStandIn(r: Pick<RequestParties, 'employeeId' | 'managerId'>, caller: Caller): boolean {
  const away = caller.standIn?.away;
  return !!away && caller.employeeId !== null && r.managerId === caller.employeeId && movesToStandIn(r, away, cLevelOf(caller));
}

/** The approver the caller stands in for on this request, as the request's page names them ("Standing in for Ahmed"). */
export function standingInFor(r: Pick<RequestParties, 'employeeId' | 'managerId'>, caller: Caller): CoveragePerson | null {
  if (!standsInFor(r, caller)) return null;
  return { id: r.managerId!, fullNameEn: caller.standIn!.for.get(r.managerId!)!.fullNameEn };
}

/**
 * Why the approver it was sent to doesn't decide a request at the manager stage today: they are away, and it waits with
 * their stand-in. Null: they decide it (or it isn't theirs).
 */
export function standInRefusal(r: Pick<RequestParties, 'employeeId' | 'managerId'> & { status: string }, caller: Caller): string | null {
  if (r.status !== 'with_manager' || !movedToStandIn(r, caller)) return null;
  const away = caller.standIn!.away!;
  return `You are on leave until ${shownDate(away.until)}, so ${away.name ?? 'HR'} decides this request meanwhile, standing in for you.`;
}

/**
 * The approver a stand-in decides a manager stage for (the step and the audit log keep both): the absent approver's
 * employee id, or null when the caller decides as themself.
 */
export const decidedOnBehalfOf = (stage: string, r: Pick<RequestParties, 'employeeId' | 'managerId'>, caller: Caller): string | null =>
  stage === 'manager' && standsInFor(r, caller) ? r.managerId : null;

/**
 * Who sees a request: its employee, the manager it was sent to, their manager now, HR and the CEO; a C-level person's,
 * not HR nor their manager now (owner, 19 October 2026), but the manager it was sent to.
 */
export const seesRequest = (r: RequestParties, caller: Caller) =>
  isRequester(r, caller) ||
  isRequestManager(r, caller) ||
  standsInFor(r, caller) ||
  (!hiddenRequest(r, caller) && (seesEveryRequest(caller.user) || isTeamManager(r, caller)));

/**
 * Whether the caller decides a stage of the request: the manager stage the direct manager it was sent to, HR's stage
 * HR; a C-level person's HR stage the CEO (or HR with Super Admin); nobody their own request.
 */
export function decidesStage(stage: LeaveStage, r: RequestParties, caller: Caller): boolean {
  if (isRequester(r, caller)) return false;
  // the approver it was sent to, unless away with a stand-in; their stand-in meanwhile (25 October 2026)
  if (stage === 'manager') return (isRequestManager(r, caller) && !movedToStandIn(r, caller)) || standsInFor(r, caller);
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
  if (caller.employeeId) or.push(...managerWaiting(caller));
  const ordinary = isHr(caller.user);
  const theirs = confidential.length > 0 && decidesConfidentialStage(caller.user, ['hr']);
  if (ordinary && (theirs || !confidential.length)) or.push({ status: 'with_hr' });
  else if (ordinary) or.push({ status: 'with_hr', employeeId: { notIn: confidential } });
  else if (theirs) or.push({ status: 'with_hr', employeeId: { in: confidential } });
  if (!or.length) return { id: { in: [] } };
  return { OR: or, ...(caller.employeeId && { employeeId: { not: caller.employeeId } }) };
}

/**
 * The requests at the manager stage waiting for the caller: those sent to them, but while they are away only those that
 * don't move to their stand-in (the stand-in's own, a C-level person's when the stand-in doesn't see C-level people); and
 * those sent to the approvers they stand in for today, never one hidden from them nor (as HR) a C-level person's.
 */
export function managerWaiting(caller: Caller): RequestWhere[] {
  const or: RequestWhere[] = [];
  const me = caller.employeeId!;
  const cLevel = [...cLevelOf(caller)];
  const away = caller.standIn?.away;
  if (!away) or.push({ status: 'with_manager', managerId: me });
  else {
    const kept: RequestWhere[] = [];
    if (away.employeeId) kept.push({ employeeId: away.employeeId });
    if (!away.seesConfidential && cLevel.length) kept.push({ employeeId: { in: cLevel } });
    if (kept.length) or.push({ status: 'with_manager', managerId: me, OR: kept });
  }
  or.push(...standInScope(caller).map((w) => ({ ...w, status: 'with_manager' })));
  return or;
}

/**
 * The requests sent to the approvers the caller stands in for today (any status: they see them as the approver does),
 * never one hidden from them, nor (as HR) a C-level person's.
 */
export function standInScope(caller: Caller): RequestWhere[] {
  const entries = [...(caller.standIn?.for ?? new Map())];
  if (!entries.length) return [];
  const hidden = hiddenIds(caller);
  const cLevel = [...cLevelOf(caller)];
  const named = entries.filter(([, e]) => !e.viaHr).map(([id]) => id);
  const asHr = entries.filter(([, e]) => e.viaHr).map(([id]) => id);
  const out: RequestWhere[] = [];
  if (named.length) out.push({ managerId: { in: named }, ...(hidden.length && { employeeId: { notIn: hidden } }) });
  if (asHr.length) out.push({ managerId: { in: asHr }, ...(cLevel.length && { employeeId: { notIn: cLevel } }) });
  return out;
}

/**
 * The requests the caller sees in lists and the calendar: everyone's for HR and the CEO; a manager's, those sent to them
 * and their team's now (and their own); anyone else's, their own. A stand-in's also those sent to whom they stand in for.
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
      ...standInScope(caller),
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
    OR: [{ managerId: caller.employeeId }, { employee: { employments: { some: { endDate: null, managerId: caller.employeeId } } }, ...shown }, ...standInScope(caller)],
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
