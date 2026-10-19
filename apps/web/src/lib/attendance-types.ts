import type { AttendanceMonthResult } from '@trendlix/shared';

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
