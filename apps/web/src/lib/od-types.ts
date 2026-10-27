import type { CompensationEarned, CompensatoryOutcome, CompensatoryRules, LeaveDecision, LeaveStage, LeaveStatus, OdStepKind } from '@trendlix/shared';
import type { RequestApprover } from './types';

// Official duty, OD (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode
// beside Office and WFH, needing an approved request"), as the API sends it (apps/api/src/official-duty/od-views.ts,
// od.service.ts). Dates YYYY-MM-DD, times HH:MM, moments ISO.

/** A step of a request: sent, sent straight to HR, recorded by HR, each stage's decision, cancelled, imported. */
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
  /**
   * Recorded by HR, approved at once (owner, 26 October 2026: "HR records it"), with what it was recorded past (the 3-day
   * limit), or imported by a leave import ("Import (template + Zoho)"). Left out by an API from before them.
   */
  recordedByHr?: boolean;
  warnings?: string[];
  imported?: boolean;
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
  /**
   * The months (YYYY-MM) whose payroll had moved on when this was approved or cancelled (27 October 2026): not in that
   * payroll, listed on Unsettled until HR handles it. The API's warning on the action just taken joins `warnings`.
   */
  payrollLocked?: string[];
  /**
   * One day on a rest day or an official holiday (owner, 27 October 2026: "it should count in the compensatories"; "One
   * step"): its compensatory day, saved with it and decided and cancelled with it. Left out by an API from before it.
   */
  compensation?: OdCompensation | null;
}

/** The compensatory day an official duty on a rest day or an official holiday carries (its own page: /attendance/compensatory/<id>). */
export interface OdCompensation {
  id: string;
  /** The duty's: decided and cancelled with it. */
  status: LeaveStatus;
  /** A day off (whole, or hours off for part of the day), or cash instead. */
  outcome: CompensatoryOutcome;
  /** YYYY-MM-DD of the day off (or the day for the hours off); null for cash instead. */
  dayOff: string | null;
  /** Part of the day's hours (null: a full day), and the hours off they earned (null: a whole day). */
  hoursWorked: number | null;
  hoursOff: number | null;
}

/**
 * What a request on a day off earns (27 October 2026), as HR's check (GET /official-duty/check) says it and the
 * employee's form works it out.
 */
export interface OdCompensationView {
  /** One day on a rest day or an official holiday. */
  onDayOff: boolean;
  /** A compensation is to be chosen with it: it earns one and no compensatory day compensates the day already. */
  needed: boolean;
  /** What its hours earn (null: not on a day off). */
  earned: CompensationEarned | null;
  /** Cash instead, in days' pay. */
  cashDays: number;
  /** A compensatory day compensates the day already: its status's words; null: none. */
  already: string | null;
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
  /**
   * For one on a rest day or an official holiday (27 October 2026): their shift's working days (0 = Sunday), the official
   * holidays from 3 days ago to a year ahead, the Compensatory Setup, and the shift's hours a day (null: no shift). Left
   * out by an API from before it: the form then leaves rest days and holidays to the API.
   */
  workingDays?: number[];
  holidays?: { date: string; nameEn: string }[];
  rules?: CompensatoryRules;
  hoursADay?: number | null;
  /** The days worked a compensatory day compensates already, with its status's words (27 October 2026). */
  compensated?: { date: string; status: string }[];
}

/** GET /official-duty/check: what refuses official duty HR would record for someone, and what it would be recorded past. */
export interface OdCheck {
  employee: { id: string; fullNameEn: string };
  problems: string[];
  warnings: string[];
  /** Their shift's window, for part of a day; null: none. */
  shift: { startTime: string; endTime: string; graceMinutes: number } | null;
  /** On a rest day or an official holiday (27 October 2026): what it earns. Left out by an API from before it. */
  compensation?: OdCompensationView;
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
