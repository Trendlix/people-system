import { attendanceFigures, attendanceDayView, attendanceLineInputs, EMPTY_PAYROLL_INPUTS, expectedHoursOf, historyDay, payrollLine, withNoRecordDays, type PayrollInputs, type PayrollTerms, type SourcedDay } from '@trendlix/shared';

// The dates nothing was kept for (owner, 4 November 2026, of someone whose attendance comes from Zoho alone, with dates
// Zoho's file had no row for: "just record nothing but dont hide the dates"; packages/shared attendance-days.ts
// withNoRecordDays). Every person here is invented.

const kept = (date: string, over: Partial<SourcedDay> = {}): SourcedDay => ({
  date,
  status: 'worked',
  checkIn: `${date}T06:00:00.000Z`,
  checkOut: `${date}T15:00:00.000Z`,
  place: 'office',
  zohoStatus: 'Present',
  permissionHours: 0,
  hoursCounted: 9,
  source: 'zoho',
  ...over,
});

// October 2026: Sunday to Thursday, the 6th a holiday, leave on the 14th
const ctx = { month: '2026-10', today: '2026-11-04', workingDays: [0, 1, 2, 3, 4], holidays: ['2026-10-06'], leaveDays: ['2026-10-14'], employedFrom: '2025-01-01', employedTo: null };

describe('the dates nothing was kept for', () => {
  const days = withNoRecordDays([kept('2026-10-01'), kept('2026-10-25')], ctx);
  const on = (date: string) => days.find((d) => d.date === date);

  it('shows every date of the month, in order', () => {
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
  });

  it('keeps what was kept, and reads the rest by the system’s rules: a holiday, a rest day, leave, else no record', () => {
    expect(on('2026-10-01')).toMatchObject({ status: 'worked', source: 'zoho' });
    expect(on('2026-10-01')?.nothingKept).toBeUndefined();
    expect(on('2026-10-06')).toMatchObject({ status: 'holiday', nothingKept: true });
    expect(on('2026-10-02')).toMatchObject({ status: 'rest', nothingKept: true });
    expect(on('2026-10-14')).toMatchObject({ status: 'leave', nothingKept: true });
    // Monday 26 and Tuesday 27: working days Zoho's file had no row for
    expect(on('2026-10-26')).toMatchObject({ status: 'no_record', nothingKept: true, hoursCounted: 0, checkIn: null });
    expect(on('2026-10-27')?.status).toBe('no_record');
  });

  it('never before today, nor outside their employment', () => {
    const now = withNoRecordDays([kept('2026-11-02')], { ...ctx, month: '2026-11', today: '2026-11-04', holidays: [], leaveDays: [] });
    expect(now.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    const joined = withNoRecordDays([kept('2026-10-29')], { ...ctx, employedFrom: '2026-10-29', employedTo: '2026-10-31' });
    expect(joined.map((d) => d.date)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
  });

  it('leaves a month with no day at all empty: not imported yet, or before they were recorded', () => {
    expect(withNoRecordDays([], ctx)).toEqual([]);
    // a day of another month is no record of this one
    expect(withNoRecordDays([kept('2026-09-30')], ctx)).toHaveLength(1);
  });

  it('counts them apart: never absent, never recorded', () => {
    const f = attendanceFigures(days.map((d) => attendanceDayView(d, 9)));
    // the holiday, rest days and leave shown for the dates nothing was kept for aren't records either
    expect(f).toMatchObject({ daysRecorded: 2, daysWorked: 2, absentDays: 0, holidays: 0, leaveDays: 0, restDays: 0 });
    expect(f.noRecordDays).toBe(days.filter((d) => d.status === 'no_record').length);
  });

  it('says No record on the history, neither expected nor attended', () => {
    const d = on('2026-10-26')!;
    const h = historyDay({ ...attendanceDayView(d, 9), source: d.source, wfh: false, shift: null, scheduled: true });
    expect(h).toMatchObject({ mode: 'no_record', expected: false, attended: false, nothingKept: true });
  });
});

describe('the payroll', () => {
  /** 9 hours a day, 22 working days of Sunday–Thursday in the month: 198 scheduled. */
  const terms: PayrollTerms = {
    year: 2026,
    payBasis: 'monthly',
    gross: 9_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [],
    paidDays: 30,
    statutory: true,
    insured: true,
    insuredWage: 9_000,
    hoursPerDay: 9,
    expectedHours: 198,
    expectedDays: { workingDays: 22, holidays: 0 },
  };
  const inputs = (given: Partial<PayrollInputs>): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });

  it('fills the days with no record from the attendance days, on a monthly salary only', () => {
    const days = [
      { status: 'worked' as const, hoursCounted: 9, permissionHours: 0 },
      { status: 'no_record' as const, hoursCounted: 0, permissionHours: 0 },
      { status: 'no_record' as const, hoursCounted: 0, permissionHours: 0 },
    ];
    const opts = { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false };
    expect(attendanceLineInputs(days, opts)).toEqual({ workedHours: 9, noShowDays: 0, permissionHours: null, noRecordDays: 2 });
    expect(attendanceLineInputs(days.slice(0, 1), opts)).toEqual({ workedHours: 9, noShowDays: 0, permissionHours: null });
    expect(attendanceLineInputs(days, { ...opts, hourly: true })).toEqual({ workedHours: 9 });
  });

  it('takes their hours out of the expected hours: neither a cut nor a lower attendance', () => {
    // 19 days worked of the 22, 3 with no record: 171 expected, 171 worked
    expect(expectedHoursOf(terms, inputs({ noRecordDays: 3 }))).toBe(171);
    const line = payrollLine(terms, inputs({ workedHours: 171, noShowDays: 0, noRecordDays: 3 }));
    expect(line).toMatchObject({ expectedHours: 171, attendanceRatio: 1, attendanceCut: 0, noShowCut: 0 });
    expect(line.warnings).toEqual([]);
  });
});
