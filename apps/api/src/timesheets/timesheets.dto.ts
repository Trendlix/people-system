import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { TIMESHEET_DECISIONS, TIMESHEET_FILTERS, TIMESHEET_LIMITS, type TimesheetDecision, type TimesheetFilter } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { TrimOrNull } from '../common/transforms.js';

// Timesheets (owner, 4 November 2026; packages/shared timesheets.ts): a week asked for by any day of it, its lines as
// sent (each checked again by the service with the week's rules), the lists' filters, and a decision.

/** ?week=YYYY-MM-DD: any day of the week (its Sunday is taken); none: this week. */
export class TimesheetWeekQueryDto {
  @IsOptional() @IsDateOnly('Choose the week by one of its days, e.g. 2026-11-01.')
  week?: string;
}

export class TimesheetEntryDto {
  @IsDateOnly('Choose the day of each line, e.g. 2026-11-01.')
  date!: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the client from the list.' })
  clientAccountId?: string | null;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the task as text.' }) @MaxLength(TIMESHEET_LIMITS.task, { message: `Keep the task to ${TIMESHEET_LIMITS.task} characters or fewer.` })
  task?: string | null;

  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Enter the hours as a number, e.g. 1.5.' })
  hours!: number;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the note as text.' }) @MaxLength(TIMESHEET_LIMITS.note, { message: `Keep the note to ${TIMESHEET_LIMITS.note} characters or fewer.` })
  note?: string | null;
}

/** The week's lines, all of them: what is saved replaces what was. */
export class SaveTimesheetDto {
  @IsArray({ message: 'Send the lines as a list.' })
  @ArrayMaxSize(TIMESHEET_LIMITS.entriesPerWeek, { message: `Keep a week to ${TIMESHEET_LIMITS.entriesPerWeek} lines or fewer.` })
  @ValidateNested({ each: true })
  @Type(() => TimesheetEntryDto)
  entries: TimesheetEntryDto[] = [];
}

/** ?status=waiting|submitted|approved|rejected|all&week=&employeeId=. */
export class ListTimesheetsDto {
  @IsOptional() @IsIn(TIMESHEET_FILTERS, { message: 'Choose waiting, submitted, approved, rejected or all.' })
  status?: TimesheetFilter;

  @IsOptional() @IsDateOnly('Choose the week by one of its days, e.g. 2026-11-01.')
  week?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the employee from the list.' })
  employeeId?: string;
}

export class DecideTimesheetDto {
  @IsIn(TIMESHEET_DECISIONS, { message: 'Choose approve or reject.' })
  decision!: TimesheetDecision;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the comment as text.' }) @MaxLength(TIMESHEET_LIMITS.reason, { message: `Keep the comment to ${TIMESHEET_LIMITS.reason} characters or fewer.` })
  comment?: string | null;
}
