import { insuredWageFrom, type InsuredWage } from '@trendlix/shared';

/**
 * The insured wage social insurance Form 1 prints and payroll deducts insurance on (owner's decisions, 16 October 2026):
 * the comprehensive wage, the employee's own else the contract's gross and allowances, within `year`'s insurable
 * limits. Null without either. The Social Insurance tab shows it for this year, a payroll run uses the run's year.
 */
export function insuredWageOfEmployee(ownComprehensive: number | null, contractTotal: number | null, year: number): InsuredWage | null {
  const comprehensive = ownComprehensive ?? contractTotal;
  return comprehensive === null ? null : insuredWageFrom(comprehensive, year);
}
