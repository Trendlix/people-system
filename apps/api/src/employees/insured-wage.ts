import { insuredWageFrom, type InsuredWage, type LawRates } from '@trendlix/shared';

/**
 * The insured wage social insurance Form 1 prints and payroll deducts insurance on (owner's decisions, 16 October 2026):
 * the comprehensive wage, the employee's own else the contract's gross and allowances, within the insurable limits of
 * the year's rates set by law (`rates`: LawRatesService's for the year). Null without either. The Social Insurance tab
 * shows it for this year, a payroll run uses the run's year.
 */
export function insuredWageOfEmployee(ownComprehensive: number | null, contractTotal: number | null, rates: LawRates): InsuredWage | null {
  const comprehensive = ownComprehensive ?? contractTotal;
  return comprehensive === null ? null : insuredWageFrom(comprehensive, rates);
}
