import type {
  AttendanceDayView,
  AttendanceFigures,
  AttendanceFilter,
  AttendanceMonthResult,
  AttendanceSummaryGroup,
  AttendanceSummaryRow,
  CheckInFlag,
  CheckInPlace,
  ExpectedPlace,
  OfficeNetwork,
  PayrollStatus,
  PunchKind,
  PunchPointFrom,
  SignedIpProblem,
} from '@trendlix/shared';

// Attendance imported from Zoho People on a draft payroll run (owner, 19 October 2026: attendance runs in Zoho People
// today, "Import Zoho now, replace it later"), as the API sends it (apps/api/src/attendance/attendance-imports.service.ts).
// Dates YYYY-MM-DD, months YYYY-MM, moments ISO.

/** How a person of the files was matched to an employee: by their remembered Zoho ID, by name, by HR, or not (yet). */
export type PersonMatch = 'linked' | 'exact' | 'confirmed' | 'close' | 'none' | 'skipped';

export interface AttendanceEmployeeRef {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

/** A person of Zoho's files, as the review shows them. */
export interface AttendancePersonView {
  /** Their key in the import: Zoho's Employee Id, else their name as matched. */
  key: string;
  zohoId: string | null;
  zohoName: string;
  match: PersonMatch;
  employee: AttendanceEmployeeRef | null;
  /** "Did you mean …?": the closest employees (a close name, or two of the same name). */
  candidates: (AttendanceEmployeeRef & { similarity: number })[];
  /** Another person of the files is matched to the same employee: neither is applied until HR chooses. */
  duplicate: boolean;
  /** Their line on the run (null: not on this payroll), and whether the user fills it. */
  lineId: string | null;
  editable: boolean;
  confidential: boolean;
  /** Their days of the run's month in the files. */
  rows: number;
  /** Their month by the system's rules, once matched. */
  month: AttendanceMonthResult | null;
  applied: { at: string; by: string | null } | null;
  /** Undone on their line since (Undo this import, owner, 19 October 2026); left out by an API from before it. */
  undone?: { at: string; by: string | null } | null;
  /**
   * They check in on the system this month (owner, 19 October 2026: "Check-in through the system (phone or web with the
   * office location check, or a device) to replace Zoho"): applying keeps their Zoho days, counted before their first
   * check-in, and their line is filled from their attendance days instead of Zoho's month. Left out by an API from before it.
   */
  checksIn?: boolean;
}

/** A file of the import: its name, the sheet read, its rows and people, the months its days are in. */
export interface AttendanceImportFile {
  name: string;
  sheet: string;
  rows: number;
  people: number;
  months: string[];
  problems: string[];
}

/** GET /payroll/runs/:id/attendance-imports/:importId: the review. */
export interface AttendanceImportView {
  id: string;
  runId: string;
  month: string;
  source: 'zoho';
  createdAt: string;
  createdBy: string | null;
  appliedAt: string | null;
  files: AttendanceImportFile[];
  people: AttendancePersonView[];
  /** The C-level people of the files hidden from the user: one row ("C-level (1 person): the CEO fills their lines"). */
  hidden: { count: number; label: string } | null;
  counts: { matched: number; toConfirm: number; notFound: number; skipped: number; notOnRun: number };
  canApply: boolean;
  /**
   * The run's lines filled from it that the user fills, still marked from it: what Undo this import puts back (owner, 19
   * October 2026: "imported data shouldn't be editable"); left out by an API from before it.
   */
  undoable?: number;
  /** What is still on the run from it, whoever fills the lines (21 October 2026); left out by an API from before Delete. */
  kept?: AttendanceImportKept;
}

/**
 * The run's lines still filled from an import (the C-level people's too) and the days kept from it: what a Super Admin's
 * Delete undoes first (asked, 21 October 2026: "how to delete previous imports").
 */
export interface AttendanceImportKept {
  lines: number;
  days: number;
}

/** DELETE /payroll/runs/:id/attendance-imports/:importId(?undo=1): what it did. */
export interface AttendanceImportDeleted {
  id: string;
  runId: string;
  month: string;
  undone: boolean;
  lines: number;
  days: number;
}

/** GET /payroll/runs/:id/attendance-imports: the run's imports, the latest first. */
export interface AttendanceImportSummary {
  id: string;
  createdAt: string;
  createdBy: string | null;
  files: number;
  people: number;
  appliedAt: string | null;
}

// ---------- the Attendance section (owner, 19 October 2026: "the attendance is not active in the side menu") ----------
// As GET /attendance, /attendance/me, /attendance/employees/:id, /attendance/summary and /attendance/imports send them
// (apps/api/src/attendance/attendance.service.ts).

/** Who a row of attendance is, and where they worked that month ("Department › Team"). */
export interface AttendanceEmployee {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  jobTitle: string | null;
  department: string | null;
  departmentId: string | null;
  confidential: boolean;
}

/** A day kept, as the pages show it, with the import it came from. */
export type AttendanceDay = AttendanceDayView & { importId: string | null };

/** A person's month: their days and the month's figures. */
export interface AttendancePersonMonth {
  employee: AttendanceEmployee;
  month: string;
  hoursADay: number | null;
  figures: AttendanceFigures;
  averageHours: number | null;
  permissionFrom: 'system' | 'zoho' | null;
  /**
   * They checked in on the system that month (owner, 19 October 2026: "Check-in through the system … to replace Zoho"):
   * Zoho's days count only before their first check-in, and a working day gone by without one is absent. Left out by an
   * API from before it.
   */
  checksIn?: boolean;
  days: AttendanceDay[];
  /**
   * Daily Attendance and the team view (owner, 20 October 2026: "simplify this, i want to view if it is remote or office,
   * and location link"): every press of the month, the spot only for those who see it. Left out by an API from before it.
   */
  punches?: AttendancePunchRow[];
  /**
   * The month's work from home days approved for them (owner, 21 October 2026: "think about how should we handle the
   * working from home in out erp"), in date order: those days show "Working from home". Left out by an API from before it.
   */
  wfhDays?: string[];
}

/**
 * A press of Check in or Check out as the Attendance pages list it, under its day (GET /attendance's people, and
 * /attendance/me's and /attendance/employees/:id's `punches`): the day it counts on, in or out, the server's moment, the
 * place, the flags, the location's and the office network's names. The spot (owner, 20 October 2026: "Yes, keep the
 * spot") only for HR, the CEO, the Super Admin and the employee themself: its point, the reading's accuracy and where
 * the point comes from (the press, or an old office press's location); left out for everyone else.
 */
export interface AttendancePunchRow {
  date: string;
  kind: string;
  at: string;
  place: string;
  flags?: readonly string[];
  locationName?: string | null;
  officeNetwork?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMetres?: number | null;
  pointFrom?: PunchPointFrom | null;
}

/** An import the days shown came from (the run's status for those who see payroll only). */
export interface AttendanceSource {
  importId: string;
  runId: string;
  month: string;
  runStatus: PayrollStatus | null;
  createdAt: string;
  createdBy: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  files: string[];
}

/** The month's payroll run (for those who see payroll), the way to import its attendance. */
export interface AttendanceRunRef {
  id: string;
  status: PayrollStatus;
}

/** GET /attendance: a month of everyone's attendance, or a manager's team's. */
export interface AttendanceMonthView {
  month: string;
  scope: 'everyone' | 'team';
  filter: { departmentId: string | null; employeeId: string | null; only: AttendanceFilter | null };
  people: AttendancePersonMonth[];
  totals: AttendanceFigures;
  withoutDays: AttendanceEmployee[];
  hidden: { count: number; label: string } | null;
  sources: AttendanceSource[];
  run: AttendanceRunRef | null;
}

/** GET /attendance/me and /attendance/employees/:id: one person's month. */
export interface PersonAttendanceView {
  month: string;
  person: AttendancePersonMonth;
  self: boolean;
  sources: AttendanceSource[];
  run: AttendanceRunRef | null;
}

/** GET /attendance/summary: a period by department and team. */
export interface AttendanceSummaryView {
  generatedAt: string;
  period: { from: string; to: string };
  months: string[];
  groups: AttendanceSummaryGroup[];
  totals: AttendanceSummaryRow;
  hidden: { count: number; label: string } | null;
}

/** GET /attendance/imports: an import across the runs. */
export interface AttendanceImportRow {
  id: string;
  runId: string;
  month: string;
  runStatus: PayrollStatus;
  createdAt: string;
  createdBy: string | null;
  files: { name: string; rows: number; people: number }[];
  people: number;
  counts: { matched: number; toConfirm: number; notFound: number; skipped: number };
  appliedAt: string | null;
  appliedBy: string | null;
  undoneAt: string | null;
  /** What is still on its run from it (21 October 2026); left out by an API from before Delete. */
  kept?: AttendanceImportKept;
}

// ---------- checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the
// office location check, or a device) to replace Zoho") ----------
// As GET /me/attendance/today and POST /me/attendance/punches send them (apps/api/src/attendance/check-in.service.ts).
// The API reads the browser's location to tell the office from remote, and keeps the point with the press (owner, 20
// October 2026: "Yes, keep the spot"): the employee's own today carries it.

/** A press of Check in or Check out as the day shows it: the server's moment, where it was, how accurate, its flags. */
export interface PunchView {
  kind: PunchKind;
  at: string;
  place: CheckInPlace;
  accuracyMetres: number | null;
  flags: CheckInFlag[];
  /**
   * The check-in location it was within, by its name then, and the office network it came from, by its name (owner, 20
   * October 2026: several locations, and the office network's lock); never the address. Left out by an API from
   * before them.
   */
  locationName?: string | null;
  officeNetwork?: string | null;
  /** Where it was pressed (20 October 2026: "Yes, keep the spot"), and where that point comes from; none: no point. */
  latitude?: number | null;
  longitude?: number | null;
  pointFrom?: PunchPointFrom | null;
}

/** The day as today's punches make it: the first check-in, the last check-out after it, the place, flags and hours. */
export interface PunchedDayView {
  checkIn: string | null;
  checkOut: string | null;
  place: CheckInPlace | null;
  flags: CheckInFlag[];
  hoursCounted: number;
}

/** GET /me/attendance/today: whether they check in, today's punches and day, and what the next press is. */
export interface CheckInTodayView {
  /** Null: they check in on the system; else why not, in a sentence. */
  refusal: string | null;
  /** The working day the next punch counts on (YYYY-MM-DD, Cairo). */
  date: string;
  /** The server's time now (ISO): the time a punch takes. */
  now: string;
  next: PunchKind;
  punches: PunchView[];
  day: PunchedDayView | null;
  /** Where their work arrangement expects them today, and in words. */
  expected: ExpectedPlace | null;
  expectedText: string | null;
  /** Whether HR set a check-in location (Attendance → Check-in Setup): without one every check-in is location unknown. */
  officeLocationSet: boolean;
  /**
   * Whether their check-ins and check-outs need the office network (owner, 20 October 2026: "Office staff, plus
   * exceptions"). Left out by an API from before it.
   */
  network?: { locked: boolean };
  /**
   * The sub-locations they are linked to, by name (owner, 20 October 2026: "own sublocation shows the sub location
   * name"): their own check-in places, where a locked Office person may check in off the office network. Left out by an
   * API from before them.
   */
  ownPlaces?: string[];
  /**
   * Whether their presses on the website need a location (owner, 20 October 2026: "Company switch + exceptions"): Check-in
   * Setup's switch on, and HR hasn't let them check in without one. Left out by an API from before it.
   */
  location?: { required: boolean };
  /**
   * Whether today is a work from home day approved for them (owner, 21 October 2026): expected anywhere, the office
   * network's lock waived. Left out by an API from before it.
   */
  workingFromHome?: boolean;
  /**
   * Their shift: its window (HH:MM), hours a day, grace minutes and the time it counts hours until (HH:MM; owner, 20
   * October 2026: make-up hours; null, or left out by an API from before it: none).
   */
  shift: { startTime: string; endTime: string; hoursPerDay: number | null; graceMinutes: number; countUntil?: string | null } | null;
}

/** POST /me/attendance/punches: the day after the punch, and what to tell them. */
export interface PunchResultView extends CheckInTodayView {
  messages: string[];
  /** False when it was the same press twice within a minute (kept once). */
  kept: boolean;
}

// ---------- Attendance → Check-in Setup (owner, 20 October 2026: "Own page, several locations") ----------
// As GET /attendance/check-in-setup/locations and /networks send them (apps/api/src/attendance/check-in-setup.service.ts).

/**
 * A check-in location: within its radius of its point a check-in is at the main office (`isMain`), or, at a
 * sub-location, remote with its name ("Remote - Studio"; owner, 20 October 2026: "main office location is the hero and
 * other locations are like sub locations. shown with their name and linked users"). Left out by an API from before them:
 * `isMain` (every location then was the office) and `people`.
 */
export interface CheckInLocationView {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  isMain?: boolean;
  /** A sub-location's linked people the caller may see (a C-level person only the CEO and the Super Admin), by name; none on the main office. */
  people?: LinkedPersonView[];
  createdAt: string;
  updatedAt: string;
}

/** A person linked to a sub-location, as its card names them. */
export interface LinkedPersonView {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

/** Someone a sub-location's "Link people" offers (GET /attendance/check-in-setup/people): a current employee the caller may see. */
export interface LinkablePersonView extends LinkedPersonView {
  department: string | null;
}

/** GET /employees/:id/check-in-places: the sub-locations a person is linked to, by name (their profile). */
export interface CheckInPlacesView {
  places: { id: string; name: string }[];
}

/**
 * The switch "Refuse check-ins and check-outs without a location" (owner, 20 October 2026: "Company switch +
 * exceptions"), as GET /attendance/check-in-setup/location-rule sends it.
 */
export interface LocationRuleView {
  refuseWithoutLocation: boolean;
}

/**
 * The office networks and the lock (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip, whatever is
 * right"): the list, the switch, whether the server holds the key and the lock is in force, and this request's address
 * as the website signed it (the office network it is on), or why it can't be trusted.
 */
export interface OfficeNetworksView {
  lock: boolean;
  networks: OfficeNetwork[];
  serverKey: boolean;
  inForce: boolean;
  here: { signed: true; ip: string; network: string | null } | { signed: false; problem: SignedIpProblem };
}
