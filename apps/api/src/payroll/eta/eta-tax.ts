import { annualSalaryTax, type LawRates } from '@trendlix/shared';

// How the Tax Authority works the salary tax out, read off its own export of TrendLIX's filings (owner, 27 October
// 2026: "an extracted file with the prefilled data, to be able to do it correctly"; 13 rows, every one checked):
//
//   period base   = total earnings − employee social insurance − health insurance − personal exemption − premiums
//                   (the personal exemption a twelfth of the year's)
//   months        = the year's filings so far, this one included
//   annual base   = (Σ period bases ÷ months) × 12, rounded down to 10 pounds
//   cumulative    = the year's tax on the annual base × months ÷ 12: the tax due since the start of the year
//   period tax    = cumulative − the earlier periods' tax
//
// Every filing is a full month (owner, 27 October 2026: "the ETA system must have 30 days, it doesn't read part of
// the month, only full month"): a person paid for part of a month is filed with 30 days and the whole exemption.
//
// On a steady salary this is the monthly tax the payroll deducts (to the piaster: the payroll rounds its annual base
// before the exemption, ETA after); with a commission one month, ETA spreads it over the year's months so far while
// the payroll taxes the month on its own. The file carries ETA's figures, and the page says where they differ from
// what the payroll deducted (EtaFileService.check).

const cents = (n: number) => Math.round(n * 100) / 100;

/** A month's figures as the method takes them. */
export interface EtaPeriod {
  /** The period's base: total earnings less the deductions before tax. */
  base: number;
}

export interface EtaTaxFigures {
  months: number;
  annualBase: number;
  cumulativeTax: number;
  earlierTax: number;
  periodTax: number;
}

/** A twelfth of the year's personal exemption. */
export const etaExemption = (law: Pick<LawRates, 'personalExemption'>): number => cents(law.personalExemption / 12);

/** The year's tax of a period, after the earlier periods of the year (oldest first). */
export function etaTax(earlier: readonly EtaPeriod[], current: EtaPeriod, law: Pick<LawRates, 'taxTiers'>): EtaTaxFigures {
  let months = 0;
  let ytdBase = 0;
  let earlierTax = 0;
  const step = (p: EtaPeriod) => {
    months += 1;
    ytdBase = cents(ytdBase + p.base);
    const average = cents(ytdBase / months);
    const annualBase = Math.max(0, Math.floor((average * 12) / 10) * 10);
    const cumulativeTax = cents((annualSalaryTax(annualBase, law.taxTiers) * months) / 12);
    return { annualBase, cumulativeTax };
  };
  for (const p of earlier) earlierTax = step(p).cumulativeTax;
  const { annualBase, cumulativeTax } = step(current);
  return { months, annualBase, cumulativeTax, earlierTax, periodTax: cents(cumulativeTax - earlierTax) };
}
