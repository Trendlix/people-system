import {
  isOpenLeave,
  leaveStage,
  type ApproverRole,
  type AttendanceDayStatus,
  type AttendanceSource,
  type CorrectionKind,
  type DayPlace,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type LeaveStepKind,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { UserRef } from '../payroll/adjustments/people.js';
import { isConfidentialRequest, isRequester, waitsFor, type Caller } from '../leave/access.js';
import { placeOf } from '../leave/views.js';

// Attendance corrections as the API sends them (owner, 19 October 2026: "Attendance corrections with approval ("I forgot
// to check out")"): shaped as a leave or permission request is (its employee, status, stage, who decides it, the steps),
// with `kind: 'correction'`, the day, what was wrong (correctionKind), the right times and the day as it was shown when
// asked.

export const CORRECTION_ENTITY = 'attendance_correction';

/** What a correction is shown with: its employee, their direct manager now (who sees it too), the manager it went to, the steps. */
export const CORRECTION_INCLUDE = {
  employee: {
    select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, employments: { where: { endDate: null }, select: { managerId: true }, take: 1 } },
  },
  employment: { select: { department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } } },
  manager: { select: { id: true, fullNameEn: true } },
  steps: { orderBy: { id: 'asc' }, include: { actor: { select: { id: true, email: true } } } },
} satisfies Prisma.AttendanceCorrectionInclude;

export type CorrectionRow = Prisma.AttendanceCorrectionGetPayload<{ include: typeof CORRECTION_INCLUDE }>;

/** The parties of a correction as access.ts takes them, its employee's direct manager now included. */
export const correctionParties = (r: Pick<CorrectionRow, 'employeeId' | 'managerId' | 'employee'>) => ({
  employeeId: r.employeeId,
  managerId: r.managerId,
  currentManagerId: r.employee.employments[0]?.managerId ?? null,
});

/** The day as it was shown when the correction was asked for. */
export interface DayBefore {
  status: AttendanceDayStatus;
  checkIn: string | null;
  checkOut: string | null;
  place: DayPlace | null;
  source: AttendanceSource;
}

/**
 * A correction as `caller` sees it: whether it waits for their decision, whether its employee may cancel it (theirs,
 * while being decided: canCancel). `names`: who took each step, by user id.
 */
export function correctionView(r: CorrectionRow, caller: Caller, names: ReadonlyMap<string, UserRef>) {
  const status = r.status as LeaveStatus;
  const parties = correctionParties(r);
  const date = fromDateOnly(r.date);
  return {
    id: r.id,
    kind: 'correction' as const,
    employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullNameEn: r.employee.fullNameEn, fullNameAr: r.employee.fullNameAr, ...placeOf(r.employment.department) },
    date,
    correctionKind: r.kind as CorrectionKind,
    checkIn: r.checkIn?.toISOString() ?? null,
    checkOut: r.checkOut?.toISOString() ?? null,
    reason: r.reason,
    dayBefore: (r.dayBefore as unknown as DayBefore | null) ?? null,
    status,
    stage: leaveStage(status),
    waitingForYou: waitsFor({ ...parties, status }, caller),
    // a C-level person's (owner, 19 October 2026): its HR stage is the CEO's
    confidential: isConfidentialRequest(parties, caller),
    // the employee cancels theirs while it is being decided; an approved one stays (its day changed: HR corrects it again)
    canCancel: isRequester(parties, caller) && isOpenLeave(status),
    manager: r.manager && { id: r.manager.id, fullNameEn: r.manager.fullNameEn, role: (r.approverRole as ApproverRole | null) ?? 'direct_manager' },
    rejectedStage: r.rejectedStage as LeaveStage | null,
    rejectReason: r.rejectReason,
    recordedByHr: r.recordedByHr,
    appliedAt: r.appliedAt?.toISOString() ?? null,
    steps: r.steps.map((s) => ({
      id: s.id.toString(),
      kind: s.kind as LeaveStepKind,
      decision: s.decision as LeaveDecision | null,
      comment: s.comment,
      actor: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      at: s.at.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

export type AttendanceCorrectionView = ReturnType<typeof correctionView>;
