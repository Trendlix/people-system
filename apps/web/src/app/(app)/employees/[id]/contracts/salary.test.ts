import { grossToNet } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  basisFrom,
  breakdownRows,
  formatEgp,
  formatPercent,
  insurableLimits,
  insuredFor,
  insuredWageNote,
  parseAmount,
  plainAmount,
  salaryFor,
  savedNetChange,
  splitSalary,
  switchBasis,
  workedOutGross,
} from './salary';

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

  it('shows amounts in EGP', () => {
    expect(formatEgp(16700)).toBe('EGP 16,700');
    expect(formatEgp(1234.5)).toBe('EGP 1,234.5');
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
    expect(insuredWageNote({ gross: 25000, insuredWage: 16700 })).toBe('capped at 16,700');
    expect(insuredWageNote({ gross: 2000, insuredWage: 2700 })).toBe('raised to the minimum, 2,700');
    expect(insuredWageNote({ gross: 12000, insuredWage: 12000 })).toBeUndefined();
  });

  it('gives the insurable limits of a year, a later one using the latest known', () => {
    expect(insurableLimits(2025)).toEqual({ year: 2025, min: 2300, max: 14500 });
    expect(insurableLimits(2027)).toEqual({ year: 2026, min: 2700, max: 16700 });
  });

  it('explains the gross worked out for a net', () => {
    expect(workedOutGross(13000, grossToNet(16603, 2026))).toBe('EGP 16,603 gross: the lowest whole-pound gross whose net reaches EGP 13,000.');
  });

  it('lists the contract form breakdown, monthly', () => {
    const rows = breakdownRows(grossToNet(25000, 2026));
    expect(rows.map((r) => [r.label, r.amount, r.kind])).toEqual([
      ['Gross salary', 25000, 'amount'],
      ['Insured wage', 16700, 'amount'],
      ['Employee social insurance (11%)', 1837, 'deduction'],
      ['Income tax', expect.any(Number), 'deduction'],
      ["Martyrs' Fund (0.05%)", 12.5, 'deduction'],
      ['Net salary', expect.any(Number), 'total'],
      ['Company cost', 28131.25, 'company'],
    ]);
    expect(rows[1].note).toBe('capped at 16,700');
    expect(rows[6].note).toBe("gross plus the company's 18.75% insurance, 3,131.25");
    // what is deducted adds up to the net
    const b = grossToNet(25000, 2026);
    expect(rows[5].amount).toBeCloseTo(b.gross - rows.filter((r) => r.kind === 'deduction').reduce((t, r) => t + r.amount, 0), 2);
    expect(breakdownRows(grossToNet(12000, 2026))[1].note).toBeUndefined();
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
