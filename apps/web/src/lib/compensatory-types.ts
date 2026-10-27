import type { CompensationEarned, CompensatoryOutcome, CompensatoryRules, LeaveDecision, LeaveStage, LeaveStatus } from '@trendlix/shared';
import type { RequestApprover } from './types';

// Compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month. and
// rarely to be compensated in cash"), as the API sends them (apps/api/src/compensatory/compensatory-views.ts). Dates
// YYYY-MM-DD, moments ISO. Never an amount: a cash decision is a payroll addition in days. Since 27 October 2026 (owner:
// "Hours off for hours worked", and "i need a setup dashboard for the compensatory leaves") part of a day worked, the
// Compensatory Setup's rules and the official duty a request goes with; optional, as an API from before them omits them.

/** A step of a request: leave's. */
export interface CompensatoryStep {
  id: string;
  kind: string;
  decision: LeaveDecision | null;
  comment: string | null;
  actor: string | null;
  onBehalfOf?: { id: string; fullNameEn: string } | null;
  at: string;
}

/** GET /compensatory/:id, the lists and the employee's own: shaped as a work from home request is, kind 'compensatory'. */
export interface CompensatoryRequestView {
  id: string;
  kind: 'compensatory';
  employee: { id: string; employeeCode: string; fullNameEn: string; fullNameAr: string | null; department: string | null; team: string | null };
  type: { id: string; key: string; nameEn: string; nameAr: string };
  /** The day worked (a rest day or an official holiday), and the day off asked for (none for a cash one HR recorded). */
  dayWorked: string;
  dayOff: string | null;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatus;
  stage: LeaveStage | null;
  /** HR's decision once approved: a day off, or cash instead. */
  outcome: CompensatoryOutcome | null;
  /** The days' pay a cash decision pays now for a whole day (the Compensatory Setup's rate). */
  cashDays: number;
  /** Part of a day worked (27 October 2026): its hours, and the hours off they earned; null: a whole day. */
  hoursWorked?: number | null;
  hoursOff?: number | null;
  /** The official duty it goes with (27 October 2026): decided and cancelled with it, never on its own. */
  od?: { id: string; startDate: string; status: LeaveStatus } | null;
  /** No check-in is kept on the day worked: HR confirms it on the decision; null when not shown. */
  noCheckIn: boolean | null;
  waitingForYou: boolean;
  standingInFor?: { id: string; fullNameEn: string } | null;
  confidential: boolean;
  canCancel: boolean;
  hrCanCancel: boolean;
  manager: RequestApprover | null;
  rejectedStage: LeaveStage | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  warnings: string[];
  steps: CompensatoryStep[];
  createdAt: string;
}

/** GET /me/compensatory/form: what the request form checks live, around today. */
export interface CompensatoryForm {
  refusal: string | null;
  offered: boolean;
  hasShift: boolean;
  today: string;
  cashDays: number;
  /** The Compensatory Setup (27 October 2026), and the shift's hours a day (null: none), for what part of a day earns. */
  rules?: CompensatoryRules;
  hoursADay?: number | null;
  workingDays: number[];
  holidays: { date: string; nameEn: string }[];
  leave: { date: string; type: string; status: string }[];
  other: { date: string; what: string }[];
  claimed: string[];
  checkedIn: string[];
  from: string;
  to: string;
}

/**
 * GET /compensatory/check?employeeId=&dayWorked=&dayOff=&hoursWorked=: what refuses a request HR would record, and what it
 * is recorded past; `cashDays`, cash instead in days' pay for what the hours earn (27 October 2026).
 */
export interface CompensatoryCheck {
  employee: { id: string; fullNameEn: string };
  problems: string[];
  warnings: string[];
  cashDays: number;
  earned?: CompensationEarned;
  rules?: CompensatoryRules;
}

/** GET /compensatory/counts. */
export interface CompensatoryCounts {
  waiting: number;
}

/**
 * GET /compensatory/settings: the Compensatory Setup (owner, 27 October 2026: "i need a setup dashboard for the
 * compensatory leaves"): the cash rate, and the hours rules and the day off's window (an API from before them: the rate).
 */
export interface CompensatorySettings {
  cashRate: number;
  minHours?: number;
  hoursCap?: number;
  fullDayHours?: number;
  /** null: in the same calendar month as the day worked; else within these days after it. */
  offWithinDays?: number | null;
}

/** GET /compensatory/calendar: a compensatory day off on the leave calendar, shaped as its items are. */
export interface CompensatoryCalendarItem {
  id: string;
  kind: 'compensatory';
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { id: string; nameEn: string; nameAr: string };
  startDate: string;
  endDate: string;
  halfDay: false;
  status: LeaveStatus;
}
