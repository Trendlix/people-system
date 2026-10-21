import type { LeaveImportRowStatus, LeaveImportSource, ZohoApproval } from '@trendlix/shared';

// A leave import as the API sends it (owner, 21 October 2026: "how to import bulk leaves?"; apps/api/src/leave/
// leave-import.service.ts): the file, its people, a Zoho file's leave types, each row with its status, and the history.
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
  typeId: string | null;
  chosen: boolean;
  defaultTypeId: string | null;
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
  kept: { leaves: number; adjustments: number };
}

export interface LeaveImportHistoryRow {
  id: string;
  fileName: string;
  source: LeaveImportSource;
  sourceLabel: string;
  createdAt: string;
  createdBy: string | null;
  rows: { leaves: number; balances: number };
  kept: { leaves: number; adjustments: number };
  appliedAt: string | null;
  appliedBy: string | null;
  undoneAt: string | null;
  undoneBy: string | null;
  state: 'not_applied' | 'applied' | 'undone';
}
