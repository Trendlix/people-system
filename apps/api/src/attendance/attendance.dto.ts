import { ATTENDANCE_FILTERS, type AttendanceFilter } from '@trendlix/shared';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';
import { MONTH } from '../payroll/months.js';

// The Attendance section's reads (owner, 19 October 2026: "the attendance is not active in the side menu"): a month
// (YYYY-MM, this month unless sent), Daily Attendance's filters, and the Summary's period (?month= or ?from=&to=).

const MONTH_MESSAGE = 'Choose the month as YYYY-MM, e.g. 2026-10.';

/** A month: this month (Cairo) unless sent. */
export class AttendanceMonthQueryDto {
  @TrimOrNull() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  month?: string | null;
}

/** Daily Attendance: the month, a department or team (a department with its teams), a person, and "only with …". */
export class AttendanceListQueryDto extends AttendanceMonthQueryDto {
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the department or team from the list.' })
  departmentId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the employee from the list.' })
  employeeId?: string | null;

  @TrimOrNull() @IsOptional() @IsIn(ATTENDANCE_FILTERS, { message: `Choose who to show: ${ATTENDANCE_FILTERS.join(', ')}.` })
  only?: AttendanceFilter | null;
}

/** The Summary: ?month= alone, or ?from=&to= (one of them alone: that month); this month without any. */
export class AttendanceSummaryQueryDto extends AttendanceMonthQueryDto {
  @TrimOrNull() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  from?: string | null;

  @TrimOrNull() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  to?: string | null;
}

/** The imports across the runs: of one month, or every one. */
export class AttendanceImportsQueryDto extends AttendanceMonthQueryDto {}
