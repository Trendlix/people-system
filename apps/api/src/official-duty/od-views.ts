import {
  isOpenLeave,
  leaveStage,
  OD_LABEL,
  OD_LABEL_AR,
  type ApproverRole,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type OdStepKind,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { hrMayCancel, isConfidentialRequest, isRequester, standingInFor, waitsFor, type Caller } from '../leave/access.js';
import { placeOf } from '../leave/views.js';
import type { UserRef } from '../payroll/adjustments/people.js';

// Official duty requests as the API sends them (owner, 23 October 2026: "Official duty (OD) requests"; packages/shared
// official-duty.ts): shaped as a work from home request is (its employee, status, stage, who decides it, the steps), with
// `kind: 'od'`, its first and last day, a full day or its times, where (`dutyPlace`: free text, hidden from a developer),
// why, and whether it was asked after its first day (`late`); recorded by HR with what it was recorded past, or
// imported by a leave import (owner, 26 October 2026: "HR records it", "Import (template + Zoho)").

export const OD_ENTITY = 'od_request';

/** An official duty as the lists and the calendar name its "type": Official duty, مأمورية. */
export const OD_TYPE = { id: 'od', key: 'od', nameEn: OD_LABEL, nameAr: OD_LABEL_AR } as const;

/**
 * What a request is shown with: its employee and where they work under the employment it is under, their direct manager
 * now (who sees it too), the approver it was sent to, and its steps.
 */
export const OD_INCLUDE = {
  employee: {
    select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, employments: { where: { endDate: null }, select: { managerId: true }, take: 1 } },
  },
  employment: { select: { department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } } },
  manager: { select: { id: true, fullNameEn: true } },
  // a stand-in's decision: the approver they stood in for (25 October 2026)
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } }, onBehalfOf: { select: { id: true, fullNameEn: true } } } },
} satisfies Prisma.OdRequestInclude;

export type OdRow = Prisma.OdRequestGetPayload<{ include: typeof OD_INCLUDE }>;

/** The parties of a request as leave/access.ts takes them, its employee's direct manager now included. */
export const odParties = (r: Pick<OdRow, 'employeeId' | 'managerId' | 'employee'>) => ({
  employeeId: r.employeeId,
  managerId: r.managerId,
  currentManagerId: r.employee.employments[0]?.managerId ?? null,
});

/** A time column as HH:MM, or null. */
export const timeOf = (t: Date | null): string | null => (t ? fromTimeOfDay(t) : null);

/**
 * A request as `caller` sees it: whether it waits for their decision, whether its employee may cancel it (theirs, while
 * being decided: canCancel) and whether HR may (an approved one, not their own: hrCanCancel). `names`: who took each
 * step, by user id.
 */
export function odView(r: OdRow, caller: Caller, names: ReadonlyMap<string, UserRef>) {
  const status = r.status as LeaveStatus;
  const parties = odParties(r);
  return {
    id: r.id,
    kind: 'od' as const,
    employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullNameEn: r.employee.fullNameEn, fullNameAr: r.employee.fullNameAr, ...placeOf(r.employment.department) },
    type: OD_TYPE,
    startDate: fromDateOnly(r.startDate),
    endDate: fromDateOnly(r.endDate),
    fullDay: r.fullDay,
    fromTime: timeOf(r.fromTime),
    toTime: timeOf(r.toTime),
    // where it is: free text about the person's day (hidden from a developer, packages/shared developer.ts)
    dutyPlace: r.place,
    reason: r.reason,
    // asked after its first day (owner, 23 October 2026: "Ahead or up to 3 days after"): "requested after"
    late: r.late,
    // recorded by HR, approved at once (26 October 2026: "HR records it"), with what it was recorded past (the 3-day
    // limit); or imported by a leave import ("Import (template + Zoho)")
    recordedByHr: r.recordedByHr,
    warnings: r.warnings,
    imported: r.importId !== null,
    status,
    stage: leaveStage(status),
    waitingForYou: waitsFor({ ...parties, status }, caller),
    // the approver the caller decides it for, standing in (owner, 25 October 2026: "To a stand-in")
    standingInFor: standingInFor(parties, caller),
    // a C-level person's (owner, 19 October 2026): its HR stage is the CEO's
    confidential: isConfidentialRequest(parties, caller),
    // by the person while it is being decided (owner's brief, 23 October 2026: "cancel (before approval)")
    canCancel: isRequester(parties, caller) && isOpenLeave(status),
    hrCanCancel: hrMayCancel({ ...parties, status }, caller),
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as LeaveStage | null,
    rejectReason: r.rejectReason,
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as OdStepKind,
      decision: s.decision as LeaveDecision | null,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      onBehalfOf: s.onBehalfOf ? { id: s.onBehalfOf.id, fullNameEn: s.onBehalfOf.fullNameEn } : null,
      at: s.at.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

export type OdRequestView = ReturnType<typeof odView>;

/** An official duty on the leave calendar (GET /official-duty/calendar), shaped as its items are, kind 'od'. */
export interface OdCalendarItem {
  id: string;
  kind: 'od';
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { id: string; nameEn: string; nameAr: string };
  startDate: string;
  endDate: string;
  halfDay: false;
  fullDay: boolean;
  fromTime: string | null;
  toTime: string | null;
  status: LeaveStatus;
}

/** What the request form reads first (GET /me/official-duty/form): today, how far back, the shift, and why they can't ask. */
export interface OdFormView {
  /** Today in Cairo. */
  today: string;
  /** The earliest first day they may ask for: 3 days ago. */
  earliest: string;
  /** Their shift's window, for part of a day; null: none. */
  shift: { startTime: string; endTime: string; graceMinutes: number } | null;
  /** Why they can't ask at all (no employment, a freelancer); null: they can. */
  refusal: string | null;
  /** A C-level person's goes to the CEO after their manager, not HR. */
  toCeo: boolean;
}
