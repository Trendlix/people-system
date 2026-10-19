import 'server-only';
import type { AttendanceImportRow, AttendanceMonthView, PersonAttendanceView, AttendanceSummaryView } from '@/lib/attendance-types';
import type { PayrollRunSummary } from '@/lib/types';
import { loadJson, type Loaded } from '../payroll/load';
import { apiImportsPath, apiMinePath, apiMonthPath, apiPersonPath, apiSummaryPath, type AttendanceFilters } from './attendance';

// Reading the Attendance section (owner, 19 October 2026: "the attendance is not active in the side menu") from the API
// with the caller's session: a month of everyone's or a team's, a person's month, the caller's own, the Summary, every
// import across the runs, and the runs (for the Import page). An API from before them answers 404: "not available yet".

export const loadMonth = (month: string, filters: Partial<AttendanceFilters> = {}): Promise<Loaded<AttendanceMonthView>> => loadJson(apiMonthPath(month, filters));

export const loadPerson = (employeeId: string, month: string): Promise<Loaded<PersonAttendanceView>> => loadJson(apiPersonPath(employeeId, month));

export const loadMine = (month: string): Promise<Loaded<PersonAttendanceView>> => loadJson(apiMinePath(month));

export const loadSummary = (period: { from: string; to: string }): Promise<Loaded<AttendanceSummaryView>> => loadJson(apiSummaryPath(period));

export const loadImportHistory = (month?: string | null): Promise<Loaded<AttendanceImportRow[]>> => loadJson(apiImportsPath(month));

export const loadRuns = (): Promise<Loaded<PayrollRunSummary[]>> => loadJson('/payroll/runs');
