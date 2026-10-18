import { describe, expect, it } from 'vitest';
import type { LeaveCalendarEntry } from '../../../lib/types';
import {
  calendarAgenda,
  calendarDays,
  calendarPath,
  calendarPeople,
  monthRange,
  monthTitle,
  nextMonth,
  offPerDay,
  offThisMonthText,
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
