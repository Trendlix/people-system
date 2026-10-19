import type { AttendanceDayView, AttendanceFigures, AttendanceFilter, AttendanceMonthResult, AttendanceSummaryGroup, AttendanceSummaryRow, PayrollStatus } from '@trendlix/shared';

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
  days: AttendanceDay[];
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
}
