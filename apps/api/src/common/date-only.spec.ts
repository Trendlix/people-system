import { addDays, addMonths, fromDateOnly, isDateOnly, shownDate, toDateOnly, weekday } from './date-only.js';

describe('date-only', () => {
  it('round-trips a date', () => {
    expect(fromDateOnly(toDateOnly('2026-10-14'))).toBe('2026-10-14');
    expect(fromDateOnly(null)).toBeNull();
  });

  it('accepts real dates only', () => {
    expect(isDateOnly('2024-02-29')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('14/10/2026')).toBe(false);
    expect(isDateOnly(20261014)).toBe(false);
  });

  it('adds months, keeping the day where the month allows it', () => {
    expect(addMonths('2026-10-14', 3)).toBe('2027-01-14');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2027-11-30', 3)).toBe('2028-02-29');
  });

  it('adds and takes away days, across months and years', () => {
    expect(addDays('2026-10-15', 14)).toBe('2026-10-29');
    expect(addDays('2026-12-25', 7)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2026-10-15', 0)).toBe('2026-10-15');
  });

  it('knows the day of the week and shows dates as DD/MM/YYYY', () => {
    expect(weekday('2026-10-15')).toBe(4); // a Thursday
    expect(weekday('2026-10-18')).toBe(0); // a Sunday
    expect(shownDate('2026-10-05')).toBe('05/10/2026');
  });
});
