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

export class UpdatePayrollSettingsDto {
  @Sent() @IsInt({ message: DIVISOR_MESSAGE }) @Min(20, { message: DIVISOR_MESSAGE }) @Max(31, { message: DIVISOR_MESSAGE })
  dayDivisor?: number;

  @Sent() @IsNumber({ maxDecimalPlaces: 2 }, { message: GRACE_MESSAGE }) @Min(0, { message: GRACE_MESSAGE }) @Max(100, { message: GRACE_MESSAGE })
  attendanceGracePercent?: number;

  @Sent() @IsNumber({ maxDecimalPlaces: 2 }, { message: GRACE_MESSAGE }) @Min(0, { message: GRACE_MESSAGE }) @Max(100, { message: GRACE_MESSAGE })
  kpiGracePercent?: number;

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
}

// ---------- runs ----------

export class CreatePayrollRunDto {
  @Trim() @Matches(MONTH, { message: 'Choose the month, as YYYY-MM.' })
  month: string;
}

const HOURS_MESSAGE = 'Enter the hours from 0 to 744, e.g. 270 or 270:30.';
const PERCENT_MESSAGE = 'Enter the percent from 0 to 200, e.g. 95.';
const DAYS_MESSAGE = 'Enter the days from 0 to 31, in whole or half days, e.g. 2 or 1.5.';
const AMOUNT_MESSAGE = 'Enter the amount, to the piaster, within 10,000,000 either way.';
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
const Amount = (min = -MAX_AMOUNT, message = AMOUNT_MESSAGE) => (target: object, key: string) => {
  IsOptional()(target, key);
  IsNumber({ maxDecimalPlaces: 2 }, { message })(target, key);
  Min(min, { message })(target, key);
  Max(MAX_AMOUNT, { message })(target, key);
};

/**
 * The month's inputs of a line, any of them (null clears one: not given). The hours are numbers (the screen reads
 * 270:30 as 270.5); attendance will fill the same inputs later. There is no medical subscription any more (owner's
 * decision, 16 October 2026): `medical` is refused as any field not here is.
 */
export class PayrollInputsDto {
  @Hours() workedHours?: number | null;
  @Hours() expectedHours?: number | null;
  @Percent() softSkills?: number | null;
  @Percent() performance?: number | null;
  @Percent() clientSatisfaction?: number | null;
  @Days() noShowDays?: number | null;
  @Days() penaltyDays?: number | null;
  @Days() bonusDays?: number | null;
  @Amount() commission?: number | null;
  /** One-off amounts in the gross, such as last month's corrections: may be negative. */
  @Amount() settlements?: number | null;
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
