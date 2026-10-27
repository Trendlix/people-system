import type { PayrollStatus } from '@trendlix/shared';
import { parseDate } from '../../../lib/format';
import type { PayrollLineView } from '../../../lib/types';

// A run's files (owner's decisions, 16 October 2026): the payroll register, any time, and once the CEO approved the run
// the two bank files: CIB's Payroll System file for the CIB accounts (with the day the bank is to pay, the value date)
// and the ACH file for every other bank; and the Tax Authority's salary-tax upload (owner, 27 October 2026: "the upload
// template of the ETA Payroll System"), ETA's own template with the run's rows written in, once approved too. They are Excel files the API makes; the browser gets them under the web domain,
// with the caller's session (files/[kind]/route.ts). Pure code, tested; relative imports, as vitest doesn't know the @/
// paths.

export const FILE_KINDS = ['register', 'cib', 'ach', 'eta'] as const;
export type PayrollFileKind = (typeof FILE_KINDS)[number];

export const isFileKind = (value: string): value is PayrollFileKind => (FILE_KINDS as readonly string[]).includes(value);

/** Where the browser downloads a run's file (a plain link, never prefetched). */
export const fileHref = (runId: string, kind: PayrollFileKind) => `/payroll/${runId}/files/${kind}`;

/** The bank files are made once the CEO approved the run (the bank details are those approved), and for a paid one. */
export const bankFilesReady = (status: PayrollStatus) => status === 'approved' || status === 'paid';

/**
 * The value date the CIB file is asked for with (YYYY-MM-DD): as typed on the page (DD/MM/YYYY) or as the API takes it;
 * today (Cairo) when none is given; null when it isn't a date.
 */
export function valueDateFrom(raw: string | null, today: string): string | null {
  const s = (raw ?? '').trim();
  if (s === '') return today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseDate(s.split('-').reverse().join('/')) || null;
  return parseDate(s) || null;
}

/** The API's address for a run's file: GET /payroll/runs/:id/files/:kind, the CIB file with its value date. */
export function apiFilePath(runId: string, kind: PayrollFileKind, valueDate: string | null): string {
  const path = `/payroll/runs/${encodeURIComponent(runId)}/files/${kind}`;
  return kind === 'cib' && valueDate ? `${path}?valueDate=${valueDate}` : path;
}

/** The name a file is saved under when the API names none. */
export const FALLBACK_NAMES: Record<PayrollFileKind, string> = {
  register: 'Payroll register.xlsx',
  cib: 'CIB salaries.xlsx',
  ach: 'ACH salaries.xlsx',
  eta: 'ETA salary tax.xlsx',
};

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The API's Excel file passed on to the browser, saved under the name the API sends (`fallbackName` when it sends
 * none), with nothing allowed to run in it. Null when the API sent anything else: the caller answers 502 in its words.
 */
export function passSheetOn(res: Response, fallbackName: string): Response | null {
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== XLSX && type !== 'application/octet-stream') return null;
  const disposition = res.headers.get('content-disposition') ?? `attachment; filename="${fallbackName}"`;
  const headers = new Headers({
    'content-type': XLSX,
    'content-disposition': disposition.replace(/^\s*inline/i, 'attachment'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  });
  // fetch unpacks a compressed body, so the length only holds when nothing was compressed on the way
  const length = res.headers.get('content-length');
  if (length && !res.headers.has('content-encoding')) headers.set('content-length', length);
  return new Response(res.body, { headers });
}

// ---------- who each bank file pays ----------

type BankLine = Pick<PayrollLineView, 'id' | 'onHold'> & { bank: Pick<PayrollLineView['bank'], 'problem'>; result: Pick<PayrollLineView['result'], 'transfer'> };

/**
 * The lines the bank pays this month whose bank details neither file can pay (to put right on the employee's bank
 * page: the API's count of problems), and those the bank files leave out this month: on hold, or with nothing to
 * transfer (all of it released already, or deductions above the pay).
 */
export function bankLeftOut<L extends BankLine>(lines: readonly L[]): { problems: L[]; held: L[]; nothingToPay: L[] } {
  const paid = (l: L) => !l.onHold && l.result.transfer > 0;
  return {
    problems: lines.filter((l) => paid(l) && l.bank.problem !== null),
    held: lines.filter((l) => l.onHold),
    nothingToPay: lines.filter((l) => !l.onHold && l.result.transfer <= 0),
  };
}

/** Where ETA's tax for the month differs from what the payroll deducted, by a pound or more. */
export interface EtaDifference {
  employeeId: string;
  employeeCode: string;
  name: string;
  payrollTax: number;
  etaTax: number;
}

/** The ETA file's check, shown before the download (GET /payroll/runs/:id/files/eta/check). */
export interface EtaCheck {
  /** The people in the file: on salary tax, freelancers left out. */
  employees: number;
  /** The earlier months of the year the file's cumulative figures are built on. */
  earlierMonths: number;
  differences: EtaDifference[];
}

/** The check's address on the API. */
export const etaCheckPath = (runId: string) => `/payroll/runs/${encodeURIComponent(runId)}/files/eta/check`;
