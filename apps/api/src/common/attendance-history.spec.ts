import {
  checkInBins,
  clockText,
  HISTORY_SOURCE_LABELS,
  historyDay,
  historyFigures,
  historyRange,
  historyTrend,
  lateByWeekday,
  matchesHistoryFilter,
  percentText,
  trendByQuarter,
  zonedMoment,
  type HistoryDayInput,
} from '@trendlix/shared';

// A person's attendance history (owner, 23 October 2026: "Attendance history on the profile. Since joining: on-time %,
// average check-in time, late days by weekday and trends; an Excel export"): packages/shared attendance-history.ts, on
// made-up days with a holiday, leave, a work from home day, an official duty and Zoho's rows. 2026-11-01 is a Sunday;
// Cairo is UTC+2 then. The MORNING shift: 9:00 AM to 7:00 PM, 9 hours, 15 minutes' grace, Sunday to Thursday.

const MORNING = { startTime: '09:00', endTime: '19:00', graceMinutes: 15 };
const at = (date: string, time: string) => new Date(zonedMoment(date, time)).toISOString();
const input = (date: string, over: Partial<HistoryDayInput> = {}): HistoryDayInput => ({
  date,
  status: 'worked',
  checkIn: null,
  checkOut: null,
  place: 'office',
  hoursCounted: 0,
  extraHours: 0,
  od: null,
  correctionId: null,
  source: 'system',
  wfh: false,
  shift: MORNING,
  scheduled: true,
  ...over,
});
const worked = (date: string, from: string, to: string, hours: number, over: Partial<HistoryDayInput> = {}) =>
  input(date, { checkIn: at(date, from), checkOut: at(date, to), hoursCounted: hours, ...over });

const DAYS = [
  worked('2026-11-01', '09:05', '18:10', 9),
  // late by 20 minutes: past 9:15
  worked('2026-11-02', '09:20', '18:30', 9),
  // working from home, on time at 9:00
  worked('2026-11-03', '09:00', '17:00', 8, { place: 'home', wfh: true }),
  // a full day of official duty with no press: attended, on time
  input('2026-11-04', { place: null, hoursCounted: 9, od: { requestId: 'od-1', fullDay: true, fromTime: null, toTime: null, hours: 9 } }),
  input('2026-11-05', { status: 'absent', place: null }),
  input('2026-11-06', { status: 'rest', place: null, scheduled: false }),
  // checked in on a Saturday: worked off, not expected
  worked('2026-11-07', '10:00', '14:00', 4, { scheduled: false }),
  input('2026-11-08', { status: 'leave', place: null }),
  input('2026-11-09', { status: 'holiday', place: null, scheduled: false }),
  // Zoho's import: late by an hour
  worked('2026-11-10', '10:00', '19:00', 9, { source: 'zoho' }),
  // corrected, early, with make-up time
  worked('2026-11-11', '08:50', '18:00', 9, { source: 'correction', correctionId: 'c-1', extraHours: 0.5 }),
  input('2026-11-12', { status: 'zoho_leave', place: null, source: 'zoho' }),
].map(historyDay);

const RANGE = { from: '2026-11-01', to: '2026-11-12' };

describe('a day of the history', () => {
  it('says what it was, whether expected and attended, on time or late, and where it came from', () => {
    const by = Object.fromEntries(DAYS.map((d) => [d.date, d]));
    expect(by['2026-11-01']).toMatchObject({ mode: 'office', expected: true, attended: true, onTime: true, lateMinutes: 0, checkInMinutes: 545, counted: true });
    expect(by['2026-11-02']).toMatchObject({ onTime: false, lateMinutes: 20 });
    expect(by['2026-11-03']).toMatchObject({ mode: 'wfh', onTime: true });
    expect(by['2026-11-04']).toMatchObject({ mode: 'od', attended: true, onTime: true, checkInMinutes: null, counted: true, odRequestId: 'od-1' });
    expect(by['2026-11-05']).toMatchObject({ mode: 'absent', expected: true, attended: false, onTime: null });
    expect(by['2026-11-07']).toMatchObject({ mode: 'office', expected: false, offDay: true, onTime: null });
    expect(by['2026-11-08']).toMatchObject({ mode: 'leave', expected: false });
    expect(by['2026-11-09']).toMatchObject({ mode: 'holiday', expected: false });
    expect(by['2026-11-10']).toMatchObject({ source: 'zoho', onTime: false, lateMinutes: 60 });
    expect(by['2026-11-11']).toMatchObject({ source: 'correction', correctionId: 'c-1', onTime: true });
    expect(by['2026-11-12']).toMatchObject({ mode: 'zoho_leave', expected: false });
    expect([HISTORY_SOURCE_LABELS.system, HISTORY_SOURCE_LABELS.zoho, HISTORY_SOURCE_LABELS.correction]).toEqual(['System', 'Zoho import', 'Corrected']);
    // remote, outside the office
    expect(historyDay(worked('2026-11-02', '09:00', '18:00', 9, { place: 'remote' })).mode).toBe('remote');
    // part of a day on duty from the start: on time whatever the press; one later in the day doesn't cover the start
    const morning = { requestId: 'od-2', fullDay: false, fromTime: '09:00', toTime: '13:00', hours: 4 };
    expect(historyDay(worked('2026-11-02', '14:00', '19:00', 9, { od: morning }))).toMatchObject({ mode: 'od', onTime: true, lateMinutes: 0 });
    const afternoon = { ...morning, fromTime: '13:00', toTime: '17:00' };
    expect(historyDay(worked('2026-11-02', '09:30', '13:00', 8, { od: afternoon }))).toMatchObject({ onTime: false, lateMinutes: 30 });
    // no shift: not measured
    expect(historyDay(worked('2026-11-02', '11:00', '18:00', 7, { shift: null })).onTime).toBeNull();
  });

  it('is listed under the log’s filters', () => {
    const under = (f: Parameters<typeof matchesHistoryFilter>[1]) => DAYS.filter((d) => matchesHistoryFilter(d, f)).map((d) => d.date);
    expect(under('late')).toEqual(['2026-11-02', '2026-11-10']);
    expect(under('wfh')).toEqual(['2026-11-03']);
    expect(under('od')).toEqual(['2026-11-04']);
    expect(under('leave')).toEqual(['2026-11-08', '2026-11-12']);
    expect(under('absent')).toEqual(['2026-11-05']);
    expect(under(null)).toHaveLength(12);
  });
});

describe('the history’s figures', () => {
  it('works out the rate, on time, the averages, overtime and the days of each kind', () => {
    const f = historyFigures(DAYS);
    expect(f).toEqual({
      daysOnRecord: 12,
      // the working days worked or absent: not the rest day, the Saturday, the holiday or leave
      expectedDays: 7,
      attendedDays: 6,
      attendanceRate: 6 / 7,
      measuredDays: 6,
      onTimeDays: 4,
      lateDays: 2,
      onTimeRate: 4 / 6,
      // 9:05, 9:20, 9:00, 10:00, 8:50: 9:15 on average (the duty day had no press, the Saturday isn't attended)
      averageCheckIn: 555,
      // 57 hours over 7 days counted (the duty day and the Saturday among them)
      averageHours: Math.round((57 / 7) * 60) / 60,
      hoursCounted: 57,
      daysCounted: 7,
      absences: 1,
      leaveDays: 1,
      zohoLeaveDays: 1,
      wfhDays: 1,
      odDays: 1,
      exemptDays: 0,
      extraHours: 0.5,
      offDaysWorked: 1,
      lateMinutes: 80,
    });
    expect([clockText(f.averageCheckIn!), percentText(f.onTimeRate), percentText(null)]).toEqual(['9:15 AM', '67%', '—']);
    expect(historyFigures([])).toMatchObject({ attendanceRate: null, onTimeRate: null, averageCheckIn: null, averageHours: null });
  });

  it('bins the check-ins by 15 minutes, every bin from the earliest to the latest', () => {
    expect(checkInBins(DAYS)).toEqual([
      { from: 525, label: '8:45 AM', count: 1 },
      { from: 540, label: '9:00 AM', count: 2 },
      { from: 555, label: '9:15 AM', count: 1 },
      { from: 570, label: '9:30 AM', count: 0 },
      { from: 585, label: '9:45 AM', count: 0 },
      { from: 600, label: '10:00 AM', count: 1 },
    ]);
    expect(checkInBins([])).toEqual([]);
  });

  it('counts the late days by weekday, Sunday to Thursday', () => {
    expect(lateByWeekday(DAYS, [0, 1, 2, 3, 4])).toEqual([
      { weekday: 0, label: 'Sun', lateDays: 0, measuredDays: 1 },
      { weekday: 1, label: 'Mon', lateDays: 1, measuredDays: 1 },
      { weekday: 2, label: 'Tue', lateDays: 1, measuredDays: 2 },
      { weekday: 3, label: 'Wed', lateDays: 0, measuredDays: 2 },
      { weekday: 4, label: 'Thu', lateDays: 0, measuredDays: 0 },
    ]);
  });

  it('trends on time by month, by quarter over 12 months', () => {
    expect(historyTrend(DAYS, RANGE)).toEqual([
      { key: '2026-11', label: 'Nov 2026', from: '2026-11-01', to: '2026-11-12', measuredDays: 6, onTimeDays: 4, onTimeRate: 4 / 6, expectedDays: 7, attendedDays: 6, attendanceRate: 6 / 7 },
    ]);
    const long = { from: '2025-01-15', to: '2026-11-12' };
    expect(trendByQuarter(long)).toBe(true);
    expect(trendByQuarter({ from: '2026-01-01', to: '2026-12-31' })).toBe(false);
    const quarters = historyTrend(DAYS, long);
    expect(quarters.map((q) => q.label)).toEqual(['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
    expect(quarters[0]).toMatchObject({ from: '2025-01-15', to: '2025-03-31', onTimeRate: null });
    expect(quarters.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-11-12', onTimeDays: 4, measuredDays: 6 });
  });
});

describe('the history’s period', () => {
  const TODAY = '2026-11-12';
  it('runs to today, never before they joined', () => {
    expect(historyRange('this_month', TODAY, '2024-03-10')).toEqual({ from: '2026-11-01', to: TODAY });
    expect(historyRange('last_3_months', TODAY, '2024-03-10')).toEqual({ from: '2026-09-01', to: TODAY });
    expect(historyRange('this_year', TODAY, '2024-03-10')).toEqual({ from: '2026-01-01', to: TODAY });
    expect(historyRange('since_joining', TODAY, '2024-03-10')).toEqual({ from: '2024-03-10', to: TODAY });
    // joined this month: from the join date
    expect(historyRange('last_3_months', TODAY, '2026-11-05')).toEqual({ from: '2026-11-05', to: TODAY });
    expect(historyRange('custom', TODAY, '2024-03-10', { from: '2023-01-01', to: '2027-01-01' })).toEqual({ from: '2024-03-10', to: TODAY });
    expect(historyRange('custom', TODAY, null, { from: '2026-06-30', to: '2026-01-01' })).toEqual({ problem: "The last day can't be before the first." });
    expect(historyRange('custom', TODAY, null, {})).toEqual({ problem: 'Choose the first and the last day of the range, e.g. 2026-01-01 and 2026-06-30.' });
  });
});
