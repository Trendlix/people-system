import { lawRatesFor } from '@trendlix/shared';
import { etaExemption, etaTax } from './eta-tax.js';

// The figures are rows of the Tax Authority's own export of TrendLIX's 2026 filings (amounts only): what the method
// has to give back from the period bases.
const law = lawRatesFor(2026);
const month = (base: number) => ({ base });

describe("ETA's salary tax", () => {
  it('takes a twelfth of the personal exemption every month', () => {
    expect(etaExemption(law)).toBe(1666.67);
  });

  it('a steady salary, third month: the annual base floored to 10, the tax due since January, this period’s share', () => {
    // 15,000 a month, insured on it: base 15,000 − 1,650 − 1,666.67
    const steady = month(11_683.33);
    expect(etaTax([steady, steady], steady, law)).toEqual({ months: 3, annualBase: 140_190, cumulativeTax: 4_447, earlierTax: 2_964.67, periodTax: 1_482.33 });
  });

  it('the fourth month on 16,700, and on 10,000', () => {
    const m = month(13_196.33);
    expect(etaTax([m, m, m], m, law)).toEqual({ months: 4, annualBase: 158_350, cumulativeTax: 7_140, earlierTax: 5_355, periodTax: 1_785 });
    const low = month(7_233.33);
    expect(etaTax([low, low, low], low, law)).toEqual({ months: 4, annualBase: 86_790, cumulativeTax: 2_369.33, earlierTax: 1_777, periodTax: 592.33 });
  });

  it('a commission one month is spread over the year so far, not taxed as if paid every month', () => {
    // 16,000 a month (base 12,573.33), then a month with a 28,000 commission (base 40,573.33) as the fourth: the export's
    // row with 346,110 and 7,857.98 had earlier commissions too, so only the shape is checked here
    const m = month(12_573.33);
    const bonus = etaTax([m, m, m], month(40_573.33), law);
    const alone = etaTax([], month(40_573.33), law);
    expect(bonus.months).toBe(4);
    expect(bonus.annualBase).toBe(Math.floor((Math.round(((12_573.33 * 3 + 40_573.33) / 4) * 100) / 100) * 12 / 10) * 10);
    expect(bonus.periodTax).toBeLessThan(alone.periodTax);
    expect(bonus.cumulativeTax).toBe(Math.round((bonus.earlierTax + bonus.periodTax) * 100) / 100);
  });

  it('the first month of the year has no earlier tax, and a base below zero is taxed as zero', () => {
    expect(etaTax([], month(11_683.33), law)).toMatchObject({ months: 1, annualBase: 140_190, earlierTax: 0, periodTax: 1_482.33 });
    expect(etaTax([], month(-500), law)).toMatchObject({ annualBase: 0, cumulativeTax: 0, periodTax: 0 });
  });
});
