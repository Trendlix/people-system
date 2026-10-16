import {
  annualSalaryTax,
  BUILT_IN_LAW_RATES,
  grossToNet,
  hourlyRateFromNet,
  LAW_7_2024_TAX_TIERS,
  lawRatesFor,
  netToGross,
  TAX_TIER_LIMITS,
  taxTierLimits,
  type LawRates,
  type TaxTier,
} from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { AllowanceType } from '../../../../lib/types';
import { tierLabels } from '../../organization/payroll/law-rates';
import { allowancesEffect, calculatorRows, calculatorSearch, calculatorYears, namedAllowances, readCalculatorQuery, type CalculatorInput } from './calculator';

/** An input with the defaults: a monthly gross, nothing typed, 2026, no allowances. */
const input = (o: Partial<CalculatorInput> = {}): CalculatorInput => ({
  pay: 'monthly',
  basis: 'gross',
  amount: '',
  rateBasis: 'gross',
  rate: '',
  netRate: '',
  hours: '',
  year: 2026,
  allowances: [],
  ...o,
});

const kind = (id: string, nameEn: string, taxable: boolean, insured: boolean): AllowanceType => ({
  id,
  nameEn,
  nameAr: nameEn,
  taxable,
  insured,
  active: true,
  sortOrder: 0,
  inUse: false,
});
/** Rates set by law the Super Admin might keep for 2027 (invented): every value changed, and one simpler tax table. */
const TABLE_2027: TaxTier[] = [
  {
    upTo: 500_000,
    bands: [
      { upTo: 30_000, rate: 0 },
      { upTo: 100_000, rate: 0.125 },
      { upTo: null, rate: 0.2 },
    ],
  },
  { upTo: null, bands: [{ upTo: null, rate: 0.3 }] },
];
const RATES_2027: LawRates = {
  year: 2027,
  employeeInsuranceRate: 0.12,
  employerInsuranceRate: 0.19,
  insurableWageMin: 3000,
  insurableWageMax: 18000,
  personalExemption: 25000,
  martyrsRate: 0.001,
  healthInsuranceRate: 0.01,
  taxTiers: TABLE_2027,
};
const KEPT = [...BUILT_IN_LAW_RATES, RATES_2027];

const TRANSPORT = kind('t1', 'Transport', true, false);
const MOBILE = kind('m1', 'Mobile', false, false);
const HOUSING = kind('h1', 'Housing', true, true);

describe('the salary calculator', () => {
  it('offers the years with rates set by law of their own, and this year', () => {
    expect(calculatorYears(2026)).toEqual([2025, 2026]);
    expect(calculatorYears(2027)).toEqual([2025, 2026, 2027]);
    // the years the Super Admin keeps
    expect(calculatorYears(2026, KEPT)).toEqual([2025, 2026, 2027]);
    expect(calculatorYears(2028, KEPT.slice(1))).toEqual([2026, 2027, 2028]);
    expect(readCalculatorQuery({ year: '2027' }, 2026, KEPT).year).toBe(2027);
    expect(readCalculatorQuery({ year: '2027' }, 2026).year).toBe(2026);
  });

  it('reads the input from the address', () => {
    expect(readCalculatorQuery({}, 2026)).toEqual(input());
    expect(readCalculatorQuery({ gross: '16700' }, 2026)).toEqual(input({ amount: '16700' }));
    expect(readCalculatorQuery({ net: '13000', year: '2025' }, 2026)).toEqual(input({ basis: 'net', amount: '13000', year: 2025 }));
    // the gross wins when both are given; a year not offered is this year
    expect(readCalculatorQuery({ gross: '20000', net: '13000', year: '2019' }, 2026)).toEqual(input({ amount: '20000' }));
    expect(readCalculatorQuery({ net: ['9000', '8000'], year: 'x' }, 2026)).toEqual(input({ basis: 'net', amount: '9000' }));
  });

  it('reads pay by the hour and the allowances from the address', () => {
    expect(readCalculatorQuery({ rate: '150', hours: '20', gross: '9000' }, 2026)).toEqual(input({ pay: 'hourly', rate: '150', hours: '20' }));
    expect(readCalculatorQuery({ hours: '' }, 2026)).toEqual(input({ pay: 'hourly' }));
    expect(readCalculatorQuery({ gross: '15000', allowance: ['t1:1000', 'm1:500'] }, 2026).allowances).toEqual([
      { allowanceTypeId: 't1', amount: '1000' },
      { allowanceTypeId: 'm1', amount: '500' },
    ]);
    expect(readCalculatorQuery({ allowance: 'h1' }, 2026).allowances).toEqual([{ allowanceTypeId: 'h1', amount: '' }]);
    expect(readCalculatorQuery({ allowance: Array.from({ length: 30 }, (_, i) => `k${i}:1`) }, 2026).allowances).toHaveLength(20);
  });

  it('reads a net per hour from the address, the gross rate winning when both are given', () => {
    expect(readCalculatorQuery({ netRate: '120', hours: '16' }, 2026)).toEqual(input({ pay: 'hourly', rateBasis: 'net', netRate: '120', hours: '16' }));
    expect(readCalculatorQuery({ netRate: '' }, 2026)).toEqual(input({ pay: 'hourly', rateBasis: 'net' }));
    expect(readCalculatorQuery({ rate: '150', netRate: '120', hours: '20' }, 2026)).toEqual(input({ pay: 'hourly', rate: '150', hours: '20' }));
    // a monthly amount is ignored by the hour, as with the gross rate
    expect(readCalculatorQuery({ netRate: '120', hours: '16', net: '9000' }, 2026)).toEqual(input({ pay: 'hourly', rateBasis: 'net', netRate: '120', hours: '16' }));
  });

  it('writes a net per hour to the address, and reads it back', () => {
    const fromNet = input({ pay: 'hourly', rateBasis: 'net', netRate: '١٢٠', rate: '150', hours: '16' });
    expect(calculatorSearch(fromNet)).toBe('?netRate=120&hours=16&year=2026');
    expect(calculatorSearch(input({ pay: 'hourly', rateBasis: 'net' }))).toBe('?netRate=&hours=&year=2026');
    expect(readCalculatorQuery(Object.fromEntries(new URLSearchParams(calculatorSearch(fromNet))), 2026)).toEqual(
      input({ pay: 'hourly', rateBasis: 'net', netRate: '120', hours: '16' }),
    );
  });

  it('writes the input to the address, so a result can be shared', () => {
    expect(calculatorSearch(input({ amount: '16,700' }))).toBe('?gross=16700&year=2026');
    expect(calculatorSearch(input({ basis: 'net', amount: '13000.5', year: 2025 }))).toBe('?net=13000.5&year=2025');
    expect(calculatorSearch(input())).toBe('?year=2026');
    expect(calculatorSearch(input({ basis: 'net' }))).toBe('?net=&year=2026');
    expect(calculatorSearch(input({ amount: 'abc' }))).toBe('?gross=abc&year=2026');
    // and reads it back
    expect(readCalculatorQuery(Object.fromEntries(new URLSearchParams(calculatorSearch(input({ basis: 'net', amount: '13,000', year: 2025 })))), 2026)).toEqual(
      input({ basis: 'net', amount: '13000', year: 2025 }),
    );
  });

  it('writes pay by the hour and the allowances to the address', () => {
    expect(calculatorSearch(input({ pay: 'hourly', rate: '١٥٠', hours: '22.5', amount: '9000' }))).toBe('?rate=150&hours=22.5&year=2026');
    // kept empty, so the page still opens by the hour
    expect(calculatorSearch(input({ pay: 'hourly' }))).toBe('?rate=&hours=&year=2026');
    const withAllowances = input({
      amount: '15000',
      allowances: [
        { allowanceTypeId: 't1', amount: '1,000' },
        { allowanceTypeId: '', amount: '' },
        { allowanceTypeId: 'm1', amount: '' },
      ],
    });
    expect(calculatorSearch(withAllowances)).toBe('?gross=15000&year=2026&allowance=t1%3A1000&allowance=m1%3A');
    const back = new URLSearchParams(calculatorSearch(withAllowances));
    expect(readCalculatorQuery({ gross: back.get('gross')!, allowance: back.getAll('allowance') }, 2026).allowances).toEqual([
      { allowanceTypeId: 't1', amount: '1000' },
      { allowanceTypeId: 'm1', amount: '' },
    ]);
  });

  it('names the allowances ready to work out, with their treatment', () => {
    const rows = [
      { allowanceTypeId: 't1', amount: '1,000' },
      { allowanceTypeId: 'm1', amount: 'abc' },
      { allowanceTypeId: 'gone', amount: '300' },
      { allowanceTypeId: 'h1', amount: '0' },
    ];
    expect(namedAllowances(rows, [TRANSPORT, MOBILE, HOUSING])).toEqual([{ name: 'Transport', amount: 1000, taxable: true, insured: false }]);
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
    expect(employee[1].how).toBe('The gross, at most the 2026 maximum insurable wage (16,700.00) and at least its minimum (2,700.00)');
    expect(employee[2].how).toBe('11% of the insured wage');
    expect(employee[4].how).toBe('Monthly taxable × 12, less the 20,000.00 personal exemption, rounded down to 10 pounds');
  });

  it('lists the allowances under the gross, and says how they change the rest', () => {
    const allowances = namedAllowances(
      [
        { allowanceTypeId: 't1', amount: '1000' },
        { allowanceTypeId: 'm1', amount: '500' },
        { allowanceTypeId: 'h1', amount: '2000' },
      ],
      [TRANSPORT, MOBILE, HOUSING],
    );
    const b = grossToNet(12000, 2026, allowances);
    const { employee, company } = calculatorRows(b, 2026, allowances);
    expect(employee.slice(0, 5).map((r) => [r.label, r.amount, r.kind])).toEqual([
      ['Gross salary', 12000, 'amount'],
      ['Transport', 1000, 'amount'],
      ['Mobile', 500, 'amount'],
      ['Housing', 2000, 'amount'],
      ['Allowances in total', 3500, 'subtotal'],
    ]);
    expect(employee[1].how).toBe('Allowance, a month on top of the gross: taxed, not insured');
    expect(employee[4].how).toBe('On top of the gross: 3,000.00 taxed, 2,000.00 insured');
    // the housing allowance is insured with the gross
    expect(employee[5]).toMatchObject({ label: 'Insured wage', amount: 14000, note: 'the gross and the insured allowances' });
    expect(employee[5].how).toMatch(/^The gross and the insured allowances, at most/);
    expect(employee.find((r) => r.label === 'Monthly taxable')).toMatchObject({ amount: 15000 - 1540, how: 'The gross and the taxed allowances less social insurance' });
    expect(employee.find((r) => r.label === "Martyrs' Fund")?.how).toBe('0.05% of the gross and the taxed allowances');
    expect(employee.at(-1)).toMatchObject({ label: 'Net salary', how: 'The gross and the allowances, less the deductions' });
    expect(company.at(-1)).toMatchObject({ label: 'Company cost', amount: 15500 + 2625 });
    // one allowance: no total row
    expect(calculatorRows(grossToNet(12000, 2026, allowances.slice(0, 1)), 2026, allowances.slice(0, 1)).employee.map((r) => r.label)).not.toContain(
      'Allowances in total',
    );
  });

  it('explains a gross estimated from an hourly rate, and the net per hour it gives', () => {
    const { employee } = calculatorRows(grossToNet(13000, 2026), 2026, [], { rate: 150, hours: 20 });
    expect(employee[0].how).toBe('The monthly estimate: EGP 150.00 an hour × 20 hours a week × 52 ÷ 12 = EGP 13,000.00 a month');
    expect(employee.at(-1)?.how).toBe('The gross less the deductions, ≈ EGP 120.43 net per hour');
    // a monthly salary has no rate
    expect(calculatorRows(grossToNet(13000, 2026), 2026).employee.at(-1)?.how).toBe('The gross less the deductions');
  });

  it('explains a gross rate worked out from the net per hour', () => {
    const { hourlyRate, breakdown } = hourlyRateFromNet(120, 16, 2026);
    const { employee } = calculatorRows(breakdown, 2026, [], { rate: hourlyRate, hours: 16, netRate: 120 });
    expect(employee[0].how).toBe(
      'The monthly estimate: EGP 144.59 an hour × 16 hours a week × 52 ÷ 12 = EGP 10,024.91 a month, the gross rate worked out from EGP 120.00 net per hour',
    );
    expect(employee.at(-1)).toMatchObject({ amount: 8320.33, how: 'The gross less the deductions, ≈ EGP 120.00 net per hour' });
  });

  it('says what the allowances add to the net', () => {
    const b = grossToNet(12000, 2026, [{ amount: 1000, taxable: false, insured: false }]);
    // an untaxed, uninsured allowance goes to the net whole
    expect(allowancesEffect(b, 2026)).toBe(1000);
    expect(allowancesEffect(grossToNet(12000, 2026), 2026)).toBe(0);
    expect(allowancesEffect(grossToNet(12000, 2026, [{ amount: 1000, taxable: true, insured: false }]), 2026)).toBeLessThan(1000);
  });

  it('notes a capped insured wage, with the year’s limits', () => {
    const { employee } = calculatorRows(netToGross(20000, 2025), 2025);
    expect(employee[1].note).toBe('capped at 14,500.00');
    expect(employee[1].how).toContain('2025 maximum insurable wage (14,500.00)');
    expect(calculatorRows(grossToNet(25000, 2027), 2027).employee[1].how).toContain('2026 maximum');
  });

  it('works the rows out with the year’s rates set by law, and says so', () => {
    const rates = lawRatesFor(2027, KEPT);
    const b = grossToNet(20000, rates);
    const { employee, company } = calculatorRows(b, rates);
    expect(b).not.toEqual(grossToNet(20000, 2026));
    expect(employee.find((r) => r.label === 'Insured wage')).toMatchObject({
      amount: 18000,
      note: 'capped at 18,000.00',
      how: 'The gross, at most the 2027 maximum insurable wage (18,000.00) and at least its minimum (3,000.00)',
    });
    expect(employee.find((r) => r.label === 'Employee social insurance')).toMatchObject({ amount: 2160, how: '12% of the insured wage' });
    // health insurance applies once its rate is above 0
    expect(employee.find((r) => r.label === 'Health insurance')).toMatchObject({ amount: 200, how: '1% of the gross' });
    expect(employee.find((r) => r.label === 'Monthly taxable')?.how).toBe('The gross less social insurance and health insurance');
    expect(employee.find((r) => r.label === 'Annual net income (a year)')?.how).toBe(
      'Monthly taxable × 12, less the 25,000.00 personal exemption, rounded down to 10 pounds',
    );
    expect(employee.find((r) => r.label === 'Annual tax (a year)')).toMatchObject({ amount: annualSalaryTax(b.annualNetIncome, TABLE_2027), how: 'The 2027 salary tax tiers on the annual net income' });
    expect(employee.find((r) => r.label === "Martyrs' Fund")).toMatchObject({ amount: 20, how: '0.1% of the gross' });
    expect(employee.find((r) => r.label === 'Total deductions')?.how).toBe("Social insurance, health insurance, tax and the Martyrs' Fund");
    expect(company[0]).toMatchObject({ amount: 3420, how: '19% of the insured wage' });
    // a later year without its own uses 2027's
    expect(calculatorRows(grossToNet(20000, lawRatesFor(2029, KEPT)), lawRatesFor(2029, KEPT)).employee[1].how).toContain('2027 maximum');
    expect(allowancesEffect(grossToNet(20000, rates, [{ amount: 1000, taxable: false, insured: false }]), rates)).toBe(1000);
  });

  it('lists the tiers and bands exactly as the tax is worked out', () => {
    const amount = (text: string) => Number(text.replace(/,/g, ''));
    /** A listed range back as numbers: [from, up to], Infinity for no limit. */
    const range = (text: string): [number, number] => {
      if (text === 'Any amount') return [0, Infinity];
      const upTo = /^Up to ([\d,.]+)$/.exec(text);
      if (upTo) return [0, amount(upTo[1])];
      const above = /^Above ([\d,.]+)$/.exec(text);
      if (above) return [amount(above[1]), Infinity];
      const between = /^([\d,.]+) to ([\d,.]+)$/.exec(text);
      if (between) return [amount(between[1]), amount(between[2])];
      throw new Error(`Not a range: ${text}`);
    };
    /** The tax as the list says it: the tier whose range the whole income is in, its bands each taxed from 0. */
    const asListed = (income: number, tiers: readonly TaxTier[]) => {
      const tier = tierLabels(tiers).find((t) => income <= range(t.range)[1])!;
      let tax = 0;
      for (const band of tier.bands) {
        const [text, rate] = band.split(': ');
        const [from, upTo] = range(text);
        tax += Math.max(0, Math.min(income, upTo) - from) * (Number(rate.replace('%', '')) / 100);
      }
      return Math.round((tax + Number.EPSILON) * 100) / 100;
    };
    // Law 7/2024's table, and one the Super Admin might set instead
    expect(taxTierLimits(LAW_7_2024_TAX_TIERS)).toEqual(TAX_TIER_LIMITS);
    for (const tiers of [LAW_7_2024_TAX_TIERS, TABLE_2027]) {
      for (let income = 0; income <= 1_500_000; income += 2_510) expect(asListed(income, tiers)).toBe(annualSalaryTax(income, tiers));
      for (const limit of taxTierLimits(tiers)) for (const income of [limit - 10, limit, limit + 10]) expect(asListed(income, tiers)).toBe(annualSalaryTax(income, tiers));
    }
    expect(tierLabels(TABLE_2027)).toEqual([
      { range: 'Up to 500,000.00', bands: ['Up to 30,000.00: 0%', '30,000.00 to 100,000.00: 12.5%', 'Above 100,000.00: 20%'] },
      { range: 'Above 500,000.00', bands: ['Any amount: 30%'] },
    ]);
  });
});
