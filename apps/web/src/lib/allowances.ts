import { isPerAccount, PER_ACCOUNT_TEXT, type AllowanceTerms } from '@trendlix/shared';
// relative, not "@/": the unit tests run without the alias
import { parseAmount } from '../app/(app)/employees/[id]/contracts/salary';
import type { AllowanceType, FormState } from './types';

// Allowances as a contract's or a job offer's form sends them (components/allowance-rows.tsx): one allowanceTypeId and
// one allowanceAmount per row, in order. Read here for the API, and refilled from them after a refused save. A kind
// paid per client account (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with
// it?") has no amount on the contract or the offer: its row sends PER_ACCOUNT_MARK in place of one, and the API gets
// the kind alone (the person is eligible; payroll pays their client accounts).

/** What a per-account row sends as its amount: none, the kind is paid per client account assigned. */
export const PER_ACCOUNT_MARK = 'per_account';

/** What a kind does to the salary, in a few words: "Taxed, not insured". */
export function treatmentText(t: Pick<AllowanceType, 'taxable' | 'insured'>): string {
  return [t.taxable ? 'Taxed' : 'Not taxed', t.insured ? 'insured' : 'not insured'].join(', ');
}

/**
 * An allowance's amount as a contract or an offer shows it: the amount, or "Per client account assigned" for one paid
 * per client account (its amount 0).
 */
export function allowanceAmountText(a: { amount: number; basis?: AllowanceType['basis'] }, money: (n: number) => string): string {
  return isPerAccount(a) ? PER_ACCOUNT_TEXT : money(a.amount);
}

/** A row as typed: the kind's id and the amount as text. */
export interface AllowanceRow {
  allowanceTypeId: string;
  amount: string;
}

const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * The rows submitted, for the API: [{ allowanceTypeId, amount }], a per-account kind's without an amount. A row without
 * a kind or an amount is left out.
 */
export function allowancesFrom(fd: FormData, errors: string[]): { allowanceTypeId: string; amount?: number }[] {
  const ids = fd.getAll('allowanceTypeId').map(String);
  const amounts = fd.getAll('allowanceAmount').map(String);
  const out: { allowanceTypeId: string; amount?: number }[] = [];
  ids.forEach((id, i) => {
    const raw = (amounts[i] ?? '').trim();
    if (!id && (!raw || raw === PER_ACCOUNT_MARK)) return;
    if (!id) {
      errors.push('Choose the kind of each allowance, or remove the row.');
      return;
    }
    // paid per client account: the kind alone
    if (raw === PER_ACCOUNT_MARK) {
      out.push({ allowanceTypeId: id });
      return;
    }
    const amount = parseAmount(raw);
    if (amount === null || Number.isNaN(amount) || amount <= 0) {
      errors.push('Enter each allowance as an amount in EGP a month, more than 0, e.g. 1,000 or 750.50.');
      return;
    }
    out.push({ allowanceTypeId: id, amount });
  });
  if (new Set(out.map((a) => a.allowanceTypeId)).size !== out.length) errors.push('Each kind of allowance can be added once.');
  return out;
}

/**
 * The rows to show: as typed before a refused save, else as saved. A per-account row has no amount to show: its marker
 * as sent, or its 0 as saved (a fixed allowance is never 0), reads as none.
 */
export function allowanceRows(state: FormState, saved: readonly { allowanceTypeId: string; amount?: number }[] = []): AllowanceRow[] {
  if (state.values && 'allowanceTypeId' in state.values) {
    const ids = list(state.values.allowanceTypeId);
    const amounts = list(state.values.allowanceAmount);
    return ids.map((id, i) => ({ allowanceTypeId: id, amount: amounts[i] === PER_ACCOUNT_MARK ? '' : (amounts[i] ?? '') }));
  }
  return saved.map((a) => ({ allowanceTypeId: a.allowanceTypeId, amount: a.amount ? String(a.amount) : '' }));
}

/**
 * The rows as the salary is worked out from them (shared grossToNet), each with its kind's treatment. Rows not yet
 * valid are left out, and so are those paid per client account: they have no amount on the contract or the offer.
 */
export function allowanceTerms(rows: readonly AllowanceRow[], types: readonly AllowanceType[]): AllowanceTerms[] {
  const byId = new Map(types.map((t) => [t.id, t]));
  return rows.flatMap((r) => {
    const t = byId.get(r.allowanceTypeId);
    if (!t || isPerAccount(t)) return [];
    const amount = parseAmount(r.amount);
    return amount !== null && !Number.isNaN(amount) && amount > 0 ? [{ amount, taxable: t.taxable, insured: t.insured }] : [];
  });
}

/**
 * Whether the rows are the saved allowances: the same kinds with the same amounts, in any order (rows not yet valid
 * count as different). The contract form tells a net saved by hand from one that changed with the allowances by it. A
 * row with no amount matches a saved 0, which only a per-account allowance has.
 */
export function sameAllowances(rows: readonly AllowanceRow[], saved: readonly { allowanceTypeId: string; amount?: number }[]): boolean {
  const key = (id: string, amount: number | null) => `${id}=${amount}`;
  const typed = rows.map((r) => key(r.allowanceTypeId, parseAmount(r.amount) ?? 0)).sort();
  const was = saved.map((a) => key(a.allowanceTypeId, a.amount ?? 0)).sort();
  return typed.length === was.length && typed.every((k, i) => k === was[i]);
}
