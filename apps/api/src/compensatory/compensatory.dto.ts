import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { COMPENSATORY_OUTCOMES, LEAVE_DECISIONS, LEAVE_STATUSES, type CompensatoryOutcome, type LeaveDecision, type LeaveStatus } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';

// Compensatory day requests (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month"; packages/shared compensatory.ts). JSON: the day worked, the day off (YYYY-MM-DD) and why. Which days are
// allowed, the same month, the notice and the locked months are the service's to check; here only the shapes.

const WORKED = 'Enter the day worked, e.g. 2026-11-06.';
const OFF = 'Enter the day off, e.g. 2026-11-10.';
const OUTCOME = `Choose the decision: ${COMPENSATORY_OUTCOMES.join(' or ')}.`;

/** An employee's own request: the day worked, the day off, and why (optional). */
export class CreateCompensatoryDto {
  @Trim() @IsDateOnly(WORKED)
  dayWorked: string;

  @Trim() @IsDateOnly(OFF)
  dayOff: string;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the reason.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason?: string | null;
}

/**
 * HR recording one for someone: whose, the days, the outcome (a day off unless cash), and why, required. A cash one has no
 * day off.
 */
export class RecordCompensatoryDto {
  @Trim() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @Trim() @IsDateOnly(WORKED)
  dayWorked: string;

  @Trim() @IsOptional() @IsDateOnly(OFF)
  dayOff?: string | null;

  @IsOptional() @IsIn(COMPENSATORY_OUTCOMES, { message: OUTCOME })
  outcome?: CompensatoryOutcome;

  // empty unless sent: a missing reason is refused once, as an empty one is
  @Trim() @IsString({ message: 'Write why HR records this compensatory day.' }) @MinLength(1, { message: 'Write why HR records this compensatory day.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason: string = '';
}

/** ?employeeId=&dayWorked=&dayOff=: what refuses a request HR would record, and what it would be recorded past. */
export class CompensatoryCheckQueryDto {
  @Trim() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @Trim() @IsDateOnly(WORKED)
  dayWorked: string;

  @Trim() @IsOptional() @IsDateOnly(OFF)
  dayOff?: string;
}

/** A decision on a request: approve (HR: a day off or cash instead) or reject with a comment. */
export class DecideCompensatoryDto {
  @IsIn(LEAVE_DECISIONS, { message: 'Choose approve or reject.' })
  decision: LeaveDecision;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write a comment.' }) @MaxLength(1000, { message: 'Keep the comment to 1000 characters or fewer.' })
  comment?: string | null;

  /** HR's stage only: a day off (the default) or cash instead. */
  @IsOptional() @IsIn(COMPENSATORY_OUTCOMES, { message: OUTCOME })
  outcome?: CompensatoryOutcome;

  /** HR's stage only: the day worked has no check-in kept, and HR confirms it was worked. */
  @IsOptional() @IsBoolean({ message: 'Confirm with true or false.' })
  confirmNoCheckIn?: boolean;
}

/** HR cancelling an approved request: why, required. */
export class HrCancelCompensatoryDto {
  @Trim() @IsString({ message: 'Write why the compensatory day is cancelled.' }) @MinLength(1, { message: 'Write why the compensatory day is cancelled.' }) @MaxLength(1000, { message: 'Keep the comment to 1000 characters or fewer.' })
  comment: string = '';
}

/** ?status=<a status, or waiting>&employeeId=&departmentId=&from=&to=: all unless sent; the days are the day worked's. */
export class ListCompensatoryDto {
  @IsOptional() @IsIn([...LEAVE_STATUSES, 'waiting'], { message: `Choose a status: waiting, ${LEAVE_STATUSES.join(', ')}.` })
  status?: LeaveStatus | 'waiting';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  /** A department, with its teams; or a team. */
  @IsOptional() @IsUUID('all', { message: 'Choose the department or team.' })
  departmentId?: string;

  /** The day worked on or after it. */
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  /** The day worked on or before it. */
  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;
}

/** ?month=YYYY-MM: this month in Cairo unless sent. */
export class CompensatoryFormQueryDto {
  @Trim() @IsOptional() @IsDateOnly('Enter the day, e.g. 2026-11-01.')
  around?: string;
}

/** ?from=&to=&departmentId=: the calendar's days (this month unless sent; at most a year), a department or team. */
export class CompensatoryCalendarQueryDto {
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the department or team.' })
  departmentId?: string;
}

const RATE = "Enter the days' pay for cash instead in whole or half days from 0.5 to 5, e.g. 1.5.";

/** The Leave Setup's cash rate. */
export class UpdateCompensatorySettingsDto {
  @IsNumber({ maxDecimalPlaces: 1 }, { message: RATE })
  cashRate: number;
}
