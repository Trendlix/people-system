import type { AttendanceDayStatus, AttendanceSource, CorrectionKind, DayPlace, LeaveStage, LeaveStatus } from '@trendlix/shared';
import type { LeaveRequestStep, RequestApprover } from './types';

// Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"), as
// the API sends them (apps/api/src/attendance/correction-views.ts, corrections.service.ts). Dates YYYY-MM-DD, moments ISO.

/** The day as it was shown when the correction was asked for; null: no day on record. */
export interface CorrectionDayBefore {
  status: AttendanceDayStatus;
  checkIn: string | null;
  checkOut: string | null;
  place: DayPlace | null;
  source: AttendanceSource;
}

/** GET /attendance/corrections/:id, the lists and the employee's own: shaped as a leave or permission request is. */
export interface AttendanceCorrectionView {
  id: string;
  kind: 'correction';
  employee: { id: string; employeeCode: string; fullNameEn: string; fullNameAr: string | null; department: string | null; team: string | null };
  date: string;
  /** What was wrong. */
  correctionKind: CorrectionKind;
  /** The right moments asked for; null: as on record. */
  checkIn: string | null;
  checkOut: string | null;
  reason: string;
  dayBefore: CorrectionDayBefore | null;
  status: LeaveStatus;
  stage: LeaveStage | null;
  waitingForYou: boolean;
  /**
   * The approver on leave the caller decides it for, standing in (owner, 25 October 2026: "To a stand-in"); null when
   * they decide as themself. Left out by an API from before it. Its steps' stand-ins: LeaveRequestStep.onBehalfOf.
   */
  standingInFor?: { id: string; fullNameEn: string } | null;
  /** The employee may cancel it now: theirs, while being decided. */
  canCancel: boolean;
  /** The employee is C-level: HR's stage is the CEO's (or HR with Super Admin). */
  confidential: boolean;
  manager: RequestApprover | null;
  rejectedStage: LeaveStage | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  /** When its approval changed the day; null until then. */
  appliedAt: string | null;
  steps: LeaveRequestStep[];
  createdAt: string;
}

/** A person's correction of a month, as their attendance page has it by day. */
export interface MonthCorrection {
  id: string;
  date: string;
  correctionKind: CorrectionKind;
  status: LeaveStatus;
  checkIn: string | null;
  checkOut: string | null;
}

/** Whether a month's days can be corrected now (not once its payroll is approved or paid), and why not. */
export interface MonthCorrectable {
  allowed: boolean;
  reason: string | null;
}

/** GET /attendance/corrections/counts. */
export interface CorrectionCounts {
  waiting: number;
}

/**
 * What GET /attendance/me and /attendance/employees/:id add for corrections (19 October 2026): the person's corrections
 * of the month, whether its days can be corrected now, and whether the caller corrects a day directly (HR). Left out by
 * an API from before them.
 */
export interface MonthCorrectionsPart {
  corrections?: MonthCorrection[];
  correctable?: MonthCorrectable;
  canCorrect?: boolean;
}
