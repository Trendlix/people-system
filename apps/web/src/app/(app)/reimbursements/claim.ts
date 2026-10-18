import {
  REIMBURSEMENT_RECEIPT_MAX_MB,
  REIMBURSEMENT_RECEIPT_TYPES,
  REIMBURSEMENT_RECEIPTS_MAX,
  reimbursementLeft,
  reimbursementMost,
  reimbursementProblems,
  type ReimbursementRules,
  type ReimbursementUse,
} from '@trendlix/shared';
import { parseDate } from '../../../lib/format';
import type { MyReimbursementType } from '../../../lib/types';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { monthName, monthOf } from '../payroll/list';
import { amountTyped } from './list';

// The new reimbursement claim (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific
// preset up conditions"): the type, among those the employee may claim (GET /me/reimbursement-types), with its
// conditions and what is left of its caps; the expense's date, the amount, a description and the receipts (photos or
// PDFs). The form shows the shared checks (reimbursementProblems) live as it is filled in, and sends nothing while any
// is left; the API checks them all again. Pure code, tested: the checks, what is left in words, the receipts' limits and
// the form as the server action reads it. Relative imports: the tests run without the "@/" alias.

/** What the receipts box takes. Listing the types (not image/*) makes an iPhone hand over a JPEG instead of a HEIC photo. */
export const RECEIPT_ACCEPT = REIMBURSEMENT_RECEIPT_TYPES.join(',');

/** The API takes each receipt up to this size. */
export const RECEIPT_MAX_BYTES = REIMBURSEMENT_RECEIPT_MAX_MB * 1024 * 1024;

/**
 * All the receipts go in one upload, which passes through the web app on Vercel, at most 4.5 MB a request: together they
 * must stay under this (as the ID card's two scans, employees/paperwork.ts). Photos are made smaller in the browser first
 * (employees/shrink-photo.ts), so this mostly stops large PDFs.
 */
export const RECEIPTS_SEND_MAX_BYTES = 4 * 1024 * 1024;

/** The longest description the API takes. */
export const DESCRIPTION_MAX = 500;

/** A type's conditions as the shared rules take them. Who may claim it is the API's: the employee is sent only theirs. */
export const rulesOf = (t: MyReimbursementType): ReimbursementRules => ({
  receiptRequired: t.receiptRequired,
  capPerClaim: t.capPerClaim,
  capPerMonth: t.capPerMonth,
  capPerYear: t.capPerYear,
  claimWithinDays: t.claimWithinDays,
  departmentIds: [],
  gradeIds: [],
  employmentTypes: [],
});

/** What the employee's claims of the type already take of its caps, in the expense's month and year. */
export const usageOf = (t: Pick<MyReimbursementType, 'usedInMonth' | 'usedInYear'>): ReimbursementUse => ({ usedInMonth: t.usedInMonth, usedInYear: t.usedInYear });

/** Before a type is chosen: the amount and the date are still checked, against no conditions. */
const NO_RULES: ReimbursementRules = {
  receiptRequired: false,
  capPerClaim: null,
  capPerMonth: null,
  capPerYear: null,
  claimWithinDays: null,
  departmentIds: [],
  gradeIds: [],
  employmentTypes: [],
};

// ---------- the receipts ----------

/** A receipt as chosen: its name, size and kind (File has them). */
export interface ReceiptFile {
  name: string;
  size: number;
  type: string;
}

/** 812 → "812 B", 245 760 → "240 KB", 1 258 291 → "1.2 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why the receipts can't be sent: too many, of another kind, one too large, or too large together. None: they can. */
export function receiptProblems(files: readonly ReceiptFile[]): string[] {
  const problems: string[] = [];
  if (files.length > REIMBURSEMENT_RECEIPTS_MAX) problems.push(`Attach at most ${REIMBURSEMENT_RECEIPTS_MAX} receipts; remove ${files.length - REIMBURSEMENT_RECEIPTS_MAX}.`);
  for (const f of files) {
    if (!(REIMBURSEMENT_RECEIPT_TYPES as readonly string[]).includes(f.type)) problems.push(`${f.name || 'A file'} can't be attached: a receipt is a photo (JPG, PNG or WebP) or a PDF.`);
  }
  if (files.some((f) => f.size > RECEIPT_MAX_BYTES)) problems.push(`Each receipt must be ${REIMBURSEMENT_RECEIPT_MAX_MB} MB or smaller.`);
  else if (files.reduce((n, f) => n + f.size, 0) > RECEIPTS_SEND_MAX_BYTES) {
    problems.push('Together the receipts are too large to send: at most 4 MB. Take the photos again, or scan a PDF at a lower resolution (150–200 dpi is enough).');
  }
  return problems;
}

// ---------- the claim as typed ----------

/** The form as typed: the type chosen, the expense's date (DD/MM/YYYY), the amount and the description. */
export interface TypedClaim {
  typeId: string;
  expenseDate: string;
  amount: string;
  description: string;
}

/** The expense's date as YYYY-MM-DD ("" while empty or not a date), and the amount (NaN while empty or not one). */
export function readClaim(t: Pick<TypedClaim, 'expenseDate' | 'amount'>): { expenseDate: string; amount: number } {
  const amount = amountTyped(t.amount);
  return { expenseDate: parseDate(t.expenseDate) || '', amount: amount ?? NaN };
}

/**
 * Why the claim can't be sent yet, in the order to fix them (none: it can): the type, then the shared checks of the
 * amount, the date, the receipt and each cap against the type chosen (`type`, with what the employee's claims of it
 * already take in the expense's month and year), the description, and the receipts' limits. `today`: YYYY-MM-DD, Cairo.
 */
export function claimProblems(typed: TypedClaim, type: MyReimbursementType | null, receipts: readonly ReceiptFile[], today: string): string[] {
  const problems: string[] = [];
  if (!type) problems.push('Choose the type of expense.');
  const { expenseDate, amount } = readClaim(typed);
  problems.push(
    ...reimbursementProblems({ amount, expenseDate, today, receipts: receipts.length }, type ? rulesOf(type) : NO_RULES, type ? usageOf(type) : { usedInMonth: 0, usedInYear: 0 }),
  );
  const description = typed.description.trim();
  if (!description) problems.push('Describe the expense: what it was for.');
  else if (description.length > DESCRIPTION_MAX) problems.push(`Keep the description to ${DESCRIPTION_MAX} characters; it has ${description.length}.`);
  problems.push(...receiptProblems(receipts));
  return problems;
}

/** The month whose use of the caps a date counts in ("2026-10"), to load it again when the expense's date moves to another. */
export const capsMonth = (expenseDate: string) => monthOf(expenseDate);

/**
 * What is left of a type's caps, as the panel beside the form says it (owner, 18 October 2026: "in the setup i need to
 * enter for it a cap"): each cap set, with what is left of the month's and the year's for the expense's date (`month`,
 * "YYYY-MM"), and the most that can be claimed now. Caps not set are left out; `most` null: no cap at all.
 */
export function leftText(type: MyReimbursementType, month: string): { rows: { label: string; value: string; note: string | null }[]; most: string | null } {
  const rules = rulesOf(type);
  const use = usageOf(type);
  const left = reimbursementLeft(rules, use);
  const rows: { label: string; value: string; note: string | null }[] = [];
  if (type.capPerClaim !== null) rows.push({ label: 'A claim', value: formatEgp(type.capPerClaim), note: 'at most each time' });
  if (type.capPerMonth !== null && left.month !== null) {
    rows.push({ label: monthName(month), value: `${formatEgp(left.month)} left`, note: `of ${formatEgp(type.capPerMonth)} a month; ${formatEgp(use.usedInMonth)} claimed` });
  }
  if (type.capPerYear !== null && left.year !== null) {
    rows.push({ label: month.slice(0, 4), value: `${formatEgp(left.year)} left`, note: `of ${formatEgp(type.capPerYear)} a year; ${formatEgp(use.usedInYear)} claimed` });
  }
  const most = reimbursementMost(rules, use);
  return { rows, most: most === null ? null : formatEgp(most) };
}

// ---------- the form as the server action reads it ----------

/** What POST /me/reimbursements takes besides the receipts. */
export interface ClaimFields {
  typeId: string;
  expenseDate: string;
  amount: number;
  description: string;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/**
 * The claim sent: its fields as the API takes them (the date as YYYY-MM-DD, the amount as a number) and the receipts
 * (`receipts`, the files the form added), or what is wrong with them, checked again here before the upload. The
 * conditions of the type are the API's to check: it answers what is wrong.
 */
export function claimForm(fd: FormData): { fields: ClaimFields | null; receipts: File[]; errors: string[] } {
  const errors: string[] = [];
  const typeId = text(fd, 'typeId');
  if (!typeId) errors.push('Choose the type of expense.');
  const expenseDate = parseDate(text(fd, 'expenseDate'));
  if (!expenseDate) errors.push('Enter the date of the expense as DD/MM/YYYY, e.g. 14/10/2026.');
  const amount = amountTyped(text(fd, 'amount'));
  if (amount === null || Number.isNaN(amount) || amount <= 0) errors.push('Enter the amount spent, more than 0, e.g. 250 or 250.50.');
  const description = text(fd, 'description');
  if (!description) errors.push('Describe the expense: what it was for.');
  else if (description.length > DESCRIPTION_MAX) errors.push(`Keep the description to ${DESCRIPTION_MAX} characters; it has ${description.length}.`);
  const receipts = fd.getAll('receipts').filter((v): v is File => typeof v === 'object' && v !== null && 'size' in v && (v as File).size > 0);
  errors.push(...receiptProblems(receipts));
  if (errors.length) return { fields: null, receipts, errors };
  return { fields: { typeId, expenseDate: expenseDate!, amount: amount!, description }, receipts, errors };
}

/** The fields as the form shows them again after a refusal (not the receipts: a file box can't be refilled). */
export const typedValues = (fd: FormData): Record<string, string> => Object.fromEntries(['typeId', 'expenseDate', 'amount', 'description'].map((k) => [k, String(fd.get(k) ?? '')]));
