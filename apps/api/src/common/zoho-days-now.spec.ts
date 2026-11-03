import { monthDays, withShiftNow, type SourcedDay } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';

// Zoho's days read by the system's rules (owner, 3 November 2026: "i swear to God that the assigned shift has no rest
// Days on Friday and Saturday", "just import the attendance from zoho not the sifts", "only the checkin and out
// records"): a day Zoho's import kept without a check-in is a holiday, a rest day of the shift as it is now, else absent,
// whatever was kept at the import (the shift then, or Zoho's own status); leave read over it as it is now. 2026-10-23 is
// a Friday, 2026-10-24 a Saturday, 2026-10-25 a Sunday.

const zoho = (date: string, status: SourcedDay['status'], zohoStatus: string, more: Partial<SourcedDay> = {}): SourcedDay => ({
  date,
  status,
  checkIn: null,
  checkOut: null,
  place: null,
  zohoStatus,
  permissionHours: 0,
  hoursCounted: 0,
  source: 'zoho',
  flags: [],
  ...more,
});
const EVERY_DAY = { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: new Set<string>() };
const SUN_TO_THU = { workingDays: [0, 1, 2, 3, 4], holidays: new Set<string>() };

describe('a Zoho day without a check-in, by the shift as it is now', () => {
  it('a rest day kept on a weekday the shift now works is absent: Zoho’s “Weekend” isn’t read', () => {
    expect(withShiftNow(zoho('2026-10-23', 'rest', 'Weekend, On Duty(Outdoor Meeting) - 04:30'), EVERY_DAY).status).toBe('absent');
    expect(withShiftNow(zoho('2026-10-24', 'rest', 'Weekend'), EVERY_DAY).status).toBe('absent');
  });

  it('Zoho’s “present” or leave without a check-in is absent too: only its check-in and check-out are read', () => {
    expect(withShiftNow(zoho('2026-10-25', 'no_check_in', 'Present'), SUN_TO_THU).status).toBe('absent');
    expect(withShiftNow(zoho('2026-10-25', 'zoho_leave', 'Annual Leave'), SUN_TO_THU).status).toBe('absent');
  });

  it('a weekday the shift doesn’t work is a rest day, an official holiday a holiday', () => {
    expect(withShiftNow(zoho('2026-10-23', 'absent', 'Absent'), SUN_TO_THU).status).toBe('rest');
    expect(withShiftNow(zoho('2026-10-25', 'absent', 'Absent'), { ...SUN_TO_THU, holidays: new Set(['2026-10-25']) }).status).toBe('holiday');
  });

  it('a day with a check-in, a worked day and another source’s day stay as they are', () => {
    const worked = zoho('2026-10-23', 'worked', 'Present', { checkIn: '2026-10-23T07:00:00.000Z', hoursCounted: 8 });
    expect(withShiftNow(worked, SUN_TO_THU)).toBe(worked);
    const system = { ...zoho('2026-10-23', 'absent', ''), source: 'system' as const };
    expect(withShiftNow(system, SUN_TO_THU)).toBe(system);
  });

  it('in the month: approved leave read over it as it is now', () => {
    const days = monthDays([zoho('2026-10-24', 'rest', 'Weekend'), zoho('2026-10-25', 'zoho_leave', 'Annual Leave')], {
      month: '2026-10',
      today: '2026-11-03',
      checkInFrom: null,
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      holidays: [],
      leaveDays: ['2026-10-25'],
      employedFrom: null,
      employedTo: null,
    });
    expect(days.map((d) => [d.date, d.status])).toEqual([
      ['2026-10-24', 'absent'],
      ['2026-10-25', 'leave'],
    ]);
  });
});
