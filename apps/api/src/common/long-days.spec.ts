import { attendanceMonth, freelanceDays, longDayHours, longDayProblems, longDayRuleOf, longDayText, type SourcedDay } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';

// A freelancer's long day on a shift (owner, 3 November 2026: "if more than N Hours Count as Y Hours", "Freelancers only",
// "set per shift", "this rule may be enables or disabled in a specific shift"): packages/shared long-days.ts.

const RULE = { overHours: 10, countsAs: 14 };

describe('the shift’s rule', () => {
  it('is on only when switched on with both hours', () => {
    expect(longDayRuleOf({ longDayOn: true, longDayOverHours: 10, longDayCountsAs: 14 })).toEqual(RULE);
    expect(longDayRuleOf({ longDayOn: false, longDayOverHours: 10, longDayCountsAs: 14 })).toBeNull();
    expect(longDayRuleOf({ longDayOn: true, longDayOverHours: 10, longDayCountsAs: null })).toBeNull();
    expect(longDayRuleOf(null)).toBeNull();
    expect(longDayText(RULE)).toBe('More than 10:00 a day counts as 14:00');
    expect(longDayText({ overHours: 9.5, countsAs: 13.5 })).toBe('More than 9:30 a day counts as 13:30');
  });

  it('is checked: both hours or none, in half hours, counting as more, on only with them; kept while off', () => {
    expect(longDayProblems(false, null, null)).toEqual([]);
    expect(longDayProblems(true, 10, 14)).toEqual([]);
    expect(longDayProblems(false, 10, 14)).toEqual([]);
    expect(longDayProblems(true, null, null)).toEqual(['Freelancers’ long day: give the hours and what they count as, or switch it off.']);
    expect(longDayProblems(true, 10, null)).toEqual(['Freelancers’ long day: give both the hours and what they count as, or leave both empty.']);
    expect(longDayProblems(true, 10.25, 14)).toEqual(['Freelancers’ long day: give the hours in half hours from 0.5 to 24, e.g. 10.']);
    expect(longDayProblems(true, 10, 49)).toEqual(['Freelancers’ long day: give what they count as in half hours up to 48, e.g. 14.']);
    expect(longDayProblems(true, 10, 10)).toEqual(['Freelancers’ long day: it must count as more hours than it takes.']);
  });

  it('counts a day of more than its hours as what they count as; at them or under, as it is', () => {
    expect(longDayHours(10.5, RULE)).toBe(14);
    expect(longDayHours(10, RULE)).toBe(10);
    expect(longDayHours(9, RULE)).toBe(9);
    expect(longDayHours(12, null)).toBe(12);
  });
});

const day = (date: string, status: SourcedDay['status'], hoursCounted: number): SourcedDay => ({
  date,
  status,
  checkIn: status === 'worked' ? `${date}T07:00:00.000Z` : null,
  checkOut: null,
  place: 'office',
  zohoStatus: null,
  permissionHours: 0,
  hoursCounted,
  source: 'system',
  flags: [],
});

describe('a freelancer’s days', () => {
  it('a long day counted as the shift says and marked; an absent day not counted, as before', () => {
    const days = freelanceDays([day('2026-11-01', 'worked', 12), day('2026-11-02', 'worked', 8), day('2026-11-03', 'absent', 0)], RULE);
    expect(days.map((d) => [d.date, d.status, d.hoursCounted, d.longDay ?? false, d.notCounted ?? false])).toEqual([
      ['2026-11-01', 'worked', 14, true, false],
      ['2026-11-02', 'worked', 8, false, false],
      ['2026-11-03', 'rest', 0, false, true],
    ]);
    // without the rule (off): the hours as they are
    expect(freelanceDays([day('2026-11-01', 'worked', 12)])[0]).toMatchObject({ hoursCounted: 12 });
  });

  it('the Zoho import’s month hours count it too, its days keeping their own', () => {
    const input = {
      month: '2026-11',
      days: [
        { date: '2026-11-01', checkIn: '2026-11-01T06:00:00.000Z', checkOut: '2026-11-01T18:30:00.000Z', place: 'office' as const, zohoStatus: 'Present', permissionHours: 0 },
        { date: '2026-11-02', checkIn: '2026-11-02T07:00:00.000Z', checkOut: '2026-11-02T15:00:00.000Z', place: 'office' as const, zohoStatus: 'Present', permissionHours: 0 },
      ],
      shift: { startTime: '08:00', endTime: '20:00', hoursPerDay: 9, graceMinutes: 0, countUntil: '21:00', workingDays: [0, 1, 2, 3, 4, 5, 6] },
      holidays: [],
      leaveDays: [],
      employedFrom: '2026-10-01',
      employedTo: null,
      systemPermissionHours: 0,
      permissionHoursPerMonth: 4,
    };
    const plain = attendanceMonth(input);
    const long = attendanceMonth({ ...input, longDay: RULE });
    // 8:00 to 8:30 PM: 12:30 counted (until 9:00 PM), so 14:00; and 8:00 the other day
    expect(plain.days.map((d) => d.hoursCounted)).toEqual([12.5, 8]);
    expect(long.days.map((d) => d.hoursCounted)).toEqual([12.5, 8]);
    expect([plain.hoursCounted, long.hoursCounted]).toEqual([20.5, 22]);
  });
});
