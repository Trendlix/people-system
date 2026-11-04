import {
  checkInRefusal,
  clientHoursGroups,
  clientHoursTotal,
  hiddenPeopleNote,
  hoursOk,
  timesheetEditable,
  timesheetEntryProblems,
  timesheetRefusal,
  timesheetSubmitProblem,
  timesheetWeekDays,
  timesheetWeekOf,
  timesheetWeekShift,
  timesheetWeekText,
  totalHours,
  type ClientHoursLine,
} from '@trendlix/shared';

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

describe('client hours (4 November 2026: "Full salary, hours tracked")', () => {
  const nour = { id: 'e1', fullNameEn: 'Nour Adel', employeeCode: 'EMP-0001' };
  const omar = { id: 'e2', fullNameEn: 'Omar Fathy', employeeCode: 'EMP-0002' };
  const acme = { id: 'c1', name: 'Acme', code: 'ACM' };
  const zed = { id: 'c2', name: 'Zed', code: null };
  const line = (over: Partial<ClientHoursLine>): ClientHoursLine => ({ date: '2026-11-02', employee: nour, client: acme, task: null, hours: 1, note: null, status: 'approved', ...over });

  it('adds up each client’s hours by person, the approved apart from those waiting, most hours first, No client last', () => {
    const lines = [
      line({ client: null, task: 'Admin', hours: 9 }),
      line({ hours: 6 }),
      line({ hours: 1.75, date: '2026-11-03' }),
      line({ employee: omar, hours: 10, status: 'submitted' }),
      line({ client: zed, hours: 2 }),
    ];
    const groups = clientHoursGroups(lines);
    expect(groups.map((g) => [g.client?.name ?? null, g.approved, g.waiting])).toEqual([
      ['Acme', 7.75, 10],
      ['Zed', 2, 0],
      [null, 9, 0],
    ]);
    expect(groups[0].people.map((p) => [p.employee.fullNameEn, p.approved, p.waiting])).toEqual([
      ['Omar Fathy', 0, 10],
      ['Nour Adel', 7.75, 0],
    ]);
    expect(clientHoursTotal(lines)).toEqual({ approved: 18.75, waiting: 10, people: 2 });
    expect(clientHoursGroups([])).toEqual([]);
    expect(clientHoursTotal([])).toEqual({ approved: 0, waiting: 0, people: 0 });
  });

  it('keeps clients with the same hours by name, and adds to the hundredth', () => {
    const groups = clientHoursGroups([line({ client: zed, hours: 0.1 }), line({ client: zed, hours: 0.2 }), line({ client: acme, hours: 0.3 })]);
    expect(groups.map((g) => [g.client?.name, g.approved])).toEqual([
      ['Acme', 0.3],
      ['Zed', 0.3],
    ]);
  });

  it('says how many C-level people aren’t shown', () => {
    expect(hiddenPeopleNote(0)).toBeNull();
    expect(hiddenPeopleNote(1)).toBe('Hours of 1 C-level person aren’t shown.');
    expect(hiddenPeopleNote(2)).toBe('Hours of 2 C-level people aren’t shown.');
  });
});
