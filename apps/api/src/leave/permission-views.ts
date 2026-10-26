import {
  employeeMayCancelLeave,
  leaveStage,
  PERMISSION_LABEL,
  PERMISSION_LABEL_AR,
  type ApproverRole,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type LeaveStepKind,
  type PermissionRules,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { LeaveSettings, Prisma } from '../generated/prisma/client.js';
import type { UserRef } from '../payroll/adjustments/people.js';
import type { PayrollLockedView } from '../payroll/locked-changes/locked-changes.js';
import { hrMayCancel, isConfidentialRequest, isRequester, standingInFor, waitsFor, type Caller } from './access.js';
import { placeOf } from './views.js';

// Permission requests as the API sends them (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day",
// asked "In the system, like leave"): shaped as a leave request is (LeaveRequestView: its employee, status, stage, who
// decides it, the steps), so the screens show them in the same lists, with `kind: 'permission'`, the day (also as its
// startDate and endDate) and the hours, times and what is left of the month instead of the type and the days.

export const PERMISSION_ENTITY = 'permission_request';

/** The Leave Setup's permission limits as the shared rules take them. */
export const permissionRulesOf = (s: Pick<LeaveSettings, 'permissionHoursPerMonth' | 'permissionMaxHoursPerDay'>): PermissionRules => ({
  hoursPerMonth: s.permissionHoursPerMonth.toNumber(),
  maxHoursPerDay: s.permissionMaxHoursPerDay.toNumber(),
});

/** A permission as the lists and the calendar name its "type": Permission, إذن. */
export const PERMISSION_TYPE = { id: 'permission', key: 'permission', nameEn: PERMISSION_LABEL, nameAr: PERMISSION_LABEL_AR } as const;

/**
 * What a request is shown with: its employee and where they work under the employment it is under, their direct manager
 * now (who sees it too), the manager it was sent to, and its steps.
 */
export const PERMISSION_INCLUDE = {
  employee: {
    select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, employments: { where: { endDate: null }, select: { managerId: true }, take: 1 } },
  },
  employment: { select: { department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } } },
  manager: { select: { id: true, fullNameEn: true } },
  // a stand-in's decision: the approver they stood in for (25 October 2026)
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } }, onBehalfOf: { select: { id: true, fullNameEn: true } } } },
} satisfies Prisma.PermissionRequestInclude;

export type PermissionRow = Prisma.PermissionRequestGetPayload<{ include: typeof PERMISSION_INCLUDE }>;

/** The parties of a request as access.ts takes them, its employee's direct manager now included. */
export const permissionParties = (r: Pick<PermissionRow, 'employeeId' | 'managerId' | 'employee'>) => ({
  employeeId: r.employeeId,
  managerId: r.managerId,
  currentManagerId: r.employee.employments[0]?.managerId ?? null,
});

/** A time column as HH:MM, or null. */
export const timeOf = (t: Date | null) => (t ? fromTimeOfDay(t) : null);

/** The month's permission hours of a person, as the form and a request's page show them. */
export interface PermissionMonthView {
  month: string;
  hoursPerMonth: number;
  maxHoursPerDay: number;
  /** Approved hours in the month. */
  approved: number;
  /** Hours being decided. */
  pending: number;
  /** What is left to ask for: the month's hours less the approved and those being decided. */
  left: number;
  /** Each day of the month with permission asked (approved or being decided), and its hours, in date order. */
  days: { date: string; hours: number }[];
}

/**
 * A request as `caller` sees it: whether it waits for their decision, whether its employee may cancel it (theirs, being
 * decided or approved and its day still to come: canCancel) and whether HR may (an approved one, not their own:
 * hrCanCancel). `names`: who took each step, by user id; `monthLeft`: what is left of its month's hours with it
 * counted (null when the caller doesn't see the person's figures: a C-level person's manager).
 */
export function permissionView(r: PermissionRow, caller: Caller, names: ReadonlyMap<string, UserRef>, monthLeft: number | null, today: string) {
  const status = r.status as LeaveStatus;
  const parties = permissionParties(r);
  const date = fromDateOnly(r.date);
  return {
    id: r.id,
    kind: 'permission' as const,
    employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, fullNameAr: r.employee.fullNameAr, ...placeOf(r.employment.department) },
    type: PERMISSION_TYPE,
    date,
    // the lists shared with leave read a request's days from these
    startDate: date,
    endDate: date,
    hours: r.hours.toNumber(),
    fromTime: timeOf(r.fromTime),
    toTime: timeOf(r.toTime),
    reason: r.reason,
    status,
    stage: leaveStage(status),
    waitingForYou: waitsFor({ ...parties, status }, caller),
    // the approver the caller decides it for, standing in (owner, 25 October 2026: "To a stand-in")
    standingInFor: standingInFor(parties, caller),
    // a C-level person's (owner, 19 October 2026): its HR stage is the CEO's
    confidential: isConfidentialRequest(parties, caller),
    canCancel: isRequester(parties, caller) && employeeMayCancelLeave({ status, startDate: date }, today),
    hrCanCancel: hrMayCancel({ ...parties, status }, caller),
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as LeaveStage | null,
    rejectReason: r.rejectReason,
    recordedByHr: r.recordedByHr,
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as LeaveStepKind,
      decision: s.decision as LeaveDecision | null,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      onBehalfOf: s.onBehalfOf ? { id: s.onBehalfOf.id, fullNameEn: s.onBehalfOf.fullNameEn } : null,
      at: s.at.toISOString(),
    })),
    monthLeft,
    createdAt: r.createdAt.toISOString(),
  };
}

/** With the months whose payroll had moved on when it was recorded, approved or cancelled (payrollLocked, 27 October 2026). */
export type PermissionRequestView = ReturnType<typeof permissionView> & PayrollLockedView;
