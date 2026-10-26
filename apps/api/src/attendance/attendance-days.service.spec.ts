import { compensatoryDays, exemptDays, officialDutyDays, wfhFullDays, zonedMoment, type DayOfficialDuty, type SourcedDay } from '@trendlix/shared';
import { ownDays } from './attendance-days.service.js';

// A month's days as the system's own, so a draft payroll line is filled from them (attendance-days.service.ts ownDays,
// read by attendance-fill.service.ts). A month made only of Zoho's Excel-imported days is left to its import, but once the
// system reads a day of it over — an approved work from home day with no check-in (owner, 26 October 2026: "Full day,
// always"), an approved official duty (23 October 2026: "OD counted as attended") or a compensatory day (26 October 2026)
// — the line is filled from the days, hours and all: before 26 October 2026 those days kept the source 'zoho' and never
// reached the line. The dates are September 2026's, as the owner's case was; every person is made up.

const MONTH = '2026-09';
const SUNDAY = '2026-09-27'; // a Sunday: a working day of the shift, the day approved at home
const SATURDAY = '2026-09-26'; // a rest day
const at = (day: string, time: string) => new Date(zonedMoment(day, time)).toISOString();
// no check-in on the system ever (checkInFrom null): only Zoho's import keeps their days
const ctx = { month: MONTH, today: '2026-10-25', checkInFrom: null, workingDays: [0, 1, 2, 3, 4], holidays: [], leaveDays: [], employedFrom: '2026-01-01', employedTo: null, hoursADay: 9 };
const duty = (over: Partial<DayOfficialDuty> = {}): DayOfficialDuty => ({ requestId: 'od-1', fullDay: true, fromTime: null, toTime: null, hours: 9, ...over });
const odCtx = { today: ctx.today, checkInFrom: null, employedFrom: ctx.employedFrom, employedTo: null, shift: null };

/** A day as Zoho's Excel import kept it: absent, unless said otherwise. */
const zoho = (date: string, over: Partial<SourcedDay> = {}): SourcedDay => ({
  date,
  status: 'absent',
  checkIn: null,
  checkOut: null,
  place: null,
  zohoStatus: 'Absent',
  permissionHours: 0,
  hoursCounted: 0,
  source: 'zoho',
  flags: [],
  ...over,
});
const present = (date: string) => zoho(date, { status: 'worked', zohoStatus: 'Present', checkIn: at(date, '09:00'), checkOut: at(date, '18:00'), place: 'office', hoursCounted: 9 });
// a week of September's import: present but the Sunday, absent, with nothing of the system's
const excel = [present('2026-09-23'), present('2026-09-24'), zoho(SUNDAY), present('2026-09-28'), present('2026-09-29')];

describe('a month’s days as the system’s own', () => {
  it('is not a month of only Zoho’s imported days, nor one without days', () => {
    expect(ownDays([])).toBe(false);
    expect(ownDays(excel)).toBe(false);
  });

  it('is a month with a day of the system’s own: a check-in on the system or a device, a correction', () => {
    expect(ownDays([...excel, zoho('2026-09-30', { source: 'system', status: 'worked', hoursCounted: 9 })])).toBe(true);
    expect(ownDays([zoho('2026-09-30', { source: 'device' })])).toBe(true);
    expect(ownDays([zoho('2026-09-30', { source: 'correction' })])).toBe(true);
  });

  it('is a Zoho-only month with an approved work from home day read full over its absent day, not one without', () => {
    const withWfh = wfhFullDays(excel, [SUNDAY], ctx);
    expect(withWfh.find((d) => d.date === SUNDAY)).toMatchObject({ source: 'zoho', status: 'worked', hoursCounted: 9, wfhDay: true });
    expect(ownDays(withWfh)).toBe(true);
    // the day approved but pressed on Zoho: Zoho's figures stand, nothing of the system's read over
    expect(ownDays(wfhFullDays([present(SUNDAY)], [SUNDAY], ctx))).toBe(false);
    // approved a day the import has no row for: with no check-in on the system yet, no day is added
    expect(ownDays(wfhFullDays(excel, ['2026-09-30'], ctx))).toBe(false);
    expect(ownDays(wfhFullDays(excel, [], ctx))).toBe(false);
  });

  it('is a Zoho-only month with an approved official duty on a day, not one without', () => {
    const withDuty = officialDutyDays(excel, new Map([[SUNDAY, duty()]]), odCtx);
    expect(withDuty.find((d) => d.date === SUNDAY)).toMatchObject({ source: 'zoho', status: 'worked', hoursCounted: 9, od: duty() });
    expect(ownDays(withDuty)).toBe(true);
    // part of a day, over a day present on Zoho: the duty is kept on the day, so the line is filled from the days
    const part = duty({ fullDay: false, fromTime: '10:00', toTime: '12:00', hours: 2 });
    expect(ownDays(officialDutyDays(excel, new Map([['2026-09-28', part]]), odCtx))).toBe(true);
    expect(ownDays(officialDutyDays(excel, new Map(), odCtx))).toBe(false);
  });

  it('is a Zoho-only month with a compensatory day off, or the day worked it compensates, not one without', () => {
    const dayOff = compensatoryDays([...excel, present(SATURDAY)], { ...ctx, daysOff: [SUNDAY], daysWorked: [SATURDAY] });
    expect(dayOff.find((d) => d.date === SUNDAY)).toMatchObject({ source: 'zoho', status: 'worked', hoursCounted: 9, compensatory: true, exempt: true });
    expect(dayOff.find((d) => d.date === SATURDAY)).toMatchObject({ compensated: true });
    expect(ownDays(dayOff)).toBe(true);
    // paid in cash instead: the day worked's hours are left out of the month, so the line is filled from the days too
    const cash = compensatoryDays([...excel, present(SATURDAY)], { ...ctx, daysOff: [], daysWorked: [SATURDAY] });
    expect(cash.find((d) => d.date === SATURDAY)).toMatchObject({ compensated: true });
    expect(cash.find((d) => d.date === SUNDAY)).toMatchObject({ status: 'absent' });
    expect(ownDays(cash)).toBe(true);
    expect(ownDays(compensatoryDays([...excel, present(SATURDAY)], { ...ctx, daysOff: [], daysWorked: [] }))).toBe(false);
  });

  it('is an exempt person’s month (25 October 2026), as before', () => {
    expect(ownDays(exemptDays(excel, [{ startDate: '2026-09-01', endDate: null }], ctx))).toBe(true);
    expect(ownDays(exemptDays(excel, [], ctx))).toBe(false);
  });
});
