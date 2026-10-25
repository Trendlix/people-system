import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import {
  CONTRACT_FORMS,
  CONTRACT_STATUSES,
  EMPLOYMENT_TYPES,
  ENDING_RULES,
  ENDING_STATUSES,
  NOTICE_UNITS,
  PAY_BASES,
  RAISE_REASONS,
  type ContractForm,
  type ContractStatus,
  type EmploymentType,
  type EndingRuleKey,
  type EndingStatus,
  type NoticeUnit,
  type PayBasis,
  type RaiseReason,
} from '@trendlix/shared';
import { AllowanceRows, type AllowanceAmountDto } from '../allowances/allowances.dto.js';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { EMPLOYMENT_TYPE_MESSAGE } from '../employees/employment.dto.js';

// Contracts, their settings, the ending rules and endings (owner's decisions, 15 October 2026, checked against Labour
// Law 14/2025). Dates: YYYY-MM-DD. Money: a number, to the piastre. Text fields: an empty string clears them.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
export const Sent = () => ValidateIf((_o, v) => v !== undefined);

export const PROBATION_CAP_MESSAGE = "Probation can't be longer than 3 months (Labour Law Art. 90).";
export const DURATION_MESSAGE = 'A fixed term runs for 1 to 60 months.';
const INSURANCE_BASIC_MESSAGE = 'Enter the default basic wage as an amount of more than 0 and up to 99,999.99, e.g. 410.';
const BASIC_PERCENT_DEFAULT_MESSAGE = 'Enter the basic share of the gross as a whole percent from 1 to 100, e.g. 80.';
/**
 * A contract's length (Labour Law 14/2025 Arts. 87, 88, 155): on 15 October 2026 the owner had every contract
 * fixed-term; open-ended and specific-job ones came back on 18 October 2026, fixed-term staying the default.
 */
export const FORM_MESSAGE = 'Choose the contract’s length: fixed (fixed-term), open_ended or specific_job.';
const JOB_TO_DO_MESSAGE = 'Enter the job the contract is for, up to 500 characters (Labour Law Art. 155).';
/** decimal(12, 2) holds up to 9,999,999,999.99 */
export const MAX_MONEY = 9_999_999_999.99;
/** decimal(10, 2) holds up to 99,999,999.99 */
const MAX_HOURLY_RATE = 99_999_999.99;
const HOURLY_RATE_MESSAGE = 'Enter the hourly rate as an amount of more than 0, e.g. 150 or 162.50.';
const HOURS_MESSAGE = 'Enter the hours a week as a number of more than 0 and up to 48, e.g. 24 or 22.5.';
const DAYS_MESSAGE = 'Enter the working days a week as a whole number, 1 to 6.';
export const RAISE_REASON_MESSAGE =
  'Choose why the pay changes: annual, performance, counter_offer, promotion, market_adjustment, cost_of_living or other.';

// ---------- settings ----------

export class UpdateContractSettingsDto {
  @Sent() @IsInt({ message: 'Enter the months of probation as a whole number, 0 to 3.' }) @Min(0, { message: 'Enter 0 to 3 months of probation.' }) @Max(3, { message: PROBATION_CAP_MESSAGE })
  probationMonths?: number;

  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;

  /** The basic wage social insurance Form 1 prints for an employee who has none of their own (owner, 16 October 2026). */
  @Sent()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: INSURANCE_BASIC_MESSAGE })
  @Min(0.01, { message: INSURANCE_BASIC_MESSAGE })
  @Max(99_999.99, { message: INSURANCE_BASIC_MESSAGE })
  insuranceBasicDefault?: number;

  /** The basic salary's share of the gross a new contract or offer starts with (owner, 16 October 2026: Payroll Setup). */
  @Sent()
  @IsInt({ message: BASIC_PERCENT_DEFAULT_MESSAGE })
  @Min(1, { message: BASIC_PERCENT_DEFAULT_MESSAGE })
  @Max(100, { message: BASIC_PERCENT_DEFAULT_MESSAGE })
  basicPercentDefault?: number;
}

// ---------- ending rules ----------

export class UpdateEndingRuleDto {
  @Sent() @Trim() @IsString() @MinLength(1, { message: 'Enter a label.' }) @MaxLength(120)
  label?: string;

  @Sent() @IsInt({ message: 'Enter the notice as a whole number, 0 to 365.' }) @Min(0, { message: 'Enter a notice of 0 to 365.' }) @Max(365, { message: 'Enter a notice of 0 to 365.' })
  noticeAmount?: number;

  @Sent() @IsIn(NOTICE_UNITS, { message: 'Choose days, working days, weeks or months.' })
  noticeUnit?: NoticeUnit;

  @Sent() @IsBoolean()
  payInLieu?: boolean;

  @Sent() @IsBoolean()
  active?: boolean;
}

// ---------- contracts ----------

/**
 * A version's pay, as a contract and a raise take it: the basic share, the net, the gross or the hourly terms, the
 * working days and the allowances; and its note.
 */
export class PayTermsDto {
  /** The share of the gross that is basic salary (80% unless sent); the rest is variable. */
  @Sent() @IsInt({ message: 'Enter the basic salary as a whole percentage, 1 to 100.' }) @Min(1, { message: 'Enter the basic salary as 1 to 100% of the gross.' }) @Max(100, { message: 'Enter the basic salary as 1 to 100% of the gross.' })
  basicPercent?: number;

  /** The approximate net, typed by HR: the pay in hand, allowances included. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the net salary as an amount, e.g. 9500 or 9500.50.' }) @Min(0, { message: 'The net salary cannot be negative.' }) @Max(MAX_MONEY)
  netSalary?: number | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;

  /**
   * The gross a month. Required for a monthly salary; by the hour it is worked out (rate × hours a week × 52 ÷ 12), so
   * it may be left out, and is replaced if sent.
   */
  @Sent()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the gross salary as an amount, e.g. 12000 or 12000.50.' })
  @Min(0.01, { message: 'Enter a gross salary of more than 0.' })
  @Max(MAX_MONEY)
  grossSalary?: number;

  /** How the pay is set (owner's request, 15 October 2026): a monthly salary unless sent, or by the hour. */
  @Sent() @IsIn(PAY_BASES, { message: 'Choose how the pay is set: monthly or hourly.' })
  payBasis?: PayBasis;

  /** By the hour only (required then); empty for a monthly salary. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: HOURLY_RATE_MESSAGE }) @Min(0.01, { message: HOURLY_RATE_MESSAGE }) @Max(MAX_HOURLY_RATE, { message: HOURLY_RATE_MESSAGE })
  hourlyRate?: number | null;

  /** By the hour only (required then): the contracted hours a week, up to the legal 48, to one decimal. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }, { message: HOURS_MESSAGE }) @Min(0.1, { message: HOURS_MESSAGE }) @Max(48, { message: HOURS_MESSAGE })
  hoursPerWeek?: number | null;

  /** The working days a week (part-time: 2, 3 …), any employment type; empty: the shift's week. */
  @IsOptional() @IsInt({ message: DAYS_MESSAGE }) @Min(1, { message: DAYS_MESSAGE }) @Max(6, { message: DAYS_MESSAGE })
  daysPerWeek?: number | null;

  /**
   * Paid every month on top of the gross: a draft's whole set ([] for none). Left out, a draft keeps its own, and a new
   * renewal copies the version before's as they are.
   */
  @AllowanceRows()
  allowances?: AllowanceAmountDto[];
}

/**
 * A contract's terms: what HR types. The end date, probation end and insured salary follow from them, and by the hour
 * the gross too.
 */
class ContractTermsDto extends PayTermsDto {
  /**
   * The contract's length: fixed-term unless sent (for a renewal, the version before's). Open-ended: no duration and no
   * end date, it ends by notice (Art. 156); for a specific job: the job (jobToDo) and, optional, the day it is expected
   * to be done (endDate).
   */
  @Sent() @IsIn(CONTRACT_FORMS, { message: FORM_MESSAGE })
  form?: ContractForm;

  /** For a specific job only (required then): the job the contract is for (Art. 155). */
  @TrimOrNull() @IsOptional() @IsString({ message: JOB_TO_DO_MESSAGE }) @MaxLength(500, { message: JOB_TO_DO_MESSAGE })
  jobToDo?: string | null;

  /** For a specific job only: the day the job is expected to be done, on or after the start; empty for none. */
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter a real date for when the job is expected to be done.')
  endDate?: string | null;

  /** Version 1: the join date unless sent; a renewal: the day after the version before ends. */
  @Sent() @IsDateOnly('Enter the start date.')
  startDate?: string;

  /** The settings' duration (12 months) unless sent. */
  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;

  /** Version 1 only (a renewal has none); the settings' probation (3 months) unless sent, or 0 for someone who had one. */
  @Sent() @IsInt({ message: 'Enter the months of probation as a whole number, 0 to 3.' }) @Min(0, { message: 'Enter 0 to 3 months of probation.' }) @Max(3, { message: PROBATION_CAP_MESSAGE })
  probationMonths?: number;

  /**
   * Why the pay changes, on a version after the first whose pay isn't the one before's (a renewal with new pay counts
   * as a raise: owner, 16 October 2026): required then, and the CEO approves it before it is signed; ignored when the pay
   * stays the same.
   */
  @Sent() @IsIn(RAISE_REASONS, { message: RAISE_REASON_MESSAGE })
  raiseReason?: RaiseReason;
}

export class CreateContractDto extends ContractTermsDto {
  /**
   * An intern's agreement converted to a full-time contract (owner, 19 October 2026: "or can be only
   * renewed 1 time, after that it should be converted to a full time contract"): this version is the full-time contract,
   * after the agreement; signing it makes the employment full-time (the same employment, so the service counts on).
   */
  @Sent() @IsIn(['full_time'], { message: 'An internship agreement is converted to full_time: send convertsTo as full_time, or leave it out.' })
  convertsTo?: 'full_time';
}

/**
 * A draft takes any of its terms; a signed contract only the dates it was signed and filed, and its note (checked by
 * the service).
 */
export class UpdateContractDto extends ContractTermsDto {
  @Sent() @IsDateOnly('Enter the date the contract was signed.')
  signedOn?: string;

  /** When it was filed with social insurance. */
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter a real date for the social insurance filing.')
  insuranceFiledOn?: string | null;

  /** When it was filed at the labour office. */
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter a real date for the labour office filing.')
  labourOfficeFiledOn?: string | null;
}

export class SignContractDto {
  @IsDateOnly('Enter the date the contract was signed.')
  signedOn: string;
}

/** A query parameter sent empty (e.g. a filter left on "All") counts as not sent; text is trimmed. */
export const EmptyIsUnset = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

const ENDING_WITHIN_MESSAGE = 'Enter endingWithin as a whole number of days, 0 to 1830 (e.g. 30).';
/** A search of contracts: the Contracts page's and the Contracts report's (25 October 2026). */
export const SEARCH_MESSAGE = 'Search with one text, e.g. a name or a contract number.';
export const SEARCH_LENGTH_MESSAGE = 'Search with at most 100 characters.';

/**
 * ?endingWithin=N: signed contracts that end within N days of today, a whole number from 0 to 1830; empty counts as not
 * sent. The Contracts page's and the Contracts report's (25 October 2026).
 */
export const EndingWithinDays = () =>
  applyDecorators(
    Transform(({ value }) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : Number(trimmed); // not a number: NaN, refused below
    }),
    IsOptional(),
    ValidateBy({ name: 'isDays', validator: { validate: (v) => Number.isInteger(v) && v >= 0 && v <= 1830, defaultMessage: () => ENDING_WITHIN_MESSAGE } }),
  );

/** The company-wide list (GET /contracts): every filter is optional. */
export class ListContractsDto {
  /** Draft and active (signed) contracts unless sent. */
  @EmptyIsUnset() @IsOptional() @IsIn(CONTRACT_STATUSES, { message: 'Choose a status: draft, active, ended or superseded.' })
  status?: ContractStatus;

  /** The employee's name (English or Arabic), employee code or the contract number; case doesn't matter. */
  @EmptyIsUnset() @IsOptional() @IsString({ message: SEARCH_MESSAGE }) @MaxLength(100, { message: SEARCH_LENGTH_MESSAGE })
  q?: string;

  /** The contract's length: fixed, open_ended or specific_job. */
  @EmptyIsUnset() @IsOptional() @IsIn(CONTRACT_FORMS, { message: FORM_MESSAGE })
  form?: ContractForm;

  /** The employment's type. */
  @EmptyIsUnset() @IsOptional() @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
  type?: EmploymentType;

  /** Signed contracts that end within this many days of today, those already past their end included. */
  @EndingWithinDays()
  endingWithin?: number;
}

/** ?within=N: how many days ahead the alert lists look. */
export class WithinDto {
  @IsOptional() @Type(() => Number) @IsInt({ message: 'Enter a number of days.' }) @Min(0) @Max(366)
  within?: number;
}

// ---------- endings ----------

export class CreateEndingDto {
  @IsIn(ENDING_RULES, { message: 'Choose how the employment ends.' })
  ruleKey: EndingRuleKey;

  /** Who ends it: needed when either side can (an ending during probation, mutual agreement). */
  @TrimOrNull() @IsOptional() @IsIn(['employee', 'company'], { message: 'Choose who ends it: the employee or the company.' })
  initiator?: 'employee' | 'company' | null;

  /** The day the notice was received, or the day of the event (e.g. death). */
  @IsDateOnly('Enter the date the notice was given.')
  noticeGivenOn: string;

  /** The notice paid instead of worked, where the rule allows it: the last working day is then the notice date. */
  @IsOptional() @IsBoolean()
  payInLieu?: boolean;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  reason?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;

  /** Resignation only: the labour office that certified it (Decree 187/2025). */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(200)
  certifiedOffice?: string | null;

  /** Resignation only: the certification's serial number. */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  certifiedSerial?: string | null;

  /** Resignation only: the day it was certified. */
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter a real date for the certification.')
  certifiedOn?: string | null;
}

/** The CEO's approval, or HR withdrawing an ending: an optional note. */
export class EndingNoteDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
}

/** The CEO's rejection: the reason is required. */
export class RejectEndingDto {
  @Trim() @IsString({ message: 'Enter why the ending is rejected.' }) @MinLength(1, { message: 'Enter why the ending is rejected.' }) @MaxLength(1000)
  note: string;
}

export class ListEndingsDto {
  @IsOptional() @IsIn(ENDING_STATUSES, { message: 'Choose a status: pending_ceo, approved, rejected, withdrawn or completed.' })
  status?: EndingStatus;
}
