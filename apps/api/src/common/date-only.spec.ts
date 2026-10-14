import { addMonths, fromDateOnly, isDateOnly, toDateOnly } from './date-only.js';

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
});
