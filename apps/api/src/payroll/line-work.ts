import { EMPTY_PAYROLL_INPUTS, payrollLine, type LawRates, type PayrollAdjustmentItem, type PayrollInputs, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { TOTAL_KEYS } from './views.js';

// Working a payroll line out (owner's decisions, 16 October 2026), shared by the runs (payroll.service.ts) and by
// Additions / Deductions (owner, 17 October 2026), which works a draft's line out again when one of its additions or
// deductions changes.

export const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * A line's saved inputs, only those there are today: one saved before it was taken off (the medical subscription,
 * owner's decision, 16 October 2026) is dropped when the line is refreshed or changed, and one saved before it existed
 * (the leave days, 17 October 2026) reads as not given.
 */
export const savedInputs = (saved: Prisma.JsonValue): PayrollInputs => {
  const values = (saved ?? {}) as Partial<PayrollInputs>;
  const fields = Object.keys(EMPTY_PAYROLL_INPUTS) as (keyof PayrollInputs)[];
  return Object.fromEntries(fields.map((k) => [k, values[k] ?? null])) as unknown as PayrollInputs;
};

/** A line worked out with the run's rules and rates set by law: its result, and the result's totals for their columns. */
export function worked(terms: PayrollTerms, inputs: PayrollInputs, rules: PayrollRules, law: LawRates) {
  const result = payrollLine(terms, inputs, rules, law);
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, result[k]])) as Record<(typeof TOTAL_KEYS)[number], number>;
  return { result: json(result), ...totals };
}

/**
 * The terms with the month's additions and deductions for the line (owner, 17 October 2026): those given, in the order
 * entered; none, the terms without any (so a line without any reads as it did before them).
 */
export function withAdjustments(terms: PayrollTerms, items: readonly PayrollAdjustmentItem[] | undefined): PayrollTerms {
  const rest: PayrollTerms = { ...terms };
  delete rest.adjustments;
  return items?.length ? { ...rest, adjustments: [...items] } : rest;
}
