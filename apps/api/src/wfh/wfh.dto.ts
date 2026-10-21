import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { LEAVE_STATUSES, WFH_DAYS_PER_MONTH_MAX, WFH_GAP_DAYS_MAX, WFH_SOURCES, type LeaveStatus, type WfhSource } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { MONTH } from '../payroll/months.js';

// Work from home requests (owner, 21 October 2026: "think about how should we handle the working from home in out
// erp"; packages/shared wfh.ts). JSON: the day (YYYY-MM-DD) and why; one day a request. Who may ask for that day, the
// notice and the Leave Setup's limits are the service's to check; here only the shapes.

const DAY_MESSAGE = 'Enter the day, e.g. 2026-11-01.';

/** An employee's own request: the day, and why (optional). */
export class CreateWfhDto {
  @Trim() @IsDateOnly(DAY_MESSAGE)
  date: string;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the reason.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason?: string | null;
}

/** HR recording a day for someone (any day, past the limits too): whose, the day, and why, required. */
export class RecordWfhDto {
  @Trim() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @Trim() @IsDateOnly(DAY_MESSAGE)
  date: string;

  // empty unless sent: a missing reason is refused once, as an empty one is
  @Trim() @IsString({ message: 'Write why HR records this day.' }) @MinLength(1, { message: 'Write why HR records this day.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason: string = '';
}

/** ?employeeId=&date=: what refuses a day HR would record, and what it would be recorded past. */
export class WfhCheckQueryDto {
  @Trim() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @Trim() @IsDateOnly(DAY_MESSAGE)
  date: string;
}

/** HR cancelling an approved day: why, required. */
export class HrCancelWfhDto {
  @Trim() @IsString({ message: 'Write why the work from home day is cancelled.' }) @MinLength(1, { message: 'Write why the work from home day is cancelled.' }) @MaxLength(1000, { message: 'Keep the comment to 1000 characters or fewer.' })
  comment: string = '';
}

/** ?status=<a status, or waiting>&employeeId=&departmentId=&source=&from=&to=: all unless sent. */
export class ListWfhDto {
  @IsOptional() @IsIn([...LEAVE_STATUSES, 'waiting'], { message: `Choose a status: waiting, ${LEAVE_STATUSES.join(', ')}.` })
  status?: LeaveStatus | 'waiting';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  /** A department, with its teams; or a team. */
  @IsOptional() @IsUUID('all', { message: 'Choose the department or team.' })
  departmentId?: string;

  @IsOptional() @IsIn(WFH_SOURCES, { message: `Choose where it came from: ${WFH_SOURCES.join(', ')}.` })
  source?: WfhSource;

  /** Those on or after it. */
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  /** Those on or before it. */
  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;
}

/** ?month=YYYY-MM: this month in Cairo unless sent. */
export class WfhMonthQueryDto {
  @Trim() @IsOptional() @Matches(MONTH, { message: 'Choose the month, as YYYY-MM.' })
  month?: string;
}

/** ?from=&to=&departmentId=: the calendar's days (this month unless sent; at most a year), a department or team. */
export class WfhCalendarQueryDto {
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the department or team.' })
  departmentId?: string;
}

const PER_MONTH = `Enter the work from home days a month as a whole number from 0 to ${WFH_DAYS_PER_MONTH_MAX}, e.g. 2 (0: no working from home).`;
const GAP = `Enter the days between two work from home days as a whole number from 1 to ${WFH_GAP_DAYS_MAX}, e.g. 7 (1: any two days).`;

/** The Leave Setup's work from home limits: either or both. */
export class UpdateWfhSettingsDto {
  @IsOptional() @IsInt({ message: PER_MONTH }) @Min(0, { message: PER_MONTH }) @Max(WFH_DAYS_PER_MONTH_MAX, { message: PER_MONTH })
  daysPerMonth?: number;

  @IsOptional() @IsInt({ message: GAP }) @Min(1, { message: GAP }) @Max(WFH_GAP_DAYS_MAX, { message: GAP })
  minGapDays?: number;
}
