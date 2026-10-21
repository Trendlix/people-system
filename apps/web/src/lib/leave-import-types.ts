import type { LeaveImportRowStatus, LeaveImportSource, ZohoApproval } from '@trendlix/shared';

// A leave import as the API sends it (owner, 21 October 2026: "how to import bulk leaves?"; apps/api/src/leave/
// leave-import.service.ts): the file, its people, a Zoho file's leave types, each row with its status, and the history.
// Zoho's Working from home rows are work-from-home days, not leave (owner, 21 October 2026: "Yes, as approved WFH days").
// Dates YYYY-MM-DD, moments ISO.

export interface LeaveImportEmployee {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

/** How a person of the file was matched: by code, Zoho id, name, close to a name, HR's choice, none, or skipped. */
export type LeaveImportPersonMatch = 'code' | 'linked' | 'exact' | 'close' | 'none' | 'confirmed' | 'skipped';

export interface LeaveImportPerson {
  key: string;
  code: string | null;
  name: string;
  zohoId: string | null;
  hint: string | null;
  rows: number;
  match: LeaveImportPersonMatch;
  toConfirm: boolean;
  employee: LeaveImportEmployee | null;
  candidates: (LeaveImportEmployee & { similarity: number })[];
  confidential: boolean;
}

export interface LeaveImportType {
  zohoType: string;
  rows: number;
  /** The system's type its rows are imported as; null: skipped, or work-from-home days. */
  typeId: string | null;
  /** Its rows are imported as work-from-home days. */
  wfh: boolean;
  chosen: boolean;
  defaultTypeId: string | null;
  defaultWfh: boolean;
  note: string | null;
}

export interface LeaveImportRow {
  sheet: 'leaves' | 'balances';
  row: number;
  status: LeaveImportRowStatus;
  reasons: string[];
  warnings: string[];
  notes: string[];
  personKey: string;
  nameInFile: string;
  code: string | null;
  employee: LeaveImportEmployee | null;
  confidential: boolean;
  typeText: string;
  type: { id: string; nameEn: string } | null;
  from: string | null;
  to: string | null;
  fromText: string;
  toText: string;
  days: number | null;
  fileDays: number | null;
  halfDay: boolean;
  pending: boolean;
  /** A work-from-home row: no type; its days, those it makes or made. */
  wfh: boolean;
  wfhDays: string[] | null;
  approval: ZohoApproval | null;
  approvalText: string | null;
  balance: number | null;
  asOf: string | null;
  adjustment: number | null;
  applied: { at: string } | null;
  yours: boolean;
  notYours: string | null;
}

export interface LeaveImportView {
  id: string;
  fileName: string;
  source: LeaveImportSource;
  sourceLabel: string;
  createdAt: string;
  createdBy: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  undoneAt: string | null;
  undoneBy: string | null;
  sameFile: string | null;
  uploadedBefore: string | null;
  people: LeaveImportPerson[];
  types: LeaveImportType[];
  leaves: LeaveImportRow[];
  balances: LeaveImportRow[];
  counts: Record<LeaveImportRowStatus, number> & { pending: number; hidden: number };
  hidden: { rows: number; label: string } | null;
  holidaysHint: string | null;
  noShowsToLeave: { days: number; people: number; text: string } | null;
  options: LeaveImportEmployee[];
  typeOptions: { id: string; nameEn: string; kind: string; balance: string }[];
  canApply: boolean;
  undoable: number;
  kept: LeaveImportKept;
}

/** What an import made that is still in the system: its leave, balance changes and work-from-home days. */
export interface LeaveImportKept {
  leaves: number;
  adjustments: number;
  wfhDays: number;
}

export interface LeaveImportHistoryRow {
  id: string;
  fileName: string;
  source: LeaveImportSource;
  sourceLabel: string;
  createdAt: string;
  createdBy: string | null;
  rows: { leaves: number; balances: number };
  kept: LeaveImportKept;
  appliedAt: string | null;
  appliedBy: string | null;
  undoneAt: string | null;
  undoneBy: string | null;
  state: 'not_applied' | 'applied' | 'undone';
}
