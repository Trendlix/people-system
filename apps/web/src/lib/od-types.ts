import type { LeaveDecision, LeaveStage, LeaveStatus, OdStepKind } from '@trendlix/shared';
import type { RequestApprover } from './types';

// Official duty, OD (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode
// beside Office and WFH, needing an approved request"), as the API sends it (apps/api/src/official-duty/od-views.ts,
// od.service.ts). Dates YYYY-MM-DD, times HH:MM, moments ISO.

/** A step of a request: sent, sent straight to HR, each stage's decision, cancelled. */
export interface OdRequestStep {
  id: string;
  kind: OdStepKind;
  decision: LeaveDecision | null;
  comment: string | null;
  /** Who, by their display name; null for a user since removed, or none (sent straight to HR). */
  actor: string | null;
  /**
   * A decision taken by a stand-in (owner, 25 October 2026: "To a stand-in"): the approver they stood in for. Left out by
   * an API from before it.
   */
  onBehalfOf?: { id: string; fullNameEn: string } | null;
  at: string;
}

/** GET /official-duty/:id, the lists and the employee's own: shaped as a work from home request is, kind 'od'. */
export interface OdRequestView {
  id: string;
  kind: 'od';
  employee: { id: string; employeeCode: string; fullNameEn: string; fullNameAr: string | null; department: string | null; team: string | null };
  type: { id: string; key: string; nameEn: string; nameAr: string };
  startDate: string;
  endDate: string;
  /** A full day, or part of one with its times (one day only). */
  fullDay: boolean;
  fromTime: string | null;
  toTime: string | null;
  /** Where it is: free text (hidden from a developer). */
  dutyPlace: string;
  reason: string;
  /** Asked after its first day ("Ahead or up to 3 days after", 23 October 2026): requested after. */
  late: boolean;
  status: LeaveStatus;
  stage: LeaveStage | null;
  waitingForYou: boolean;
  /**
   * The approver on leave the caller decides it for, standing in (owner, 25 October 2026: "To a stand-in"); null when
   * they decide as themself. Left out by an API from before it.
   */
  standingInFor?: { id: string; fullNameEn: string } | null;
  /** The employee is C-level: HR's stage is the CEO's (or HR with Super Admin). */
  confidential: boolean;
  /** The employee may cancel it now: theirs, while it is being decided. */
  canCancel: boolean;
  /** HR may cancel it now: approved, and not HR's own. */
  hrCanCancel: boolean;
  manager: RequestApprover | null;
  rejectedStage: LeaveStage | null;
  rejectReason: string | null;
  steps: OdRequestStep[];
  createdAt: string;
}

/** GET /me/official-duty/form: what the request form reads first. */
export interface OdForm {
  /** Today in Cairo. */
  today: string;
  /** The earliest first day they may ask for: 3 days ago. */
  earliest: string;
  /** Their shift's window, for part of a day; null: none. */
  shift: { startTime: string; endTime: string; graceMinutes: number } | null;
  /** Why they can't ask at all; null: they can. */
  refusal: string | null;
  /** A C-level person's goes to the CEO after their manager, not HR. */
  toCeo: boolean;
}

/** GET /official-duty/counts. */
export interface OdCounts {
  waiting: number;
}

/** GET /official-duty/calendar: an official duty on the leave calendar, shaped as its items are. */
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

/** A day of approved official duty, as a person's month lists it (GET /attendance/employees/:id: person.odDays). */
export interface OdDayView {
  date: string;
  requestId: string;
  fullDay: boolean;
  fromTime: string | null;
  toTime: string | null;
}
