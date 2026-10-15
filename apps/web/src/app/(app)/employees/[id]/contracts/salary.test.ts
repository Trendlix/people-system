import { describe, expect, it } from 'vitest';
import { formatEgp, insuredFor, parseAmount, splitSalary } from './salary';

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
