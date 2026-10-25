import { describe, expect, it } from 'vitest';
import type { LeaveCalendarEntry } from '../../../lib/types';
import type { OdCalendarItem } from '../../../lib/od-types';
import {
  calendarAgenda,
  calendarDays,
  calendarPath,
  calendarPeople,
  cellLabel,
  monthRange,
  monthSummaryText,
  monthTitle,
  nextMonth,
  odCellWords,
  offPerDay,
  offThisMonthText,
  permissionCellText,
  permissionCellWords,
  previousMonth,
  readDepartment,
  readMonth,
  typeLetters,
} from './calendar';

// invented people
const DEPT = '0b8f2c1e-1111-4222-8333-444455556666';

const entry = (e: Partial<LeaveCalendarEntry> & { who?: string }): LeaveCalendarEntry => ({
  id: `r-${e.who ?? 'nour'}-${e.startDate}`,
  employee: { id: e.who ?? 'nour', fullNameEn: e.who === 'karim' ? 'Karim Nabil' : 'Nour Adel', department: 'Marketing', team: e.who === 'karim' ? null : 'Content Team' },
  type: { nameEn: 'Annual leave' },
  startDate: '2026-10-05',
  endDate: '2026-10-06',
  halfDay: false,
  status: 'approved',
  ...e,
});

describe('the month of the calendar (owner, 18 October 2026)', () => {
  it('is the address’s, else this month', () => {
    expect(readMonth({ month: '2026-11' }, '2026-10-18')).toBe('2026-11');
    expect(readMonth({ month: '2026-13' }, '2026-10-18')).toBe('2026-10');
    expect(readMonth({ month: 'soon' }, '2026-10-18')).toBe('2026-10');
    expect(readMonth({}, '2026-10-18')).toBe('2026-10');
    expect(readDepartment({ department: DEPT })).toBe(DEPT);
    expect(readDepartment({ department: 'x' })).toBeNull();
  });

  it('runs from its first to its last day, and moves a month at a time', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(calendarPath('2026-10')).toBe('/leave/calendar?from=2026-10-01&to=2026-10-31');
    expect(calendarPath('2026-10', DEPT)).toBe(`/leave/calendar?from=2026-10-01&to=2026-10-31&departmentId=${DEPT}`);
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(monthTitle('2026-10')).toBe('October 2026');
  });

  it('has each day with its weekday, the holidays on it and today', () => {
    const days = calendarDays('2026-10', [{ date: '2026-10-06', nameEn: 'Armed Forces Day', nameAr: 'عيد القوات المسلحة' }], '2026-10-18');
    expect(days).toHaveLength(31);
    expect(days[0]).toMatchObject({ date: '2026-10-01', day: 1, weekday: 'Thu', weekdayName: 'Thursday', holidays: [], today: false });
    expect(days[5].holidays).toEqual([{ nameEn: 'Armed Forces Day', nameAr: 'عيد القوات المسلحة' }]);
    expect(days[17].today).toBe(true);
  });
});

describe('who is off', () => {
  const days = calendarDays('2026-10', [], '2026-10-18');

  it('is everyone with leave in the month, by name, each with their leave on each day', () => {
    const people = calendarPeople(
      [
        entry({ who: 'nour', startDate: '2026-10-05', endDate: '2026-10-06' }),
        entry({ who: 'karim', startDate: '2026-10-06', endDate: '2026-10-06', halfDay: true, type: { nameEn: 'Casual leave' } }),
        // rejected and cancelled leave isn't shown
        entry({ who: 'nour', startDate: '2026-10-20', endDate: '2026-10-21', status: 'rejected' }),
      ],
      days,
    );
    expect(people.map((p) => [p.name, p.place, p.daysOff])).toEqual([
      ['Karim Nabil', 'Marketing', 0.5],
      ['Nour Adel', 'Marketing › Content Team', 2],
    ]);
    const nour = people[1];
    expect(nour.cells[3]).toBeNull();
    expect(nour.cells[4]).toMatchObject({ typeName: 'Annual leave', waiting: false, first: true, last: false, requestId: 'r-nour-2026-10-05' });
    expect(nour.cells[5]).toMatchObject({ first: false, last: true });
    expect(people[0].cells[5]).toMatchObject({ typeName: 'Casual leave', halfDay: true });
    // a day off each, Karim's half: 1.5 on the 6th
    expect(offPerDay(people, days.length).slice(3, 7)).toEqual([0, 1, 1.5, 0]);
  });

  it('shows the approved leave over one still being decided on the same day, and a leave running past the month cut at its end', () => {
    const people = calendarPeople(
      [
        entry({ startDate: '2026-10-29', endDate: '2026-11-03', status: 'with_hr', type: { nameEn: 'Unpaid leave' } }),
        entry({ startDate: '2026-10-30', endDate: '2026-10-30', status: 'approved' }),
      ],
      days,
    );
    expect(people[0].cells[28]).toMatchObject({ typeName: 'Unpaid leave', waiting: true });
    expect(people[0].cells[29]).toMatchObject({ typeName: 'Annual leave', waiting: false });
    // the last day of the month ends the bar
    expect(people[0].cells[30]).toMatchObject({ typeName: 'Unpaid leave', last: true });
    expect(people[0].daysOff).toBe(3);
  });

  it('reads as a list of days on a phone: the days someone is off or a holiday falls on', () => {
    const withHoliday = calendarDays('2026-10', [{ date: '2026-10-06', nameEn: 'Armed Forces Day', nameAr: null }], '2026-10-18');
    const people = calendarPeople([entry({ startDate: '2026-10-05', endDate: '2026-10-05' })], withHoliday);
    const agenda = calendarAgenda(people, withHoliday);
    expect(agenda.map((a) => [a.day.date, a.off.map((o) => o.name), a.day.holidays.map((h) => h.nameEn)])).toEqual([
      ['2026-10-05', ['Nour Adel'], []],
      ['2026-10-06', [], ['Armed Forces Day']],
    ]);
  });

  it('marks each type with a letter of its own, and says how many are off', () => {
    expect([...typeLetters(['Annual leave', 'Sick leave', 'Annual leave', 'Absence'])]).toEqual([
      ['Annual leave', 'A'],
      ['Sick leave', 'S'],
      ['Absence', 'Ab'],
    ]);
    expect(offThisMonthText(0)).toBe('No one off this month');
    expect(offThisMonthText(1)).toBe('1 person off this month');
    expect(offThisMonthText(3)).toBe('3 people off this month');
  });
});

describe('permission on the calendar (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day"; as hours)', () => {
  const days = calendarDays('2026-11', [], '2026-10-19');
  const permission = (e: Partial<LeaveCalendarEntry> & { who?: string }) =>
    entry({ kind: 'permission', type: { nameEn: 'Permission' }, startDate: '2026-11-03', endDate: '2026-11-03', halfDay: false, hours: 2, fromTime: '17:00', toTime: '19:00', ...e });

  it('marks its day with its hours, not as a day off; someone with only permission still has a row', () => {
    const people = calendarPeople([permission({ who: 'karim' }), entry({ who: 'nour', startDate: '2026-11-04', endDate: '2026-11-05' })], days);
    expect(people.map((p) => [p.name, p.daysOff, p.permissionHours])).toEqual([
      ['Karim Nabil', 0, 2],
      ['Nour Adel', 2, 0],
    ]);
    const cell = people[0].cells[2]!;
    expect(cell).toMatchObject({ typeName: 'Permission', halfDay: false, waiting: false, first: true, last: true, requestId: 'r-karim-2026-11-03' });
    expect(cell.permission).toEqual({ hours: 2, fromTime: '17:00', toTime: '19:00' });
    expect(permissionCellText(cell.permission!)).toBe('2:00');
    // permission isn't counted among those off
    expect(offPerDay(people, days.length).slice(2, 5)).toEqual([0, 1, 1]);
    expect(monthSummaryText(people)).toBe('1 person off this month, 1 with permission');
    expect(monthSummaryText([])).toBe('No one off this month');
  });

  it('says what it is to those who can’t see the grid: the hours, the times, approved or being decided', () => {
    const [karim] = calendarPeople([permission({ who: 'karim' })], days);
    expect(cellLabel(karim.cells[2]!, karim.name, days[2])).toBe('Karim Nabil: Permission, 2 hours, 5:00 PM – 7:00 PM, approved, Tuesday 03/11/2026');
    const [waiting] = calendarPeople([permission({ who: 'karim', status: 'with_manager', hours: 1.5, fromTime: null, toTime: null })], days);
    expect(cellLabel(waiting.cells[2]!, waiting.name, days[2])).toBe('Karim Nabil: Permission, 1 hour 30 minutes, being decided, Tuesday 03/11/2026');
    expect(permissionCellWords('Permission', { hours: 0.5, fromTime: '09:00', toTime: null })).toBe('Permission, 30 minutes, from 9:00 AM');
    // a leave day says it as before
    const [nour] = calendarPeople([entry({ startDate: '2026-11-04', endDate: '2026-11-04', halfDay: true, status: 'with_hr' })], days);
    expect(cellLabel(nour.cells[3]!, nour.name, days[3])).toBe('Nour Adel: Annual leave, half a day, being decided, Wednesday 04/11/2026');
  });

  it('names the colleague who covers a leave on hover and in the phone’s list (25 October 2026)', () => {
    const covered = entry({ startDate: '2026-11-04', endDate: '2026-11-05', cover: { id: 'sara', fullNameEn: 'Sara Ali' } });
    const [nour] = calendarPeople([covered], days);
    expect(nour.cells[3]).toMatchObject({ cover: 'Sara Ali' });
    expect(cellLabel(nour.cells[3]!, nour.name, days[3])).toBe('Nour Adel: Annual leave, covered by Sara Ali, Wednesday 04/11/2026');
    expect(calendarAgenda([nour], days).find((d) => d.day.date === '2026-11-04')!.off[0]).toMatchObject({ name: 'Nour Adel', cover: 'Sara Ali' });
    // nobody named: as before
    const [plain] = calendarPeople([entry({ startDate: '2026-11-04', endDate: '2026-11-04', cover: null })], days);
    expect(plain.cells[3]).not.toHaveProperty('cover');
  });

  it('gives way to leave on the same day, and two of a day show their hours together', () => {
    const [nour] = calendarPeople([permission({}), entry({ startDate: '2026-11-03', endDate: '2026-11-03' })], days);
    expect(nour.cells[2]).toMatchObject({ typeName: 'Annual leave', permission: null });
    expect([nour.daysOff, nour.permissionHours]).toEqual([1, 0]);
    const [twice] = calendarPeople([permission({ hours: 1, fromTime: '09:00', toTime: '10:00' }), permission({ id: 'r-2', hours: 0.5, fromTime: '17:00', toTime: '17:30' })], days);
    expect(twice.cells[2]?.permission).toEqual({ hours: 1.5, fromTime: null, toTime: null });
    expect(twice.permissionHours).toBe(1.5);
    // an approved one over one being decided, as leave
    const [approved] = calendarPeople([permission({ status: 'with_hr', hours: 1 }), permission({ id: 'r-3', hours: 2 })], days);
    expect(approved.cells[2]).toMatchObject({ waiting: false, permission: { hours: 2 } });
  });

  it('reads on a phone with its hours and times, opening its own request', () => {
    const people = calendarPeople([permission({ who: 'karim' })], days);
    const agenda = calendarAgenda(people, days);
    expect(agenda.map((a) => [a.day.date, a.off.map((o) => [o.name, o.permission?.hours, o.requestId])])).toEqual([['2026-11-03', [['Karim Nabil', 2, 'r-karim-2026-11-03']]]]);
  });

  it('isn’t shown rejected or cancelled', () => {
    expect(calendarPeople([permission({ status: 'rejected' }), permission({ status: 'cancelled' })], days)).toEqual([]);
  });
});

describe('official duty on the calendar (owner, 23 October 2026: "Official duty (OD) requests"; the spec: "Team calendar shows leave and OD")', () => {
  const days = calendarDays('2026-11', [], '2026-10-23');
  const od = (e: Partial<OdCalendarItem> & { who?: string } = {}): OdCalendarItem => ({
    id: `od-${e.who ?? 'nour'}`,
    kind: 'od',
    employee: { id: e.who ?? 'nour', fullNameEn: e.who === 'karim' ? 'Karim Nabil' : 'Nour Adel', department: 'Marketing', team: null },
    type: { id: 'od', nameEn: 'Official duty', nameAr: 'مأمورية' },
    startDate: '2026-11-02',
    endDate: '2026-11-03',
    halfDay: false,
    fullDay: true,
    fromTime: null,
    toTime: null,
    status: 'approved',
    ...e,
  });

  it('marks each of its days apart, not as a day off, counted on its own; part of a day with its times', () => {
    const people = calendarPeople([od({}), od({ who: 'karim', startDate: '2026-11-04', endDate: '2026-11-04', fullDay: false, fromTime: '10:00', toTime: '14:00' })], days);
    expect(people.map((p) => [p.name, p.daysOff, p.odDays])).toEqual([
      ['Karim Nabil', 0, 1],
      ['Nour Adel', 0, 2],
    ]);
    expect(people[1].cells[1]).toMatchObject({ typeName: 'Official duty', od: { times: null }, first: true, last: true, requestId: 'od-nour' });
    expect(offPerDay(people, days.length).slice(1, 4)).toEqual([0, 0, 0]);
    expect(cellLabel(people[0].cells[3]!, 'Karim Nabil', days[3])).toBe('Karim Nabil: Official duty, 10:00 AM–2:00 PM, approved, Wednesday 04/11/2026');
    expect(odCellWords({ times: null })).toBe('Official duty');
    expect(monthSummaryText(people)).toBe('No one off this month, 2 on official duty');
    // on a phone, with its words
    expect(calendarAgenda(people, days)[0].off[0]).toMatchObject({ name: 'Nour Adel', od: { times: null } });
  });

  it('gives way to leave on the same day, and isn’t shown rejected or cancelled', () => {
    const [nour] = calendarPeople([od({}), entry({ startDate: '2026-11-02', endDate: '2026-11-02' })], days);
    expect(nour.cells[1]).toMatchObject({ typeName: 'Annual leave' });
    expect(nour.cells[1]?.od).toBeUndefined();
    expect(nour.odDays).toBe(1);
    expect(calendarPeople([od({ status: 'rejected' }), od({ status: 'cancelled' })], days)).toEqual([]);
  });
});
