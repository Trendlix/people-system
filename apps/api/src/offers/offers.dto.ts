import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateBy, ValidateIf } from 'class-validator';
import {
  EMPLOYMENT_TYPES,
  OFFER_SEND_WAYS,
  OFFER_SHOWN_STATUSES,
  PAY_BASES,
  phoneOk,
  phoneTidy,
  WORK_ARRANGEMENTS,
  WORK_NATURES,
  type EmploymentType,
  type OfferSendWay,
  type OfferShownStatus,
  type PayBasis,
  type WorkArrangement,
  type WorkNature,
} from '@trendlix/shared';
import { AllowanceRows, type AllowanceAmountDto } from '../allowances/allowances.dto.js';
import { IsDateOnly } from '../common/date-only.js';
import { LatinDigits, Trim, TrimOrNull } from '../common/transforms.js';
import { PROBATION_CAP_MESSAGE } from '../contracts/contracts.dto.js';
import { COMMISSION_MESSAGE, EMPLOYMENT_TYPE_MESSAGE, WORK_NATURE_MESSAGE } from '../employees/employment.dto.js';
import { PDF_ONLY } from '../pdf/pdf-file.js';

// Job offers (owner's request, 15 October 2026): the candidate, the position and the terms HR drafts, sending the
// offer, and the answer. Dates: YYYY-MM-DD. Money: a number, to the piastre. Text fields: an empty string clears them.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

const LowerEmail = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value));
// kept as the profile keeps phones: "010 1234-5678" becomes "+201012345678" (see employee.dto.ts)
const Phone = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const typed = value.trim();
    return typed ? phoneTidy(typed) || typed : null;
  });
const IsPhone = () =>
  ValidateBy({
    name: 'isPhone',
    validator: {
      validate: (v) => typeof v === 'string' && phoneOk(v),
      defaultMessage: () => 'Enter the mobile number with its country code, e.g. +201012345678.',
    },
  });

/** decimal(12, 2) holds up to 9,999,999,999.99; decimal(10, 2) up to 99,999,999.99 */
const MAX_MONEY = 9_999_999_999.99;
const MAX_RATE = 99_999_999.99;
const DURATION_MESSAGE = 'A fixed term runs for 1 to 60 months.';
const GROSS_MESSAGE = 'Enter the gross salary as an amount, e.g. 12000 or 12000.50.';
const RATE_MESSAGE = 'Enter the hourly rate as an amount of more than 0, e.g. 150 or 150.50.';
// as on a contract, which is made from the offer: up to the legal 48 hours, over at most 6 days
const HOURS_MESSAGE = 'Enter the hours a week as a number of more than 0 and up to 48, e.g. 24 or 22.5.';
const DAYS_MESSAGE = 'Enter the working days a week as a whole number, 1 to 6.';
const NAME_EN_MESSAGE = 'Enter the full name in English.';
const NAME_AR_MESSAGE = 'Enter the full name in Arabic.';
const EMAIL_MESSAGE = "Enter the candidate's email, e.g. name@example.com.";

/** The web app's address the link points to: http(s), a host, and nothing after it (no path, query or fragment). */
export function isWebOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
}

/** What a draft can change besides the candidate's name, email, the employment type and the join date. */
class OfferFieldsDto {
  @LatinDigits() @Phone() @IsOptional() @IsPhone()
  mobile?: string | null;

  /** A former employee offered again: their profile is used once they accept. They must have no current employment. */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the former employee.' })
  employeeId?: string | null;

  /** A department or one of its teams; with a job title, the one the job title belongs to (it follows the job title when left out). */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a department or team.' })
  departmentId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a job title.' })
  jobTitleId?: string | null;

  /** The person's grade, within the range of grades the job title takes. */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a grade.' })
  gradeId?: string | null;

  /** A current employee. */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a manager.' })
  managerId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a shift.' })
  shiftId?: string | null;

  @Sent() @IsIn(WORK_ARRANGEMENTS, { message: 'Choose Office, Work from home or Hybrid.' })
  workArrangement?: WorkArrangement;

  /** 0 = Sunday … 6 = Saturday; Hybrid only */
  @Sent() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  officeDays?: number[];

  /**
   * Paid by commission, a full-time offer only (owner, 18 October 2026: Sales became Full-time with this flag): its job
   * offer is the commission one when published. Off unless sent; carried to the employment when accepted.
   */
  @Sent() @IsBoolean({ message: COMMISSION_MESSAGE })
  paidByCommission?: boolean;

  /** The nature of the work (Labour Law 14/2025 Art. 1(6–8)): regular unless sent; carried to the employment. */
  @Sent() @IsIn(WORK_NATURES, { message: WORK_NATURE_MESSAGE })
  workNature?: WorkNature;

  /** Monthly unless sent; by the hour, the gross is the monthly estimate (hourly rate × hours a week × 52 ÷ 12). */
  @Sent() @IsIn(PAY_BASES, { message: 'Choose Monthly salary or By the hour.' })
  payBasis?: PayBasis;

  /** A month: needed for a monthly salary; worked out for pay by the hour. */
  @Sent() @IsNumber({ maxDecimalPlaces: 2 }, { message: GROSS_MESSAGE }) @Min(0.01, { message: 'Enter a gross salary of more than 0.' }) @Max(MAX_MONEY)
  grossSalary?: number;

  /** By the hour only. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: RATE_MESSAGE }) @Min(0.01, { message: RATE_MESSAGE }) @Max(MAX_RATE, { message: RATE_MESSAGE })
  hourlyRate?: number | null;

  /** By the hour only: the contracted hours. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }, { message: HOURS_MESSAGE }) @Min(0.1, { message: HOURS_MESSAGE }) @Max(48, { message: HOURS_MESSAGE })
  hoursPerWeek?: number | null;

  /** Working days a week (part-time: 2, 3 …); empty: the shift's week. */
  @IsOptional() @IsInt({ message: DAYS_MESSAGE }) @Min(1, { message: DAYS_MESSAGE }) @Max(6, { message: DAYS_MESSAGE })
  daysPerWeek?: number | null;

  /** The share of the gross that is basic salary (80% unless sent); the rest is variable. */
  @Sent() @IsInt({ message: 'Enter the basic salary as a whole percentage, 1 to 100.' }) @Min(1, { message: 'Enter the basic salary as 1 to 100% of the gross.' }) @Max(100, { message: 'Enter the basic salary as 1 to 100% of the gross.' })
  basicPercent?: number;

  /** The approximate net, typed by HR. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the net salary as an amount, e.g. 9500 or 9500.50.' }) @Min(0, { message: 'The net salary cannot be negative.' }) @Max(MAX_MONEY)
  netSalary?: number | null;

  /** The contract settings' probation unless sent; 0 for someone who already had an employment with the company (Art. 90). */
  @Sent() @IsInt({ message: 'Enter the months of probation as a whole number, 0 to 3.' }) @Min(0, { message: 'Enter 0 to 3 months of probation.' }) @Max(3, { message: PROBATION_CAP_MESSAGE })
  probationMonths?: number;

  /** The contract settings' fixed term (12 months) unless sent. */
  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;

  /** Each kind once, an amount a month each; sent, it replaces the offer's allowances ([] for none). */
  @AllowanceRows()
  allowances?: AllowanceAmountDto[];

  /** The last day to accept: OFFER_VALID_DAYS from today unless sent; never in the past. */
  @Sent() @IsDateOnly("Enter the offer's last day as a real date.")
  expiresOn?: string;

  /** A few words to the candidate, in the email and on the offer's page. */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(2000)
  message?: string | null;

  /** For HR only. */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class CreateOfferDto extends OfferFieldsDto {
  @Trim() @IsString({ message: NAME_EN_MESSAGE }) @MinLength(1, { message: NAME_EN_MESSAGE }) @MaxLength(150)
  fullNameEn: string;

  @Trim() @IsString({ message: NAME_AR_MESSAGE }) @MinLength(1, { message: NAME_AR_MESSAGE }) @MaxLength(150)
  fullNameAr: string;

  /** Their personal email, where the offer is sent. */
  @LowerEmail() @IsEmail({}, { message: EMAIL_MESSAGE }) @MaxLength(254)
  email: string;

  @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
  employmentType: EmploymentType;

  /** The expected first day. */
  @IsDateOnly('Enter the expected join date.')
  joinDate: string;
}

/** A draft takes any field; a sent offer only its last day and the note (checked by the service). */
export class UpdateOfferDto extends OfferFieldsDto {
  @Sent() @Trim() @IsString({ message: NAME_EN_MESSAGE }) @MinLength(1, { message: NAME_EN_MESSAGE }) @MaxLength(150)
  fullNameEn?: string;

  @Sent() @Trim() @IsString({ message: NAME_AR_MESSAGE }) @MinLength(1, { message: NAME_AR_MESSAGE }) @MaxLength(150)
  fullNameAr?: string;

  @Sent() @LowerEmail() @IsEmail({}, { message: EMAIL_MESSAGE }) @MaxLength(254)
  email?: string;

  @Sent() @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
  employmentType?: EmploymentType;

  @Sent() @IsDateOnly('Enter the expected join date.')
  joinDate?: string;
}

/** A query parameter sent empty (e.g. a filter left on "All") counts as not sent; text is trimmed. */
const EmptyIsUnset = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

export const OFFER_LIST_STATUSES = [...OFFER_SHOWN_STATUSES, 'open'] as const;

/** GET /offers: every filter is optional. */
export class ListOffersDto {
  /** A shown status, or open: drafts and sent offers not expired. */
  @EmptyIsUnset() @IsOptional() @IsIn(OFFER_LIST_STATUSES, { message: 'Choose a status: open, draft, sent, expired, accepted, declined or withdrawn.' })
  status?: OfferShownStatus | 'open';

  /** The candidate's name (English or Arabic), email or the offer number; case doesn't matter. */
  @EmptyIsUnset() @IsOptional() @IsString({ message: 'Search with one text, e.g. a name or an offer number.' }) @MaxLength(100, { message: 'Search with at most 100 characters.' })
  q?: string;
}

/** GET /offers/:id/document: a protected PDF only (owner's request, 15 October 2026); ?download=1 saves it. */
export class OfferDocumentQueryDto {
  /** pdf, or none: the Word file is refused (pdfOnly). */
  @EmptyIsUnset() @IsOptional() @IsString({ message: PDF_ONLY })
  format?: string;

  /** 1 (or true): saved rather than shown. */
  @EmptyIsUnset() @IsOptional() @IsString({ message: 'Send download=1 to save the PDF, or leave it out to open it.' })
  download?: string;
}

export class SendOfferDto {
  @IsIn(OFFER_SEND_WAYS, { message: 'Choose how to send the offer: by email, or as a link you send yourself.' })
  via: OfferSendWay;

  /** The web app's address, e.g. https://people.example.com: the link is <origin>/offer/<secret>. */
  @Trim()
  @ValidateBy({ name: 'isWebOrigin', validator: { validate: isWebOrigin, defaultMessage: () => "Send the web app's address, e.g. https://people.example.com, with nothing after it." } })
  origin: string;

  /** Where the email goes, when not the candidate's email on the offer. */
  @LowerEmail() @IsOptional() @IsEmail({}, { message: 'Enter a valid email to send the offer to.' }) @MaxLength(254)
  to?: string | null;
}

export class WithdrawOfferDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  reason?: string | null;
}

/** An answer the candidate gave another way (by phone, on paper …), recorded by HR. */
export class AnswerOfferDto {
  @IsIn(['accepted', 'declined'], { message: 'Choose the answer: accepted or declined.' })
  answer: 'accepted' | 'declined';

  /** Why they declined, when they said. */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  reason?: string | null;
}

/** Where the candidate answered from, as the web app saw it (kept shortened). */
class ResponseOriginDto {
  @TrimOrNull() @IsOptional() @IsString()
  ip?: string | null;

  @TrimOrNull() @IsOptional() @IsString()
  userAgent?: string | null;
}

export class AcceptOfferDto extends ResponseOriginDto {
  /** The candidate's full name as on the offer, in English or Arabic. */
  @Trim() @IsString({ message: 'Type your full name as it is on the offer.' }) @MinLength(1, { message: 'Type your full name as it is on the offer.' }) @MaxLength(300)
  name: string;
}

export class DeclineOfferDto extends ResponseOriginDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  reason?: string | null;
}
