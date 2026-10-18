import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { INSTALLMENT_LIMIT_MIN, LAW_INSTALLMENT_PERCENT, SALARY_REVIEW_MONTHS_MAX, SALARY_REVIEW_MONTHS_MIN } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { LatinDigits, Trim, TrimOrNull } from '../common/transforms.js';
import { MONTH } from './months.js';

// Payroll (owner's decisions, 16 October 2026): its settings, a month's run and the inputs HR types on it. Money: a
// number, to the piaster; percents as 95 for 95%; dates YYYY-MM-DD; a month YYYY-MM. Text: an empty string clears it.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

// ---------- settings ----------

const DIVISOR_MESSAGE = 'Enter the days a month counts as, a whole number from 20 to 31 (the sheet: 30).';
const GRACE_MESSAGE = 'Enter the percent from 0 to 100, e.g. 90.';
const OVERTIME_ABOVE_MESSAGE = 'Enter the attendance percent overtime starts above, from 100 to 200, e.g. 110.';
const OVERTIME_RATE_MESSAGE = 'Enter the overtime rate from 1 to 5, e.g. 1.5.';
const NO_SHOW_MESSAGE = "Enter how many days' pay a no-show day costs, from 0 to 10, e.g. 2.";
const CIB_ACCOUNT_MESSAGE = "Enter the company's CIB account number: 12 digits.";
const PURPOSE_MESSAGE = 'Enter the ACH transaction purpose in capital letters and digits, up to 20, e.g. CASH.';
const PAYDAY_MESSAGE = 'Enter the day of the month salaries are paid, a whole number from 1 to 31, or leave it empty.';
const REVIEW_MESSAGE = `Enter after how many months without a raise a salary review is due, a whole number from ${SALARY_REVIEW_MONTHS_MIN} to ${SALARY_REVIEW_MONTHS_MAX}, e.g. 12.`;
const INSTALLMENT_LIMIT_MESSAGE = `Enter the most a month's installments of advances and loans may take, from ${INSTALLMENT_LIMIT_MIN} to ${LAW_INSTALLMENT_PERCENT} percent of the wage, e.g. 10: the law allows at most ${LAW_INSTALLMENT_PERCENT}% (Labour Law Art. 113).`;

export class UpdatePayrollSettingsDto {
  @Sent() @IsInt({ message: DIVISOR_MESSAGE }) @Min(20, { message: DIVISOR_MESSAGE }) @Max(31, { message: DIVISOR_MESSAGE })
  dayDivisor?: number;

  @Sent() @IsNumber({ maxDecimalPlaces: 2 }, { message: GRACE_MESSAGE }) @Min(0, { message: GRACE_MESSAGE }) @Max(100, { message: GRACE_MESSAGE })
  attendanceGracePercent?: number;

  @Sent() @IsNumber({ maxDecimalPlaces: 2 }, { message: GRACE_MESSAGE }) @Min(0, { message: GRACE_MESSAGE }) @Max(100, { message: GRACE_MESSAGE })
  kpiGracePercent?: number;

  /** Whether overtime is paid at all (owner, 16 October 2026: "No overtime for now"): off from then on. */
  @Sent() @IsBoolean({ message: 'Say whether overtime is paid: true or false.' })
  payOvertime?: boolean;

  @Sent()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: OVERTIME_ABOVE_MESSAGE })
  @Min(100, { message: OVERTIME_ABOVE_MESSAGE })
  @Max(200, { message: OVERTIME_ABOVE_MESSAGE })
  overtimeAbovePercent?: number;

  @Sent() @IsNumber({ maxDecimalPlaces: 2 }, { message: OVERTIME_RATE_MESSAGE }) @Min(1, { message: OVERTIME_RATE_MESSAGE }) @Max(5, { message: OVERTIME_RATE_MESSAGE })
  overtimeRate?: number;

  @Sent() @IsNumber({ maxDecimalPlaces: 2 }, { message: NO_SHOW_MESSAGE }) @Min(0, { message: NO_SHOW_MESSAGE }) @Max(10, { message: NO_SHOW_MESSAGE })
  noShowDayMultiplier?: number;

  /** The company's CIB account the salaries are paid from: 12 digits (spaces and dashes dropped); null clears it. */
  @LatinDigits()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]+/g, '') || null : value))
  @IsOptional()
  @Matches(/^\d{12}$/, { message: CIB_ACCOUNT_MESSAGE })
  cibDebitAccount?: string | null;

  /** The account's name, as CIB has it (the CIB file's debit row). */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100, { message: 'Keep the account name to 100 characters or fewer.' })
  cibDebitAccountName?: string | null;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Sent()
  @Matches(/^[A-Z0-9]{1,20}$/, { message: PURPOSE_MESSAGE })
  achPurpose?: string;

  /**
   * The day of the month salaries are paid (owner's request, 16 October 2026: Payroll Setup): the date a run is marked
   * paid on, to start with; null clears it.
   */
  @IsOptional() @IsInt({ message: PAYDAY_MESSAGE }) @Min(1, { message: PAYDAY_MESSAGE }) @Max(31, { message: PAYDAY_MESSAGE })
  payday?: number | null;

  /**
   * Salary review due after this many months (owner's decision, 16 October 2026: the Salary Raises report): who has had
   * no raise for this long, or since joining, is listed as due for review.
   */
  @Sent()
  @IsInt({ message: REVIEW_MESSAGE })
  @Min(SALARY_REVIEW_MONTHS_MIN, { message: REVIEW_MESSAGE })
  @Max(SALARY_REVIEW_MONTHS_MAX, { message: REVIEW_MESSAGE })
  salaryReviewMonths?: number;

  /**
   * The most a month's installments of advances and loans may take, in percent of the wage (Labour Law 14/2025 Art.
   * 113; owner, 18 October 2026, after reading the law: "Block above 10%"): 1 to 10, never more than the law's 10, and
   * never none (null is refused).
   */
  @Sent()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: INSTALLMENT_LIMIT_MESSAGE })
  @Min(INSTALLMENT_LIMIT_MIN, { message: INSTALLMENT_LIMIT_MESSAGE })
  @Max(LAW_INSTALLMENT_PERCENT, { message: INSTALLMENT_LIMIT_MESSAGE })
  installmentLimitPercent?: number;
}

// ---------- runs ----------

export class CreatePayrollRunDto {
  @Trim() @Matches(MONTH, { message: 'Choose the month, as YYYY-MM.' })
  month: string;
}

const HOURS_MESSAGE = 'Enter the hours from 0 to 744, e.g. 270 or 270:30.';
const PERCENT_MESSAGE = 'Enter the percent from 0 to 200, e.g. 95.';
const DAYS_MESSAGE = 'Enter the days from 0 to 31, in whole or half days, e.g. 2 or 1.5.';
const RELEASED_MESSAGE = 'Enter what was already paid out this month: 0 or more, up to 10,000,000.';
/** decimal(12, 2) holds far more; ten million is the most any one month's input may be. */
const MAX_AMOUNT = 10_000_000;

/** Whole or half days. */
const HalfDays = () =>
  ValidateBy({ name: 'halfDays', validator: { validate: (v) => typeof v === 'number' && Number.isInteger(v * 2), defaultMessage: () => DAYS_MESSAGE } });

const Hours = () => (target: object, key: string) => {
  IsOptional()(target, key);
  IsNumber({ allowNaN: false, allowInfinity: false }, { message: HOURS_MESSAGE })(target, key);
  Min(0, { message: HOURS_MESSAGE })(target, key);
  Max(744, { message: HOURS_MESSAGE })(target, key);
};
const Percent = () => (target: object, key: string) => {
  IsOptional()(target, key);
  IsNumber({ maxDecimalPlaces: 2 }, { message: PERCENT_MESSAGE })(target, key);
  Min(0, { message: PERCENT_MESSAGE })(target, key);
  Max(200, { message: PERCENT_MESSAGE })(target, key);
};
const Days = () => (target: object, key: string) => {
  IsOptional()(target, key);
  IsNumber({}, { message: DAYS_MESSAGE })(target, key);
  Min(0, { message: DAYS_MESSAGE })(target, key);
  Max(31, { message: DAYS_MESSAGE })(target, key);
  HalfDays()(target, key);
};
const Amount = (min: number, message: string) => (target: object, key: string) => {
  IsOptional()(target, key);
  IsNumber({ maxDecimalPlaces: 2 }, { message })(target, key);
  Min(min, { message })(target, key);
  Max(MAX_AMOUNT, { message })(target, key);
};

/**
 * The month's inputs of a line, any of them (null clears one: not given). The hours are numbers (the screen reads
 * 270:30 as 270.5); attendance will fill the same inputs later. The expected hours HR types are taken as already
 * without the no-show and leave days (owner, 17 October 2026). There is no medical subscription any more (owner's
 * decision, 16 October 2026): `medical` is refused as any field not here is. Nor bonus or penalty days, commission or
 * settlements (owner, 17 October 2026: "instead of there, i think earnings and deductions will be enough"): they are
 * entered on Additions / Deductions, so `bonusDays`, `penaltyDays`, `commission` and `settlements` are refused too.
 * The CEO's attendance waiver has its own request (AttendanceWaiverDto), never sent with HR's inputs.
 */
export class PayrollInputsDto {
  @Hours() workedHours?: number | null;
  @Hours() expectedHours?: number | null;
  @Percent() softSkills?: number | null;
  @Percent() performance?: number | null;
  @Percent() clientSatisfaction?: number | null;
  @Days() noShowDays?: number | null;
  /**
   * Approved paid leave this month, whole or half days (owner, 17 October 2026): no cut, its hours out of the expected
   * hours. Filled in from the Leave module's approved leave since 18 October 2026; typed, it wins (null: as the leave
   * says). No more than the line's days paid (PayrollService.updateLines).
   */
  @Days() leaveDays?: number | null;
  /**
   * Unpaid leave this month, whole or half days (owner, 18 October 2026): a day of the gross cut for each, its hours out
   * of the expected hours. Filled in from the approved unpaid leave (and the unpaid share of a partly paid one); typed, it
   * wins (null: as the leave says). With the leave days, no more than the line's days paid.
   */
  @Days() unpaidLeaveDays?: number | null;
  @Amount(0, RELEASED_MESSAGE) released?: number | null;
}

export class PayrollLineChangeDto {
  @IsUUID('all', { message: 'Send each line by its id.' })
  id: string;

  @IsOptional()
  @IsObject({ message: 'Send the inputs as an object.' })
  @ValidateNested()
  @Type(() => PayrollInputsDto)
  inputs?: PayrollInputsDto;

  /** Not paid by the bank files this month. */
  @Sent() @IsBoolean({ message: 'Send whether the line is on hold as true or false.' })
  onHold?: boolean;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: 'Keep the comments to 500 characters or fewer.' })
  comments?: string | null;
}

export class UpdatePayrollLinesDto {
  @IsArray({ message: 'Send the changed lines as a list.' })
  @ArrayMinSize(1, { message: 'Send at least one changed line.' })
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PayrollLineChangeDto)
  lines: PayrollLineChangeDto[];
}

/**
 * The CEO waives a line's attendance deduction, or takes the waiver back (owner, 17 October 2026: "if there is an
 * attendance deduction, allow the CEO to wave the deduction by ticking a box").
 */
export class AttendanceWaiverDto {
  @IsBoolean({ message: 'Send whether the attendance deduction is waived as true or false.' })
  waived: boolean;
}

export class ReturnPayrollDto {
  @Trim()
  @IsString({ message: 'Say why the payroll goes back to HR.' })
  @IsNotEmpty({ message: 'Say why the payroll goes back to HR.' })
  @MaxLength(1000, { message: 'Keep the reason to 1,000 characters or fewer.' })
  reason: string;
}

export class PaidPayrollDto {
  @IsDateOnly('Enter the date the salaries were paid.')
  paidOn: string;
}

export class CibFileQueryDto {
  /** The day the bank pays the salaries; today when not sent. */
  @IsOptional() @IsDateOnly('Choose the value date, as YYYY-MM-DD.')
  valueDate?: string;
}
