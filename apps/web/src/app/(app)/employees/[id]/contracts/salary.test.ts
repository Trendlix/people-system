import { BUILT_IN_LAW_RATES, grossToNet, hourlyRateFromNet, lawRatesFor, monthlyFromHourly, netToGross, type LawRates } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  allowancesLabel,
  allowancesNote,
  allowanceTotals,
  basisFrom,
  belowAllowancesText,
  breakdownRows,
  daysLabel,
  formatEgp,
  formatPercent,
  hourlyFor,
  hourlyLabel,
  hourlyMinimumText,
  hourlyNetTerms,
  hourlyPayFor,
  hourlyTerms,
  hoursLabel,
  insurableLimits,
  insuredFor,
  insuredWageNote,
  monthlyEstimateText,
  netPerHour,
  netPerHourText,
  parseAmount,
  parseHours,
  payLabel,
  plainAmount,
  ratesYearText,
  salaryFor,
  savedNetChange,
  splitSalary,
  switchBasis,
  switchRateBasis,
  typedHourlyMinimum,
  workedOutGross,
  workedOutRate,
} from './salary';

const TAXED = { amount: 1000, taxable: true, insured: false };
const UNTAXED = { amount: 500, taxable: false, insured: false };
const INSURED = { amount: 2000, taxable: true, insured: true };

describe('a contract’s money', () => {
  it('reads amounts as typed, with commas, spaces or Arabic digits', () => {
    expect(parseAmount('15000')).toBe(15000);
    expect(parseAmount('15,000')).toBe(15000);
    expect(parseAmount(' 15 000.50 ')).toBe(15000.5);
    expect(parseAmount('١٥٠٠٠')).toBe(15000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('fifteen')).toBeNaN();
    expect(parseAmount('-200')).toBeNaN();
    expect(parseAmount('10.555')).toBeNaN();
  });

  // always two decimals (owner, 16 October 2026: "make all the wages with 2 decimal places")
  it('shows amounts in EGP, with two decimals', () => {
    expect(formatEgp(16700)).toBe('EGP 16,700.00');
    expect(formatEgp(0)).toBe('EGP 0.00');
    expect(formatEgp(1234.5)).toBe('EGP 1,234.50');
    expect(formatEgp(1234.567)).toBe('EGP 1,234.57');
    expect(formatEgp(1234.999)).toBe('EGP 1,235.00');
  });

  it('splits the gross into basic and variable', () => {
    expect(splitSalary(20000, 80)).toEqual({ basic: 16000, variable: 4000 });
    expect(splitSalary(12345, 80)).toEqual({ basic: 9876, variable: 2469 });
    expect(splitSalary(10001, 75)).toEqual({ basic: 7500.75, variable: 2500.25 });
  });

  it('insures the actual gross, capped at the year’s maximum and never below its minimum', () => {
    expect(insuredFor(25000, 2026)).toEqual({ amount: 16700, why: 'the 2026 maximum' });
    expect(insuredFor(12000, 2026)).toEqual({ amount: 12000, why: 'the actual gross' });
    expect(insuredFor(2000, 2026)).toEqual({ amount: 2700, why: 'the 2026 minimum' });
    expect(insuredFor(15000, 2025)).toEqual({ amount: 14500, why: 'the 2025 maximum' });
    // a year not in the table uses the latest one known
    expect(insuredFor(25000, 2027)).toEqual({ amount: 16700, why: 'the 2026 maximum' });
  });
});

describe('gross and net', () => {
  it('reads the Gross / Net switch, gross by default', () => {
    expect(basisFrom('net')).toBe('net');
    expect(basisFrom('gross')).toBe('gross');
    expect(basisFrom('')).toBe('gross');
    expect(basisFrom(undefined)).toBe('gross');
    expect(basisFrom(['net'])).toBe('gross');
  });

  it('works out the net from a gross as the Ministry of Finance printout does', () => {
    const r = salaryFor('gross', '16,700', 2026);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.typed).toBe(16700);
    expect(r.breakdown).toMatchObject({ employeeInsurance: 1837, monthlyTax: 1785, martyrsFund: 8.35, net: 13069.65 });
  });

  it('works out the lowest whole-pound gross for a net', () => {
    const r = salaryFor('net', '13000', 2026);
    expect(r.kind === 'ok' && r.breakdown).toMatchObject({ gross: 16603, net: 13000.54 });
    const exact = salaryFor('net', '13069.65', 2026);
    expect(exact.kind === 'ok' && exact.breakdown.gross).toBe(16700);
  });

  it('tells an empty amount from one that is not an amount', () => {
    expect(salaryFor('gross', '', 2026)).toEqual({ kind: 'empty' });
    expect(salaryFor('net', '  ', 2026)).toEqual({ kind: 'empty' });
    expect(salaryFor('gross', 'abc', 2026)).toEqual({ kind: 'invalid' });
    expect(salaryFor('gross', '0', 2026)).toEqual({ kind: 'invalid' });
  });

  it('writes amounts plainly for the form and the address', () => {
    expect(plainAmount(13069.65)).toBe('13069.65');
    expect(plainAmount(16700)).toBe('16700');
    expect(plainAmount(0.1 + 0.2)).toBe('0.3');
  });

  it('carries the salary over when switching what HR starts from', () => {
    expect(switchBasis('net', { gross: '16700', net: '' }, 2026)).toEqual({ gross: '16700', net: '13069.65' });
    expect(switchBasis('gross', { gross: '16700', net: '13069.65' }, 2026)).toEqual({ gross: '16700', net: '13069.65' });
    expect(switchBasis('gross', { gross: '', net: '13000' }, 2026)).toEqual({ gross: '16603', net: '13000' });
    // nothing to work from: left as it was
    expect(switchBasis('net', { gross: 'abc', net: '9000' }, 2026)).toEqual({ gross: 'abc', net: '9000' });
  });

  it('shows rates as percents', () => {
    expect(formatPercent(0.11)).toBe('11%');
    expect(formatPercent(0.0005)).toBe('0.05%');
    expect(formatPercent(0.1875)).toBe('18.75%');
    expect(formatPercent(0.225)).toBe('22.5%');
  });

  it('says when the insured wage is capped or raised', () => {
    expect(insuredWageNote({ gross: 25000, insuredWage: 16700 })).toBe('capped at 16,700.00');
    expect(insuredWageNote({ gross: 2000, insuredWage: 2700 })).toBe('raised to the minimum, 2,700.00');
    expect(insuredWageNote({ gross: 12000, insuredWage: 12000 })).toBeUndefined();
  });

  it('gives the insurable limits of a year, a later one using the latest known', () => {
    expect(insurableLimits(2025)).toEqual({ year: 2025, min: 2300, max: 14500 });
    expect(insurableLimits(2027)).toEqual({ year: 2026, min: 2700, max: 16700 });
  });

  it('explains the gross worked out for a net', () => {
    expect(workedOutGross(13000, grossToNet(16603, 2026))).toBe('EGP 16,603.00 gross: the lowest whole-pound gross whose net reaches EGP 13,000.00.');
  });

  it('lists the contract form breakdown, monthly', () => {
    const rows = breakdownRows(grossToNet(25000, 2026), 2026);
    expect(rows.map((r) => [r.label, r.amount, r.kind])).toEqual([
      ['Gross salary', 25000, 'amount'],
      ['Insured wage', 16700, 'amount'],
      ['Employee social insurance (11%)', 1837, 'deduction'],
      ['Income tax', expect.any(Number), 'deduction'],
      ["Martyrs' Fund (0.05%)", 12.5, 'deduction'],
      ['Net salary', expect.any(Number), 'total'],
      ['Company cost', 28131.25, 'company'],
    ]);
    expect(rows[1].note).toBe('capped at 16,700.00');
    expect(rows[6].note).toBe("gross plus the company's 18.75% insurance, 3,131.25");
    // what is deducted adds up to the net
    const b = grossToNet(25000, 2026);
    expect(rows[5].amount).toBeCloseTo(b.gross - rows.filter((r) => r.kind === 'deduction').reduce((t, r) => t + r.amount, 0), 2);
    expect(breakdownRows(grossToNet(12000, 2026), 2026)[1].note).toBeUndefined();
  });

  it('shows a saved, hand-typed net only while the gross is the saved one and the nets differ', () => {
    const b = grossToNet(16700, 2026);
    expect(savedNetChange({ gross: 16700, net: 13000 }, b)).toEqual({ saved: 13000, calculated: 13069.65 });
    expect(savedNetChange({ gross: 16700, net: 13069.65 }, b)).toBeNull();
    expect(savedNetChange({ gross: 16700, net: null }, b)).toBeNull();
    expect(savedNetChange({ gross: 15000, net: 12000 }, b)).toBeNull();
    expect(savedNetChange({ gross: 16700, net: 13000 }, null)).toBeNull();
  });
});

describe('allowances on top of the gross', () => {
  it('adds them up: all, the taxed and the insured', () => {
    expect(allowanceTotals([TAXED, UNTAXED, INSURED])).toEqual({ total: 3500, taxable: 3000, insured: 2000 });
    expect(allowanceTotals([])).toEqual({ total: 0, taxable: 0, insured: 0 });
  });

  it('insures the gross with the insured allowances, within the year’s limits', () => {
    expect(insuredFor(12000, 2026, [INSURED, TAXED])).toEqual({ amount: 14000, why: 'the gross and the insured allowances' });
    expect(insuredFor(16000, 2026, [INSURED])).toEqual({ amount: 16700, why: 'the 2026 maximum' });
    // an allowance that isn't insured leaves the insured wage alone
    expect(insuredFor(12000, 2026, [TAXED, UNTAXED])).toEqual({ amount: 12000, why: 'the actual gross' });
  });

  it('works the net out with them, and the gross for a net that includes them', () => {
    const r = salaryFor('gross', '12000', 2026, [UNTAXED]);
    expect(r.kind === 'ok' && r.breakdown.net).toBeCloseTo((salaryFor('gross', '12000', 2026) as { breakdown: { net: number } }).breakdown.net + 500, 2);
    const net = salaryFor('net', '13000', 2026, [UNTAXED]);
    expect(net.kind === 'ok' && net.breakdown.net).toBeGreaterThanOrEqual(13000);
    expect(net.kind === 'ok' && net.breakdown.gross).toBeLessThan(16603);
  });

  it('says when the allowances alone give the net asked for', () => {
    expect(salaryFor('net', '400', 2026, [UNTAXED])).toEqual({ kind: 'belowAllowances', net: 500 });
    expect(belowAllowancesText(500)).toBe('The allowances alone give a net of EGP 500.00: enter a higher net, or fewer allowances.');
  });

  it('carries the salary over with them when switching what HR starts from', () => {
    const s = switchBasis('net', { gross: '12000', net: '' }, 2026, [UNTAXED]);
    expect(switchBasis('gross', { gross: '', net: s.net }, 2026, [UNTAXED]).gross).toBe('12000');
  });

  it('describes how they are treated', () => {
    expect(allowancesNote([TAXED])).toBe('taxed, not insured');
    expect(allowancesNote([UNTAXED])).toBe('not taxed, not insured');
    expect(allowancesNote([INSURED])).toBe('taxed, insured');
    expect(allowancesNote([TAXED, UNTAXED, INSURED])).toBe('3,000.00 taxed, 2,000.00 insured');
  });

  it('says when the insured wage is the gross with the insured allowances', () => {
    expect(insuredWageNote({ gross: 12000, insuredWage: 14000 }, 2000)).toBe('the gross and the insured allowances');
    expect(insuredWageNote({ gross: 16000, insuredWage: 16700 }, 2000)).toBe('capped at 16,700.00');
    expect(insuredWageNote({ gross: 500, insuredWage: 2700 }, 1000)).toBe('raised to the minimum, 2,700.00');
  });

  it('lists them in the contract form breakdown', () => {
    const allowances = [TAXED, INSURED];
    const rows = breakdownRows(grossToNet(12000, 2026, allowances), 2026, allowances);
    expect(rows.slice(0, 3).map((r) => [r.label, r.amount, r.note])).toEqual([
      ['Gross salary', 12000, undefined],
      ['Allowances', 3000, 'taxed, 2,000.00 insured'],
      ['Insured wage', 14000, 'the gross and the insured allowances'],
    ]);
    expect(rows.at(-1)?.note).toBe("gross and allowances plus the company's 18.75% insurance, 2,625.00");
    // none: no row
    expect(breakdownRows(grossToNet(12000, 2026), 2026).map((r) => r.label)).not.toContain('Allowances');
  });

  it('lists a contract’s allowances with their amounts', () => {
    expect(allowancesLabel([{ nameEn: 'Transport', amount: 1000 }, { nameEn: 'Mobile', amount: 500.5 }])).toBe('Transport EGP 1,000.00 · Mobile EGP 500.50');
    expect(allowancesLabel([])).toBe('');
    // paid per client account (25 October 2026): no amount on the contract
    expect(allowancesLabel([{ nameEn: 'Transport', amount: 1000 }, { nameEn: 'Accounts allowance', amount: 0, basis: 'per_account' }])).toBe(
      'Transport EGP 1,000.00 · Accounts allowance: Per client account assigned',
    );
  });
});

describe('pay by the hour and working days', () => {
  it('reads hours as typed, to a tenth of an hour', () => {
    expect(parseHours('20')).toBe(20);
    expect(parseHours(' 22.5 ')).toBe(22.5);
    expect(parseHours('٢٠')).toBe(20);
    expect(parseHours('')).toBeNull();
    expect(parseHours('22.25')).toBeNaN();
    expect(parseHours('twenty')).toBeNaN();
  });

  it('works out the monthly estimate from the rate and the hours a week', () => {
    expect(hourlyFor('150', '20')).toEqual({ kind: 'ok', rate: 150, hours: 20, gross: 13000 });
    expect(hourlyFor('100', '22.5')).toEqual({ kind: 'ok', rate: 100, hours: 22.5, gross: 9750 });
    expect(hourlyFor('', '20')).toEqual({ kind: 'empty' });
    expect(hourlyFor('150', '')).toEqual({ kind: 'empty' });
    expect(hourlyFor('abc', '20')).toEqual({ kind: 'invalid', field: 'rate' });
    expect(hourlyFor('0', '')).toEqual({ kind: 'invalid', field: 'rate' });
    expect(hourlyFor('150', '0')).toEqual({ kind: 'invalid', field: 'hours' });
    expect(hourlyFor('150', '49')).toEqual({ kind: 'invalid', field: 'hours' });
    expect(hourlyFor('150', '48').kind).toBe('ok');
  });

  it('words the hourly terms and the estimate', () => {
    expect(hoursLabel(20)).toBe('20 hours a week');
    expect(hoursLabel(1)).toBe('1 hour a week');
    expect(hourlyLabel(150, 22.5)).toBe('EGP 150.00 an hour × 22.5 hours a week');
    expect(monthlyEstimateText({ rate: 150, hours: 20, gross: 13000 })).toBe('EGP 150.00 an hour × 20 hours a week × 52 ÷ 12 = EGP 13,000.00 a month');
  });

  it('words the working days, or none for the shift’s week', () => {
    expect(daysLabel(3)).toBe('3 days a week');
    expect(daysLabel(1)).toBe('1 day a week');
    expect(daysLabel(null)).toBeNull();
  });

  it('words how a contract’s pay is set, the rate only when the salary is shown', () => {
    const hourly = { payBasis: 'hourly' as const, hourlyRate: 150, hoursPerWeek: 20, daysPerWeek: 3 };
    expect(payLabel(hourly)).toBe('By the hour: EGP 150.00 an hour × 20 hours a week · 3 days a week');
    expect(payLabel({ ...hourly, salaryHidden: true })).toBe('By the hour: 20 hours a week · 3 days a week');
    expect(payLabel({ ...hourly, hourlyRate: null, daysPerWeek: null })).toBe('By the hour: 20 hours a week');
    expect(payLabel({ payBasis: 'monthly', hourlyRate: null, hoursPerWeek: null, daysPerWeek: null })).toBe('Monthly salary');
    expect(payLabel({ payBasis: 'monthly', hourlyRate: null, hoursPerWeek: null, daysPerWeek: 5 })).toBe('Monthly salary · 5 days a week');
    expect(hourlyTerms({ payBasis: 'monthly', hourlyRate: 150, hoursPerWeek: 20, daysPerWeek: null })).toBeNull();
    expect(hourlyTerms(hourly)).toBe('EGP 150.00 an hour × 20 hours a week');
  });

  // owner, 27 October 2026: "can i add rate per hour with a minimum monthly payment?" (he chose "On each contract")
  it('words the minimum a month by the hour with the rate, only when the salary is shown', () => {
    const hourly = { payBasis: 'hourly' as const, hourlyRate: 250, hoursPerWeek: 20, hourlyMinimum: 12000, daysPerWeek: null };
    expect(hourlyTerms(hourly)).toBe('EGP 250.00 an hour × 20 hours a week · minimum EGP 12,000.00 a month');
    expect(payLabel(hourly)).toBe('By the hour: EGP 250.00 an hour × 20 hours a week · minimum EGP 12,000.00 a month');
    expect(hourlyTerms({ ...hourly, salaryHidden: true })).toBe('20 hours a week');
    expect(hourlyTerms({ ...hourly, hourlyMinimum: null })).toBe('EGP 250.00 an hour × 20 hours a week');
    expect(hourlyMinimumText({ ...hourly, payBasis: 'monthly' })).toBeNull();
  });

  it('reads the minimum a month as typed: above 0, empty for none', () => {
    expect(typedHourlyMinimum('12,000')).toBe(12000);
    expect(typedHourlyMinimum(' 12000.5 ')).toBe(12000.5);
    expect(typedHourlyMinimum('')).toBeNull();
    for (const wrong of ['0', 'abc', '-1', '1.234']) expect(typedHourlyMinimum(wrong), wrong).toBeNaN();
  });
});

describe('by the hour, from the net rate', () => {
  it('gives a month’s net as a rate: the net ÷ (hours a week × 52 ÷ 12)', () => {
    expect(netPerHour(10437, 20)).toBe(120.43);
    expect(netPerHour(8320.33, 16)).toBe(120);
    expect(netPerHourText(10437, 20)).toBe('≈ EGP 120.43 net per hour');
  });

  it('works the gross rate out from the net per hour agreed, to the piaster', () => {
    // the owner’s example: 120 net an hour × 16 hours a week
    const r = hourlyPayFor('net', '120', '16', 2026);
    expect(r).toEqual({ kind: 'ok', rate: 144.59, hours: 16, gross: 10024.91, breakdown: hourlyRateFromNet(120, 16, 2026).breakdown });
    expect(r.kind === 'ok' && r.breakdown.net).toBe(8320.33);
    expect(r.kind === 'ok' && r.gross).toBe(monthlyFromHourly(144.59, 16));
    if (r.kind === 'ok') expect(workedOutRate(r)).toBe('EGP 144.59 gross per hour, which gives ≈ EGP 120.00 net per hour.');
  });

  it('counts the allowances in the net per hour', () => {
    const transport = { amount: 1000, taxable: false, insured: false };
    const r = hourlyPayFor('net', '120', '16', 2026, [transport]);
    expect(r).toMatchObject({ kind: 'ok', rate: 124.32, gross: 8619.52 });
    expect(r.kind === 'ok' && r.breakdown.net).toBeGreaterThanOrEqual(monthlyFromHourly(120, 16));
  });

  it('takes the gross rate as typed, with its breakdown', () => {
    expect(hourlyPayFor('gross', '150', '20', 2026)).toEqual({ kind: 'ok', rate: 150, hours: 20, gross: 13000, breakdown: grossToNet(13000, 2026) });
  });

  it('keeps the gross rate typed before while it gives the net rate', () => {
    // 150 gives 120.43 net an hour, and is kept; the lowest rate reaching 120.43 is 150.01
    expect(hourlyPayFor('net', '120.43', '20', 2026)).toMatchObject({ rate: 150.01 });
    expect(hourlyPayFor('net', '120.43', '20', 2026, [], '150')).toMatchObject({ rate: 150, gross: 13000 });
    // not for another net rate, or other hours
    expect(hourlyPayFor('net', '125', '20', 2026, [], '150')).toMatchObject({ rate: hourlyRateFromNet(125, 20, 2026).hourlyRate });
    expect(hourlyPayFor('net', '120.43', '16', 2026, [], '150')).toMatchObject({ rate: hourlyRateFromNet(120.43, 16, 2026).hourlyRate });
  });

  it('says when the allowances alone give the net rate’s month, or what is missing or wrong', () => {
    expect(hourlyPayFor('net', '10', '4', 2026, [{ amount: 3000, taxable: false, insured: false }])).toEqual({ kind: 'belowAllowances', net: 3000 });
    expect(belowAllowancesText(3000, true)).toBe('The allowances alone give a net of EGP 3,000.00 a month: enter a higher net rate, or fewer allowances.');
    expect(hourlyPayFor('net', '', '16', 2026)).toEqual({ kind: 'empty' });
    expect(hourlyPayFor('net', 'abc', '16', 2026)).toEqual({ kind: 'invalid', field: 'rate' });
    expect(hourlyPayFor('net', '120', '50', 2026)).toEqual({ kind: 'invalid', field: 'hours' });
  });

  it('switches between the gross and the net per hour, keeping the pay the same', () => {
    const typed = { rate: '150', netRate: '', hours: '20' };
    const toNet = switchRateBasis('net', typed, 2026);
    expect(toNet).toEqual({ rate: '150', netRate: '120.43' });
    expect(switchRateBasis('gross', { ...typed, ...toNet }, 2026)).toEqual({ rate: '150', netRate: '120.43' });
    // from a net rate typed anew: the gross rate worked out
    expect(switchRateBasis('gross', { rate: '150', netRate: '120', hours: '16' }, 2026)).toEqual({ rate: '144.59', netRate: '120' });
    expect(switchRateBasis('net', { rate: '144.59', netRate: '120', hours: '16' }, 2026)).toEqual({ rate: '144.59', netRate: '120' });
  });

  it('leaves the rates as they were when there is nothing to work from', () => {
    expect(switchRateBasis('net', { rate: '', netRate: '99', hours: '20' }, 2026)).toEqual({ rate: '', netRate: '99' });
    expect(switchRateBasis('gross', { rate: '150', netRate: 'abc', hours: '20' }, 2026)).toEqual({ rate: '150', netRate: 'abc' });
    expect(switchRateBasis('net', { rate: '150', netRate: '', hours: '' }, 2026)).toEqual({ rate: '150', netRate: '' });
  });

  it('words a saved contract’s or offer’s net per hour, only when the salary is shown', () => {
    const hourly = { payBasis: 'hourly' as const, hourlyRate: 150, hoursPerWeek: 20, daysPerWeek: 3, netSalary: 10437 };
    expect(hourlyNetTerms(hourly)).toBe('≈ EGP 120.43 net per hour');
    expect(hourlyNetTerms({ ...hourly, salaryHidden: true })).toBeNull();
    expect(hourlyNetTerms({ ...hourly, netSalary: null })).toBeNull();
    expect(hourlyNetTerms({ ...hourly, hoursPerWeek: null })).toBeNull();
    expect(hourlyNetTerms({ ...hourly, payBasis: 'monthly' })).toBeNull();
  });
});

describe('the rates set by law of the year', () => {
  /** Rates the Super Admin might keep for 2027 (invented): every value changed. */
  const RATES_2027: LawRates = {
    ...lawRatesFor(2026),
    year: 2027,
    employeeInsuranceRate: 0.12,
    employerInsuranceRate: 0.19,
    insurableWageMin: 3000,
    insurableWageMax: 18000,
    personalExemption: 25000,
    martyrsRate: 0.001,
    healthInsuranceRate: 0.01,
    taxTiers: [{ upTo: null, bands: [{ upTo: 50_000, rate: 0 }, { upTo: null, rate: 0.2 }] }],
  };
  const KEPT = [...BUILT_IN_LAW_RATES, RATES_2027];

  it('works the salary out with them', () => {
    const rates = lawRatesFor(2027, KEPT);
    const r = salaryFor('gross', '20000', rates);
    expect(r).toEqual({ kind: 'ok', typed: 20000, breakdown: grossToNet(20000, RATES_2027) });
    expect(r.kind === 'ok' && r.breakdown.net).not.toBe(grossToNet(20000, 2026).net);
    expect(salaryFor('net', '15000', rates)).toEqual({ kind: 'ok', typed: 15000, breakdown: netToGross(15000, RATES_2027) });
    expect(hourlyPayFor('gross', '150', '20', rates)).toMatchObject({ gross: 13000, breakdown: grossToNet(13000, RATES_2027) });
    expect(hourlyPayFor('net', '120', '16', rates)).toMatchObject({ rate: hourlyRateFromNet(120, 16, RATES_2027).hourlyRate });
  });

  it('insures within their limits, naming the year they are from', () => {
    expect(insuredFor(20000, lawRatesFor(2027, KEPT))).toEqual({ amount: 18000, why: 'the 2027 maximum' });
    expect(insuredFor(2000, lawRatesFor(2030, KEPT))).toEqual({ amount: 3000, why: 'the 2027 minimum' });
    expect(insurableLimits(RATES_2027)).toEqual({ year: 2027, min: 3000, max: 18000 });
    // 2026 still has its own
    expect(insuredFor(20000, lawRatesFor(2026, KEPT))).toEqual({ amount: 16700, why: 'the 2026 maximum' });
  });

  it('gives their rates in the breakdown', () => {
    const rows = breakdownRows(grossToNet(20000, RATES_2027), RATES_2027);
    expect(rows.map((r) => r.label)).toEqual([
      'Gross salary',
      'Insured wage',
      'Employee social insurance (12%)',
      'Health insurance (1%)',
      'Income tax',
      "Martyrs' Fund (0.1%)",
      'Net salary',
      'Company cost',
    ]);
    expect(rows[1].note).toBe('capped at 18,000.00');
    expect(rows.at(-1)?.note).toBe("gross plus the company's 19% insurance, 3,420.00");
  });

  it('says which year’s rates are used', () => {
    expect(ratesYearText(2026, lawRatesFor(2026, KEPT))).toBe('the rates set by law for 2026');
    expect(ratesYearText(2028, lawRatesFor(2028, KEPT))).toBe('the rates set by law for 2028, those of 2027');
    expect(ratesYearText(2024, lawRatesFor(2024, KEPT))).toBe('the rates set by law for 2024, those of 2025');
  });

  it('carries the salary over with them when switching what HR starts from', () => {
    const s = switchBasis('net', { gross: '20000', net: '' }, RATES_2027);
    expect(Number(s.net)).toBe(grossToNet(20000, RATES_2027).net);
    expect(switchRateBasis('net', { rate: '150', netRate: '', hours: '20' }, RATES_2027).netRate).not.toBe(
      switchRateBasis('net', { rate: '150', netRate: '', hours: '20' }, 2026).netRate,
    );
  });
});

describe('a salary of 0 (owner, 27 October 2026: "this case for example is paid per account only")', () => {
  it('is a gross of 0 only with a per-account allowance on the contract', () => {
    expect(salaryFor('gross', '0', 2026)).toEqual({ kind: 'invalid' });
    const zero = salaryFor('gross', '0', 2026, [], true);
    expect(zero).toMatchObject({ kind: 'ok', typed: 0, breakdown: { gross: 0, net: 0 } });
    expect(salaryFor('net', '0', 2026, [], true)).toMatchObject({ kind: 'ok', breakdown: { gross: 0 } });
  });
});
