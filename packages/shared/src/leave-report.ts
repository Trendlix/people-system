// The Leave report (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"). Asked, the
// owner chose "Both" (a summary with one row per employee and a column per leave type, plus a list of each leave, on
// screen and as Excel), to also count the permission hours, the work from home days and the annual balance left, and
// "A month, or a range": one month, or From and To months, like the payroll reports. For a period of months (this month
// unless asked): the approved leave only, each leave's days inside the period counted the way the leave counts its days
// (leaveDaysBetween: working days by the employment's shift without the holidays, or calendar days for a type counted
// so; a half day is 0.5); a leave crossing a month's end counts only its days inside. Pure code: the API sends it (GET
// /reports/leave) and makes its workbook from it (GET /reports/leave.xlsx); the screens word it. Dates: YYYY-MM-DD.

import { departmentOf, periodDays, type ReportDepartment, type ReportPeriod, type ReportPerson } from './salary-raises.js';
import { leaveDaysBetween } from './leaves.js';

// ---------- the period ----------

/**
 * The period asked for (?from=&to=, months): this month when neither is sent; with one of them only, that month alone
 * ("A month, or a range"). The payroll reports start with a calendar year; this one with the month.
 */
export function requestedLeavePeriod(query: { from?: string; to?: string }, today: string): ReportPeriod {
  const month = today.slice(0, 7);
  return { from: query.from ?? query.to ?? month, to: query.to ?? query.from ?? month };
}

// ---------- what the report reads ----------

/** Where a leave came from: HR recorded it, a file or Zoho People brought it in, or the employee asked for it. */
export const LEAVE_REPORT_SOURCES = ['recorded', 'imported', 'requested'] as const;
export type LeaveReportSource = (typeof LEAVE_REPORT_SOURCES)[number];
export const LEAVE_REPORT_SOURCE_LABELS: Record<LeaveReportSource, string> = { recorded: 'Recorded by HR', imported: 'Imported', requested: 'Requested' };

/** What the report is asked for (GET /reports/leave): the period, and optionally a department or team and one employee. */
export interface LeaveReportFilters {
  period: ReportPeriod;
  /** A department (with its teams) or a team. */
  departmentId: string | null;
  employeeId: string | null;
}

/** The filters as the report says it used them: the department or team and the employee named, for the page and the workbook. */
export type LeaveReportFiltersUsed = Omit<LeaveReportFilters, 'departmentId' | 'employeeId'> & { department: ReportDepartment | null; employee: ReportPerson | null };

/** An approved leave as the report reads it, with the days the shift works and its type's way of counting. */
export interface LeaveReportSourceLeave {
  id: string;
  employee: ReportPerson;
  department: ReportDepartment | null;
  typeId: string;
  typeName: string;
  typeOrder: number;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  /** The type counts calendar days, not working days. */
  calendarDays: boolean;
  /** The leave's own days, as it counted them when made (Leave Requests, the balances). */
  days: number;
  /** The employment's shift: JS weekdays (0 Sunday … 6 Saturday); the default week when it has none. */
  workingDays: readonly number[];
  source: LeaveReportSource;
  reason: string | null;
}

/** An approved permission: a few hours of one day. */
export interface LeaveReportSourcePermission {
  employee: ReportPerson;
  department: ReportDepartment | null;
  date: string;
  hours: number;
}

/** An approved work from home day. */
export interface LeaveReportSourceWfh {
  employee: ReportPerson;
  department: ReportDepartment | null;
  date: string;
}

// ---------- each leave's days inside the period ----------

/**
 * A leave's days inside the period: the leave's own days when it lies wholly inside; otherwise its days from the first
 * day inside to the last, counted as the leave counts them (leaveDaysBetween), the half day being its last day, so in
 * the period only when that day is.
 */
export function leaveDaysInPeriod(
  leave: Pick<LeaveReportSourceLeave, 'startDate' | 'endDate' | 'halfDay' | 'calendarDays' | 'days' | 'workingDays'>,
  period: ReportPeriod,
  holidays: readonly string[],
): number {
  const { start, end } = periodDays(period);
  const from = leave.startDate > start ? leave.startDate : start;
  const to = leave.endDate < end ? leave.endDate : end;
  if (from > to) return 0;
  if (from === leave.startDate && to === leave.endDate) return leave.days;
  return leaveDaysBetween(from, to, { workingDays: leave.workingDays, holidays, calendarDays: leave.calendarDays, halfDay: leave.halfDay && to === leave.endDate });
}

// ---------- the report ----------

/** A leave type that has days in the period: a column of the summary. */
export interface LeaveReportType {
  id: string;
  nameEn: string;
}

/** One employee of the summary: their days of each type, permission hours, work from home days and annual balance. */
export interface LeaveReportPerson {
  employee: ReportPerson;
  department: ReportDepartment | null;
  /** Days in the period by leave type id; only the types they took. */
  days: Record<string, number>;
  /** All their leave days in the period. */
  leaveDays: number;
  permissionHours: number;
  wfhDays: number;
  /** The annual balance left at the period's end (or today); null when the person has none (outside the labour law). */
  annualLeft: number | null;
}

/** One leave of the list: an approved leave overlapping the period. */
export interface LeaveReportLeave {
  id: string;
  employee: ReportPerson;
  department: ReportDepartment | null;
  typeId: string;
  typeName: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  /** Its days inside the period. */
  daysInPeriod: number;
  /** All its days. */
  days: number;
  source: LeaveReportSource;
  reason: string | null;
}

/** The sums of some people's rows. */
export interface LeaveReportTotals {
  people: number;
  byType: Record<string, number>;
  leaveDays: number;
  permissionHours: number;
  wfhDays: number;
}

/** GET /reports/leave, less the moment it was made and the C-level people left out. */
export interface LeaveReport {
  filters: LeaveReportFiltersUsed;
  /** The types with days in the period, in Leave Setup's order. */
  types: LeaveReportType[];
  people: LeaveReportPerson[];
  leaves: LeaveReportLeave[];
  totals: LeaveReportTotals;
}

/** To a tenth: half days and permission hours without the noise of fractions. */
const tenth = (n: number) => Math.round(n * 10 + 1e-9) / 10 + 0;

/** The sums of these people's rows (a group's subtotal, or the grand total). */
export function leaveReportTotals(people: readonly Pick<LeaveReportPerson, 'days' | 'leaveDays' | 'permissionHours' | 'wfhDays'>[]): LeaveReportTotals {
  const byType: Record<string, number> = {};
  for (const p of people) for (const [id, n] of Object.entries(p.days)) byType[id] = tenth((byType[id] ?? 0) + n);
  return {
    people: people.length,
    byType,
    leaveDays: tenth(people.reduce((n, p) => n + p.leaveDays, 0)),
    permissionHours: tenth(people.reduce((n, p) => n + p.permissionHours, 0)),
    wfhDays: people.reduce((n, p) => n + p.wfhDays, 0),
  };
}

export interface LeaveReportInput {
  period: ReportPeriod;
  leaves: readonly LeaveReportSourceLeave[];
  permissions: readonly LeaveReportSourcePermission[];
  wfh: readonly LeaveReportSourceWfh[];
  /** The official holidays in the period's days, YYYY-MM-DD. */
  holidays: readonly string[];
  /** The annual balance left by employee id; a person without one (outside the labour law, or none known) is null. */
  annualLeft: ReadonlyMap<string, number | null>;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/**
 * The summary and the list for these approved leaves, permissions and work from home days: the people with any of them
 * in the period (one row each, by name), the types with days in it, the list of the leaves overlapping it (by first
 * day, then employee code) and the grand total.
 */
export function leaveReport(input: LeaveReportInput): Pick<LeaveReport, 'types' | 'people' | 'leaves' | 'totals'> {
  const people = new Map<string, LeaveReportPerson>();
  const personOf = (employee: ReportPerson, department: ReportDepartment | null): LeaveReportPerson => {
    let p = people.get(employee.id);
    if (!p) {
      p = { employee, department, days: {}, leaveDays: 0, permissionHours: 0, wfhDays: 0, annualLeft: input.annualLeft.get(employee.id) ?? null };
      people.set(employee.id, p);
    }
    return p;
  };

  const types = new Map<string, { type: LeaveReportType; order: number }>();
  const leaves: LeaveReportLeave[] = [];
  for (const l of input.leaves) {
    const inside = leaveDaysInPeriod(l, input.period, input.holidays);
    // overlapping the period is the caller's to have asked; a leave wholly outside it has no place here
    const { start, end } = periodDays(input.period);
    if (l.startDate > end || l.endDate < start) continue;
    leaves.push({
      id: l.id,
      employee: l.employee,
      department: l.department,
      typeId: l.typeId,
      typeName: l.typeName,
      startDate: l.startDate,
      endDate: l.endDate,
      halfDay: l.halfDay,
      daysInPeriod: inside,
      days: l.days,
      source: l.source,
      reason: l.reason,
    });
    const p = personOf(l.employee, l.department);
    if (inside > 0) {
      p.days[l.typeId] = tenth((p.days[l.typeId] ?? 0) + inside);
      p.leaveDays = tenth(p.leaveDays + inside);
      types.set(l.typeId, { type: { id: l.typeId, nameEn: l.typeName }, order: l.typeOrder });
    }
  }
  for (const x of input.permissions) {
    const p = personOf(x.employee, x.department);
    p.permissionHours = tenth(p.permissionHours + x.hours);
  }
  for (const x of input.wfh) {
    const p = personOf(x.employee, x.department);
    p.wfhDays += 1;
  }

  const rows = [...people.values()].sort((a, b) => byName(a.employee.fullNameEn, b.employee.fullNameEn) || a.employee.employeeCode.localeCompare(b.employee.employeeCode));
  return {
    types: [...types.values()].sort((a, b) => a.order - b.order || byName(a.type.nameEn, b.type.nameEn)).map((t) => t.type),
    people: rows,
    leaves: leaves.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employee.employeeCode.localeCompare(b.employee.employeeCode) || a.endDate.localeCompare(b.endDate)),
    totals: leaveReportTotals(rows),
  };
}

// ---------- the groups ----------

/** A team's people, or the department's own (team null). */
export interface LeaveReportTeam {
  team: string | null;
  people: LeaveReportPerson[];
  totals: LeaveReportTotals;
}

/** A department's people: its own first, then each team's; department null for those without one. */
export interface LeaveReportDepartment {
  department: string | null;
  teams: LeaveReportTeam[];
  totals: LeaveReportTotals;
}

/** The team a place is, if it is one: its own name (a department has none). */
const teamOf = (d: ReportDepartment | null) => (d?.parent ? d.nameEn : null);

/**
 * The people by department, then team, as the lists group them: departments by name, those without one last; in each,
 * the department's own people first, then its teams by name; with each group's totals.
 */
export function leaveReportGroups(people: readonly LeaveReportPerson[]): LeaveReportDepartment[] {
  const departments = new Map<string | null, Map<string | null, LeaveReportPerson[]>>();
  for (const p of people) {
    const department = departmentOf(p.department)?.nameEn ?? null;
    const teams = departments.get(department) ?? new Map<string | null, LeaveReportPerson[]>();
    departments.set(department, teams);
    const team = teamOf(p.department);
    teams.set(team, [...(teams.get(team) ?? []), p]);
  }
  return [...departments.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : byName(a, b)))
    .map(([department, teams]) => {
      const sorted = [...teams.entries()]
        .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : byName(a, b)))
        .map(([team, list]) => ({ team, people: list, totals: leaveReportTotals(list) }));
      return { department, teams: sorted, totals: leaveReportTotals(sorted.flatMap((t) => t.people)) };
    });
}
