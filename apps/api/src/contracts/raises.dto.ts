import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  MAX_RAISE_PERCENT,
  RAISE_REASON_CHOICES,
  RAISE_REASONS,
  RAISE_REQUEST_STATUSES,
  RAISE_WAYS,
  type RaiseReason,
  type RaiseReasonChoice,
  type RaiseRequestStatus,
  type RaiseWay,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { MONTH } from '../payroll/months.js';
import { DURATION_MESSAGE, MAX_MONEY, PayTermsDto, RAISE_REASON_MESSAGE, Sent } from './contracts.dto.js';

// Pay raises during a contract and raise requests (owner's decisions, 16 October 2026; packages/shared raises.ts).
// Dates: YYYY-MM-DD. Money: a number, to the piastre. Text fields: an empty string clears them.

const WAY_MESSAGE = 'Choose how the raise is made: amendment (the same contract) or contract (a new contract).';
const EFFECTIVE_MESSAGE = 'Enter the date the raise takes effect, the 1st of a month.';
const AMOUNT_MESSAGE = 'Enter the raise as an amount in EGP of more than 0, to the piaster, e.g. 1500.';
const PERCENT_MESSAGE = `Enter the raise as a percent of more than 0 and up to ${MAX_RAISE_PERCENT}, with two decimals at most, e.g. 10 or 7.5.`;
const COMMENT_MESSAGE = 'Write a comment.';
const REQUEST_REASON_MESSAGE = 'Choose why the raise is asked for: annual, performance, counter_offer, promotion, market_adjustment, cost_of_living or other.';
const DECISION_MESSAGE = 'Choose approve (as suggested) or approve_other (with another raise). To reject it, decline it.';
const EFFECTIVE_FROM_MESSAGE = 'Choose the month the raise is to take effect from, as its 1st (YYYY-MM-01), e.g. 2026-11-01.';

/** A raise as an amount (EGP a month added to the gross) or a percent of the gross: one or the other (the service checks). */
class RaiseFigureDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: AMOUNT_MESSAGE }) @Min(0.01, { message: AMOUNT_MESSAGE }) @Max(MAX_MONEY, { message: AMOUNT_MESSAGE })
  increaseAmount?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: PERCENT_MESSAGE }) @Min(0.01, { message: PERCENT_MESSAGE }) @Max(MAX_RAISE_PERCENT, { message: PERCENT_MESSAGE })
  increasePercent?: number;
}

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

  /**
   * The raise request it is prepared from (HR prepares it from one with HR): HR's approval of it, sent to the CEO at once
   * (owner, 17 October 2026), with HR's comment (required then).
   */
  @IsOptional() @IsUUID('all', { message: 'Choose the raise request.' })
  requestId?: string;

  @Trim() @IsOptional() @IsString({ message: COMMENT_MESSAGE }) @MaxLength(1000)
  comment?: string;
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

/**
 * A step with a comment (owner, 17 October 2026: "Approve - Approve with another raise amount or percentge - Reject, and
 * add a comment"): the CEO returns a raise to HR, or rejects it; HR rejects a request. The comment is required, sent as
 * `comment`, or as `reason`, as it was before then.
 */
export class RaiseCommentDto {
  @Trim() @ValidateIf((o: RaiseCommentDto) => o.reason === undefined) @IsString({ message: COMMENT_MESSAGE }) @MinLength(1, { message: COMMENT_MESSAGE }) @MaxLength(1000)
  comment?: string;

  @Trim() @IsOptional() @IsString({ message: COMMENT_MESSAGE }) @MinLength(1, { message: COMMENT_MESSAGE }) @MaxLength(1000)
  reason?: string;
}

/** The comment of a RaiseCommentDto, as sent either way. */
export const commentOf = (dto: RaiseCommentDto): string => (dto.comment ?? dto.reason)!;

/**
 * The CEO approves a raise (owner, 17 October 2026): as it reached them, or with another raise, an amount or a percent
 * over the pay before it, which its pay is changed to; always with a comment.
 */
export class ApproveRaiseDto extends RaiseFigureDto {
  @Trim() @IsString({ message: COMMENT_MESSAGE }) @MinLength(1, { message: COMMENT_MESSAGE }) @MaxLength(1000)
  comment: string;
}

/** HR sends a raise to the CEO: a comment if HR wants (e.g. on a raise the CEO returned). */
export class SendRaiseDto {
  @Trim() @IsOptional() @IsString({ message: COMMENT_MESSAGE }) @MaxLength(1000)
  comment?: string;
}

/**
 * HR approves a raise request (owner, 17 October 2026): as suggested, or with another raise (an amount or a percent of
 * the gross in force), with a comment; and how the raise is made: the way, the effective date (the 1st of a month; the
 * request's Effective from unless sent, 17 October 2026) and a new contract's length. The raise is prepared from it and
 * sent to the CEO. Its reason is the request's, unless sent (a request from before then has none).
 */
export class ApproveRaiseRequestDto extends RaiseFigureDto {
  @IsIn(['approve', 'approve_other'], { message: DECISION_MESSAGE })
  decision: 'approve' | 'approve_other';

  @Trim() @IsString({ message: COMMENT_MESSAGE }) @MinLength(1, { message: COMMENT_MESSAGE }) @MaxLength(1000)
  comment: string;

  @IsIn(RAISE_WAYS, { message: WAY_MESSAGE })
  way: RaiseWay;

  /** The request's Effective from unless sent (a request from before 17 October 2026 has none: then it is required). */
  @IsOptional() @IsDateOnly(EFFECTIVE_MESSAGE)
  effectiveDate?: string;

  @Sent() @IsInt({ message: DURATION_MESSAGE }) @Min(1, { message: DURATION_MESSAGE }) @Max(60, { message: DURATION_MESSAGE })
  durationMonths?: number;

  @IsOptional() @IsIn(RAISE_REASON_CHOICES, { message: RAISE_REASON_MESSAGE })
  raiseReason?: RaiseReasonChoice;
}

/** Form 2 filed: the insured wage follows the new pay from this 1st of a month; null when none was filed after all. */
export class RaiseForm2Dto {
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter the date Form 2 changes the insured wage from, the 1st of a month.')
  form2From: string | null;
}

/**
 * A raise request (owner, 17 October 2026: "a drop list reason first ... then add requester comment, suggest raise amount
 * or percentage"; "in the request their should be a tab called Effective from"): the reason from the list, the month the
 * raise is asked from (its 1st: this month in Cairo or a later one, the service checks) and the requester's comment (all
 * required), and, if any, the raise suggested: an amount in EGP added to the gross (the employee or HR) or a percent of
 * it (anyone), not both.
 */
export class CreateRaiseRequestDto {
  @IsIn(RAISE_REASON_CHOICES, { message: REQUEST_REASON_MESSAGE })
  raiseReason: RaiseReasonChoice;

  @Trim() @IsDateOnly(EFFECTIVE_FROM_MESSAGE)
  effectiveFrom: string;

  @Trim() @IsString({ message: 'Write a comment: what the raise is for.' }) @MinLength(1, { message: 'Write a comment: what the raise is for.' }) @MaxLength(2000)
  comment: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: AMOUNT_MESSAGE }) @Min(0.01, { message: AMOUNT_MESSAGE }) @Max(MAX_MONEY, { message: AMOUNT_MESSAGE })
  suggestedIncrease?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: PERCENT_MESSAGE }) @Min(0.01, { message: PERCENT_MESSAGE }) @Max(MAX_RAISE_PERCENT, { message: PERCENT_MESSAGE })
  suggestedPercent?: number;
}

/** ?status= on the Raise Requests page; all unless sent. */
export class ListRaiseRequestsDto {
  @IsOptional() @IsIn(RAISE_REQUEST_STATUSES, { message: 'Choose a status: with_hr, with_ceo, approved, declined or done.' })
  status?: RaiseRequestStatus;
}

/**
 * The Salary Raises report's period, ?from=YYYY-MM&to=YYYY-MM, both months included: this calendar year (in Cairo)
 * unless sent; with one of them only, that month's year from January or to December.
 */
export class SalaryRaisesQueryDto {
  @Trim() @IsOptional() @Matches(MONTH, { message: 'Choose the month the period starts in, as YYYY-MM, e.g. 2026-01.' })
  from?: string;

  @Trim() @IsOptional() @Matches(MONTH, { message: 'Choose the month the period ends in, as YYYY-MM, e.g. 2026-12.' })
  to?: string;
}
