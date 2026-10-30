import { describe, expect, it } from 'vitest';
import { dayBalance, dayLabel, figureColumns, glanceOf, usualSource } from './my-days';

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
