import { describe, expect, it } from 'vitest';
import { addDays, addMonths, addWorkingDays, contractEnd, daysBetween, daysLabel, noticeLabel, noticeLastDay, probationEnd } from './dates';

describe('counting days and months', () => {
  it('adds days across months and years, and takes them away', () => {
    expect(addDays('2026-10-15', 14)).toBe('2026-10-29');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2027-11-01', -1)).toBe('2027-10-31');
  });

  it('adds months on the same day, or the last day of a shorter month', () => {
    expect(addMonths('2026-10-15', 3)).toBe('2027-01-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('counts the days between two dates, negative when the second is earlier', () => {
    expect(daysBetween('2026-10-15', '2026-12-14')).toBe(60);
    expect(daysBetween('2026-10-15', '2026-10-15')).toBe(0);
    expect(daysBetween('2026-10-15', '2026-10-10')).toBe(-5);
    // across the change to summer time (no time zone is involved)
    expect(daysBetween('2027-03-01', '2027-05-01')).toBe(61);
  });
});

describe('a contract', () => {
  it('ends the day before the same date a term later, so a renewal starts the day after', () => {
    expect(contractEnd('2026-11-01', 12)).toBe('2027-10-31');
    expect(contractEnd('2026-10-15', 12)).toBe('2027-10-14');
    expect(contractEnd('2026-03-01', 6)).toBe('2026-08-31');
    expect(addDays(contractEnd('2026-11-01', 12), 1)).toBe('2027-11-01');
  });

  it('ends its probation like its term, the day before the same date months later; none without probation', () => {
    expect(probationEnd('2026-10-15', 3)).toBe('2027-01-14');
    expect(probationEnd('2026-11-01', 3)).toBe('2027-01-31');
    expect(probationEnd('2026-11-30', 3)).toBe('2027-02-27');
    expect(probationEnd('2026-10-15', 0)).toBeNull();
  });
});

describe('the last working day after a notice', () => {
  it('counts working days Sunday to Thursday, after the day the notice was given', () => {
    // 15/10/2026 is a Thursday
    expect(addWorkingDays('2026-10-15', 1)).toBe('2026-10-18');
    expect(addWorkingDays('2026-10-15', 5)).toBe('2026-10-22');
    expect(addWorkingDays('2026-10-15', 45)).toBe('2026-12-17');
    // from a Friday, Saturday is skipped too
    expect(addWorkingDays('2026-10-16', 1)).toBe('2026-10-18');
    expect(addWorkingDays('2026-10-15', 0)).toBe('2026-10-15');
  });

  it('follows another working week when given one', () => {
    // Saturday to Wednesday
    expect(addWorkingDays('2026-10-15', 1, [6, 0, 1, 2, 3])).toBe('2026-10-17');
  });

  it('adds days, weeks or months exactly, and says working days are about', () => {
    expect(noticeLastDay('2026-10-15', 2, 'weeks')).toEqual({ date: '2026-10-29', approximate: false });
    expect(noticeLastDay('2026-10-15', 3, 'months')).toEqual({ date: '2027-01-15', approximate: false });
    expect(noticeLastDay('2026-10-15', 30, 'days')).toEqual({ date: '2026-11-14', approximate: false });
    expect(noticeLastDay('2026-10-15', 45, 'working_days')).toEqual({ date: '2026-12-17', approximate: true });
  });

  it('is the day itself without notice', () => {
    expect(noticeLastDay('2026-10-15', 0, 'days')).toEqual({ date: '2026-10-15', approximate: false });
  });
});

describe('the words', () => {
  it('names a notice, in the singular for one', () => {
    expect(noticeLabel(3, 'months')).toBe('3 months');
    expect(noticeLabel(1, 'months')).toBe('1 month');
    expect(noticeLabel(2, 'weeks')).toBe('2 weeks');
    expect(noticeLabel(45, 'working_days')).toBe('45 working days');
    expect(noticeLabel(1, 'working_days')).toBe('1 working day');
    expect(noticeLabel(0, 'days')).toBe('No notice');
  });

  it('counts days', () => {
    expect(daysLabel(1)).toBe('1 day');
    expect(daysLabel(12)).toBe('12 days');
    expect(daysLabel(0)).toBe('0 days');
  });
});
