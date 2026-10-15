import { annualSalaryTax, grossToNet, netToGross, TAX_TIER_LIMITS } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  bracketLabels,
  calculatorRows,
  calculatorSearch,
  calculatorYears,
  readCalculatorQuery,
  TAX_BRACKETS,
  TAX_TIERS,
  TOP_TIER,
} from './calculator';

describe('the salary calculator', () => {
  it('offers the years with insurable wage limits, and this year', () => {
    expect(calculatorYears(2026)).toEqual([2025, 2026]);
    expect(calculatorYears(2027)).toEqual([2025, 2026, 2027]);
  });

  it('reads the input from the address', () => {
    expect(readCalculatorQuery({}, 2026)).toEqual({ basis: 'gross', amount: '', year: 2026 });
    expect(readCalculatorQuery({ gross: '16700' }, 2026)).toEqual({ basis: 'gross', amount: '16700', year: 2026 });
    expect(readCalculatorQuery({ net: '13000', year: '2025' }, 2026)).toEqual({ basis: 'net', amount: '13000', year: 2025 });
    // the gross wins when both are given; a year not offered is this year
    expect(readCalculatorQuery({ gross: '20000', net: '13000', year: '2019' }, 2026)).toEqual({ basis: 'gross', amount: '20000', year: 2026 });
    expect(readCalculatorQuery({ net: ['9000', '8000'], year: 'x' }, 2026)).toEqual({ basis: 'net', amount: '9000', year: 2026 });
  });

  it('writes the input to the address, so a result can be shared', () => {
    expect(calculatorSearch({ basis: 'gross', amount: '16,700', year: 2026 })).toBe('?gross=16700&year=2026');
    expect(calculatorSearch({ basis: 'net', amount: '13000.5', year: 2025 })).toBe('?net=13000.5&year=2025');
    expect(calculatorSearch({ basis: 'gross', amount: '', year: 2026 })).toBe('?year=2026');
    expect(calculatorSearch({ basis: 'net', amount: '', year: 2026 })).toBe('?net=&year=2026');
    expect(calculatorSearch({ basis: 'gross', amount: 'abc', year: 2026 })).toBe('?gross=abc&year=2026');
    // and reads it back
    expect(readCalculatorQuery(Object.fromEntries(new URLSearchParams(calculatorSearch({ basis: 'net', amount: '13,000', year: 2025 }))), 2026)).toEqual({
      basis: 'net',
      amount: '13000',
      year: 2025,
    });
  });

  it('lays out the breakdown of the Ministry of Finance printout', () => {
    const { employee, company } = calculatorRows(grossToNet(16700, 2026), 2026);
    expect(employee.map((r) => [r.label, r.amount, r.kind])).toEqual([
      ['Gross salary', 16700, 'amount'],
      ['Insured wage', 16700, 'amount'],
      ['Employee social insurance', 1837, 'deduction'],
      ['Monthly taxable', 14863, 'subtotal'],
      ['Annual net income (a year)', 158350, 'amount'],
      ['Annual tax (a year)', 21420, 'amount'],
      ['Monthly tax', 1785, 'deduction'],
      ["Martyrs' Fund", 8.35, 'deduction'],
      ['Total deductions', 3630.35, 'subtotal'],
      ['Net salary', 13069.65, 'total'],
    ]);
    expect(company.map((r) => [r.label, r.amount, r.kind])).toEqual([
      ['Company social insurance', 3131.25, 'amount'],
      ['Company cost', 19831.25, 'total'],
    ]);
    expect(employee[1].how).toBe('The gross, at most the 2026 maximum insurable wage (16,700) and at least its minimum (2,700)');
    expect(employee[2].how).toBe('11% of the insured wage');
    expect(employee[4].how).toBe('Monthly taxable × 12, less the 20,000 personal exemption, rounded down to 10 pounds');
  });

  it('notes a capped insured wage, with the year’s limits', () => {
    const { employee } = calculatorRows(netToGross(20000, 2025), 2025);
    expect(employee[1].note).toBe('capped at 14,500');
    expect(employee[1].how).toContain('2025 maximum insurable wage (14,500)');
    expect(calculatorRows(grossToNet(25000, 2027), 2027).employee[1].how).toContain('2026 maximum');
  });

  it('lists the brackets', () => {
    expect(bracketLabels()).toEqual([
      'Up to 40,000: 0%',
      '40,000 to 55,000: 10%',
      '55,000 to 70,000: 15%',
      '70,000 to 200,000: 20%',
      '200,000 to 400,000: 22.5%',
      'Above 400,000: 25%',
    ]);
  });

  it('describes the tax exactly as it is worked out', () => {
    const bands = (income: number, brackets: readonly { upTo: number; rate: number }[]) => {
      let tax = 0;
      let from = 0;
      for (const { upTo, rate } of brackets) {
        tax += Math.max(0, Math.min(income, upTo) - from) * rate;
        from = upTo;
      }
      return Math.round(tax * 100) / 100;
    };
    const asListed = (income: number) => {
      if (income > TOP_TIER.over) return bands(income, [{ upTo: TOP_TIER.over, rate: TOP_TIER.below }, { upTo: Infinity, rate: TOP_TIER.rate }]);
      const tier = TAX_TIERS.findLast((t) => income > t.over);
      if (!tier) return bands(income, TAX_BRACKETS);
      return bands(income, [{ upTo: tier.firstUpTo, rate: tier.rate }, ...TAX_BRACKETS.filter((b) => b.upTo > tier.firstUpTo)]);
    };
    expect([...TAX_TIERS.map((t) => t.over), TOP_TIER.over]).toEqual(TAX_TIER_LIMITS);
    for (let income = 0; income <= 1_500_000; income += 2_510) expect(asListed(income)).toBe(annualSalaryTax(income));
    for (const limit of TAX_TIER_LIMITS) for (const income of [limit - 10, limit, limit + 10]) expect(asListed(income)).toBe(annualSalaryTax(income));
  });
});
