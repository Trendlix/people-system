import { grossToNet, monthlyFromHourly, netToGross } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  estimateText,
  insuredAllowancesOf,
  offerBreakdownRows,
  offerSalary,
  parseHours,
  payBasisFrom,
  switchStart,
  totalPay,
  type TermsTyped,
} from './terms';

const typed = (t: Partial<TermsTyped>): TermsTyped => ({
  payBasis: 'monthly',
  salaryBasis: 'gross',
  grossSalary: '',
  wantedNet: '',
  hourlyRate: '',
  hoursPerWeek: '',
  ...t,
});

const transport = { amount: 1000, taxable: false, insured: false };
const housing = { amount: 2000, taxable: true, insured: true };

describe('the pay basis', () => {
  it('is monthly unless by the hour', () => {
    expect(payBasisFrom('hourly')).toBe('hourly');
    expect(payBasisFrom('monthly')).toBe('monthly');
    expect(payBasisFrom(undefined)).toBe('monthly');
    expect(payBasisFrom('weekly')).toBe('monthly');
  });
});

describe('hours a week as typed', () => {
  it('reads whole numbers, one decimal and Arabic digits', () => {
    expect(parseHours('20')).toBe(20);
    expect(parseHours(' 22.5 ')).toBe(22.5);
    expect(parseHours('٢٤')).toBe(24);
    expect(parseHours('')).toBeNull();
    expect(parseHours('22.25')).toBeNaN();
    expect(parseHours('twenty')).toBeNaN();
  });
});

describe("a monthly salary's breakdown", () => {
  it('works the net out from the gross, with the allowances in it', () => {
    const r = offerSalary(typed({ grossSalary: '15,000' }), 2026, [transport]);
    expect(r).toEqual({ kind: 'ok', breakdown: grossToNet(15000, 2026, [transport]), estimate: null });
    if (r.kind === 'ok') expect(r.breakdown.net).toBeGreaterThan(grossToNet(15000, 2026).net);
  });

  it('works the gross out from the net wanted, in whole pounds', () => {
    const r = offerSalary(typed({ salaryBasis: 'net', wantedNet: '13000' }), 2026, [housing]);
    expect(r).toEqual({ kind: 'ok', breakdown: netToGross(13000, 2026, 1, [housing]), estimate: null });
    if (r.kind === 'ok') expect(Number.isInteger(r.breakdown.gross)).toBe(true);
  });

  it('says what to type when empty, and what is wrong when not an amount', () => {
    expect(offerSalary(typed({}), 2026)).toMatchObject({ kind: 'empty' });
    expect(offerSalary(typed({ grossSalary: 'abc' }), 2026)).toMatchObject({ kind: 'invalid', field: 'grossSalary' });
    expect(offerSalary(typed({ grossSalary: '0' }), 2026)).toMatchObject({ kind: 'invalid', field: 'grossSalary' });
    expect(offerSalary(typed({ salaryBasis: 'net', wantedNet: '-5' }), 2026)).toMatchObject({ kind: 'invalid', field: 'wantedNet' });
  });
});

describe('pay by the hour', () => {
  it('takes the monthly estimate as the gross', () => {
    const r = offerSalary(typed({ payBasis: 'hourly', hourlyRate: '150', hoursPerWeek: '20' }), 2026);
    const estimate = monthlyFromHourly(150, 20);
    expect(r).toEqual({ kind: 'ok', breakdown: grossToNet(estimate, 2026), estimate });
    expect(estimate).toBe(13000);
  });

  it('ignores the monthly fields', () => {
    const r = offerSalary(typed({ payBasis: 'hourly', grossSalary: '99999', hourlyRate: '100', hoursPerWeek: '12' }), 2026);
    expect(r.kind === 'ok' && r.breakdown.gross).toBe(monthlyFromHourly(100, 12));
  });

  it('waits for both the rate and the hours, and flags a wrong one', () => {
    expect(offerSalary(typed({ payBasis: 'hourly', hourlyRate: '150' }), 2026)).toMatchObject({ kind: 'empty' });
    expect(offerSalary(typed({ payBasis: 'hourly', hourlyRate: 'x', hoursPerWeek: '20' }), 2026)).toMatchObject({ kind: 'invalid', field: 'hourlyRate' });
    expect(offerSalary(typed({ payBasis: 'hourly', hourlyRate: '150', hoursPerWeek: '0' }), 2026)).toMatchObject({ kind: 'invalid', field: 'hoursPerWeek' });
    // the legal working week: 8 hours a day, 6 days
    expect(offerSalary(typed({ payBasis: 'hourly', hourlyRate: '150', hoursPerWeek: '48' }), 2026)).toMatchObject({ kind: 'ok' });
    expect(offerSalary(typed({ payBasis: 'hourly', hourlyRate: '150', hoursPerWeek: '48.5' }), 2026)).toMatchObject({ kind: 'invalid', field: 'hoursPerWeek' });
  });

  it('explains the estimate', () => {
    expect(estimateText(150, 20, 13000)).toBe('EGP 150 × 20 hours a week × 52 ÷ 12 = EGP 13,000 a month, the monthly estimate.');
  });
});

describe('switching between typing the gross and the net', () => {
  it('fills the other field so the salary stays the same', () => {
    const toNet = switchStart('net', typed({ grossSalary: '15000' }), 2026, [transport]);
    expect(toNet.salaryBasis).toBe('net');
    expect(Number(toNet.wantedNet)).toBe(grossToNet(15000, 2026, [transport]).net);
    const back = switchStart('gross', toNet, 2026, [transport]);
    expect(Number(back.grossSalary)).toBe(15000);
  });

  it('only switches when there is nothing to work from', () => {
    expect(switchStart('net', typed({}), 2026)).toEqual(typed({ salaryBasis: 'net' }));
  });
});

describe('the breakdown rows', () => {
  it('lists the allowances and the net, and says when the insured wage is capped', () => {
    const b = grossToNet(20000, 2026, [housing]);
    const rows = offerBreakdownRows(b, { insuredAllowances: insuredAllowancesOf([housing, transport]) });
    expect(rows.map((r) => r.label)).toEqual([
      'Gross salary',
      'Allowances',
      'Insured wage',
      'Employee social insurance (11%)',
      'Income tax',
      "Martyrs' Fund (0.05%)",
      'Net salary',
      'Company cost',
    ]);
    expect(rows.find((r) => r.label === 'Allowances')?.note).toBe('2,000 of it taxed');
    expect(rows.find((r) => r.label === 'Insured wage')?.note).toBe('capped at 16,700');
    expect(rows.find((r) => r.kind === 'total')?.amount).toBe(b.net);
  });

  it('leaves the allowances out without any, and marks the monthly estimate', () => {
    const rows = offerBreakdownRows(grossToNet(8000, 2026), { hourly: true });
    expect(rows.some((r) => r.label === 'Allowances')).toBe(false);
    expect(rows[0].note).toBe('the monthly estimate');
    expect(rows.find((r) => r.label === 'Insured wage')?.note).toBeUndefined();
  });

  it('does not take insured allowances for a raised minimum', () => {
    const b = grossToNet(2000, 2026, [{ amount: 500, taxable: false, insured: true }]);
    const rows = offerBreakdownRows(b, { insuredAllowances: 500 });
    expect(rows.find((r) => r.label === 'Insured wage')?.note).toBe('raised to the minimum, 2,700');
  });
});

describe('the total pay', () => {
  it('is the gross and the allowances', () => {
    expect(totalPay(15000, 1500.5)).toBe(16500.5);
    expect(totalPay(15000, null)).toBe(15000);
    expect(insuredAllowancesOf([housing, transport])).toBe(2000);
  });
});
