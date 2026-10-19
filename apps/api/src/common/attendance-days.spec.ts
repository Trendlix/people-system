import {
  addFigures,
  attendanceDayView,
  attendanceFigures,
  attendancePeriod,
  attendanceSummary,
  averageHoursADay,
  isAttendanceFilter,
  matchesAttendanceFilter,
  NO_ATTENDANCE_FIGURES,
  periodMonthCount,
  type KeptDay,
  type PersonMonthFigures,
} from '@trendlix/shared';

// The Attendance section (owner, 19 October 2026: "the attendance is not active in the side menu"): the days kept from
// Zoho People's imports read back, a month's figures, Daily Attendance's filters, the Summary's period and its rows by
// department and team (packages/shared attendance-days.ts). Every name here is invented.

const day = (date: string, more: Partial<KeptDay> = {}): KeptDay => ({ date, status: 'worked', checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: 0, ...more });
const worked = (date: string, hours: number, more: Partial<KeptDay> = {}) =>
  day(date, { checkIn: `${date}T07:00:00.000Z`, checkOut: `${date}T16:00:00.000Z`, place: 'office', hoursCounted: hours, ...more });

describe('a kept day', () => {
  it('is short by the shift’s hours less the hours counted and its permission, never below 0', () => {
    expect(attendanceDayView(worked('2026-09-01', 8 + 8 / 60), 9)).toMatchObject({ expectedHours: 9, shortHours: 52 / 60, missingCheckOut: false });
    // 7 hours with 2 hours' permission: not short
    expect(attendanceDayView(worked('2026-09-02', 7, { permissionHours: 2 }), 9).shortHours).toBe(0);
    expect(attendanceDayView(worked('2026-09-03', 9), 9).shortHours).toBe(0);
    // no shift: nothing to be short of
    expect(attendanceDayView(worked('2026-09-03', 5), null)).toMatchObject({ expectedHours: null, shortHours: 0 });
  });

  it('says a check-in without a check-out, which is not short (it is said apart), and nothing of a day not worked', () => {
    expect(attendanceDayView(day('2026-09-04', { checkIn: '2026-09-04T07:00:00.000Z' }), 9)).toMatchObject({ missingCheckOut: true, shortHours: 0 });
    expect(attendanceDayView(day('2026-09-05', { status: 'absent' }), 9)).toMatchObject({ expectedHours: null, shortHours: 0, missingCheckOut: false });
  });
});

describe('a month’s figures', () => {
  const days = [
    worked('2026-09-01', 8 + 8 / 60, { permissionHours: 0.5 }),
    worked('2026-09-02', 9, { place: 'remote', permissionHours: 3 }),
    day('2026-09-03', { status: 'absent' }),
    day('2026-09-04', { status: 'rest' }),
    day('2026-09-06', { status: 'zoho_leave' }),
    day('2026-09-07', { status: 'leave' }),
    day('2026-09-08', { status: 'holiday' }),
    day('2026-09-09', { checkIn: '2026-09-09T07:10:00.000Z', place: 'office' }),
    day('2026-09-10', { status: 'no_check_in' }),
  ].map((d) => attendanceDayView(d, 9));

  it('counts each kind of day, the hours, the short hours and the permission within the allowance', () => {
    const f = attendanceFigures(days, { permissionLimit: 3 });
    expect(f).toEqual({
      daysRecorded: 9,
      daysWorked: 3,
      daysCounted: 2,
      hoursCounted: 17 + 8 / 60,
      absentDays: 1,
      // 9 − 8:08 − 0:30 on the 1st; none on the 2nd (9 counted); the 9th has no check-out
      shortHours: 22 / 60,
      permissionHours: 3,
      officeDays: 2,
      remoteDays: 1,
      leaveDays: 1,
      zohoLeaveDays: 1,
      missingCheckOuts: 1,
      noCheckInDays: 1,
      holidays: 1,
      restDays: 1,
    });
    // the system's approved requests counted instead: the month's, days without a row too
    expect(attendanceFigures(days, { permissionHours: 2.5 }).permissionHours).toBe(2.5);
    // no limit: every day's
    expect(attendanceFigures(days).permissionHours).toBe(3.5);
  });

  it('averages the hours over the days counted, and adds up', () => {
    const f = attendanceFigures(days);
    expect(averageHoursADay(f)).toBe(Math.round(((17 + 8 / 60) / 2) * 60) / 60);
    expect(averageHoursADay(NO_ATTENDANCE_FIGURES)).toBeNull();
    const twice = addFigures(f, f);
    expect(twice).toMatchObject({ daysWorked: 6, absentDays: 2, hoursCounted: 34 + 16 / 60 });
  });

  it('lists people by Daily Attendance’s filters', () => {
    const f = attendanceFigures(days);
    expect(['absences', 'short_hours', 'missing_check_outs', 'remote', 'zoho_leave'].map((x) => matchesAttendanceFilter(f, x as never))).toEqual([true, true, true, true, true]);
    expect(matchesAttendanceFilter({ ...f, shortHours: 0 }, 'short_hours')).toBe(false);
    expect(matchesAttendanceFilter(NO_ATTENDANCE_FIGURES, 'absences')).toBe(false);
    expect(matchesAttendanceFilter(NO_ATTENDANCE_FIGURES, null)).toBe(true);
    expect(isAttendanceFilter('absences')).toBe(true);
    expect(isAttendanceFilter('everyone')).toBe(false);
  });
});

describe('the Summary’s period', () => {
  it('is this month without one, a month alone, or a range (one end alone: that month), the wrong way round swapped', () => {
    expect(attendancePeriod({}, '2026-10-19')).toEqual({ from: '2026-10', to: '2026-10' });
    expect(attendancePeriod({ month: '2026-09' }, '2026-10-19')).toEqual({ from: '2026-09', to: '2026-09' });
    expect(attendancePeriod({ from: '2026-01', to: '2026-06' }, '2026-10-19')).toEqual({ from: '2026-01', to: '2026-06' });
    expect(attendancePeriod({ from: '2026-06', to: '2026-01' }, '2026-10-19')).toEqual({ from: '2026-01', to: '2026-06' });
    expect(attendancePeriod({ to: '2026-03' }, '2026-10-19')).toEqual({ from: '2026-03', to: '2026-03' });
    expect(attendancePeriod({ month: '2026-13', from: 'x' }, '2026-10-19')).toEqual({ from: '2026-10', to: '2026-10' });
    expect(periodMonthCount({ from: '2025-11', to: '2026-02' })).toBe(4);
  });
});

describe('the Summary by department and team', () => {
  const sales = { id: 'd-sales', nameEn: 'Sales', parent: null };
  const field = { id: 't-field', nameEn: 'Field Team', parent: { id: 'd-sales', nameEn: 'Sales' } };
  const media = { id: 'd-media', nameEn: 'Media', parent: null };
  const figures = (absentDays: number, hoursCounted: number, daysCounted: number) => ({ ...NO_ATTENDANCE_FIGURES, absentDays, hoursCounted, daysCounted, daysWorked: daysCounted });
  const rows: PersonMonthFigures[] = [
    { employeeId: 'a', month: '2026-09', place: field, figures: figures(1, 80, 10) },
    { employeeId: 'a', month: '2026-10', place: field, figures: figures(0, 90, 10) },
    { employeeId: 'b', month: '2026-09', place: sales, figures: figures(2, 45, 5) },
    { employeeId: 'c', month: '2026-09', place: media, figures: figures(0, 9, 1) },
    { employeeId: 'd', month: '2026-09', place: null, figures: figures(3, 0, 0) },
  ];
  // Organization's order: Media before Sales
  const places = [
    { id: 'd-media', nameEn: 'Media', parentId: null },
    { id: 'd-sales', nameEn: 'Sales', parentId: null },
    { id: 't-field', nameEn: 'Field Team', parentId: 'd-sales' },
  ];

  it('counts a team in its department, in Organization’s order, those without a department last', () => {
    const { groups, totals } = attendanceSummary(rows, places);
    expect(groups.map((g) => [g.name, g.people, g.personMonths, g.figures.absentDays, g.teams.map((t) => t.name)])).toEqual([
      ['Media', 1, 1, 0, []],
      ['Sales', 2, 3, 3, ['Field Team']],
      [null, 1, 1, 3, []],
    ]);
    const team = groups[1].teams[0];
    expect([team.people, team.personMonths, team.figures.hoursCounted, team.averageHours]).toEqual([1, 2, 170, 8.5]);
    expect(groups[1].averageHours).toBe(Math.round((215 / 25) * 60) / 60);
    expect(totals).toMatchObject({ people: 4, personMonths: 5, figures: { absentDays: 6, hoursCounted: 224 } });
  });

  it('puts the places it doesn’t know after those it does, by name', () => {
    expect(attendanceSummary(rows, []).groups.map((g) => g.name)).toEqual(['Media', 'Sales', null]);
    expect(attendanceSummary([], places)).toEqual({ groups: [], totals: { id: null, name: null, people: 0, personMonths: 0, figures: NO_ATTENDANCE_FIGURES, averageHours: null } });
  });
});
