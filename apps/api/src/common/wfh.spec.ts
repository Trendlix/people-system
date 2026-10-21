import {
  checkInFlags,
  daysApart,
  expectedPlace,
  expectedPlaceText,
  flagsOnWfhDay,
  nextWfhDay,
  WFH_RULE_DEFAULTS,
  WFH_STEP_KIND_LABELS,
  wfhAllowanceText,
  wfhDayProblems,
  wfhLimitProblems,
  wfhMonthUsed,
  wfhNoticeProblem,
  wfhNotNeededMessage,
  wfhOffered,
  wfhRecordCheck,
  wfhRequestProblems,
  wfhRulesProblems,
  type WfhDay,
} from '@trendlix/shared';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; asked,
// "Manager, then HR", "its 2 days per month with a gap of 1 week between each record (Biweekly)", "A day before"):
// packages/shared wfh.ts. 2026-11-01 is a Sunday.

const RULES = WFH_RULE_DEFAULTS;
const OFFICE: WfhDay = { arrangement: 'office', officeDays: [], workingDay: true, holiday: null, leave: null, taken: [] };
const day = (over: Partial<WfhDay> = {}): WfhDay => ({ ...OFFICE, ...over });
const TODAY = '2026-10-21';

describe('the Leave Setup’s work from home limits', () => {
  it('are the owner’s: 2 days a month, a week apart', () => {
    expect(RULES).toEqual({ daysPerMonth: 2, minGapDays: 7 });
    expect(wfhRulesProblems(RULES)).toEqual([]);
  });

  it('are whole numbers: 0 to 20 a month (0 turns it off), 1 to 31 days apart', () => {
    expect(wfhRulesProblems({ daysPerMonth: 0, minGapDays: 1 })).toEqual([]);
    expect(wfhRulesProblems({ daysPerMonth: 2.5, minGapDays: 7 })).toEqual(['Enter the work from home days a month as a whole number from 0 to 20, e.g. 2 (0: no working from home).']);
    expect(wfhRulesProblems({ daysPerMonth: 21, minGapDays: 0 })).toHaveLength(2);
    expect(wfhRulesProblems({ daysPerMonth: 2, minGapDays: 32 })).toEqual(['Enter the days between two work from home days as a whole number from 1 to 31, e.g. 7 (1: any two days).']);
  });
});

describe('who needs a work from home day', () => {
  it('Office any day, Hybrid with office days; Work from home, Outdoor and Indoor and outdoor never', () => {
    expect(wfhOffered('office', [])).toBe(true);
    expect(wfhOffered('hybrid', [0, 2])).toBe(true);
    expect(wfhOffered('hybrid', [])).toBe(false);
    for (const a of ['wfh', 'outdoor', 'indoor_outdoor']) expect(wfhOffered(a, [0, 1, 2, 3, 4])).toBe(false);
    expect(wfhDayProblems('2026-11-02', day({ arrangement: 'wfh' }))).toEqual(['You work from home already: no work from home day is needed.']);
    expect(wfhDayProblems('2026-11-02', day({ arrangement: 'outdoor' }))).toEqual([wfhNotNeededMessage('outdoor')]);
    expect(wfhNotNeededMessage('hybrid', 'Mona Adel')).toBe("Mona Adel's hybrid arrangement has no office days: no work from home day is needed.");
  });

  it('Hybrid only on its office days: another day is refused, saying they work from home that day already', () => {
    const hybrid = day({ arrangement: 'hybrid', officeDays: [0, 2] }); // Sunday and Tuesday
    expect(wfhDayProblems('2026-11-01', hybrid)).toEqual([]); // Sunday
    expect(wfhDayProblems('2026-11-03', hybrid)).toEqual([]); // Tuesday
    expect(wfhDayProblems('2026-11-02', hybrid)).toEqual(["02/11/2026 isn't one of your office days: you work from home that day already."]);
    expect(wfhDayProblems('2026-11-02', hybrid, 'Mona Adel')).toEqual(["02/11/2026 isn't one of Mona Adel's office days: Mona Adel works from home that day already."]);
  });

  it('never on an official holiday, a rest day of the shift, a day of leave, nor a day already one', () => {
    expect(wfhDayProblems('2026-11-02', day({ holiday: 'Test Day' }))).toEqual(['02/11/2026 is an official holiday (Test Day): there is no work that day.']);
    expect(wfhDayProblems('2026-11-06', day({ workingDay: false }))).toEqual(['06/11/2026 is a rest day of your shift: there is no work that day.']);
    expect(wfhDayProblems('2026-11-02', day({ leave: { type: 'Annual leave', status: 'approved' } }))).toEqual([
      'You have Annual leave on 02/11/2026 (approved): no work from home day is needed on a day of leave.',
    ]);
    expect(wfhDayProblems('2026-11-02', day({ taken: ['2026-11-02'] }))).toEqual(['You have a work from home day on 02/11/2026 already.']);
    expect(wfhDayProblems('2026-13-02', day())).toEqual(['Enter the day, e.g. 2026-11-01.']);
  });
});

describe('the notice: a day before', () => {
  it('refuses today and a day gone by; tomorrow is fine', () => {
    expect(wfhNoticeProblem(TODAY, TODAY)).toBe('21/10/2026 is today: ask for a work from home day a day before it at the latest.');
    expect(wfhNoticeProblem('2026-10-20', TODAY)).toBe('20/10/2026 has gone by: ask for a work from home day a day before it at the latest.');
    expect(wfhNoticeProblem('2026-10-22', TODAY)).toBeNull();
  });
});

describe('the limits: 2 a calendar month, 7 days apart', () => {
  it('counts days apart by date, either way', () => {
    expect(daysApart('2026-11-01', '2026-11-08')).toBe(7);
    expect(daysApart('2026-11-08', '2026-11-01')).toBe(7);
    expect(daysApart('2026-10-29', '2026-11-02')).toBe(4);
  });

  it('allows 7 days apart exactly, not 6', () => {
    expect(wfhLimitProblems('2026-11-08', RULES, ['2026-11-01'])).toEqual([]);
    expect(wfhLimitProblems('2026-11-07', RULES, ['2026-11-01'])).toEqual(['Two work from home days must be at least 7 days apart: 07/11/2026 is 6 days from your day on 01/11/2026.']);
    // the nearest one is named
    expect(wfhLimitProblems('2026-11-10', { daysPerMonth: 5, minGapDays: 7 }, ['2026-11-04', '2026-11-12'])).toEqual([
      'Two work from home days must be at least 7 days apart: 10/11/2026 is 2 days from your day on 12/11/2026.',
    ]);
  });

  it('holds the gap across months: 29/10 then 02/11 is too close', () => {
    expect(wfhLimitProblems('2026-11-02', RULES, ['2026-10-29'])).toEqual(['Two work from home days must be at least 7 days apart: 02/11/2026 is 4 days from your day on 29/10/2026.']);
    expect(wfhLimitProblems('2026-11-05', RULES, ['2026-10-29'])).toEqual([]);
  });

  it('allows the month’s 2nd, refuses a 3rd; another month’s days don’t count', () => {
    expect(wfhLimitProblems('2026-11-15', RULES, ['2026-11-01'])).toEqual([]);
    expect(wfhLimitProblems('2026-11-22', RULES, ['2026-11-01', '2026-11-15'])).toEqual(['November 2026\'s 2 days of working from home are already asked for: 2 of 2.']);
    expect(wfhLimitProblems('2026-11-22', RULES, ['2026-10-01', '2026-10-15'])).toEqual([]);
    expect(wfhMonthUsed('2026-11', ['2026-10-29', '2026-11-05', '2026-11-20'])).toBe(2);
  });

  it('is off at 0 a month; a gap of 1 allows the next day', () => {
    expect(wfhLimitProblems('2026-11-02', { daysPerMonth: 0, minGapDays: 7 }, [])).toEqual([
      'Working from home is turned off in Leave Setup: there are no work from home days a month to ask for.',
    ]);
    expect(wfhLimitProblems('2026-11-03', { daysPerMonth: 5, minGapDays: 1 }, ['2026-11-02'])).toEqual([]);
  });
});

describe('an employee’s request', () => {
  it('gives every reason in order: the day, the notice, then the limits', () => {
    expect(wfhRequestProblems('2026-11-02', RULES, day(), TODAY)).toEqual([]);
    expect(wfhRequestProblems(TODAY, RULES, day({ taken: ['2026-10-18'] }), TODAY)).toEqual([
      '21/10/2026 is today: ask for a work from home day a day before it at the latest.',
      'Two work from home days must be at least 7 days apart: 21/10/2026 is 3 days from your day on 18/10/2026.',
    ]);
    // an arrangement that never needs it says only that
    expect(wfhRequestProblems(TODAY, RULES, day({ arrangement: 'wfh' }), TODAY)).toEqual(['You work from home already: no work from home day is needed.']);
  });
});

describe('HR recording a day', () => {
  it('is refused by the day itself, recorded past the notice and the limits with warnings', () => {
    expect(wfhRecordCheck('2026-10-20', RULES, day({ taken: ['2026-10-15'] }), TODAY, 'Mona Adel')).toEqual({
      problems: [],
      warnings: ['20/10/2026 has gone by: it is recorded after the day.', "Two work from home days must be at least 7 days apart: 20/10/2026 is 5 days from Mona Adel's day on 15/10/2026."],
    });
    expect(wfhRecordCheck(TODAY, RULES, day(), TODAY, 'Mona Adel').warnings).toEqual(["21/10/2026 is today: it is recorded without a day's notice."]);
    expect(wfhRecordCheck('2026-11-22', RULES, day({ taken: ['2026-11-01', '2026-11-15'] }), TODAY, 'Mona Adel').warnings).toEqual([
      "November 2026's 2 days of working from home are already asked for for Mona Adel: 2 of 2.",
    ]);
    expect(wfhRecordCheck('2026-11-02', RULES, day({ holiday: 'Test Day' }), TODAY, 'Mona Adel')).toEqual({
      problems: ['02/11/2026 is an official holiday (Test Day): there is no work that day.'],
      warnings: [],
    });
  });
});

describe('the next day possible and the form’s line', () => {
  it('is the first day within the limits that is a working office day', () => {
    // a day on 22/10: the next is a week later; the week-end skipped by the workday rule
    const weekdays = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() <= 4;
    expect(nextWfhDay('2026-10-22', RULES, ['2026-10-22'], weekdays)).toBe('2026-10-29');
    expect(nextWfhDay('2026-10-22', RULES, [], weekdays)).toBe('2026-10-22');
    // October's 2 taken: November's first, a week after the last
    expect(nextWfhDay('2026-10-23', RULES, ['2026-10-15', '2026-10-29'], weekdays)).toBe('2026-11-05');
    expect(nextWfhDay('2026-10-22', { daysPerMonth: 0, minGapDays: 7 }, [])).toBeNull();
  });

  it('reads "x of 2 this month · next possible from DD/MM/YYYY"', () => {
    expect(wfhAllowanceText(1, RULES, '2026-11-05')).toBe('1 of 2 this month · next possible from 05/11/2026');
    expect(wfhAllowanceText(2, RULES, null)).toBe('2 of 2 this month · no day possible in the coming months');
    expect(wfhAllowanceText(0, { daysPerMonth: 0, minGapDays: 7 }, null)).toBe('Working from home is turned off in Leave Setup.');
  });
});

describe('an approved day at check-in', () => {
  it('is expected anywhere: no "Outside the office" nor "no location" flag; fake GPS and away from home stay', () => {
    expect(expectedPlace('office', [], 1, true)).toBe('anywhere');
    expect(expectedPlace('hybrid', [1], 1, true)).toBe('anywhere');
    expect(expectedPlace('office', [], 1)).toBe('office');
    expect(checkInFlags(expectedPlace('office', [], 1, true), 'remote')).toEqual([]);
    expect(checkInFlags(expectedPlace('office', [], 1, true), 'unknown')).toEqual([]);
    expect(checkInFlags(expectedPlace('office', [], 1, true), 'remote', true, true)).toEqual(['fake_gps', 'not_home_or_office']);
    expect(expectedPlaceText('office', 'anywhere', true)).toBe('Today is your approved work from home day: check in from home.');
  });

  it('leaves out the office day’s flags of a day flagged before it was approved', () => {
    expect(flagsOnWfhDay(['outside_office', 'location_unknown', 'fake_gps', 'not_home_or_office'])).toEqual(['fake_gps', 'not_home_or_office']);
  });

  it('logs an import from Zoho People as its own step', () => {
    expect(WFH_STEP_KIND_LABELS.imported).toBe('Imported from Zoho People');
    expect(WFH_STEP_KIND_LABELS.recorded_by_hr).toBe('Recorded by HR');
  });
});
