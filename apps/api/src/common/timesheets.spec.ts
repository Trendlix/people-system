import { checkInRefusal, hoursOk, timesheetEditable, timesheetEntryProblems, timesheetRefusal, timesheetSubmitProblem, timesheetWeekDays, timesheetWeekOf, timesheetWeekShift, timesheetWeekText, totalHours } from '@trendlix/shared';

// Timesheets (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly", "Only those HR switches on";
// packages/shared timesheets.ts).

describe('the week', () => {
  it('runs Sunday to Saturday', () => {
    expect(timesheetWeekOf('2026-11-04')).toBe('2026-11-01');
    expect(timesheetWeekOf('2026-11-01')).toBe('2026-11-01');
    expect(timesheetWeekOf('2026-11-07')).toBe('2026-11-01');
    expect(timesheetWeekDays('2026-11-01')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(timesheetWeekShift('2026-11-01', -1)).toBe('2026-10-25');
    expect(timesheetWeekText('2026-11-01')).toBe('01/11/2026 to 07/11/2026');
  });
});

describe('a week’s lines', () => {
  const ctx = { weekStart: '2026-10-25', today: '2026-11-04', employedFrom: '2026-10-27', employedTo: null };

  it('takes quarter hours from 0.25 to 24', () => {
    expect([0.25, 1.5, 7.75, 24].every(hoursOk)).toBe(true);
    expect([0, -1, 1.3, 24.25, Number.NaN].some(hoursOk)).toBe(false);
    expect(totalHours([{ hours: 6 }, { hours: 7.75 }])).toBe(13.75);
  });

  it('says what doesn’t fit, in words', () => {
    expect(timesheetEntryProblems([{ date: '2026-10-28', task: 'Edit', hours: 2 }], ctx)).toEqual([]);
    expect(timesheetEntryProblems([{ date: '2026-11-02', task: 'Edit', hours: 2 }], ctx)).toEqual(['Each line’s day must be within the week of 25/10/2026 to 31/10/2026.']);
    expect(timesheetEntryProblems([{ date: '2026-10-26', task: 'Edit', hours: 2 }], ctx)).toEqual(['26/10/2026 is outside your employment.']);
    expect(timesheetEntryProblems([{ date: '2026-10-28', hours: 2 }], ctx)).toEqual(['Choose the client, or write the task, on each line.']);
    expect(timesheetEntryProblems([{ date: '2026-10-28', clientAccountId: 'c1', hours: 2 }], ctx)).toEqual([]);
    expect(timesheetEntryProblems([{ date: '2026-10-28', task: 'Edit', hours: 20 }, { date: '2026-10-28', task: 'Shoot', hours: 4.5 }], ctx)).toEqual(['28/10/2026 has 24.5 hours: a day has 24 hours at most.']);
    expect(timesheetEntryProblems([{ date: '2026-11-03', task: 'Edit', hours: 2 }], { ...ctx, weekStart: '2026-11-01', today: '2026-11-02' })).toEqual(['03/11/2026 hasn’t come yet: log hours once they are worked.']);
  });
});

describe('who logs hours and what they may do', () => {
  it('is those HR switched on; they never check in', () => {
    expect(timesheetRefusal(true, { worksOnTimesheets: true })).toBeNull();
    expect(timesheetRefusal(true, { worksOnTimesheets: false })).toBe('You check in and out instead of logging hours on a timesheet.');
    expect(timesheetRefusal(false, null)).toBe('Your sign-in has no employee profile, so there are no hours to log.');
    expect(checkInRefusal(true, { employmentType: 'full_time', shiftId: 's1', worksOnTimesheets: true })).toBe('You log your hours on your timesheet instead of checking in.');
    expect(checkInRefusal(true, { employmentType: 'full_time', shiftId: 's1' })).toBeNull();
  });

  it('changes and sends a week until it is sent; again once rejected', () => {
    expect([null, 'draft', 'rejected'].every((s) => timesheetEditable(s as never))).toBe(true);
    expect(['submitted', 'approved'].some((s) => timesheetEditable(s as never))).toBe(false);
    expect(timesheetSubmitProblem('draft', 2)).toBeNull();
    expect(timesheetSubmitProblem('rejected', 1)).toBeNull();
    expect(timesheetSubmitProblem('draft', 0)).toBe('Log the hours of at least one day before sending the week.');
    expect(timesheetSubmitProblem('submitted', 2)).toBe('This week is waiting for approval already.');
  });
});
