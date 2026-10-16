import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { RAISE_REASONS, RAISE_REQUEST_STATUSES, RAISE_WAYS, type RaiseReason, type RaiseRequestStatus, type RaiseWay } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { DURATION_MESSAGE, MAX_MONEY, PayTermsDto, RAISE_REASON_MESSAGE, Sent } from './contracts.dto.js';

// Pay raises during a contract and raise requests (owner's decisions, 16 October 2026; packages/shared raises.ts).
// Dates: YYYY-MM-DD. Money: a number, to the piastre. Text fields: an empty string clears them.

const WAY_MESSAGE = 'Choose how the raise is made: amendment (the same contract) or contract (a new contract).';
const EFFECTIVE_MESSAGE = 'Enter the date the raise takes effect, the 1st of a month.';
const SUGGESTED_MESSAGE = 'Enter the suggested gross as an amount of more than 0, e.g. 15000.';

/** The promotion that may come with a raise: a new job title and grade (within the job title's range); null clears one. */
class PromotionDto extends PayTermsDto {
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the new job title.' })
  newJobTitleId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose the new grade.' })
  newGradeId?: string | null;
}

/** A raise on the signed contract in force: the way, the effective date, the new pay, why, and a promotion if any. */
export class CreateRaiseDto extends PromotionDto {
  @IsIn(RAISE_WAYS, { message: WAY_MESSAGE })
  way: RaiseWay;

  /** The 1st of a month, after the contract in force started and not after it ends. */
  @IsDateOnly(EFFECTIVE_MESSAGE)
  effectiveDate: string;

  /** A new contract only: its term (the contract settings' 12 months unless sent). */
  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;

  @IsIn(RAISE_REASONS, { message: RAISE_REASON_MESSAGE })
  reason: RaiseReason;

  /** The raise request it is prepared from (HR prepares it from one with HR). */
  @IsOptional() @IsUUID('all', { message: 'Choose the raise request.' })
  requestId?: string;
}

/** A raise not yet with the CEO (a draft, returned, or approved, which then goes back to the CEO): any of its terms. */
export class UpdateRaiseDto extends PromotionDto {
  @Sent() @IsIn(RAISE_WAYS, { message: WAY_MESSAGE })
  way?: RaiseWay;

  @Sent() @IsDateOnly(EFFECTIVE_MESSAGE)
  effectiveDate?: string;

  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;

  @Sent() @IsIn(RAISE_REASONS, { message: RAISE_REASON_MESSAGE })
  reason?: RaiseReason;
}

/** The CEO returns a raise to HR, or declines it (a raise request too): the reason is required. */
export class RaiseReasonDto {
  @Trim() @IsString({ message: 'Enter the reason.' }) @MinLength(1, { message: 'Enter the reason.' }) @MaxLength(1000)
  reason: string;
}

/** Form 2 filed: the insured wage follows the new pay from this 1st of a month; null when none was filed after all. */
export class RaiseForm2Dto {
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter the date Form 2 changes the insured wage from, the 1st of a month.')
  form2From: string | null;
}

/** A raise request: why (required) and, from the employee or HR, the gross they suggest. */
export class CreateRaiseRequestDto {
  @Trim() @IsString({ message: 'Say why the raise is asked for.' }) @MinLength(1, { message: 'Say why the raise is asked for.' }) @MaxLength(2000)
  reason: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: SUGGESTED_MESSAGE }) @Min(0.01, { message: SUGGESTED_MESSAGE }) @Max(MAX_MONEY, { message: SUGGESTED_MESSAGE })
  suggestedGross?: number | null;
}

/** ?status= on the Raise Requests page; all unless sent. */
export class ListRaiseRequestsDto {
  @IsOptional() @IsIn(RAISE_REQUEST_STATUSES, { message: 'Choose a status: with_hr, with_ceo, approved, declined or done.' })
  status?: RaiseRequestStatus;
}
