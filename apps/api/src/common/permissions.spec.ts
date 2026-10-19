import {
  isHalfHours,
  monthPermissionHours,
  PERMISSION_RULE_DEFAULTS,
  permissionClock,
  permissionHoursText,
  permissionLeft,
  permissionLeftThatDay,
  permissionMonth,
  permissionRequestProblems,
  permissionRulesProblems,
  permissionTimes,
  permissionTimeText,
  type PermissionDay,
} from '@trendlix/shared';

// Permission (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours per
// day", asked "In the system, like leave", the limits "Yes, in Leave Setup"): packages/shared permissions.ts.

const RULES = PERMISSION_RULE_DEFAULTS;
const DAY: PermissionDay = { workingDay: true, holiday: null, leave: null, usedThatDay: 0, usedInMonth: 0 };
const ask = (hours: number, over: Partial<PermissionDay> = {}, times: { fromTime?: string | null; toTime?: string | null } = {}, name: string | null = null) =>
  permissionRequestProblems({ date: '2026-11-03', hours, ...times }, RULES, { ...DAY, ...over }, name);

describe('the Leave Setup’s permission limits', () => {
  it('are the owner’s: 4 hours a month, at most 2 a day', () => {
    expect(RULES).toEqual({ hoursPerMonth: 4, maxHoursPerDay: 2 });
    expect(permissionRulesProblems(RULES)).toEqual([]);
  });

  it('are in half hours, a day’s no more than a month’s, and a month of 0 turns permission off', () => {
    expect(permissionRulesProblems({ hoursPerMonth: 0, maxHoursPerDay: 2 })).toEqual([]);
    expect(permissionRulesProblems({ hoursPerMonth: 4.25, maxHoursPerDay: 2 })).toEqual([
      'Enter the permission hours a month from 0 to 40, in half hours, e.g. 4 (0: no permission).',
    ]);
    expect(permissionRulesProblems({ hoursPerMonth: 4, maxHoursPerDay: 0 })).toEqual(['Enter the most permission hours a day from 0.5 to 8, in half hours, e.g. 2.']);
    expect(permissionRulesProblems({ hoursPerMonth: 41, maxHoursPerDay: 9 })).toHaveLength(2);
    expect(permissionRulesProblems({ hoursPerMonth: 3, maxHoursPerDay: 4 })).toEqual(["The most hours a day (4 hours) can't be more than the hours a month (3 hours)."]);
  });

  it('half hours: 0.5, 1, 1.5 … and nothing else', () => {
    expect([0, 0.5, 1, 1.5, 2].every(isHalfHours)).toBe(true);
    expect([0.25, -1, Number.NaN, Number.POSITIVE_INFINITY, '1'].some(isHalfHours)).toBe(false);
  });
});

describe('a permission’s times', () => {
  it('works the other time out from the hours (leaving at 5 PM for 2 hours: 17:00–19:00)', () => {
    expect(permissionTimes(2, '17:00', null)).toEqual({ fromTime: '17:00', toTime: '19:00', problems: [] });
    expect(permissionTimes(1.5, null, '11:30')).toEqual({ fromTime: '10:00', toTime: '11:30', problems: [] });
    expect(permissionTimes(2, '', '  ')).toEqual({ fromTime: null, toTime: null, problems: [] });
  });

  it('both given, they must span the hours, the end after the start, within the day', () => {
    expect(permissionTimes(2, '17:00', '19:00').problems).toEqual([]);
    expect(permissionTimes(2, '17:00', '18:30').problems).toEqual(['From 17:00 to 18:30 is 1 hour 30 minutes, not 2 hours: change the hours or the times.']);
    expect(permissionTimes(1, '18:00', '17:00').problems).toEqual(['The time it ends must be after the time it starts, on the same day.']);
    expect(permissionTimes(2, '23:00', null).problems).toEqual(['2 hours from 23:00 run to midnight or past it: choose an earlier time.']);
    expect(permissionTimes(2, '22:00', null).problems).toHaveLength(1);
    expect(permissionTimes(1, null, '00:30').problems).toEqual(['1 hour up to 00:30 start before midnight: choose a later time.']);
    expect(permissionTimes(1, '5pm', null).problems).toEqual(['Enter the time it starts as HH:MM, e.g. 17:00.']);
  });

  it('is shown as its span, or one end', () => {
    expect(permissionTimeText({ fromTime: '17:00', toTime: '19:00' })).toBe('17:00–19:00');
    expect(permissionTimeText({ fromTime: '17:00', toTime: null })).toBe('from 17:00');
    expect(permissionTimeText({})).toBeNull();
  });
});

describe('a permission request’s problems', () => {
  it('takes up to 2 hours of a working day, in half hours', () => {
    expect(ask(2)).toEqual([]);
    expect(ask(0.5)).toEqual([]);
    expect(ask(2.5)).toEqual(['Permission is at most 2 hours a day; this is 2 hours 30 minutes.']);
    expect(ask(1.25)).toEqual(['Enter the hours in half hours, e.g. 1.5 or 2.']);
    expect(ask(0)).toEqual(['Enter the hours in half hours, e.g. 1.5 or 2.']);
    expect(permissionRequestProblems({ date: '03/11/2026', hours: 1 }, RULES, DAY)).toEqual(['Enter the day of the permission, e.g. 2026-11-01.']);
  });

  it('is refused on a rest day, an official holiday or a day of leave', () => {
    expect(ask(1, { workingDay: false })).toEqual(['03/11/2026 is a rest day of your shift: there is no work to ask permission from.']);
    expect(ask(1, { holiday: 'Armed Forces Day' })).toEqual(['03/11/2026 is an official holiday (Armed Forces Day): there is no work to ask permission from.']);
    expect(ask(1, { leave: { type: 'Annual leave', status: 'approved' } })).toEqual(['You have Annual leave on 03/11/2026 (approved): no permission is needed on a day of leave.']);
    // HR recording it on someone's behalf: by their name
    expect(ask(1, { workingDay: false, leave: { type: 'Sick leave', status: 'with HR' } }, {}, 'Sara Test')).toEqual([
      "03/11/2026 is a rest day of Sara Test's shift: there is no work to ask permission from.",
      'Sara Test has Sick leave on 03/11/2026 (with HR): no permission is needed on a day of leave.',
    ]);
  });

  it('takes no more than is left of the day’s 2 hours and the month’s 4 (approved and being decided counted)', () => {
    expect(ask(1, { usedThatDay: 1 })).toEqual([]);
    expect(ask(1.5, { usedThatDay: 1, usedInMonth: 1 })).toEqual(['Only 1 hour left of the 2 hours a day on 03/11/2026: 1 hour already asked for.']);
    expect(ask(1, { usedThatDay: 2, usedInMonth: 2 })).toEqual(['The 2 hours a day on 03/11/2026 are already asked for.']);
    expect(ask(2, { usedInMonth: 3 })).toEqual(["Only 1 hour left of November 2026's 4 hours of permission."]);
    expect(ask(0.5, { usedInMonth: 4 })).toEqual(["November 2026's 4 hours of permission are already asked for."]);
    expect(ask(1, { usedInMonth: 3 })).toEqual([]);
  });

  it('is refused while the Leave Setup gives no hours a month', () => {
    expect(permissionRequestProblems({ date: '2026-11-03', hours: 1 }, { hoursPerMonth: 0, maxHoursPerDay: 2 }, DAY)).toEqual([
      'Permission is turned off in Leave Setup: there are no permission hours a month to ask for.',
    ]);
  });

  it('checks the times with the hours', () => {
    expect(ask(2, {}, { fromTime: '17:00', toTime: '18:00' })).toEqual(['From 17:00 to 18:00 is 1 hour, not 2 hours: change the hours or the times.']);
  });
});

describe('what is left, and the month’s hours on the payroll', () => {
  it('is the month’s hours less those approved and being decided, never below 0', () => {
    expect(permissionLeft(RULES, 1.5)).toBe(2.5);
    expect(permissionLeft(RULES, 6)).toBe(0);
    expect(permissionLeftThatDay(RULES, 0.5)).toBe(1.5);
    expect(permissionMonth('2026-11-03')).toBe('2026-11');
  });

  it('counts the approved hours on the days paid, at most the allowance', () => {
    const november = [
      { date: '2026-11-03', hours: 2 },
      { date: '2026-11-17', hours: 1.5 },
      { date: '2026-12-01', hours: 2 },
    ];
    expect(monthPermissionHours(november, '2026-11', 4)).toBe(3.5);
    // the days paid only: joined on the 10th
    expect(monthPermissionHours(november, '2026-11', 4, [{ from: '2026-11-10', to: '2026-11-30' }])).toBe(1.5);
    // a limit lowered since counts no more than it
    expect(monthPermissionHours(november, '2026-11', 3)).toBe(3);
    expect(monthPermissionHours([], '2026-11', 4)).toBe(0);
  });

  it('says hours in words and as a clock', () => {
    expect([2, 1, 0.5, 1.5].map(permissionHoursText)).toEqual(['2 hours', '1 hour', '30 minutes', '1 hour 30 minutes']);
    expect(permissionClock(4)).toBe('4:00');
    expect(permissionClock(1.5)).toBe('1:30');
  });
});
