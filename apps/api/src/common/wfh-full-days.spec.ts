import { attendanceDayView, attendanceFigures, attendanceLineInputs, exemptDays, historyDay, wfhFullDays, zonedMoment, type SourcedDay } from '@trendlix/shared';

// An approved work from home day without a check-in counts the shift's full hours (owner, 26 October 2026: "Full day,
// always"): packages/shared wfh.ts wfhFullDays, and what such a day counts in the pages, the history and the payroll.

const at = (day: string, time: string) => new Date(zonedMoment(day, time)).toISOString();
const ctx = (over: Partial<Parameters<typeof wfhFullDays>[2]> = {}) => ({
  today: '2026-10-25',
  checkInFrom: '2026-10-01',
  workingDays: [0, 1, 2, 3, 4],
  holidays: ['2026-10-06'],
  leaveDays: ['2026-10-13'],
  employedFrom: '2026-01-01',
  employedTo: null,
  hoursADay: 9,
  ...over,
});
const kept = (date: string, over: Partial<SourcedDay> = {}): SourcedDay => ({
  date,
  status: 'absent',
  checkIn: null,
  checkOut: null,
  place: null,
  zohoStatus: null,
  permissionHours: 0,
  hoursCounted: 0,
  source: 'system',
  flags: [],
  ...over,
});
const SUNDAY = '2026-10-11';
const one = (days: SourcedDay[], wfh: string[] = [SUNDAY], over = {}) => wfhFullDays(days, wfh, ctx(over)).find((d) => d.date === SUNDAY)!;

describe('an approved work from home day without a check-in', () => {
  it('with no check-in at all counts the shift’s hours, worked, never short', () => {
    const d = one([kept(SUNDAY)]);
    expect(d).toMatchObject({ status: 'worked', hoursCounted: 9, wfhDay: true, flags: [] });
    expect(attendanceDayView(d, 9)).toMatchObject({ shortHours: 0, extraHours: 0, missingCheckOut: false, missingCheckIn: false });
  });

  it('with a check-in is counted from its presses as before, even short', () => {
    const pressed = kept(SUNDAY, { status: 'worked', checkIn: at(SUNDAY, '09:00'), checkOut: at(SUNDAY, '13:00'), hoursCounted: 4 });
    expect(one([pressed])).toEqual(pressed);
    const open = kept(SUNDAY, { status: 'worked', checkIn: at(SUNDAY, '09:00'), openAt: at(SUNDAY, '09:00') });
    expect(one([open])).toEqual(open);
    const pairs = kept(SUNDAY, { status: 'worked', pairs: [{ in: at(SUNDAY, '09:00'), out: at(SUNDAY, '11:00') }], hoursCounted: 2 });
    expect(one([pairs])).toEqual(pairs);
  });

  it('on a Zoho day with only a status and no times counts full', () => {
    expect(one([kept(SUNDAY, { source: 'zoho', status: 'worked', zohoStatus: 'Present', hoursCounted: 0 })])).toMatchObject({ status: 'worked', hoursCounted: 9, wfhDay: true });
    expect(one([kept(SUNDAY, { source: 'zoho', status: 'no_check_in', zohoStatus: 'Present' })])).toMatchObject({ status: 'worked', hoursCounted: 9 });
    expect(one([kept(SUNDAY, { source: 'zoho', status: 'absent' })])).toMatchObject({ status: 'worked', hoursCounted: 9 });
  });

  it('with no day kept at all is added once they have checked in on the system, not before', () => {
    expect(one([])).toMatchObject({ status: 'worked', hoursCounted: 9, source: 'system', wfhDay: true });
    expect(wfhFullDays([], [SUNDAY], ctx({ checkInFrom: null }))).toEqual([]);
    expect(wfhFullDays([], [SUNDAY], ctx({ checkInFrom: '2026-10-12' }))).toEqual([]);
  });

  it('that is not a working day stays as it is: a rest day, a holiday, leave, before joining, a day to come, official duty', () => {
    const friday = '2026-10-09';
    expect(wfhFullDays([kept(friday, { status: 'rest' })], [friday], ctx())[0]).toMatchObject({ status: 'rest', hoursCounted: 0 });
    expect(wfhFullDays([], [friday], ctx())).toEqual([]);
    expect(wfhFullDays([kept('2026-10-06', { status: 'holiday' })], ['2026-10-06'], ctx())[0]).toMatchObject({ status: 'holiday' });
    expect(wfhFullDays([kept('2026-10-13', { status: 'leave' })], ['2026-10-13'], ctx())[0]).toMatchObject({ status: 'leave' });
    expect(wfhFullDays([kept('2026-10-13', { status: 'absent' })], ['2026-10-13'], ctx())[0]).toMatchObject({ status: 'absent' });
    expect(one([kept(SUNDAY)], [SUNDAY], { employedFrom: '2026-10-12' })).toMatchObject({ status: 'absent' });
    expect(one([kept(SUNDAY)], [SUNDAY], { today: '2026-10-10' })).toMatchObject({ status: 'absent' });
    const duty = { requestId: 'od', fullDay: false, fromTime: '10:00', toTime: '12:00', hours: 2 };
    expect(one([kept(SUNDAY, { status: 'worked', hoursCounted: 2, od: duty })])).toMatchObject({ hoursCounted: 2 });
  });

  it('not approved (not among the approved days), or a shift without hours, leaves the day as it is', () => {
    const day = kept(SUNDAY);
    expect(one([day], [])).toEqual(day);
    expect(one([day], ['2026-10-12'])).toEqual(day);
    expect(one([day], [SUNDAY], { hoursADay: null })).toEqual(day);
  });

  it('counts in the figures, the history and the payroll line', () => {
    const d = one([kept(SUNDAY)]);
    const view = attendanceDayView(d, 9);
    const figures = attendanceFigures([view]);
    expect(figures).toMatchObject({ daysWorked: 1, daysCounted: 1, hoursCounted: 9, absentDays: 0, shortHours: 0 });
    expect(historyDay({ ...view, source: 'system', wfh: true, shift: { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 }, scheduled: true })).toMatchObject({
      mode: 'wfh',
      attended: true,
      onTime: true,
      hours: 9,
      counted: true,
    });
    expect(attendanceLineInputs([d], { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false, hoursADay: 9 })).toMatchObject({ workedHours: 9, noShowDays: 0 });
  });

  it('reads beside an exemption: the exempt day still wins', () => {
    const days = exemptDays(wfhFullDays([kept(SUNDAY)], [SUNDAY], ctx()), [{ startDate: '2026-10-01', endDate: null }], { month: '2026-10', ...ctx() });
    expect(days.find((d) => d.date === SUNDAY)).toMatchObject({ status: 'worked', hoursCounted: 9, exempt: true });
  });
});
