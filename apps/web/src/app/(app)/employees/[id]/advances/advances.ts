import { sumAmounts } from '@trendlix/shared';
import type { DeductionPlansView } from '../../../../../lib/types';
import type { AdvanceRow } from '../../../payroll/adjustments/adjustments';

// The employee's advances and loans on the Salary sub-tab (owner, 17 October 2026), and since 18 October 2026 their
// Loans and Deductions (owner: "in the deductions i might have a loan of a medical subscription or something that
// needs to be deducted as installments on the employee. how will it be managed?"): each open advance or loan with what
// is paid so far, what is left and the next installment, and the recurring deductions running or to come, for the
// employee themself as well as HR, Finance and the CEO. Plain helpers, tested; relative imports, as vitest doesn't know
// the @/ paths.

/** What was given in all, what is outstanding (the open ones'), and how many are still open. */
export function advanceTotals(rows: readonly Pick<AdvanceRow, 'amount' | 'outstanding' | 'status'>[]): { amount: number; outstanding: number; open: number } {
  const cents = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((c, r) => c + Math.round(pick(r) * 100), 0) / 100;
  return {
    amount: cents((r) => r.amount),
    outstanding: cents((r) => (r.status === 'open' ? r.outstanding : 0)),
    open: rows.filter((r) => r.status === 'open').length,
  };
}

/**
 * The open advances and loans as the plans have them, from HR's list of them (GET /payroll/advances): for an API from
 * before GET /employees/:id/deduction-plans, which HR, Finance and the CEO then still see.
 */
export function plansFromAdvances(rows: readonly AdvanceRow[]): DeductionPlansView['advances'] {
  return rows
    .filter((a) => a.status === 'open')
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      reason: a.reason,
      amount: a.amount,
      recovered: a.recovered,
      outstanding: a.outstanding,
      nextInstallment: a.nextInstallment ?? null,
      status: a.status,
    }));
}

/** What is left to pay on the open ones, and what the recurring deductions running take a month. */
export function plansTotals(plans: DeductionPlansView): { outstanding: number; monthly: number } {
  return {
    outstanding: sumAmounts(plans.advances.filter((a) => a.status === 'open').map((a) => a.outstanding)),
    monthly: sumAmounts(plans.recurring.filter((r) => r.status === 'running').map((r) => r.amount)),
  };
}

/** The note beside the section's title: "EGP 4,000.00 left to pay · EGP 350.00 a month recurring", or none. */
export function plansNote(plans: DeductionPlansView, money: (n: number) => string): string | undefined {
  const t = plansTotals(plans);
  const parts = [plans.advances.length ? `${money(t.outstanding)} left to pay` : null, t.monthly ? `${money(t.monthly)} a month recurring` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** Whether there is anything to show: an open advance or loan, or a recurring deduction running or to come. */
export const hasPlans = (plans: DeductionPlansView | null) => !!plans && (plans.advances.length > 0 || plans.recurring.length > 0);
