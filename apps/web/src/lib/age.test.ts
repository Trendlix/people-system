import { describe, expect, it } from 'vitest';
import { ageOn, ageText } from './age';

describe('ageOn', () => {
  it('counts whole years, one more on the birthday', () => {
    expect(ageOn('1995-03-12', '2026-03-11')).toBe(30);
    expect(ageOn('1995-03-12', '2026-03-12')).toBe(31);
    expect(ageOn('1995-03-12', '2026-10-17')).toBe(31);
    expect(ageOn('1995-12-31', '2026-01-01')).toBe(30);
  });

  it('takes a 29 February birthday as passed on 1 March in a year without one', () => {
    expect(ageOn('2000-02-29', '2026-02-28')).toBe(25);
    expect(ageOn('2000-02-29', '2026-03-01')).toBe(26);
    expect(ageOn('2000-02-29', '2028-02-29')).toBe(28);
  });

  it('reads a date with a time after it, and gives nothing without a date or for one still to come', () => {
    expect(ageOn('1995-03-12T00:00:00.000Z', '2026-10-17')).toBe(31);
    expect(ageOn(null, '2026-10-17')).toBeNull();
    expect(ageOn('', '2026-10-17')).toBeNull();
    expect(ageOn('2030-01-01', '2026-10-17')).toBeNull();
  });
});

describe('ageText', () => {
  it('says years, and one year in the singular', () => {
    expect(ageText(31)).toBe('31 years');
    expect(ageText(1)).toBe('1 year');
    expect(ageText(0)).toBe('0 years');
  });
});
