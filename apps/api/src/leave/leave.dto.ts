import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  HANDOVER_NOTE_MAX,
  LEAVE_BALANCES,
  LEAVE_DECISIONS,
  LEAVE_PAYS,
  LEAVE_STATUSES,
  PERMISSION_DAY_MAX,
  PERMISSION_MONTH_MAX,
  type LeaveBalanceKind,
  type LeaveDecision,
  type LeavePay,
  type LeaveStatus,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { LatinDigits, Trim, TrimOrNull } from '../common/transforms.js';

// Leave (owner, 18 October 2026: "can you apply the leaves according to the law?"; packages/shared leaves.ts). Dates:
// YYYY-MM-DD. Days: numbers, whole or half. Text fields: an empty string clears them. A request is sent as a form with
// its documents (multipart), so its fields arrive as text and are read as numbers and true or false here.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

/** A number sent as text (a query or a multipart field), Arabic-Indic digits too, as a number; anything else as it came. */
const NumberOf = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const typed = value.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    return typed === '' ? value : Number(typed);
  });

/** "true" or "false" sent as text (a multipart field) as true or false; anything else as it came. */
const BooleanOf = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const typed = value.trim().toLowerCase();
    return typed === 'true' ? true : typed === 'false' ? false : value;
  });

/** A stand-in: "hr", or an employee's id. */
const IsStandIn = () =>
  ValidateBy({
    name: 'isStandIn',
    validator: {
      validate: (v) => v === 'hr' || (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)),
      defaultMessage: () => 'Choose your stand-in from the list, or HR.',
    },
  });

/** A name of 1 to 100 characters (after trimming), with one message whatever is wrong. */
const IsName = (message: string) =>
  ValidateBy({ name: 'isName', validator: { validate: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100, defaultMessage: () => message } });

const PERMISSION_MONTH_MESSAGE = `Enter the permission hours a month from 0 to ${PERMISSION_MONTH_MAX}, in half hours, e.g. 4 (0: no permission).`;
const PERMISSION_DAY_MESSAGE = `Enter the most permission hours a day from 0.5 to ${PERMISSION_DAY_MAX}, in half hours, e.g. 2.`;

const limit = (what: string, min: number, max: number) => `Enter ${what} as a whole number from ${min} to ${max}, or leave it empty for none.`;
const YEAR_MESSAGE = 'Choose a year, e.g. 2026.';

/** A whole number from `min` to `max`, or null (none). */
const IntOrNull = (what: string, min: number, max: number) => (target: object, key: string) => {
  IsOptional()(target, key);
  IsInt({ message: limit(what, min, max) })(target, key);
  Min(min, { message: limit(what, min, max) })(target, key);
  Max(max, { message: limit(what, min, max) })(target, key);
};

// ---------- the types ----------

/** A type's rules. On a change, each field sent replaces what it has; null clears a limit. */
class LeaveTypeFields {
  @Sent() @IsIn(LEAVE_PAYS, { message: 'Choose whether it is paid: paid, unpaid or partly (paid at a percent).' })
  paid?: LeavePay;

  /** A partly paid type's pay, 0 to 100 percent (sick leave: 100 until HR sets it). */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the pay percent from 0 to 100, e.g. 75.' }) @Min(0, { message: 'Enter the pay percent from 0 to 100, e.g. 75.' }) @Max(100, { message: 'Enter the pay percent from 0 to 100, e.g. 75.' })
  payPercent?: number | null;

  @Sent() @IsIn(LEAVE_BALANCES, { message: `Choose what its days are counted against: ${LEAVE_BALANCES.join(', ')}.` })
  balance?: LeaveBalanceKind;

  @IntOrNull('the days a year', 1, 366) daysPerYear?: number | null;
  @IntOrNull('the most days a request', 1, 1000) maxPerRequest?: number | null;
  @IntOrNull('the most times in service', 1, 100) maxTimesInService?: number | null;
  @IntOrNull('the months of service needed first', 0, 600) minServiceMonths?: number | null;
  @IntOrNull("the days' notice", 0, 365) noticeDays?: number | null;

  @Sent() @IsBoolean({ message: 'Choose whether a document is needed.' })
  documentRequired?: boolean;

  @IsOptional() @IsIn(['male', 'female'], { message: 'Choose male or female, or leave it empty for everyone.' })
  gender?: 'male' | 'female' | null;

  @Sent() @IsBoolean({ message: 'Choose whether it is counted in calendar days.' })
  calendarDays?: boolean;

  @Sent() @IsBoolean({ message: 'Choose whether half days are allowed.' })
  halfDays?: boolean;

  /** Turned off, it isn't offered for new requests; the requests sent stay. */
  @Sent() @IsBoolean({ message: 'Choose whether the type is on.' })
  active?: boolean;

  @IsOptional() @IsInt({ message: 'Enter the order as a whole number from 1 to 999.' }) @Min(1, { message: 'Enter the order as a whole number from 1 to 999.' }) @Max(999, { message: 'Enter the order as a whole number from 1 to 999.' })
  sortOrder?: number;
}

export class CreateLeaveTypeDto extends LeaveTypeFields {
  @Trim() @IsName('Enter the name in English (up to 100 characters), e.g. Marriage leave.')
  nameEn: string;

  @Trim() @IsName('Enter the name in Arabic (up to 100 characters), e.g. إجازة زواج.')
  nameAr: string;
}

export class UpdateLeaveTypeDto extends LeaveTypeFields {
  @Trim() @Sent() @IsName('Enter the name in English (up to 100 characters), e.g. Marriage leave.')
  nameEn?: string;

  @Trim() @Sent() @IsName('Enter the name in Arabic (up to 100 characters), e.g. إجازة زواج.')
  nameAr?: string;
}

// ---------- the Leave Setup ----------

const setupDays = (what: string) => `Enter ${what} as a whole number of days from 0 to 366.`;

/**
 * The annual leave's numbers (Art. 124), the years days may be carried (Art. 125) and the permission hours (19 October
 * 2026): each field sent replaces it.
 */
export class UpdateLeaveSettingsDto {
  @IsOptional() @IsInt({ message: setupDays('the first year’s days') }) @Min(0, { message: setupDays('the first year’s days') }) @Max(366, { message: setupDays('the first year’s days') })
  firstYearDays?: number;

  @IsOptional() @IsInt({ message: setupDays('the days from the second year') }) @Min(0, { message: setupDays('the days from the second year') }) @Max(366, { message: setupDays('the days from the second year') })
  standardDays?: number;

  @IsOptional() @IsInt({ message: setupDays('the days after long service') }) @Min(0, { message: setupDays('the days after long service') }) @Max(366, { message: setupDays('the days after long service') })
  longServiceDays?: number;

  @IsOptional() @IsInt({ message: 'Enter the years of service as a whole number from 1 to 60.' }) @Min(1, { message: 'Enter the years of service as a whole number from 1 to 60.' }) @Max(60, { message: 'Enter the years of service as a whole number from 1 to 60.' })
  longServiceYears?: number;

  @IsOptional() @IsInt({ message: 'Enter the age as a whole number from 18 to 100.' }) @Min(18, { message: 'Enter the age as a whole number from 18 to 100.' }) @Max(100, { message: 'Enter the age as a whole number from 18 to 100.' })
  longServiceAge?: number;

  @IsOptional() @IsInt({ message: setupDays('the days with a disability') }) @Min(0, { message: setupDays('the days with a disability') }) @Max(366, { message: setupDays('the days with a disability') })
  disabilityDays?: number;

  @IsOptional() @IsInt({ message: setupDays('the days more for hazardous work') }) @Min(0, { message: setupDays('the days more for hazardous work') }) @Max(366, { message: setupDays('the days more for hazardous work') })
  hazardousExtraDays?: number;

  @IsOptional() @IsInt({ message: 'Enter the months served before the first year’s leave as a whole number from 0 to 12.' }) @Min(0, { message: 'Enter the months served before the first year’s leave as a whole number from 0 to 12.' }) @Max(12, { message: 'Enter the months served before the first year’s leave as a whole number from 0 to 12.' })
  firstYearMinMonths?: number;

  @IsOptional() @IsInt({ message: 'Enter the years days may be carried as a whole number from 1 to 10.' }) @Min(1, { message: 'Enter the years days may be carried as a whole number from 1 to 10.' }) @Max(10, { message: 'Enter the years days may be carried as a whole number from 1 to 10.' })
  settleWithinYears?: number;

  /**
   * The permission hours a month (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day"), in half
   * hours, 0 to 40 (0: no permission); with the most a day, checked together (permissionRulesProblems).
   */
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }, { message: PERMISSION_MONTH_MESSAGE })
  permissionHoursPerMonth?: number;

  /** The most permission hours a day, in half hours, 0.5 to 8. */
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }, { message: PERMISSION_DAY_MESSAGE })
  permissionMaxHoursPerDay?: number;
}

// ---------- requests ----------

/** A request, sent as a form with its documents (multipart, files `documents`): the type, the first and last day, a half day, why. */
export class CreateLeaveRequestDto {
  @Trim() @IsUUID('all', { message: 'Choose the leave type.' })
  typeId: string;

  @Trim() @IsDateOnly('Enter the first day of the leave, e.g. 2026-11-01.')
  startDate: string;

  @Trim() @IsDateOnly('Enter the last day of the leave, e.g. 2026-11-02.')
  endDate: string;

  @BooleanOf() @IsOptional() @IsBoolean({ message: 'Send whether it is a half day as true or false.' })
  halfDay?: boolean;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the reason.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason?: string | null;

  /**
   * The colleague who covers the work (owner, 25 October 2026: "Required over 2 days"): required for annual and unpaid
   * leave of more than 2 working days, optional otherwise.
   */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the colleague who covers from the list.' })
  coverId?: string | null;

  /** A note to the colleague who covers: what to hand over (free text). */
  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the handover note.' }) @MaxLength(HANDOVER_NOTE_MAX, { message: `Keep the handover note to ${HANDOVER_NOTE_MAX} characters or fewer.` })
  handoverNote?: string | null;

  /**
   * Who decides what waits at the requester's step while they are away (owner, 25 October 2026: "To a stand-in"): an
   * employee's id, or "hr"; none: the default (their department's head, else HR). Only for someone who approves for others.
   */
  @TrimOrNull() @IsOptional() @IsStandIn()
  standIn?: string | null;
}

/** HR recording leave on an employee's behalf: whose it is, then as a request. */
export class RecordLeaveRequestDto extends CreateLeaveRequestDto {
  @Trim() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;
}

/** ?status=<a status, or waiting>&employeeId=&from=&to= on Leave Requests: all unless sent. */
export class ListLeaveRequestsDto {
  @IsOptional() @IsIn([...LEAVE_STATUSES, 'waiting'], { message: `Choose a status: waiting, ${LEAVE_STATUSES.join(', ')}.` })
  status?: LeaveStatus | 'waiting';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  /** Those that end on or after it. */
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  /** Those that start on or before it. */
  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;
}

/** A decision on a request: approve it, or reject it with a comment. */
export class DecideLeaveDto {
  @IsIn(LEAVE_DECISIONS, { message: 'Choose approve or reject.' })
  decision: LeaveDecision;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write a comment.' }) @MaxLength(1000, { message: 'Keep the comment to 1000 characters or fewer.' })
  comment?: string | null;
}

/** HR cancelling an approved request: why, required. */
export class HrCancelLeaveDto {
  @Trim() @IsString({ message: 'Write why the leave is cancelled.' }) @MinLength(1, { message: 'Write why the leave is cancelled.' }) @MaxLength(1000, { message: 'Keep the comment to 1000 characters or fewer.' })
  comment: string;
}

/** ?year=: this year in Cairo unless sent. */
export class LeaveYearQueryDto {
  @NumberOf() @IsOptional() @IsInt({ message: YEAR_MESSAGE }) @Min(2000, { message: YEAR_MESSAGE }) @Max(2100, { message: YEAR_MESSAGE })
  year?: number;
}

/** ?from=&to=&departmentId=: the calendar's days (this month unless sent; at most a year), a department or team. */
export class LeaveCalendarQueryDto {
  @IsOptional() @IsDateOnly('Enter the first day, e.g. 2026-10-01.')
  from?: string;

  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-10-31.')
  to?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose a department or team.' })
  departmentId?: string;
}

// ---------- coverage (owner, 25 October 2026: "Warn and need HR", "Required over 2 days", "To a stand-in") ----------

/** ?from=&to=&typeId=&halfDay=: the new request's days as typed (the last day: the first unless sent). */
export class CoverageQueryDto {
  @IsDateOnly('Enter the first day, e.g. 2026-11-01.')
  from: string;

  @IsOptional() @IsDateOnly('Enter the last day, e.g. 2026-11-02.')
  to?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the leave type.' })
  typeId?: string;

  @BooleanOf() @IsOptional() @IsBoolean({ message: 'Send whether it is a half day as true or false.' })
  halfDay?: boolean;
}

/** The colleague who covers a request, changed by its employee (null: none, for leave that doesn't need one), and the note. */
export class ChangeCoverDto {
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the colleague who covers from the list.' })
  coverId?: string | null;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write the handover note.' }) @MaxLength(HANDOVER_NOTE_MAX, { message: `Keep the handover note to ${HANDOVER_NOTE_MAX} characters or fewer.` })
  handoverNote?: string | null;
}

/**
 * A team's staffing limit (or a department's without teams): at most so many people on annual leave at once, and/or at
 * least so many percent at work; both empty (or null) removes it. Checked by staffingLimitProblems.
 */
export class StaffingLimitDto {
  @IsOptional() @IsInt({ message: 'Enter the most people on annual leave at once as a whole number, or leave it empty.' })
  maxOff?: number | null;

  @IsOptional() @IsInt({ message: 'Enter the least share at work as a whole percent, or leave it empty.' })
  minAtWorkPercent?: number | null;
}

// ---------- balances ----------

/** HR's change to a year's annual balance: days more (or fewer, below 0), whole or half, and why. */
export class LeaveAdjustmentDto {
  @IsInt({ message: YEAR_MESSAGE }) @Min(2000, { message: YEAR_MESSAGE }) @Max(2100, { message: YEAR_MESSAGE })
  year: number;

  @LatinDigits() @IsNumber({}, { message: 'Enter the days to add or take off, e.g. 2 or -1.5.' }) @Min(-366, { message: 'Enter at most 366 days.' }) @Max(366, { message: 'Enter at most 366 days.' })
  days: number;

  @Trim() @IsString({ message: 'Write why the balance changes.' }) @MinLength(1, { message: 'Write why the balance changes.' }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason: string;
}

// ---------- Year Closing ----------

/** One employee's decision: the days carried into the next year and the days paid. */
export class YearClosingRowDto {
  @IsUUID('all', { message: 'Send each employee by their id.' })
  employeeId: string;

  @IsNumber({}, { message: 'Enter the days carried, 0 or more.' })
  carry: number;

  @IsNumber({}, { message: 'Enter the days paid, 0 or more.' })
  pay: number;
}

/** A year's closing: every employee's decision. */
export class CloseYearDto {
  @IsArray({ message: 'Send the rows as a list.' })
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => YearClosingRowDto)
  rows: YearClosingRowDto[];
}
