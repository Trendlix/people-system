import { BUILT_IN_LAW_RATES, grossToNet, lawRatesFor, monthlyFromHourly, type LawRates } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { changeWords, raiseFigures, typedRaiseFigures, yearOf } from './figures';

// The figures of a raise shown while it is asked for or decided (owner, 17 October 2026: "while raising a request show
// some figures regarding the raise (Gross and net) but mainly we are working on the gross salary").

const RATES: readonly LawRates[] = BUILT_IN_LAW_RATES;
const transport = { amount: 500, taxable: true, insured: false };
const monthly = { payBasis: 'monthly', grossSalary: 10_000, hourlyRate: null, hoursPerWeek: null, allowances: [transport] };

describe('the figures of a raise', () => {
  it('a percent: the amount it comes to on the gross; an amount: the percent', () => {
    const percent = raiseFigures(monthly, { kind: 'percent', value: 10 }, RATES, 2026);
    expect(percent.gross).toEqual({ from: 10_000, to: 11_000, amount: 1000, percent: 10 });
    const amount = raiseFigures(monthly, { kind: 'amount', value: 1500 }, RATES, 2026);
    expect(amount.gross).toEqual({ from: 10_000, to: 11_500, amount: 1500, percent: 15 });
    // the allowances as they are
    expect(amount.allowances).toBe(500);
  });

  it('rounds to the piaster: 12,345.67 + 7.5% is 13,271.60, a change of 925.93', () => {
    const f = raiseFigures({ ...monthly, grossSalary: 12_345.67 }, { kind: 'percent', value: 7.5 }, RATES, 2026);
    expect(f.gross).toEqual({ from: 12_345.67, to: 13_271.6, amount: 925.93, percent: 7.5 });
    // an amount's percent to two decimals: 1,000 on 9,000 is 11.11%
    expect(raiseFigures({ ...monthly, grossSalary: 9000 }, { kind: 'amount', value: 1000 }, RATES, 2026).gross.percent).toBe(11.11);
  });

  it('the net, approximately: grossToNet with the year’s rates and the allowances, before and after alike', () => {
    const f = raiseFigures(monthly, { kind: 'amount', value: 1500 }, RATES, 2026);
    const law = lawRatesFor(2026, RATES);
    expect(f.net.from).toBe(grossToNet(10_000, law, [transport]).net);
    expect(f.net.to).toBe(grossToNet(11_500, law, [transport]).net);
    expect(f.net.amount).toBe(Math.round((f.net.to - f.net.from) * 100) / 100);
    expect(f.net.amount).toBeGreaterThan(0);
    expect(f.net.amount).toBeLessThan(1500);
    expect(f.year).toBe(2026);
    // other rates, another net: the ones kept for the year are used
    const kept: LawRates = { ...law, year: 2027, martyrsRate: 0 };
    const withKept = raiseFigures(monthly, { kind: 'amount', value: 1500 }, [...RATES, kept], 2027);
    expect(withKept.net.to).toBe(grossToNet(11_500, kept, [transport]).net);
  });

  it('allowances that change with the raise count after it only', () => {
    const housing = { amount: 1000, taxable: true, insured: true };
    const f = raiseFigures(monthly, { kind: 'amount', value: 1000 }, RATES, 2026, { allowancesAfter: [transport, housing] });
    expect(f.net.from).toBe(grossToNet(10_000, 2026, [transport]).net);
    expect(f.net.to).toBe(grossToNet(11_000, 2026, [transport, housing]).net);
    expect(f.allowances).toBe(1500);
  });

  it('by the hour: the rate raised, with the monthly estimate', () => {
    const hourly = { payBasis: 'hourly', grossSalary: monthlyFromHourly(150, 20), hourlyRate: 150, hoursPerWeek: 20, allowances: [] };
    const f = raiseFigures(hourly, { kind: 'percent', value: 10 }, RATES, 2026);
    expect(f.hourly).toEqual({ from: 150, to: 165, amount: 15, percent: 10 });
    expect(f.gross).toMatchObject({ from: 13_000, to: 14_300 });
    // an amount a month spread over the month's hours: +1,000 over 86.67 hours is 11.54 an hour more
    const amount = raiseFigures(hourly, { kind: 'amount', value: 1000 }, RATES, 2026);
    expect(amount.hourly).toMatchObject({ from: 150, to: 161.54 });
    expect(amount.gross.to).toBe(monthlyFromHourly(161.54, 20));
    // a monthly salary has no rate
    expect(raiseFigures(monthly, { kind: 'percent', value: 10 }, RATES, 2026).hourly).toBeNull();
  });

  it('as typed in a form: nothing until it is a valid raise, or without the pay', () => {
    expect(typedRaiseFigures(monthly, 'amount', '1,500', RATES, 2026)?.gross.to).toBe(11_500);
    expect(typedRaiseFigures(monthly, 'percent', '7.5%', RATES, 2026)?.gross.to).toBe(10_750);
    expect(typedRaiseFigures(monthly, 'percent', '', RATES, 2026)).toBeNull();
    expect(typedRaiseFigures(monthly, 'percent', '0', RATES, 2026)).toBeNull();
    expect(typedRaiseFigures(monthly, 'percent', '101', RATES, 2026)).toBeNull();
    expect(typedRaiseFigures(monthly, 'amount', '10.005', RATES, 2026)).toBeNull();
    expect(typedRaiseFigures(null, 'amount', '1500', RATES, 2026)).toBeNull();
  });

  it('the year: the effective date’s, else today’s; a change in words', () => {
    expect(yearOf('2027-01-01', '2026-10-17')).toBe(2027);
    expect(yearOf(null, '2026-10-17')).toBe(2026);
    expect(yearOf('', '2026-10-17')).toBe(2026);
    expect(changeWords({ from: 10_000, to: 11_500, amount: 1500, percent: 15 }, formatEgp)).toBe('+EGP 1,500.00 (+15%)');
    expect(changeWords({ from: 0, to: 500, amount: 500, percent: null }, formatEgp)).toBe('+EGP 500.00');
    expect(changeWords({ from: 10_000, to: 9000, amount: -1000, percent: -10 }, formatEgp)).toBe('−EGP 1,000.00 (−10%)');
  });
});
