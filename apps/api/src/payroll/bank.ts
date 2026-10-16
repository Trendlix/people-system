import { accountLengthOk, accountLengthText, bankNamed } from '@trendlix/shared';
import { normalizeAccountNo, normalizeIban, normalizeName } from '../employees/checks.js';

// Which bank file pays each line (owner's decisions, 16 October 2026): an employee whose bank is CIB is paid through
// CIB's payroll system file, everyone else through the ACH file; the bank accepts only details it can pay. Before the
// CEO approves a run the employee's bank details are checked as they are now, afterwards as they were copied at the
// approval.

export type BankFileKind = 'cib' | 'ach';

/** A line's bank details: the employee's (bankName as typed or the list's name), or the copy taken at the approval (the list's short code). */
export interface BankDetails {
  bank: string | null;
  accountNo: string | null;
  iban: string | null;
  holderName: string | null;
}

/**
 * Bank details as the bank files need them: the account number and IBAN without spaces, dashes or invisible
 * characters, the holder's name without spaces around it (owner's request, 17 October 2026: "make sure there is no
 * spaces before or after the field data, and check the previous entered data"). Saving cleans them already; this also
 * covers anything saved or copied onto a run before then. An empty value is none.
 */
export function cleanBankDetails(d: BankDetails): BankDetails {
  const clean = (value: string | null, how: (v: string) => string) => (value === null ? null : how(value) || null);
  return {
    bank: clean(d.bank, normalizeName),
    accountNo: clean(d.accountNo, normalizeAccountNo),
    iban: clean(d.iban, normalizeIban),
    holderName: clean(d.holderName, normalizeName),
  };
}

/** Which file pays the line, its bank's short code, and what stops it being paid; the details themselves are never sent. */
export interface LineBank {
  file: BankFileKind | null;
  bankShort: string | null;
  problem: string | null;
}

/** CIB's payroll system takes its own 12-digit account numbers (banks.ts: CIB, 12 digits). */
const CIB_ACCOUNT = /^\d{12}$/;

export function lineBank(d: BankDetails): LineBank {
  const known = bankNamed(d.bank);
  if (!d.bank && !d.accountNo && !d.iban) return { file: null, bankShort: null, problem: 'No bank details on file.' };
  if (!d.bank) return { file: null, bankShort: null, problem: 'The bank details have no bank chosen.' };
  if (!known) return { file: null, bankShort: null, problem: "The bank isn't on the EG-ACH list, so neither bank file can pay it." };
  if (known.short === 'CIB') {
    const ok = !!d.accountNo && CIB_ACCOUNT.test(d.accountNo);
    return { file: 'cib', bankShort: known.short, problem: ok ? null : 'The CIB file needs the 12-digit CIB account number.' };
  }
  const ok = !!d.iban || (!!d.accountNo && accountLengthOk(known, d.accountNo));
  const length = accountLengthText(known);
  return {
    file: 'ach',
    bankShort: known.short,
    problem: ok ? null : `The ACH file needs the IBAN, or the account number${length ? ` (${known.short}: ${length})` : ''}.`,
  };
}

/** A line as the bank files see it. */
export interface PaidLine {
  onHold: boolean;
  transfer: number;
  bank: LineBank;
}

/** Paid by the bank this month: not on hold, and something to transfer. */
export const paidByBank = (l: Pick<PaidLine, 'onHold' | 'transfer'>) => !l.onHold && l.transfer > 0;

/** In that bank file: paid by the bank, through that file, with nothing stopping it. */
export const inFile = (l: PaidLine, kind: BankFileKind) => paidByBank(l) && l.bank.file === kind && l.bank.problem === null;

/**
 * The bank panel's counts, of the lines paid by the bank this month (on hold and nothing to transfer left out): how
 * many go in each file, and how many can't be paid by either until their bank details are fixed.
 */
export function bankCheck(lines: readonly PaidLine[]): { cib: number; ach: number; problems: number } {
  const paid = lines.filter(paidByBank);
  return {
    cib: paid.filter((l) => inFile(l, 'cib')).length,
    ach: paid.filter((l) => inFile(l, 'ach')).length,
    problems: paid.filter((l) => l.bank.problem !== null).length,
  };
}
