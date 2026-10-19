import 'server-only';
import { cache } from 'react';
import type {
  EmployeeLeave,
  EmployeePermissionMonth,
  Holiday,
  LeaveBalances,
  LeaveCalendarEntry,
  LeaveRequestView,
  LeaveSettingsView,
  LeaveTypeView,
  PermissionMonthView,
  PermissionRequestView,
} from '@/lib/types';
import { loadJson, type Loaded } from '../payroll/load';
import { calendarPath } from './calendar';
import { leaveRequestsPath, WAITING_LEAVE, type LeaveFilter } from './list';
import { permissionsPath, WAITING_PERMISSIONS } from './permissions';

// Reading leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): everyone's requests for
// Requests → Leave Requests, the employee's own and their balances for My Requests and the dashboard, those waiting for
// a direct manager for My Team, one request for its page, the types and the Leave Setup, a month's calendar, and an
// employee's balances for their profile. An API from before leave answers 404, which here means "not available yet"
// rather than the 404 page, so the rest of the page keeps working. Permission requests (owner, 19 October 2026: "4 hours
// per month with a maximum 2 hours per day", asked "In the system, like leave") the same way: everyone's beside the
// leave, the employee's own and their month's hours, those waiting for the caller, one for its page, and an employee's
// month for HR's record form.

export type { Loaded };

/** GET /leave/requests (HR and the CEO everyone's; a direct manager their reports'), newest first, by the filter. */
export function loadLeaveRequests(filter: LeaveFilter): Promise<Loaded<LeaveRequestView[]>> {
  return loadJson<LeaveRequestView[]>(leaveRequestsPath(filter));
}

/** GET /leave/requests?status=waiting: the requests waiting for the caller. Read once a request (My Team, the dashboard). */
export const loadWaitingLeave = cache(() => loadJson<LeaveRequestView[]>(WAITING_LEAVE));

/** GET /me/leave/requests: the employee's own, newest first. Read once a request (My Requests, the dashboard). */
export const loadMyLeave = cache(() => loadJson<LeaveRequestView[]>('/me/leave/requests'));

/** GET /me/leave/balances?year=: the employee's own balances of a year. */
export const loadMyBalances = cache((year: number) => loadJson<LeaveBalances>(`/me/leave/balances?year=${year}`));

/** GET /leave/requests/:id: one request, for the employee, their manager, HR and the CEO; anyone else gets 404. */
export function loadLeaveRequest(id: string): Promise<Loaded<LeaveRequestView>> {
  return loadJson<LeaveRequestView>(`/leave/requests/${encodeURIComponent(id)}`);
}

/** GET /leave/types: the active types for anyone signed in; every type for HR, the CEO and Admin. */
export const loadLeaveTypes = cache(() => loadJson<LeaveTypeView[]>('/leave/types'));

/** GET /leave/settings: the annual leave's tiers (Art. 124). */
export const loadLeaveSettings = cache(() => loadJson<LeaveSettingsView>('/leave/settings'));

/** GET /leave/calendar: who is off in a month ("YYYY-MM"), for a department or team (none: everyone the caller may see). */
export function loadLeaveCalendar(month: string, departmentId?: string | null): Promise<Loaded<LeaveCalendarEntry[]>> {
  return loadJson<LeaveCalendarEntry[]>(calendarPath(month, departmentId));
}

/** GET /employees/:id/leave?year=: an employee's balances and requests (HR, the CEO, Finance, the employee, their manager). */
export const loadEmployeeLeave = cache((employeeId: string, year: number) => loadJson<EmployeeLeave>(`/employees/${encodeURIComponent(employeeId)}/leave?year=${year}`));

/** GET /payroll/holidays?year=: the year's official holidays (every signed-in user), in date order. */
export const loadHolidaysOf = cache((year: number) => loadJson<Holiday[]>(`/payroll/holidays?year=${year}`));

/** The holidays of several years together (none for a year that couldn't be read: the API counts the days again). */
export async function loadHolidayYears(years: readonly number[]): Promise<Holiday[]> {
  const lists = await Promise.all([...new Set(years)].map((y) => loadHolidaysOf(y)));
  return lists.flatMap((l) => (l.kind === 'ok' ? l.value : []));
}

// ---------- permission (19 October 2026) ----------

/** GET /leave/permissions (HR and the CEO everyone's; a manager or lead those sent to them and their team's), by the filter. */
export function loadPermissions(filter: LeaveFilter): Promise<Loaded<PermissionRequestView[]>> {
  return loadJson<PermissionRequestView[]>(permissionsPath(filter));
}

/** GET /leave/permissions?status=waiting: the permission requests waiting for the caller. Read once a request (My Team, the dashboard). */
export const loadWaitingPermissions = cache(() => loadJson<PermissionRequestView[]>(WAITING_PERMISSIONS));

/** GET /me/permissions: the employee's own, the latest day first. */
export const loadMyPermissions = cache(() => loadJson<PermissionRequestView[]>('/me/permissions'));

/** GET /me/permissions/allowance?month=: the employee's own hours of a month ("YYYY-MM"). */
export const loadMyPermissionMonth = cache((month: string) => loadJson<PermissionMonthView>(`/me/permissions/allowance?month=${encodeURIComponent(month)}`));

/** GET /leave/permissions/:id: one request, for the employee, their manager, HR and the CEO; anyone else gets 404. */
export function loadPermission(id: string): Promise<Loaded<PermissionRequestView>> {
  return loadJson<PermissionRequestView>(`/leave/permissions/${encodeURIComponent(id)}`);
}

/** GET /employees/:id/permissions?month=: an employee's month, with its requests (HR, the CEO, Finance, the person, their manager). */
export const loadEmployeePermissionMonth = cache((employeeId: string, month: string) =>
  loadJson<EmployeePermissionMonth>(`/employees/${encodeURIComponent(employeeId)}/permissions?month=${encodeURIComponent(month)}`),
);
