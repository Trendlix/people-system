import {
  isOpenLeave,
  leaveStage,
  WFH_LABEL,
  WFH_LABEL_AR,
  WFH_RULE_DEFAULTS,
  type ApproverRole,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type WfhRules,
  type WfhSource,
  type WfhStepKind,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { LeaveSettings, Prisma } from '../generated/prisma/client.js';
import { hrMayCancel, isConfidentialRequest, isRequester, waitsFor, type Caller } from '../leave/access.js';
import { placeOf } from '../leave/views.js';
import type { UserRef } from '../payroll/adjustments/people.js';

// Work from home requests as the API sends them (owner, 21 October 2026: "think about how should we handle the working
// from home in out erp"; packages/shared wfh.ts): shaped as a permission request is (its employee, status, stage, who
// decides it, the steps), with `kind: 'wfh'`, the day (also as its startDate and endDate, as the lists shared with leave
// read them), how it came (asked, recorded by HR, imported from Zoho People), what HR recorded it past, and how many of
// its month's days the person has taken.

export const WFH_ENTITY = 'wfh_request';

/** The Leave Setup's work from home limits as the shared rules take them (the owner's 2 and 7 should the row be missing). */
export const wfhRulesOf = (s: Pick<LeaveSettings, 'wfhDaysPerMonth' | 'wfhMinGapDays'> | null): WfhRules =>
  s ? { daysPerMonth: s.wfhDaysPerMonth, minGapDays: s.wfhMinGapDays } : { ...WFH_RULE_DEFAULTS };

/** A work from home day as the lists and the calendar name its "type": Work from home, العمل من المنزل. */
export const WFH_TYPE = { id: 'wfh', key: 'wfh', nameEn: WFH_LABEL, nameAr: WFH_LABEL_AR } as const;

/**
 * What a request is shown with: its employee and where they work under the employment it is under, their direct manager
 * now (who sees it too), the approver it was sent to, and its steps.
 */
export const WFH_INCLUDE = {
  employee: {
    select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, employments: { where: { endDate: null }, select: { managerId: true }, take: 1 } },
  },
  employment: { select: { department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } } },
  manager: { select: { id: true, fullNameEn: true } },
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } } } },
} satisfies Prisma.WfhRequestInclude;

export type WfhRow = Prisma.WfhRequestGetPayload<{ include: typeof WFH_INCLUDE }>;

/** The parties of a request as leave/access.ts takes them, its employee's direct manager now included. */
export const wfhParties = (r: Pick<WfhRow, 'employeeId' | 'managerId' | 'employee'>) => ({
  employeeId: r.employeeId,
  managerId: r.managerId,
  currentManagerId: r.employee.employments[0]?.managerId ?? null,
});

/** A person's work from home of a month, as the request form shows it (GET /me/wfh/allowance). */
export interface WfhAllowanceView {
  month: string;
  daysPerMonth: number;
  minGapDays: number;
  /** The month's days taken: approved and being decided. */
  used: number;
  approved: number;
  pending: number;
  /** Their days approved or being decided around the month (from a month before to four after), for the live checks. */
  taken: { date: string; status: LeaveStatus }[];
  /** The first day they may ask for now (from tomorrow), within the limits, on a working office day; null: none soon. */
  nextPossible: string | null;
  /** Whether their work arrangement ever needs a work from home day (wfhOffered): else the option is hidden. */
  offered: boolean;
  /** Why they can't ask at all (no employment, a freelancer, an arrangement that never needs it); null: they can. */
  refusal: string | null;
  /** Today in Cairo: a request is for tomorrow or later. */
  today: string;
}

/**
 * A request as `caller` sees it: whether it waits for their decision, whether its employee may cancel it (theirs, while
 * being decided: canCancel) and whether HR may (an approved one, not their own: hrCanCancel). `names`: who took each step,
 * by user id; `monthUsed`: how many of its month's days the person has taken with it (null when the caller doesn't see
 * the person's figures: a C-level person's manager).
 */
export function wfhView(r: WfhRow, caller: Caller, names: ReadonlyMap<string, UserRef>, monthUsed: number | null) {
  const status = r.status as LeaveStatus;
  const parties = wfhParties(r);
  const date = fromDateOnly(r.date);
  return {
    id: r.id,
    kind: 'wfh' as const,
    employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullNameEn: r.employee.fullNameEn, fullNameAr: r.employee.fullNameAr, ...placeOf(r.employment.department) },
    type: WFH_TYPE,
    date,
    startDate: date,
    endDate: date,
    reason: r.reason,
    status,
    stage: leaveStage(status),
    waitingForYou: waitsFor({ ...parties, status }, caller),
    // a C-level person's (owner, 19 October 2026): its HR stage is the CEO's
    confidential: isConfidentialRequest(parties, caller),
    // by the person while it is being decided (owner's brief, 21 October 2026)
    canCancel: isRequester(parties, caller) && isOpenLeave(status),
    hrCanCancel: hrMayCancel({ ...parties, status }, caller),
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as LeaveStage | null,
    rejectReason: r.rejectReason,
    recordedByHr: r.recordedByHr,
    source: r.source as WfhSource,
    warnings: r.warnings,
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as WfhStepKind,
      decision: s.decision as LeaveDecision | null,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      at: s.at.toISOString(),
    })),
    monthUsed,
    createdAt: r.createdAt.toISOString(),
  };
}

export type WfhRequestView = ReturnType<typeof wfhView>;

/** A work from home day on the leave calendar (GET /wfh/calendar), shaped as its items are, kind 'wfh'. */
export interface WfhCalendarItem {
  id: string;
  kind: 'wfh';
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { id: string; nameEn: string; nameAr: string };
  startDate: string;
  endDate: string;
  halfDay: false;
  status: LeaveStatus;
}
