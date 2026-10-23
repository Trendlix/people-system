import {
  attendanceDayView,
  attendanceFigures,
  OD_STEP_KIND_LABELS,
  odCoversMoment,
  odCoversStart,
  odDates,
  odDaysProblems,
  odDutyDays,
  odHoursOn,
  odHoursProblems,
  odInputProblems,
  odRequestedAfter,
  odRequestProblems,
  odTimingProblem,
  odWhenText,
  officialDutyDays,
  withOfficialDuty,
  zonedMoment,
  type DayOfficialDuty,
  type OdDayFacts,
  type OdInput,
  type SourcedDay,
} from '@trendlix/shared';

// Official duty (owner, 23 October 2026: "Official duty (OD) requests"; asked, "Manager, then HR", "Ahead or up to 3 days
// after", "Check in from anywhere"): packages/shared official-duty.ts. 2026-11-01 is a Sunday; Cairo is UTC+2 then.

const TODAY = '2026-11-04';
const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15, countUntil: null };
const at = (date: string, time: string) => new Date(zonedMoment(date, time)).toISOString();
const input = (over: Partial<OdInput> = {}): OdInput => ({
  startDate: '2026-11-05',
  endDate: '2026-11-05',
  fullDay: true,
  fromTime: null,
  toTime: null,
  place: 'Client office, New Cairo',
  reason: 'Launch shoot',
  ...over,
});
const fact = (date: string, over: Partial<OdDayFacts> = {}): OdDayFacts => ({ date, workingDay: true, holiday: null, leave: null, wfh: null, od: [], ...over });
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('an official duty request', () => {
  it('reads its days, times, place and reason', () => {
    expect(odInputProblems(input())).toEqual([]);
    expect(odInputProblems(input({ startDate: 'tomorrow', endDate: '' }))).toEqual([
      'Enter the day of the official duty, e.g. 2026-11-01.',
      'Enter the last day of the official duty, e.g. 2026-11-03 (the same day for one day).',
    ]);
    expect(odInputProblems(input({ endDate: '2026-11-04' }))).toEqual(["The last day can't be before the first."]);
    expect(odInputProblems(input({ startDate: '2026-11-01', endDate: '2026-12-15' }))).toEqual(['Ask for at most 31 days at once: this is 45 days.']);
    expect(odInputProblems(input({ fullDay: false, fromTime: '14:00', toTime: '10:00' }))).toEqual(['The time it ends must be after the time it starts.']);
    expect(odInputProblems(input({ fullDay: false, fromTime: null, toTime: '25:00' }))).toEqual(['Enter the time it starts, e.g. 10:00.', 'Enter the time it ends, e.g. 14:00.']);
    expect(odInputProblems(input({ fullDay: false, fromTime: '10:00', toTime: '12:00', endDate: '2026-11-06' }))).toEqual([
      'Part of a day is for one day: ask for full days, or a request for each day.',
    ]);
    expect(odInputProblems(input({ place: '  ', reason: 'x'.repeat(1001) }))).toEqual([
      'Write where the official duty is, e.g. the client’s office in New Cairo.',
      'Keep the reason to 1000 characters or fewer.',
    ]);
    expect(odDates('2026-11-05', '2026-11-08')).toEqual(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(OD_STEP_KIND_LABELS.no_manager).toBe('No direct manager: sent to HR');
  });

  it('is asked ahead, today, or up to 3 days after; 4 days after is refused, and after the day is "requested after"', () => {
    expect(odTimingProblem('2026-11-10', TODAY)).toBeNull();
    expect(odTimingProblem(TODAY, TODAY)).toBeNull();
    expect(odTimingProblem('2026-11-02', TODAY)).toBeNull();
    expect(odTimingProblem('2026-11-01', TODAY)).toBeNull();
    expect(odTimingProblem('2026-10-31', TODAY)).toBe('31/10/2026 is more than 3 days ago: ask for an official duty ahead, or within 3 days after the day (from 01/11/2026).');
    expect([odRequestedAfter('2026-11-02', TODAY), odRequestedAfter(TODAY, TODAY), odRequestedAfter('2026-11-05', TODAY)]).toEqual([true, false, false]);
  });

  it('is never one day on a holiday or a rest day; several days skip them, and need one working day', () => {
    expect(odDaysProblems(input(), [fact('2026-11-05', { holiday: 'Test Day' })])).toEqual(['05/11/2026 is an official holiday (Test Day): there is no work that day, so no official duty.']);
    expect(odDaysProblems(input({ startDate: '2026-11-06', endDate: '2026-11-06' }), [fact('2026-11-06', { workingDay: false })])).toEqual([
      '06/11/2026 is a rest day of your shift: there is no work that day, so no official duty.',
    ]);
    // Thursday to Sunday: Friday and Saturday aren't duty days, the rest are
    const days = [fact('2026-11-05'), fact('2026-11-06', { workingDay: false }), fact('2026-11-07', { workingDay: false }), fact('2026-11-08')];
    expect(odDaysProblems(input({ endDate: '2026-11-08' }), days)).toEqual([]);
    expect(odDutyDays(days)).toEqual(['2026-11-05', '2026-11-08']);
    expect(odDaysProblems(input({ startDate: '2026-11-06', endDate: '2026-11-07' }), days.slice(1, 3), 'Ben')).toEqual([
      "None of the days from 06/11/2026 to 07/11/2026 is a working day of Ben's shift: there is no work to be away for.",
    ]);
  });

  it('doesn’t overlap leave, a work from home day or another official duty on the same hours', () => {
    const leave = { type: 'Annual leave', status: 'approved', halfDay: false };
    expect(odDaysProblems(input(), [fact('2026-11-05', { leave })])).toEqual(["You have Annual leave on 05/11/2026 (approved): an official duty can't be on a day of leave."]);
    // a half day of leave blocks a full day of duty, not part of one
    const half = { ...leave, halfDay: true };
    expect(odDaysProblems(input(), [fact('2026-11-05', { leave: half })])).toHaveLength(1);
    expect(odDaysProblems(input({ fullDay: false, fromTime: '10:00', toTime: '12:00' }), [fact('2026-11-05', { leave: half })])).toEqual([]);
    expect(odDaysProblems(input(), [fact('2026-11-05', { wfh: { status: 'with HR' } })], 'Ben')).toEqual(['Ben has a work from home day on 05/11/2026 (with HR): ask for one or the other.']);
    // two parts of a day meet when their times overlap
    const morning = { status: 'approved', fullDay: false, fromTime: '09:00', toTime: '12:00' };
    expect(odDaysProblems(input({ fullDay: false, fromTime: '13:00', toTime: '15:00' }), [fact('2026-11-05', { od: [morning] })])).toEqual([]);
    expect(odDaysProblems(input({ fullDay: false, fromTime: '11:00', toTime: '15:00' }), [fact('2026-11-05', { od: [morning] })])).toEqual([
      'You have an official duty on 05/11/2026 already (approved, 9:00 AM–12:00 PM).',
    ]);
    expect(odDaysProblems(input(), [fact('2026-11-05', { od: [morning] })])).toHaveLength(1);
  });

  it('has part of a day inside the shift, said so without one', () => {
    expect(odHoursProblems(input({ fullDay: false, fromTime: '10:00', toTime: '14:00' }), MORNING)).toEqual([]);
    expect(odHoursProblems(input({ fullDay: false, fromTime: '17:00', toTime: '19:15' }), MORNING)).toEqual([]);
    expect(odHoursProblems(input({ fullDay: false, fromTime: '08:00', toTime: '10:00' }), MORNING)).toEqual(['Choose times within your shift, 9:00 AM to 7:00 PM.']);
    expect(odHoursProblems(input({ fullDay: false, fromTime: '18:00', toTime: '20:00' }), MORNING)).toHaveLength(1);
    // a night shift, 22:00 to 06:00: past midnight is within it
    expect(odHoursProblems(input({ fullDay: false, fromTime: '23:00', toTime: '02:00' }), { startTime: '22:00', endTime: '06:00', graceMinutes: 0 })).toEqual([]);
    expect(odHoursProblems(input({ fullDay: false, fromTime: '10:00', toTime: '12:00' }), null)).toEqual(["You have no shift, so part of a day can't be checked against it: ask for the full day."]);
    expect(odHoursProblems(input(), null)).toEqual([]);
  });

  it('says every reason to fix, in order', () => {
    expect(odRequestProblems(input({ startDate: '2026-10-30', endDate: '2026-10-30', fullDay: false, fromTime: '07:00', toTime: '08:00' }), [fact('2026-10-30', { workingDay: false })], MORNING, TODAY)).toEqual([
      `${shown('2026-10-30')} is more than 3 days ago: ask for an official duty ahead, or within 3 days after the day (from 01/11/2026).`,
      'Choose times within your shift, 9:00 AM to 7:00 PM.',
      '30/10/2026 is a rest day of your shift: there is no work that day, so no official duty.',
    ]);
    expect(odWhenText({ startDate: '2026-11-05', endDate: '2026-11-05', fullDay: false, fromTime: '10:00', toTime: '14:00' })).toBe('05/11/2026, 10:00 AM–2:00 PM');
    expect(odWhenText({ startDate: '2026-11-05', endDate: '2026-11-08', fullDay: true })).toBe('05/11/2026–08/11/2026');
    expect(odWhenText({ startDate: '2026-11-05', endDate: '2026-11-05', fullDay: true })).toBe('05/11/2026 (full day)');
  });
});

describe('an approved official duty in the attendance', () => {
  const full = { fullDay: true, fromTime: null, toTime: null };
  const part = { fullDay: false, fromTime: '09:00', toTime: '13:00' };
  const duty = (o: typeof full | typeof part, date = '2026-11-02'): DayOfficialDuty => ({ requestId: 'od-1', ...o, hours: odHoursOn(date, o, MORNING) });
  const day = (date: string, over: Partial<SourcedDay> = {}): SourcedDay => ({
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

  it('counts the shift’s hours for a full day, a part day’s hours within the shift', () => {
    expect(odHoursOn('2026-11-02', full, MORNING)).toBe(9);
    expect(odHoursOn('2026-11-02', part, MORNING)).toBe(4);
    expect(odHoursOn('2026-11-02', { fullDay: false, fromTime: '08:00', toTime: '10:00' }, MORNING)).toBe(1);
    expect(odHoursOn('2026-11-02', full, null)).toBe(0);
  });

  it('takes a press from anywhere on a full day, within a part day’s hours and 30 minutes either side', () => {
    expect(odCoversMoment('2026-11-02', full, zonedMoment('2026-11-02', '22:00'), MORNING)).toBe(true);
    expect(odCoversMoment('2026-11-02', part, zonedMoment('2026-11-02', '08:31'), MORNING)).toBe(true);
    expect(odCoversMoment('2026-11-02', part, zonedMoment('2026-11-02', '13:30'), MORNING)).toBe(true);
    expect(odCoversMoment('2026-11-02', part, zonedMoment('2026-11-02', '13:31'), MORNING)).toBe(false);
    expect(odCoversStart('2026-11-02', part, MORNING)).toBe(true);
    expect(odCoversStart('2026-11-02', { fullDay: false, fromTime: '10:00', toTime: '13:00' }, MORNING)).toBe(false);
  });

  it('makes a day without a press attended for its hours: never absent, nor missing a press', () => {
    const d = withOfficialDuty(day('2026-11-02'), duty(full), MORNING);
    expect(d).toMatchObject({ status: 'worked', hoursCounted: 9, od: { requestId: 'od-1', fullDay: true } });
    const view = attendanceDayView(d, 9);
    expect(view).toMatchObject({ missingCheckIn: false, missingCheckOut: false, shortHours: 0 });
    // a full day with only a check-in: not a missing check-out
    expect(attendanceDayView(withOfficialDuty(day('2026-11-02', { status: 'worked', checkIn: at('2026-11-02', '10:00') }), duty(full), MORNING), 9)).toMatchObject({ hoursCounted: 9, missingCheckOut: false });
    // Zoho's present without a check-in, and Zoho's leave with no leave in the system, worked too
    expect(withOfficialDuty(day('2026-11-02', { status: 'no_check_in', source: 'zoho' }), duty(full), MORNING).status).toBe('worked');
    // a day of leave, a holiday and a rest day stay
    expect(withOfficialDuty(day('2026-11-02', { status: 'leave' }), duty(full), MORNING).status).toBe('leave');
  });

  it('adds a part day’s hours to the day’s own, overlaps once, within the shift', () => {
    // on duty 9–13, then at the office 14:00–19:00: 4 + 5
    const worked = day('2026-11-02', { status: 'worked', checkIn: at('2026-11-02', '14:00'), checkOut: at('2026-11-02', '19:00'), hoursCounted: 5 });
    expect(withOfficialDuty(worked, duty(part), MORNING).hoursCounted).toBe(9);
    // overlapping: 12:00–18:00 at the office with 9–13 on duty, 9 hours
    const overlap = day('2026-11-02', { status: 'worked', checkIn: at('2026-11-02', '12:00'), checkOut: at('2026-11-02', '18:00'), hoursCounted: 6 });
    expect(withOfficialDuty(overlap, duty(part), MORNING).hoursCounted).toBe(9);
    // a part day with no press: its hours, short of the shift's
    const alone = attendanceDayView(withOfficialDuty(day('2026-11-02'), duty(part), MORNING), 9);
    expect(alone).toMatchObject({ status: 'worked', hoursCounted: 4, shortHours: 5 });
  });

  it('adds the duty days a month has none for, from the first check-in on, up to today, within the employment', () => {
    const duties = new Map([
      ['2026-11-02', duty(full)],
      ['2026-11-03', duty(full, '2026-11-03')],
      ['2026-11-09', duty(full, '2026-11-09')],
    ]);
    const kept = [day('2026-11-02', { status: 'worked', checkIn: at('2026-11-02', '09:00'), checkOut: at('2026-11-02', '18:00'), hoursCounted: 9, place: 'remote' })];
    const days = officialDutyDays(kept, duties, { today: '2026-11-04', checkInFrom: '2026-10-20', employedFrom: '2024-01-01', employedTo: null, shift: MORNING });
    expect(days.map((d) => [d.date, d.status, d.hoursCounted, d.od?.requestId])).toEqual([
      ['2026-11-02', 'worked', 9, 'od-1'],
      ['2026-11-03', 'worked', 9, 'od-1'],
    ]);
    // never checked in on the system: only Zoho's days, read with the duty
    expect(officialDutyDays([], duties, { today: '2026-11-30', checkInFrom: null, employedFrom: null, employedTo: null, shift: MORNING })).toEqual([]);
    // the figures count them as days worked and counted, never absent
    const f = attendanceFigures(days.map((d) => attendanceDayView(d, 9)));
    expect(f).toMatchObject({ daysWorked: 2, daysCounted: 2, hoursCounted: 18, absentDays: 0, missingCheckIns: 0, missingCheckOuts: 0 });
  });
});
