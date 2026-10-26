import {
  leaveDaysInPeriod,
  leaveReport,
  leaveReportGroups,
  leaveReportTotals,
  requestedLeavePeriod,
  type LeaveReportInput,
  type LeaveReportSourceLeave,
  type ReportDepartment,
  type ReportPerson,
} from '@trendlix/shared';

// The Leave report (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"): the period asked
// for, each leave's days inside it (working days by the shift without the holidays, calendar days for a type counted so,
// a half day), the summary's rows, types, totals and grouping. Today is 26 October 2026. Everyone here is invented.

const SUN_THU = [0, 1, 2, 3, 4];
const OCT = { from: '2026-10', to: '2026-10' };
const NOV = { from: '2026-11', to: '2026-11' };
const SALES: ReportDepartment = { id: 'd-sales', nameEn: 'Sales', parent: null };
const FIELD: ReportDepartment = { id: 'd-field', nameEn: 'Field', parent: { id: 'd-sales', nameEn: 'Sales' } };
const OPS: ReportDepartment = { id: 'd-ops', nameEn: 'Ops', parent: null };

const person = (n: number, name: string): ReportPerson => ({ id: `p${n}`, employeeCode: `EMP-00${n}`, fullNameEn: name, fullNameAr: name });
const RAMI = person(1, 'Rami');
const SARA = person(2, 'Sara');
const NOUR = person(3, 'Nour');

let ids = 0;
function leave(over: Partial<LeaveReportSourceLeave> = {}): LeaveReportSourceLeave {
  ids += 1;
  return {
    id: `l${ids}`,
    employee: RAMI,
    department: FIELD,
    typeId: 't-annual',
    typeName: 'Annual',
    typeOrder: 10,
    startDate: '2026-10-04',
    endDate: '2026-10-08',
    halfDay: false,
    calendarDays: false,
    days: 5,
    workingDays: SUN_THU,
    source: 'requested',
    reason: null,
    ...over,
  };
}

const input = (over: Partial<LeaveReportInput> = {}): LeaveReportInput => ({ period: OCT, leaves: [], permissions: [], wfh: [], holidays: [], annualLeft: new Map(), ...over });

describe('the Leave report: the period', () => {
  it('is this month unless asked; one month alone is that month; a range is as sent', () => {
    expect(requestedLeavePeriod({}, '2026-10-26')).toEqual({ from: '2026-10', to: '2026-10' });
    expect(requestedLeavePeriod({ from: '2026-03' }, '2026-10-26')).toEqual({ from: '2026-03', to: '2026-03' });
    expect(requestedLeavePeriod({ to: '2026-03' }, '2026-10-26')).toEqual({ from: '2026-03', to: '2026-03' });
    expect(requestedLeavePeriod({ from: '2026-01', to: '2026-06' }, '2026-10-26')).toEqual({ from: '2026-01', to: '2026-06' });
  });
});

describe('the Leave report: a leave’s days inside the period', () => {
  it('is its own days when it lies wholly inside', () => {
    expect(leaveDaysInPeriod(leave(), OCT, [])).toBe(5);
    expect(leaveDaysInPeriod(leave({ days: 4.5, halfDay: true }), OCT, [])).toBe(4.5);
  });

  it('counts a leave crossing the month’s end by its working days inside, the shift’s and without the holidays', () => {
    // Sun 25 Oct to Thu 5 Nov (Sun to Thu weeks): 25–29 Oct are 5 working days, 1–5 Nov 5 more
    const l = leave({ startDate: '2026-10-25', endDate: '2026-11-05', days: 10 });
    expect(leaveDaysInPeriod(l, OCT, [])).toBe(5);
    expect(leaveDaysInPeriod(l, NOV, [])).toBe(5);
    expect(leaveDaysInPeriod(l, { from: '2026-10', to: '2026-11' }, [])).toBe(10);
    // 27 October is an official holiday: not counted
    expect(leaveDaysInPeriod(l, OCT, ['2026-10-27'])).toBe(4);
    // a Monday to Friday shift: 26–30 Oct and 2–5 Nov (4 days of the 5 working)
    const monFri = leave({ startDate: '2026-10-26', endDate: '2026-11-05', days: 9, workingDays: [1, 2, 3, 4, 5] });
    expect(leaveDaysInPeriod(monFri, OCT, [])).toBe(5);
    expect(leaveDaysInPeriod(monFri, NOV, [])).toBe(4);
  });

  it('counts calendar days for a type counted so, weekends included', () => {
    const l = leave({ typeId: 't-maternity', calendarDays: true, startDate: '2026-10-28', endDate: '2026-11-03', days: 7 });
    expect(leaveDaysInPeriod(l, OCT, [])).toBe(4);
    expect(leaveDaysInPeriod(l, NOV, [])).toBe(3);
  });

  it('takes half a day off a half day leave’s last day: in the period only when that day is', () => {
    // 29 Oct to 2 Nov, the last day a half day: Thu 29 is 1, Sun 1 and Mon 2 are 1.5 (the half day)
    const l = leave({ startDate: '2026-10-29', endDate: '2026-11-02', halfDay: true, days: 2.5 });
    expect(leaveDaysInPeriod(l, OCT, [])).toBe(1);
    expect(leaveDaysInPeriod(l, NOV, [])).toBe(1.5);
    // a single half day is 0.5
    expect(leaveDaysInPeriod(leave({ startDate: '2026-10-11', endDate: '2026-10-11', halfDay: true, days: 0.5 }), OCT, [])).toBe(0.5);
  });

  it('is 0 for a leave outside the period', () => {
    expect(leaveDaysInPeriod(leave({ startDate: '2026-09-01', endDate: '2026-09-03', days: 3 }), OCT, [])).toBe(0);
    expect(leaveDaysInPeriod(leave({ startDate: '2026-12-01', endDate: '2026-12-03', days: 3 }), OCT, [])).toBe(0);
  });
});

describe('the Leave report: the summary', () => {
  it('has a row per person with the days of each type, the permission hours, the work from home days and the balance', () => {
    const r = leaveReport(
      input({
        leaves: [
          leave({ employee: RAMI, startDate: '2026-10-25', endDate: '2026-11-05', days: 10 }),
          leave({ employee: RAMI, typeId: 't-casual', typeName: 'Casual', typeOrder: 20, startDate: '2026-10-11', endDate: '2026-10-11', halfDay: true, days: 0.5 }),
          leave({ employee: SARA, department: OPS, typeId: 't-sick', typeName: 'Sick', typeOrder: 30, startDate: '2026-10-12', endDate: '2026-10-13', days: 2 }),
        ],
        permissions: [
          { employee: RAMI, department: FIELD, date: '2026-10-14', hours: 1.5 },
          { employee: RAMI, department: FIELD, date: '2026-10-15', hours: 2 },
          { employee: NOUR, department: FIELD, date: '2026-10-16', hours: 1 },
        ],
        wfh: [
          { employee: NOUR, department: FIELD, date: '2026-10-20' },
          { employee: NOUR, department: FIELD, date: '2026-10-27' },
        ],
        annualLeft: new Map([
          ['p1', 12.5],
          ['p2', 3],
        ]),
      }),
    );
    expect(r.types.map((t) => t.nameEn)).toEqual(['Annual', 'Casual', 'Sick']);
    expect(r.people.map((p) => [p.employee.fullNameEn, p.days, p.leaveDays, p.permissionHours, p.wfhDays, p.annualLeft])).toEqual([
      ['Nour', {}, 0, 1, 2, null],
      ['Rami', { 't-annual': 5, 't-casual': 0.5 }, 5.5, 3.5, 0, 12.5],
      ['Sara', { 't-sick': 2 }, 2, 0, 0, 3],
    ]);
    expect(r.totals).toEqual({ people: 3, byType: { 't-annual': 5, 't-casual': 0.5, 't-sick': 2 }, leaveDays: 7.5, permissionHours: 4.5, wfhDays: 2 });
  });

  it('leaves out the types with no days in the period, and the leaves outside it', () => {
    const r = leaveReport(
      input({
        leaves: [
          leave({ typeId: 't-sick', typeName: 'Sick', startDate: '2026-09-01', endDate: '2026-09-02', days: 2 }),
          // a leave on two weekend days overlaps the period but has no days in it: listed, no column
          leave({ typeId: 't-hajj', typeName: 'Hajj', startDate: '2026-10-09', endDate: '2026-10-10', days: 0 }),
        ],
      }),
    );
    expect(r.types).toEqual([]);
    expect(r.leaves.map((l) => [l.typeName, l.daysInPeriod])).toEqual([['Hajj', 0]]);
  });

  it('lists each leave overlapping the period with its days inside and in all, by first day', () => {
    const r = leaveReport(
      input({
        leaves: [
          leave({ employee: SARA, startDate: '2026-10-20', endDate: '2026-10-21', days: 2, source: 'imported', reason: 'Wedding' }),
          leave({ employee: RAMI, startDate: '2026-10-25', endDate: '2026-11-05', days: 10, source: 'recorded' }),
          leave({ employee: NOUR, startDate: '2026-09-28', endDate: '2026-10-01', days: 4 }),
        ],
      }),
    );
    expect(r.leaves.map((l) => [l.employee.fullNameEn, l.startDate, l.daysInPeriod, l.days, l.source, l.reason])).toEqual([
      ['Nour', '2026-09-28', 1, 4, 'requested', null],
      ['Sara', '2026-10-20', 2, 2, 'imported', 'Wedding'],
      ['Rami', '2026-10-25', 5, 10, 'recorded', null],
    ]);
  });

  it('has a row for someone with only permission or only work from home', () => {
    const r = leaveReport(input({ permissions: [{ employee: SARA, department: OPS, date: '2026-10-02', hours: 2 }] }));
    expect(r.people).toHaveLength(1);
    expect(r.types).toEqual([]);
    expect(r.totals.permissionHours).toBe(2);
  });

  it('adds halves and tenths without the noise of fractions', () => {
    const t = leaveReportTotals([
      { days: { a: 0.1 }, leaveDays: 0.1, permissionHours: 0.1, wfhDays: 0 },
      { days: { a: 0.2 }, leaveDays: 0.2, permissionHours: 0.2, wfhDays: 1 },
    ]);
    expect(t).toEqual({ people: 2, byType: { a: 0.3 }, leaveDays: 0.3, permissionHours: 0.3, wfhDays: 1 });
  });
});

describe('the Leave report: the groups', () => {
  it('groups by department, then team, with the subtotals; those without a department last', () => {
    const r = leaveReport(
      input({
        leaves: [
          leave({ employee: RAMI, department: FIELD, startDate: '2026-10-04', endDate: '2026-10-05', days: 2 }),
          leave({ employee: SARA, department: OPS, startDate: '2026-10-04', endDate: '2026-10-04', days: 1 }),
          leave({ employee: NOUR, department: SALES, startDate: '2026-10-06', endDate: '2026-10-06', days: 1 }),
          leave({ employee: person(4, 'Hana'), department: null, startDate: '2026-10-06', endDate: '2026-10-06', days: 1 }),
        ],
      }),
    );
    const groups = leaveReportGroups(r.people);
    expect(groups.map((g) => [g.department, g.teams.map((t) => [t.team, t.people.map((p) => p.employee.fullNameEn)]), g.totals.leaveDays])).toEqual([
      ['Ops', [[null, ['Sara']]], 1],
      ['Sales', [[null, ['Nour']], ['Field', ['Rami']]], 3],
      [null, [[null, ['Hana']]], 1],
    ]);
    expect(groups[1].teams[1].totals).toMatchObject({ people: 1, leaveDays: 2 });
    expect(groups.reduce((n, g) => n + g.totals.leaveDays, 0)).toBe(r.totals.leaveDays);
  });
});
