import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { LEAVE_STATUSES, PERMISSION_DAY_MAX, type LeaveStatus } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { TIME_OF_DAY } from '../common/time-of-day.js';
import { LatinDigits, Trim, TrimOrNull } from '../common/transforms.js';
import { MONTH } from '../payroll/months.js';

// Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours
// per day", asked "In the system, like leave"; packages/shared permissions.ts). JSON, with no documents: the day
// (YYYY-MM-DD), the hours (half hours), the times when given (HH:MM, Cairo), why. What the Leave Setup allows is the
// service's to check, with the day's and the month's hours already asked for; here only the shapes.

const HOURS_MESSAGE = `Enter the hours in half hours, from 0.5 to ${PERMISSION_DAY_MAX}, e.g. 1.5 or 2.`;

/** A number typed with a comma for a decimal point, or Arabic-Indic digits, as a number; anything else as it came. */
const HoursOf = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const typed = value.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,٫]/g, '.');
    return typed === '' ? value : Number(typed);
  });

/** An employee's own request: the day, the hours, the times (one or both, or none), why. */
export class CreatePermissionDto {
  @Trim() @IsDateOnly('Enter the day of the permission, e.g. 2026-11-01.')
  date: string;

  @HoursOf() @IsNumber({ allowNaN: false, allowInfinity: false }, { message: HOURS_MESSAGE }) @Min(0.5, { message: HOURS_MESSAGE }) @Max(PERMISSION_DAY_MAX, { message: HOURS_MESSAGE })
  hours: number;

  /** When it starts, e.g. 17:00 to leave at 5 PM; with only one of the times, the other is worked out from the hours. */
  @LatinDigits() @TrimOrNull() @IsOptional() @Matches(TIME_OF_DAY, { message: 'Enter the time it starts as HH:MM, e.g. 17:00.' })
  fromTime?: string | null;

  @LatinDigits() @TrimOrNull() @IsOptional() @Matches(TIME_OF_DAY, { message: 'Enter the time it ends as HH:MM, e.g. 19:00.' })
  toTime?: string | null;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the reason.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason?: string | null;
}

/** HR recording permission on an employee's behalf: whose it is, then as a request. */
export class RecordPermissionDto extends CreatePermissionDto {
  @Trim() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;
}

/** ?status=<a status, or waiting>&employeeId=&from=&to= on Leave Requests' permissions: all unless sent. */
export class ListPermissionsDto {
  @IsOptional() @IsIn([...LEAVE_STATUSES, 'waiting'], { message: `Choose a status: waiting, ${LEAVE_STATUSES.join(', ')}.` })
  status?: LeaveStatus | 'waiting';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  /** Those on or after it. */
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  /** Those on or before it. */
  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;
}

/** ?month=YYYY-MM: this month in Cairo unless sent. */
export class PermissionMonthQueryDto {
  @Trim() @IsOptional() @Matches(MONTH, { message: 'Choose the month, as YYYY-MM.' })
  month?: string;
}
