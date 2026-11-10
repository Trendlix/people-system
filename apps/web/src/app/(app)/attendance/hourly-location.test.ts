import { describe, expect, it } from 'vitest';
import type { DayPingsPerson, DayPingsView, PingView } from '@trendlix/shared';
import { dailyHref, readFilters } from './attendance';
import { hourlyDayNav, hourlyDayOf, hourlyPeople, hourlySummary, noPingsText, opensFlagged, pingChip, stayText } from './hourly-location';

// The hourly location on Daily Attendance (owner, 10 November 2026: "the hourly ping is not working too, i cant find it
// in the system", then "can it be embeded in the attendance page?").

const ping = (at: string, status: PingView['status'], more: Partial<PingView> = {}): PingView => ({
  at,
  status,
  placeText: 'Office',
  distanceMetres: null,
  accuracyMetres: 12,
  latitude: null,
  longitude: null,
  ...more,
});

const person = (id: string, more: Partial<DayPingsPerson> = {}): DayPingsPerson => ({
  employee: { id, fullNameEn: `Person ${id}`, employeeCode: `EMP-${id}`, department: 'Design' },
  checkIn: '2026-11-10T07:02:00Z',
  checkOut: null,
  checkInPlace: 'Office',
  pings: [],
  flagged: 0,
  noPings: 'iphone',
  ...more,
});

describe('the day shown', () => {
  it('today in this month, else the month’s last day; one asked within the month and not to come', () => {
    expect(hourlyDayOf('2026-11', null, '2026-11-10')).toBe('2026-11-10');
    expect(hourlyDayOf('2026-10', null, '2026-11-10')).toBe('2026-10-31');
    expect(hourlyDayOf('2026-12', null, '2026-11-10')).toBeNull();
    expect(hourlyDayOf('2026-11', '2026-11-03', '2026-11-10')).toBe('2026-11-03');
    // not to come, nor in another month
    expect(hourlyDayOf('2026-11', '2026-11-12', '2026-11-10')).toBe('2026-11-10');
    expect(hourlyDayOf('2026-11', '2026-10-30', '2026-11-10')).toBe('2026-11-10');
  });

  it('the day before and after, within the month, never to come', () => {
    expect(hourlyDayNav('2026-11', '2026-11-10', '2026-11-10')).toEqual({ prev: '2026-11-09', next: null });
    expect(hourlyDayNav('2026-11', '2026-11-01', '2026-11-10')).toEqual({ prev: null, next: '2026-11-02' });
    expect(hourlyDayNav('2026-10', '2026-10-31', '2026-11-10')).toEqual({ prev: '2026-10-30', next: null });
  });

  it('is kept in the page’s address, apart from the other filters', () => {
    const f = readFilters({ day: '2026-11-03', department: 'nope' });
    expect(f.day).toBe('2026-11-03');
    expect(readFilters({ day: '3 Nov' }).day).toBeUndefined();
    expect(dailyHref('2026-11', { day: '2026-11-03' })).toBe('/attendance?month=2026-11&day=2026-11-03');
  });
});

describe('the people and their pings', () => {
  const view: DayPingsView = {
    date: '2026-11-10',
    enabled: true,
    people: [
      person('a', { pings: [ping('2026-11-10T08:02:00Z', 'at_place'), ping('2026-11-10T09:03:00Z', 'away', { distanceMetres: 1240 })], flagged: 1, noPings: null }),
      person('b', { pings: [ping('2026-11-10T08:05:00Z', 'at_place')], noPings: null }),
      person('c'),
    ],
  };

  it('keeps to those the page’s filters list', () => {
    expect(hourlyPeople(view, null).map((p) => p.employee.id)).toEqual(['a', 'b', 'c']);
    expect(hourlyPeople(view, new Set(['b', 'c'])).map((p) => p.employee.id)).toEqual(['b', 'c']);
  });

  it('says the day in a line while closed, and opens by itself when something is flagged', () => {
    expect(hourlySummary(view.people)).toBe('3 checked in · 1 flagged · 1 without pings');
    expect(hourlySummary([view.people[1]])).toBe('1 checked in · none flagged');
    expect(hourlySummary([])).toBe('Nobody checked in on the system');
    expect(opensFlagged(view.people)).toBe(true);
    expect(opensFlagged(view.people.slice(1))).toBe(false);
  });

  it('each ping in a few words, the flagged in the warning colour', () => {
    expect(pingChip(ping('2026-11-10T08:02:00Z', 'at_place'))).toEqual({ text: '10:02 AM · At the place', tone: 'ok' });
    expect(pingChip(ping('2026-11-10T09:03:00Z', 'away', { distanceMetres: 1240 }))).toEqual({ text: '11:03 AM · Away 1.2 km', tone: 'warn' });
    expect(pingChip(ping('2026-11-10T10:00:00Z', 'away', { distanceMetres: 450 })).text).toBe('12:00 PM · Away 450 m');
    expect(pingChip(ping('2026-11-10T11:00:00Z', 'off', { placeText: 'Location not allowed all the time' }))).toEqual({
      text: '1:00 PM · Location not allowed all the time',
      tone: 'warn',
    });
    expect(pingChip(ping('2026-11-10T12:00:00Z', 'unknown')).tone).toBe('muted');
  });

  it('their day, and why there are none', () => {
    expect(stayText(person('a'))).toBe('In 9:02 AM · Office · still in');
    expect(stayText(person('a', { checkOut: '2026-11-10T15:10:00Z' }))).toBe('In 9:02 AM · Office · Out 5:10 PM');
    expect(noPingsText(person('c'))).toBe('iPhone: hourly location not on iPhones yet');
    expect(noPingsText(person('d', { noPings: 'no_app' }))).toBe('Doesn’t use the app: the website can’t send it');
  });
});
