import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { BankFileKind } from './bank.js';
import { monthShort } from './months.js';

// Bank transfer batches (owner, 5 November 2026: "allow me to select a group of people for the transfer", "and to
// confirm each batch sent to be recorded"; asked, "Tick names", "Show it, still pickable"): the people ticked for one
// bank file of an approved run, each with the amount it transfers to them, numbered within the run, made when its file
// is downloaded and confirmed once it is sent to the bank. Pure code, tested.

export const BATCH_INCLUDE = {
  madeBy: { select: { id: true, email: true } },
  sentBy: { select: { id: true, email: true } },
  lines: { select: { lineId: true, amount: true, line: { select: { employeeId: true, employeeCode: true, nameEn: true } } } },
} satisfies Prisma.PayrollBankBatchInclude;

export type BatchRow = Prisma.PayrollBankBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

/** The file's name in words: "CIB", "ACH". */
export const FILE_NAMES: Record<BankFileKind, string> = { cib: 'CIB', ach: 'ACH' };

export interface PayrollBankBatchView {
  id: string;
  number: number;
  file: BankFileKind;
  /** The CIB file's value date (YYYY-MM-DD): the day the bank pays. */
  valueDate: string | null;
  /** The lines in it the caller sees, with the amount it transfers to each. */
  lines: { lineId: string; amount: number }[];
  people: number;
  /** The amounts of the lines the caller sees. */
  total: number;
  /** Its lines hidden from the caller (the C-level people's, 19 October 2026). */
  hidden: number;
  madeAt: Date;
  madeBy: string | null;
  /** When it was confirmed sent to the bank, and by whom. */
  sentAt: Date | null;
  sentBy: string | null;
  /** The caller downloads it again, confirms it sent or discards it: not with people hidden from them in it. */
  acts: boolean;
}

/** Sums to the piaster. */
export const sumAmounts = (amounts: readonly number[]) => amounts.reduce((cents, a) => cents + Math.round(a * 100), 0) / 100;

/** What is left to transfer to a line: its transfer less what the batches hold for it, to the piaster (below 0: paid more). */
export const remainingOf = (transfer: number, held: number) => (Math.round(transfer * 100) - Math.round(held * 100)) / 100;

/** A batch as the API sends it to someone `hidden` people's lines are hidden from; `names`: users' names by id. */
export function batchView(b: BatchRow, hidden: ReadonlySet<string>, names: ReadonlyMap<string, { name: string }>): PayrollBankBatchView {
  const shown = b.lines.filter((l) => !hidden.has(l.line.employeeId));
  const lines = shown.map((l) => ({ lineId: l.lineId, amount: l.amount.toNumber() }));
  const nameOf = (u: { id: string; email: string } | null) => (u ? (names.get(u.id)?.name ?? u.email) : null);
  const hiddenCount = b.lines.length - shown.length;
  return {
    id: b.id,
    number: b.number,
    file: b.file as BankFileKind,
    valueDate: fromDateOnly(b.valueDate),
    lines,
    people: lines.length,
    total: sumAmounts(lines.map((l) => l.amount)),
    hidden: hiddenCount,
    madeAt: b.createdAt,
    madeBy: nameOf(b.madeBy),
    sentAt: b.sentAt,
    sentBy: nameOf(b.sentBy),
    acts: hiddenCount === 0,
  };
}

/** The users a batch names: who made it and who confirmed it sent. */
export const batchUsers = (batches: readonly Pick<BatchRow, 'madeBy' | 'sentBy'>[]) => batches.flatMap((b) => [b.madeBy, b.sentBy]);

/** The batch's file name, the owner's file names with the batch's number: "CIB NOV 2026 Salaries Batch 2.xlsx", "ACH Salaries Batch 2 NOV 2026.xlsx". */
export function batchFileName(kind: BankFileKind, month: string, number: number): string {
  const when = `${monthShort(month)} ${month.slice(0, 4)}`;
  return kind === 'cib' ? `CIB ${when} Salaries Batch ${number}.xlsx` : `ACH Salaries Batch ${number} ${when}.xlsx`;
}
