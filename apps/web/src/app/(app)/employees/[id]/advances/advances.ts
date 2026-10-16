import type { AdvanceRow } from '../../../payroll/adjustments/adjustments';

// The employee's advances and loans on the Salary sub-tab (owner, 17 October 2026). Plain helpers, tested; relative
// imports, as vitest doesn't know the @/ paths.

/** What was given in all, what is outstanding (the open ones'), and how many are still open. */
export function advanceTotals(rows: readonly Pick<AdvanceRow, 'amount' | 'outstanding' | 'status'>[]): { amount: number; outstanding: number; open: number } {
  const cents = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((c, r) => c + Math.round(pick(r) * 100), 0) / 100;
  return {
    amount: cents((r) => r.amount),
    outstanding: cents((r) => (r.status === 'open' ? r.outstanding : 0)),
    open: rows.filter((r) => r.status === 'open').length,
  };
}
