import { bankNamed, hiddenLinesLabel, type PayrollStatus, type Role } from '@trendlix/shared';
import { formatDate, parseDate } from '../../../lib/format';
import type { ViewAs } from '../../../lib/view-as';
import type { PayrollBankBatchView, PayrollBankFile, PayrollLineView } from '../../../lib/types';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { canSeePayroll } from './list';

// A run's files (owner's decisions, 16 October 2026): the payroll register, any time, and once the CEO approved the run
// the two bank files: CIB's Payroll System file for the CIB accounts (with the day the bank is to pay, the value date)
// and the ACH file for every other bank and the mobile wallets; and the Tax Authority's salary-tax upload (owner, 27
// October 2026: "the upload template of the ETA Payroll System"), ETA's own template with the run's rows written in,
// once approved too. The bank files are made batch by batch (owner, 5 November 2026: "allow me to select a group of
// people for the transfer", "and to confirm each batch sent to be recorded", "on ticking calculate the transferred
// amount of ticked people"; asked, "Tick names", "Show it, still pickable"): the people ticked, each batch numbered and
// confirmed once sent to the bank. They are Excel files the API makes; the browser gets them under the web domain, with
// the caller's session (files/[kind]/route.ts, bank-batches/[batchId]/file/route.ts). Pure code, tested; relative
// imports, as vitest doesn't know the @/ paths.

export const FILE_KINDS = ['register', 'eta'] as const;
export type PayrollFileKind = (typeof FILE_KINDS)[number];

export const isFileKind = (value: string): value is PayrollFileKind => (FILE_KINDS as readonly string[]).includes(value);

/** Where the browser downloads a run's file (a plain link, never prefetched). */
export const fileHref = (runId: string, kind: PayrollFileKind) => `/payroll/${runId}/files/${kind}`;

/** The run's Pay as a spreadsheet to review, a Super Admin's only (owner, 2 November 2026; [id]/review/route.ts). */
export const reviewHref = (runId: string) => `/payroll/${runId}/review`;

/** The bank files are made once the CEO approved the run (the bank details are those approved), and for a paid one. */
export const bankFilesReady = (status: PayrollStatus) => status === 'approved' || status === 'paid';

/** The value date the CIB file is made with (YYYY-MM-DD), as typed on the page (DD/MM/YYYY); today (Cairo) when none; null when it isn't a date. */
export function valueDateFrom(raw: string | null, today: string): string | null {
  const s = (raw ?? '').trim();
  if (s === '') return today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseDate(s.split('-').reverse().join('/')) || null;
  return parseDate(s) || null;
}

/** The API's address for a run's file: GET /payroll/runs/:id/files/:kind. */
export const apiFilePath = (runId: string, kind: PayrollFileKind) => `/payroll/runs/${encodeURIComponent(runId)}/files/${kind}`;

/** The name a file is saved under when the API names none. */
export const FALLBACK_NAMES: Record<PayrollFileKind, string> = {
  register: 'Payroll register.xlsx',
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

// ---------- bank transfer batches ----------

export const BANK_FILES: readonly PayrollBankFile[] = ['cib', 'ach'];

/** The file's name on the page: "CIB file", "ACH file"; `short`: "CIB", "ACH". */
export const BANK_FILE_LABELS: Record<PayrollBankFile, { name: string; short: string; note: string }> = {
  cib: { name: 'CIB file', short: 'CIB', note: 'CIB accounts' },
  ach: { name: 'ACH file', short: 'ACH', note: 'Other banks and wallets' },
};

/** Where the browser downloads a batch's file (a plain link, never prefetched). */
export const batchFileHref = (runId: string, batchId: string) => `/payroll/${runId}/bank-batches/${batchId}/file`;

/** The API's address for a batch's file. */
export const apiBatchFilePath = (runId: string, batchId: string) =>
  `/payroll/runs/${encodeURIComponent(runId)}/bank-batches/${encodeURIComponent(batchId)}/file`;

/** The name a batch's file is saved under when the API names none (it names it with the batch's number). */
export const BATCH_FALLBACK_NAME = 'Salaries batch.xlsx';

type PayeeLine = Pick<PayrollLineView, 'id' | 'onHold' | 'department'> & {
  bank: Pick<PayrollLineView['bank'], 'file' | 'bankShort' | 'problem'>;
  result: Pick<PayrollLineView['result'], 'transfer'>;
};

/** The lines a bank file pays: not on hold, something to transfer, bank details that file can pay. */
export function payees<L extends PayeeLine>(lines: readonly L[], file: PayrollBankFile): L[] {
  return lines.filter((l) => !l.onHold && l.result.transfer > 0 && l.bank.file === file && l.bank.problem === null);
}

/** Paid to a mobile wallet (MIDG; owner, 5 November 2026). */
export const isWallet = (line: Pick<PayeeLine, 'bank'>) => bankNamed(line.bank.bankShort)?.wallet === true;

/** The bank as the list shows it: its short code (CIB, QNB …), or Wallet. */
export const bankLabel = (line: Pick<PayeeLine, 'bank'>) => (isWallet(line) ? 'Wallet' : line.bank.bankShort);

/** The departments among the lines, for the quick pick, in order; those without one left out. */
export function departmentsOf(lines: readonly Pick<PayeeLine, 'department'>[]): string[] {
  return [...new Set(lines.map((l) => l.department?.trim()).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b));
}

type BatchMarkSource = Pick<PayrollBankBatchView, 'number' | 'file' | 'sentAt' | 'lines'>;

/** A batch a line is in: its number, its file and when it was confirmed sent (null: not yet). */
export type BatchMark = Pick<PayrollBankBatchView, 'number' | 'file' | 'sentAt'>;

/** By line, the batches it is in, by number. */
export function batchMarks(batches: readonly BatchMarkSource[]): Map<string, BatchMark[]> {
  const marks = new Map<string, BatchMark[]>();
  for (const b of [...batches].sort((x, y) => x.number - y.number)) {
    for (const l of b.lines) marks.set(l.lineId, [...(marks.get(l.lineId) ?? []), { number: b.number, file: b.file, sentAt: b.sentAt }]);
  }
  return marks;
}

/** The batches a line is in, in words: "Sent in batch 1 on 05/11/2026", "In batch 2, not confirmed sent yet"; null for none. */
export function batchNote(marks: readonly BatchMark[] | undefined): string | null {
  if (!marks?.length) return null;
  return marks.map((m) => (m.sentAt ? `Sent in batch ${m.number} on ${formatDate(m.sentAt)}` : `In batch ${m.number}, not confirmed sent yet`)).join('; ');
}

/**
 * What the batches hold for each line, a batch not confirmed sent yet too (owner, 5 November 2026: asked, "No,
 * reserved"), summed in piasters so it never drifts.
 */
export function heldByLine(batches: readonly Pick<PayrollBankBatchView, 'lines'>[]): Map<string, number> {
  const cents = new Map<string, number>();
  for (const b of batches) for (const l of b.lines) cents.set(l.lineId, (cents.get(l.lineId) ?? 0) + Math.round(l.amount * 100));
  return new Map([...cents].map(([id, c]) => [id, c / 100]));
}

/** What is left to transfer to a line: its transfer less what the batches hold for it (below 0: paid more than it is now). */
export const leftOf = (line: Pick<PayeeLine, 'id' | 'result'>, held: ReadonlyMap<string, number>) =>
  (Math.round(line.result.transfer * 100) - Math.round((held.get(line.id) ?? 0) * 100)) / 100;

/** A file's person with what the batches hold for them and what is left to transfer. */
export type Payee<L> = L & { held: number; left: number };

/**
 * A file's people split by what is left to transfer (owner, 5 November 2026: "batches sent to the back employees are not
 * to be selected again instead there is an edit and they have remaining payment"; asked, "if there was a problem in the
 * employee calculation and has been edited"): `owed`, something left (the whole transfer, or the rest after a
 * correction upwards), to tick; `paid`, paid in full by the batches (or more, after a correction downwards), never ticked.
 */
export function owedOf<L extends PayeeLine>(people: readonly L[], batches: readonly Pick<PayrollBankBatchView, 'lines'>[]): { owed: Payee<L>[]; paid: Payee<L>[] } {
  const held = heldByLine(batches);
  const all = people.map((p) => ({ ...p, held: held.get(p.id) ?? 0, left: leftOf(p, held) }));
  return { owed: all.filter((p) => p.left > 0), paid: all.filter((p) => p.left <= 0) };
}

/**
 * Under a person owed something who is in a batch already: "EGP 1,000.00 left · EGP 9,000.00 in batch 1"; null for one
 * in no batch (their whole transfer is left).
 */
export function owedNote(p: Pick<Payee<PayeeLine>, 'id' | 'held' | 'left'>, marks: ReadonlyMap<string, BatchMark[]>): string | null {
  const numbers = (marks.get(p.id) ?? []).map((m) => m.number);
  if (!(p.held > 0) || !numbers.length) return null;
  const which = numbers.length === 1 ? `batch ${numbers[0]}` : `batches ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
  return `${formatEgp(p.left)} left · ${formatEgp(p.held)} in ${which}`;
}

/** Under one paid more than their transfer now (corrected downwards): "Paid EGP 500.00 more than the corrected transfer"; null otherwise. */
export const overpaidNote = (p: Pick<Payee<PayeeLine>, 'left'>) => (p.left < 0 ? `Paid ${formatEgp(-p.left)} more than the corrected transfer` : null);

/** Ticked to start with: everyone owed something. */
export function startTicks(owed: readonly Pick<Payee<PayeeLine>, 'id' | 'left'>[]): Set<string> {
  return new Set(owed.filter((p) => p.left > 0).map((p) => p.id));
}

/** What is left to transfer to the ticked people, summed in piasters so it never drifts. */
export function tickedTotal(owed: readonly Pick<Payee<PayeeLine>, 'id' | 'left'>[], ticked: ReadonlySet<string>): number {
  return owed.reduce((cents, p) => cents + (ticked.has(p.id) && p.left > 0 ? Math.round(p.left * 100) : 0), 0) / 100;
}

/** "1 person", "8 people". */
export const peopleText = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** A batch in the list: "Batch 2 · ACH file · 7 people · EGP 90,000.00". */
export const batchTitle = (b: Pick<PayrollBankBatchView, 'number' | 'file' | 'people' | 'total'>) =>
  `Batch ${b.number} · ${BANK_FILE_LABELS[b.file].name} · ${peopleText(b.people)} · ${formatEgp(b.total)}`;

/** Its people hidden from the caller, said as the run says them: "C-level (2 people) — hidden"; null for none. */
export const batchHiddenText = (b: Pick<PayrollBankBatchView, 'hidden'>) => (b.hidden > 0 ? hiddenLinesLabel(b.hidden) : null);

/** Asked before a batch is recorded as sent: "Confirm batch 2 (ACH, 7 people, EGP 90,000.00) was sent to the bank?" */
export const confirmSentText = (b: Pick<PayrollBankBatchView, 'number' | 'file' | 'people' | 'total'>) =>
  `Confirm batch ${b.number} (${BANK_FILE_LABELS[b.file].short}, ${peopleText(b.people)}, ${formatEgp(b.total)}) was sent to the bank?`;

/** Asked before a batch is discarded. */
export const discardText = (b: Pick<PayrollBankBatchView, 'number'>) =>
  `Discard batch ${b.number}? What it holds can be ticked again. Only when it wasn't sent to the bank.`;

/** A batch's people as its details list them: each line it holds with its amount, in the run's order (those hidden left out). */
export function batchPeople<L extends Pick<PayrollLineView, 'id'>>(batch: Pick<PayrollBankBatchView, 'lines'>, lines: readonly L[]): (L & { amount: number })[] {
  const amounts = new Map(batch.lines.map((l) => [l.lineId, l.amount]));
  return lines.filter((l) => amounts.has(l.id)).map((l) => ({ ...l, amount: amounts.get(l.id)! }));
}

/**
 * Makes, confirms and discards batches: those who see payroll (HR, Finance, the CEO), as the bank files were; never a
 * developer (read only), nor a Super Admin viewing as someone without acting in their name. The API checks again.
 */
export function makesBankBatches(user: { roles: readonly Role[]; developer?: boolean; viewAs?: ViewAs | null }): boolean {
  return canSeePayroll(user) && !user.developer && (!user.viewAs || user.viewAs.act);
}
