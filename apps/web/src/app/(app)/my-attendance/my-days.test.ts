import { describe, expect, it } from 'vitest';
import { dayBalance, dayLabel, figureColumns, glanceOf, rateTiles, usualSource, weekRangeText } from './my-days';

// My Attendance in the owner's design (30 October 2026): the month at a glance and the days' rows. Every day here is
// invented.

describe('the month at a glance', () => {
  it('puts a dot for each day on record, in date order, with what it was', () => {
    const glance = glanceOf([
      { date: '2026-10-02', status: 'rest' },
      { date: '2026-10-01', status: 'worked' },
      { date: '2026-10-08', status: 'holiday' },
      { date: '2026-10-25', status: 'leave' },
      { date: '2026-10-04', status: 'worked' },
    ]);
    expect(glance.dots.map((d) => [d.date, d.kind])).toEqual([
      ['2026-10-01', 'worked'],
      ['2026-10-02', 'rest'],
      ['2026-10-04', 'worked'],
      ['2026-10-08', 'holiday'],
      ['2026-10-25', 'leave'],
    ]);
    expect(glance.dots[0].title).toBe('Thursday 01/10/2026: Worked');
    expect(glance.dots[3].title).toBe('Thursday 08/10/2026: Official holiday');
    // the legend: only what the month has, in the design's order
    expect(glance.legend).toEqual([
      { kind: 'worked', label: 'Worked', count: 2 },
      { kind: 'rest', label: 'Rest', count: 1 },
      { kind: 'holiday', label: 'Holiday', count: 1 },
      { kind: 'leave', label: 'Leave', count: 1 },
    ]);
    expect(glance.summary).toBe('Worked 2, Rest 1, Holiday 1, Leave 1');
  });

  it('says absent days and the days for HR to check apart', () => {
    const glance = glanceOf([
      { date: '2026-10-05', status: 'absent' },
      { date: '2026-10-06', status: 'zoho_leave' },
      { date: '2026-10-07', status: 'no_check_in' },
    ]);
    expect(glance.legend.map((l) => l.label)).toEqual(['Leave in Zoho only', 'Absent', 'No check-in']);
    expect(glanceOf([]).dots).toEqual([]);
  });
});

describe('a day’s row', () => {
  it('starts with the weekday and the day, the rest of the date under it', () => {
    expect(dayLabel('2026-10-01')).toEqual({ day: 'Thu 01', rest: '/10/2026' });
    expect(dayLabel('2026-10-26')).toEqual({ day: 'Mon 26', rest: '/10/2026' });
  });

  it('balances the day: over the shift’s hours (+), short of them (−), or neither', () => {
    expect(dayBalance({ shortHours: 40 / 60, extraHours: 0 })).toEqual({ text: '−0:40', kind: 'short' });
    expect(dayBalance({ shortHours: 0, extraHours: 46 / 60 })).toEqual({ text: '+0:46', kind: 'extra' });
    expect(dayBalance({ shortHours: 0, extraHours: 0 })).toBeNull();
    // an API from before extra time
    expect(dayBalance({ shortHours: 0 })).toBeNull();
  });

  it('says where most days came from once, so a row says its own only when it differs', () => {
    expect(usualSource(['Checked in on the system', 'Zoho People', 'Checked in on the system', 'Corrected'])).toBe('Checked in on the system');
    expect(usualSource([])).toBeNull();
  });

  it('lays the month’s figures in a row up to seven, else in two rows', () => {
    expect([7, 6, 8, 9, 10, 11].map(figureColumns)).toEqual([7, 6, 4, 5, 5, 6]);
  });
});

// The attendance rate through the month (owner, 31 October 2026: "show the weekly attendance percentage and monthly
// percentage ongoing through the month"), coloured as the owner's timer (under 80% red, 80 to 90 yellow, over 90 green).
describe('the attendance rate cards', () => {
  const week = (from: string, to: string, attended: number, expected: number, current = false) => ({ from, to, attendedDays: attended, expectedDays: expected, rate: expected ? attended / expected : null, current });

  it('shows the month so far and this week, the weeks before in its note', () => {
    const tiles = rateTiles({
      month: '2026-10',
      monthToDate: { from: '2026-10-01', to: '2026-10-20', attendedDays: 12, expectedDays: 14, rate: 12 / 14 },
      weeks: [week('2026-10-01', '2026-10-03', 1, 1), week('2026-10-04', '2026-10-10', 4, 5), week('2026-10-11', '2026-10-17', 5, 5), week('2026-10-18', '2026-10-24', 2, 3, true)],
    });
    expect(tiles).toEqual([
      { key: 'rate-month', label: 'Attendance this month', value: '86%', note: '12 of 14 working days so far', tone: 'warn' },
      { key: 'rate-week', label: 'Attendance this week', value: '67%', note: '2 of 3 working days so far, 18–24 Oct. Before: 1–3 Oct 100% · 4–10 Oct 80% · 11–17 Oct 100%', tone: 'danger' },
    ]);
  });

  it('colours by the percent shown: 80 and 90 yellow, 91 green; a month gone by lists its weeks; none before it', () => {
    const month = (attended: number, expected: number) =>
      rateTiles({ month: '2026-09', monthToDate: { from: '2026-09-01', to: '2026-09-30', attendedDays: attended, expectedDays: expected, rate: attended / expected }, weeks: [week('2026-09-01', '2026-09-05', attended, expected)] })[0];
    expect(month(8, 10).tone).toBe('warn');
    expect(month(9, 10).tone).toBe('warn');
    expect(month(91, 100).tone).toBe('ok');
    expect(month(79, 100).tone).toBe('danger');
    expect(month(9, 10)).toMatchObject({ label: 'Attendance rate', note: '9 of 10 working days · 1–5 Sep 90%' });
    expect(rateTiles(null)).toEqual([]);
    expect(weekRangeText({ from: '2026-10-31', to: '2026-10-31' })).toBe('31 Oct');
  });
});
