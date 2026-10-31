import { CORRECTION_KINDS, CORRECTION_KINDS_ASKED, LEAVE_STATUSES, type CorrectionKind, type LeaveStatus } from '@trendlix/shared';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { TIME_OF_DAY } from '../common/time-of-day.js';
import { LatinDigits, Trim, TrimOrNull } from '../common/transforms.js';
import { MONTH } from '../payroll/months.js';

// Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")";
// packages/shared attendance-corrections.ts): the day (YYYY-MM-DD), what was wrong, the right times (HH:MM, Cairo; none
// given: as on record) and why. What each kind needs, the day, the month's payroll and a correction already asked for
// are the service's to check; here only the shapes.

/** An employee's own request. */
export class CreateCorrectionDto {
  @Trim() @IsDateOnly('Enter the day to correct, e.g. 2026-10-12.')
  date: string;

  @IsIn(CORRECTION_KINDS, { message: `Choose what was wrong: ${CORRECTION_KINDS_ASKED.join(', ')}.` })
  kind: CorrectionKind;

  @LatinDigits() @TrimOrNull() @IsOptional() @Matches(TIME_OF_DAY, { message: 'Enter the time of the check-in as HH:MM, e.g. 09:05.' })
  checkIn?: string | null;

  @LatinDigits() @TrimOrNull() @IsOptional() @Matches(TIME_OF_DAY, { message: 'Enter the time of the check-out as HH:MM, e.g. 18:30.' })
  checkOut?: string | null;

  /** Why: required (the service says so in words), at most 500 characters. */
  @TrimOrNull() @IsOptional() @IsString({ message: 'Write why the day needs correcting.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason?: string | null;
}

/** HR correcting a day directly: whose it is, then as a request (approved at once). */
export class RecordCorrectionDto extends CreateCorrectionDto {
  @Trim() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;
}

/** ?status=<a status, or waiting>&employeeId=&month=: all unless sent. */
export class ListCorrectionsDto {
  @IsOptional() @IsIn([...LEAVE_STATUSES, 'waiting'], { message: `Choose a status: waiting, ${LEAVE_STATUSES.join(', ')}.` })
  status?: LeaveStatus | 'waiting';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  @Trim() @IsOptional() @Matches(MONTH, { message: 'Choose the month as YYYY-MM, e.g. 2026-10.' })
  month?: string;
}
