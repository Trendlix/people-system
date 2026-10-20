import { IsArray, IsNumber, IsOptional } from 'class-validator';
import type { LawRates, TaxTier } from '@trendlix/shared';

// A year's rates set by law, as the Super Admin sends them (owner's request, 16 October 2026): every value, the rates
// as fractions (0.11 for 11%), the amounts in EGP to the piaster, the tax tiers as packages/shared's TaxTier[] with null
// for no limit. Only the kinds are checked here; the limits, and the tax table's shape, are checked by lawRatesProblems
// in packages/shared, the same check the page makes, so the messages are the same.

const Numeric = (what: string) => IsNumber({ allowNaN: false, allowInfinity: false }, { message: `Enter ${what} as a number.` });

export class PutLawRatesDto {
  @Numeric("the employee's social insurance share")
  employeeInsuranceRate: number;

  @Numeric("the company's social insurance share")
  employerInsuranceRate: number;

  @Numeric('the minimum insurable wage')
  insurableWageMin: number;

  @Numeric('the maximum insurable wage')
  insurableWageMax: number;

  @Numeric('the personal exemption')
  personalExemption: number;

  @Numeric("the Martyrs' Fund rate")
  martyrsRate: number;

  @Numeric('the health insurance rate')
  healthInsuranceRate: number;

  /** Checked by taxTiersProblems: each tier's limit and bands, the last of each without a limit. */
  @IsArray({ message: 'Send the tax tiers as a list.' })
  taxTiers: TaxTier[];

  /**
   * The private sector's minimum wage a month (owner, 18 October 2026): a trainee's last training stage is paid at least
   * this (Labour Law 14/2025 Art. 29). Null clears it; left out, the year keeps the one it has.
   */
  @IsOptional() @Numeric('the minimum wage')
  minimumWage?: number | null;

  /**
   * The most of the employee's health insurance share that lowers their taxable pay in a year (owner, 20 October 2026,
   * on the medical share: "Before Tax i think"): the recurring deductions ticked "Deducted before tax" lower a month's
   * taxable pay by at most a twelfth of it. Null clears it (no limit); left out, the year keeps the one it has.
   */
  @IsOptional() @Numeric('the before-tax health insurance limit')
  beforeTaxHealthLimit?: number | null;
}

/** A year's rates from what was sent for it. */
export const ratesSent = (year: number, d: PutLawRatesDto): LawRates => ({
  year,
  employeeInsuranceRate: d.employeeInsuranceRate,
  employerInsuranceRate: d.employerInsuranceRate,
  insurableWageMin: d.insurableWageMin,
  insurableWageMax: d.insurableWageMax,
  personalExemption: d.personalExemption,
  martyrsRate: d.martyrsRate,
  healthInsuranceRate: d.healthInsuranceRate,
  taxTiers: d.taxTiers,
  ...(d.minimumWage !== undefined && { minimumWage: d.minimumWage }),
  ...(d.beforeTaxHealthLimit !== undefined && { beforeTaxHealthLimit: d.beforeTaxHealthLimit }),
});
