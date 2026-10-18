import { describe, expect, it } from 'vitest';
import { addDays, addMonthsKeepingDay, dateOf, monthGrid, shiftMonth, spokenDate, todayInCairo, yearPage } from './date-picker';

// The mini calendar on every date field (owner, 19 October 2026: "open a date picker in a mini calendar when choosing
// any date").

describe('the mini calendar’s dates', () => {
  it('rolls days over months and years', () => {
    expect(dateOf(2026, 1, 32)).toBe('2026-02-01');
    expect(dateOf(2026, 3, 0)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('moves a month keeping the day, or the month’s last day', () => {
    expect(addMonthsKeepingDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsKeepingDay('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsKeepingDay('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsKeepingDay('2026-01-15', -1)).toBe('2025-12-15');
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -13)).toEqual({ year: 2024, month: 12 });
  });

  it('shows six weeks from a Sunday, the days outside the month marked', () => {
    const grid = monthGrid(2026, 10); // 1 October 2026 is a Thursday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: '2026-09-27', day: 27, inMonth: false });
    expect(grid[4]).toEqual({ date: '2026-10-01', day: 1, inMonth: true });
    expect(grid.filter((d) => d.inMonth)).toHaveLength(31);
    expect(grid[41]).toEqual({ date: '2026-11-07', day: 7, inMonth: false });
  });

  it('pages the years around one, ten before and one after', () => {
    expect(yearPage(2026)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
  });

  it('knows today in Cairo whatever the computer’s time zone', () => {
    expect(todayInCairo(new Date('2026-10-18T22:30:00Z'))).toBe('2026-10-19'); // 1:30 AM in Cairo (summer time)
    expect(todayInCairo(new Date('2026-12-31T21:59:00Z'))).toBe('2026-12-31');
  });

  it('says a day in full for screen readers', () => {
    expect(spokenDate('2026-10-18')).toBe('Sunday, 18 October 2026');
  });
});
