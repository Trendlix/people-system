import type { LeaveDecision, LeaveStage, LeaveStatus, WfhRules, WfhSource, WfhStepKind } from '@trendlix/shared';
import type { RequestApprover } from './types';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"), as
// the API sends it (apps/api/src/wfh/wfh-views.ts, wfh.service.ts). Dates YYYY-MM-DD, moments ISO.

/** A step of a request: leave's, and imported from Zoho People. */
export interface WfhRequestStep {
  id: string;
  kind: WfhStepKind;
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

/** GET /wfh/:id, the lists and the employee's own: shaped as a permission request is, kind 'wfh'. */
export interface WfhRequestView {
  id: string;
  kind: 'wfh';
  employee: { id: string; employeeCode: string; fullNameEn: string; fullNameAr: string | null; department: string | null; team: string | null };
  type: { id: string; key: string; nameEn: string; nameAr: string };
  date: string;
  startDate: string;
  endDate: string;
  reason: string | null;
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
  recordedByHr: boolean;
  /** Asked or recorded on the system, or brought over from Zoho People's history. */
  source: WfhSource;
  /** What HR recorded it past (no day's notice, the limits), as said then; none for a request. */
  warnings: string[];
  steps: WfhRequestStep[];
  /** How many of its month's days its person has taken (approved and being decided); null when not shown to the caller. */
  monthUsed: number | null;
  createdAt: string;
}

/** GET /me/wfh/allowance?month=: the caller's month as the request form shows it. */
export interface WfhAllowance {
  month: string;
  daysPerMonth: number;
  minGapDays: number;
  /** The month's days taken: approved and being decided. */
  used: number;
  approved: number;
  pending: number;
  /** Their days approved or being decided around the month, for the form's live checks. */
  taken: { date: string; status: LeaveStatus }[];
  /** The first day they may ask for now, from tomorrow; null: none soon. */
  nextPossible: string | null;
  /** Whether their work arrangement ever needs a work from home day: else the option is hidden. */
  offered: boolean;
  /** Why they can't ask at all; null: they can. */
  refusal: string | null;
  /** Today in Cairo. */
  today: string;
}

/** GET /wfh/check?employeeId=&date=: what refuses a day HR would record, and what it would be recorded past. */
export interface WfhCheck {
  employee: { id: string; fullNameEn: string };
  problems: string[];
  warnings: string[];
  used: number;
  daysPerMonth: number;
}

/** GET /wfh/counts. */
export interface WfhCounts {
  waiting: number;
}

/** GET /wfh/settings: the Leave Setup's limits. */
export type WfhSettings = WfhRules;

/** GET /wfh/calendar: a work from home day on the leave calendar, shaped as its items are. */
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
