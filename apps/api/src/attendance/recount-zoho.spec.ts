import { attendanceMonth, type ImportedDay } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { zonedMoment } from '@trendlix/shared';

// Recount past days (owner, 26 October 2026: "i want to recount previous payrolls on the new shift run"): a Zoho day's
// hours made again by the import's own rules (what HoursByPairsService asks AttendanceImportsService.months, which is
// attendanceMonth) under a changed shift: its window, grace and the time hours count until. A made-up person and days.

const DATE = '2026-09-06';
const t = (time: string) => new Date(zonedMoment(DATE, time)).toISOString();
const base = { month: '2026-09', holidays: [], leaveDays: [], employedFrom: '2026-01-01', employedTo: null, systemPermissionHours: 0, permissionHoursPerMonth: 4 };
const OLD = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15, countUntil: null, workingDays: [0, 1, 2, 3, 4, 5, 6] };
// the MORNING shift as the owner changed it: 8:00 AM–8:00 PM, 9 hours, grace 0, counting until 8:00 PM
const NEW = { startTime: '08:00', endTime: '20:00', hoursPerDay: 9, graceMinutes: 0, countUntil: '20:00', workingDays: [0, 1, 2, 3, 4, 5, 6] };

const hoursOf = (day: ImportedDay, shift: typeof OLD | typeof NEW) => attendanceMonth({ ...base, days: [day], shift }).days[0].hoursCounted;
const withPairs: ImportedDay = {
  date: DATE,
  checkIn: t('09:00'),
  checkOut: t('21:00'),
  place: 'office',
  zohoStatus: 'Present',
  permissionHours: 0,
  pairs: [
    { in: t('09:00'), out: t('13:00') },
    { in: t('14:00'), out: t('21:00') },
  ],
};
const firstAndLast: ImportedDay = { ...withPairs, pairs: null };

describe('a Zoho day recounted under a changed shift', () => {
  it('from its pairs: the window, grace and count-until follow the shift', () => {
    expect(hoursOf(withPairs, OLD)).toBe(9); // 9:00 to 7:15 PM, the break included, at most 9
    expect(hoursOf(withPairs, NEW)).toBe(11); // 9:00 to 8:00 PM, the break included (owner, 31 October 2026)
  });

  it('from the first and last only (an Excel import): check-in to check-out within the window', () => {
    expect(hoursOf(firstAndLast, OLD)).toBe(9);
    expect(hoursOf(firstAndLast, NEW)).toBe(11); // 9:00 to 8:00 PM
  });

  it('is the same twice', () => {
    expect(hoursOf(withPairs, NEW)).toBe(hoursOf(withPairs, NEW));
  });
});
