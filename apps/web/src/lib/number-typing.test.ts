import { describe, expect, it } from 'vitest';
import { wholeTyped, yearsSuffix, yearsTyped } from './number-typing';

// The number boxes' typing (owner, 22 October 2026, on the careers form: "make the years of experience field only
// numbers, and you add years."; the notice period: "the field accept only numbers").

/** Types `keys` one at a time, as a person does. */
const typeKeys = (filter: (v: string) => string, keys: string) => [...keys].reduce((v, key) => filter(v + key), '');

describe('the years of experience as typed', () => {
  it('keeps digits and one point for a half, at most 2 digits before it and 1 after', () => {
    expect(yearsTyped('3')).toBe('3');
    expect(yearsTyped('2.5')).toBe('2.5');
    expect(yearsTyped('12')).toBe('12');
    expect(yearsTyped('123')).toBe('12');
    expect(yearsTyped('1.2.3')).toBe('1.2');
    expect(yearsTyped('2.55')).toBe('2.5');
    expect(yearsTyped('.5')).toBe('.5');
    expect(typeKeys(yearsTyped, '3 years')).toBe('3');
    expect(typeKeys(yearsTyped, 'abc4')).toBe('4');
    expect(typeKeys(yearsTyped, '-1')).toBe('1');
  });

  it('takes a comma or the Arabic ٫ as the point, and Arabic digits as 0-9', () => {
    expect(yearsTyped('2,5')).toBe('2.5');
    expect(yearsTyped('٣٫٥')).toBe('3.5');
    expect(yearsTyped('۱۰')).toBe('10');
  });

  it('shows "years" after the number, "year" after 1', () => {
    expect(yearsSuffix('')).toBe('years');
    expect(yearsSuffix('3')).toBe('years');
    expect(yearsSuffix('1')).toBe('year');
    expect(yearsSuffix('1.5')).toBe('years');
    expect(yearsSuffix('0')).toBe('years');
  });
});

describe('a whole number as typed (the notice period)', () => {
  it('keeps digits only, at most 3', () => {
    expect(wholeTyped('30')).toBe('30');
    expect(wholeTyped('365')).toBe('365');
    expect(wholeTyped('1000')).toBe('100');
    expect(typeKeys(wholeTyped, '2.5')).toBe('25');
    expect(typeKeys(wholeTyped, '30 days')).toBe('30');
    expect(typeKeys(wholeTyped, '-7')).toBe('7');
    expect(wholeTyped('٣٠')).toBe('30');
    expect(wholeTyped('1234', 2)).toBe('12');
  });
});
