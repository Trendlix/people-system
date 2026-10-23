import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { LEAVE_STATUSES, OD_PLACE_MAX, OD_REASON_MAX, type LeaveStatus } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { TIME_OF_DAY } from '../common/time-of-day.js';
import { Trim, TrimOrNull } from '../common/transforms.js';

// Official duty requests (owner, 23 October 2026: "Official duty (OD) requests"; packages/shared official-duty.ts).
// JSON: the first and last day (YYYY-MM-DD, the same for one day), a full day or from–to times (HH:MM, one day only),
// where and why, both required. The timing, the shift, the days and the overlaps are the service's to check (with the
// shared words); here only the shapes.

const PLACE = 'Write where the official duty is, e.g. the client’s office in New Cairo.';
const REASON = 'Write what the official duty is for, e.g. a site visit for the client’s launch.';

/** An employee's own request. */
export class CreateOdDto {
  @Trim() @IsDateOnly('Enter the day of the official duty, e.g. 2026-11-01.')
  startDate: string;

  /** The last day; the first unless sent. */
  @Trim() @IsOptional() @IsDateOnly('Enter the last day of the official duty, e.g. 2026-11-03 (the same day for one day).')
  endDate?: string;

  /** A full day (true unless sent), or part of one with its times. */
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsOptional()
  @IsBoolean({ message: 'Choose a full day or part of a day.' })
  fullDay?: boolean;

  @TrimOrNull() @ValidateIf((o: CreateOdDto) => o.fullDay === false || (o.fromTime !== null && o.fromTime !== undefined)) @Matches(TIME_OF_DAY, { message: 'Enter the time it starts, e.g. 10:00.' })
  fromTime?: string | null;

  @TrimOrNull() @ValidateIf((o: CreateOdDto) => o.fullDay === false || (o.toTime !== null && o.toTime !== undefined)) @Matches(TIME_OF_DAY, { message: 'Enter the time it ends, e.g. 14:00.' })
  toTime?: string | null;

  // empty unless sent: a missing place is refused once, as an empty one is
  @Trim() @IsString({ message: PLACE }) @MinLength(1, { message: PLACE }) @MaxLength(OD_PLACE_MAX, { message: `Keep the place to ${OD_PLACE_MAX} characters or fewer.` })
  place: string = '';

  @Trim() @IsString({ message: REASON }) @MinLength(1, { message: REASON }) @MaxLength(OD_REASON_MAX, { message: `Keep the reason to ${OD_REASON_MAX} characters or fewer.` })
  reason: string = '';
}

/** HR cancelling an approved official duty: why, required. */
export class HrCancelOdDto {
  @Trim() @IsString({ message: 'Write why the official duty is cancelled.' }) @MinLength(1, { message: 'Write why the official duty is cancelled.' }) @MaxLength(1000, { message: 'Keep the comment to 1000 characters or fewer.' })
  comment: string = '';
}

/** ?status=<a status, or waiting>&employeeId=&departmentId=&from=&to=&late=: all unless sent. */
export class ListOdDto {
  @IsOptional() @IsIn([...LEAVE_STATUSES, 'waiting'], { message: `Choose a status: waiting, ${LEAVE_STATUSES.join(', ')}.` })
  status?: LeaveStatus | 'waiting';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  /** A department, with its teams; or a team. */
  @IsOptional() @IsUUID('all', { message: 'Choose the department or team.' })
  departmentId?: string;

  /** Those with a day on or after it. */
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  /** Those with a day on or before it. */
  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;

  /** Only those asked after their first day ("requested after"). */
  @IsOptional() @IsIn(['true', 'false'], { message: 'Choose late=true or late=false.' })
  late?: 'true' | 'false';
}

/** ?from=&to=&departmentId=: the calendar's days (this month unless sent; at most a year), a department or team. */
export class OdCalendarQueryDto {
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the department or team.' })
  departmentId?: string;
}
