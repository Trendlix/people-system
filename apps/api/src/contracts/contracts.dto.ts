import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateBy, ValidateIf } from 'class-validator';
import {
  CONTRACT_FORMS,
  CONTRACT_STATUSES,
  EMPLOYMENT_TYPES,
  ENDING_RULES,
  ENDING_STATUSES,
  NOTICE_UNITS,
  type ContractForm,
  type ContractStatus,
  type EmploymentType,
  type EndingRuleKey,
  type EndingStatus,
  type NoticeUnit,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';

// Contracts, their settings, the ending rules and endings (owner's decisions, 15 October 2026, checked against Labour
// Law 14/2025). Dates: YYYY-MM-DD. Money: a number, to the piastre. Text fields: an empty string clears them.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

export const PROBATION_CAP_MESSAGE = "Probation can't be longer than 3 months (Labour Law Art. 90).";
const DURATION_MESSAGE = 'A fixed term runs for 1 to 60 months.';
/** decimal(12, 2) holds up to 9,999,999,999.99 */
const MAX_MONEY = 9_999_999_999.99;

// ---------- settings ----------

export class UpdateContractSettingsDto {
  @Sent() @IsInt({ message: 'Enter the months of probation as a whole number, 0 to 3.' }) @Min(0, { message: 'Enter 0 to 3 months of probation.' }) @Max(3, { message: PROBATION_CAP_MESSAGE })
  probationMonths?: number;

  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;
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

/** A contract's terms: what HR types. The end date, probation end and insured salary follow from them. */
class ContractTermsDto {
  /** Fixed term (the owner's choice for every employment type) unless sent. */
  @Sent() @IsIn(CONTRACT_FORMS, { message: 'Choose Fixed term or Open-ended.' })
  form?: ContractForm;

  /** Version 1: the join date unless sent; a renewal: the day after the version before ends. */
  @Sent() @IsDateOnly('Enter the start date.')
  startDate?: string;

  /** Fixed term only; the settings' duration (12 months) unless sent. */
  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;

  /** Version 1 only (a renewal has none); the settings' probation (3 months) unless sent, or 0 for someone who had one. */
  @Sent() @IsInt({ message: 'Enter the months of probation as a whole number, 0 to 3.' }) @Min(0, { message: 'Enter 0 to 3 months of probation.' }) @Max(3, { message: PROBATION_CAP_MESSAGE })
  probationMonths?: number;

  /** The share of the gross that is basic salary (80% unless sent); the rest is variable. */
  @Sent() @IsInt({ message: 'Enter the basic salary as a whole percentage, 1 to 100.' }) @Min(1, { message: 'Enter the basic salary as 1 to 100% of the gross.' }) @Max(100, { message: 'Enter the basic salary as 1 to 100% of the gross.' })
  basicPercent?: number;

  /** The approximate net, typed by HR. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the net salary as an amount, e.g. 9500 or 9500.50.' }) @Min(0, { message: 'The net salary cannot be negative.' }) @Max(MAX_MONEY)
  netSalary?: number | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class CreateContractDto extends ContractTermsDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the gross salary as an amount, e.g. 12000 or 12000.50.' })
  @Min(0.01, { message: 'Enter a gross salary of more than 0.' })
  @Max(MAX_MONEY)
  grossSalary: number;
}

/**
 * A draft takes any of its terms; a signed contract only the dates it was signed and filed, and its note (checked by
 * the service).
 */
export class UpdateContractDto extends ContractTermsDto {
  @Sent()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the gross salary as an amount, e.g. 12000 or 12000.50.' })
  @Min(0.01, { message: 'Enter a gross salary of more than 0.' })
  @Max(MAX_MONEY)
  grossSalary?: number;

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
const EmptyIsUnset = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

const ENDING_WITHIN_MESSAGE = 'Enter endingWithin as a whole number of days, 0 to 1830 (e.g. 30).';

/** The company-wide list (GET /contracts): every filter is optional. */
export class ListContractsDto {
  /** Draft and active (signed) contracts unless sent. */
  @EmptyIsUnset() @IsOptional() @IsIn(CONTRACT_STATUSES, { message: 'Choose a status: draft, active, ended or superseded.' })
  status?: ContractStatus;

  /** The employee's name (English or Arabic), employee code or the contract number; case doesn't matter. */
  @EmptyIsUnset() @IsOptional() @IsString({ message: 'Search with one text, e.g. a name or a contract number.' }) @MaxLength(100, { message: 'Search with at most 100 characters.' })
  q?: string;

  @EmptyIsUnset() @IsOptional() @IsIn(CONTRACT_FORMS, { message: 'Choose a form: fixed or open_ended.' })
  form?: ContractForm;

  /** The employment's type. */
  @EmptyIsUnset() @IsOptional() @IsIn(EMPLOYMENT_TYPES, { message: 'Choose an employment type: full_time, part_time, internship, freelance or sales.' })
  type?: EmploymentType;

  /** Signed contracts that end within this many days of today, those already past their end included. */
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : Number(trimmed); // not a number: NaN, refused below
  })
  @IsOptional()
  @ValidateBy({ name: 'isDays', validator: { validate: (v) => Number.isInteger(v) && v >= 0 && v <= 1830, defaultMessage: () => ENDING_WITHIN_MESSAGE } })
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
