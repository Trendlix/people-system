import { applyDecorators } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_STATUSES,
  ADVANCE_KINDS,
  ADVANCE_STATUSES,
  type AdjustmentKind,
  type AdjustmentStatus,
  type AdvanceKind,
  type AdvanceStatus,
} from '@trendlix/shared';
import { IsDateOnly } from '../../common/date-only.js';
import { Trim, TrimOrNull } from '../../common/transforms.js';
import { MAX_MONEY } from '../../contracts/contracts.dto.js';
import { MONTH } from '../months.js';

// Additions / Deductions and advances and loans (owner, 17 October 2026; packages/shared payroll-adjustments.ts).
// Months: YYYY-MM. Dates: YYYY-MM-DD. Money: a number of EGP, to the piaster, more than 0. Text: an empty string clears
// an optional field. A type is checked against its kind, and whether it is taxed, by the service.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

const MONTH_MESSAGE = 'Choose the month, as YYYY-MM.';
const KIND_MESSAGE = 'Choose addition or deduction.';
const TYPE_MESSAGE = 'Choose the type.';
const AMOUNT_MESSAGE = 'Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.';
const REASON_MESSAGE = 'Say what it is for.';
const TAXED_MESSAGE = 'Send whether it is taxed as true or false.';
const ADVANCE_MESSAGE = 'Choose the advance or loan it recovers.';

/** An amount of EGP to the piaster, more than 0. */
const Amount = (message: string) =>
  applyDecorators(IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message }), Min(0.01, { message }), Max(MAX_MONEY, { message }));

/** An addition or deduction for an employee's month. */
export class CreateAdjustmentDto {
  @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @Trim() @Matches(MONTH, { message: MONTH_MESSAGE })
  month: string;

  @IsIn(ADJUSTMENT_KINDS, { message: KIND_MESSAGE })
  kind: AdjustmentKind;

  @Trim() @IsString({ message: TYPE_MESSAGE }) @MinLength(1, { message: TYPE_MESSAGE })
  type: string;

  /** Other additions only: whether it is taxed (every other type is taxed or not as the owner's list says). */
  @IsOptional() @IsBoolean({ message: TAXED_MESSAGE })
  taxed?: boolean | null;

  @Amount(AMOUNT_MESSAGE)
  amount: number;

  @Trim() @IsString({ message: REASON_MESSAGE }) @MinLength(1, { message: REASON_MESSAGE }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason: string;

  /** An advance's recovery or a loan's installment: the advance or loan. */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: ADVANCE_MESSAGE })
  advanceId?: string | null;
}

/** A pending one's changes: its month, type (of the same kind), whether taxed (Other), amount, reason and advance. */
export class UpdateAdjustmentDto {
  @Trim() @Sent() @Matches(MONTH, { message: MONTH_MESSAGE })
  month?: string;

  @Trim() @Sent() @IsString({ message: TYPE_MESSAGE }) @MinLength(1, { message: TYPE_MESSAGE })
  type?: string;

  @IsOptional() @IsBoolean({ message: TAXED_MESSAGE })
  taxed?: boolean | null;

  @Sent() @Amount(AMOUNT_MESSAGE)
  amount?: number;

  @Trim() @Sent() @IsString({ message: REASON_MESSAGE }) @MinLength(1, { message: REASON_MESSAGE }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason?: string;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: ADVANCE_MESSAGE })
  advanceId?: string | null;
}

/** Pending ones moved to another month: { ids, month }, at most 200 at a time. */
export class MoveAdjustmentsDto {
  @IsArray({ message: 'Choose the additions or deductions to move.' })
  @ArrayMinSize(1, { message: 'Choose the additions or deductions to move.' })
  @ArrayMaxSize(200, { message: 'Move at most 200 at a time.' })
  @IsUUID('all', { each: true, message: 'Choose the additions or deductions to move.' })
  ids: string[];

  @Trim() @Matches(MONTH, { message: MONTH_MESSAGE })
  month: string;
}

/** ?month=YYYY-MM&employeeId=&kind=&type=&status=: every filter optional. */
export class AdjustmentsQueryDto {
  @Trim() @IsOptional() @Matches(MONTH, { message: MONTH_MESSAGE })
  month?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  @IsOptional() @IsIn(ADJUSTMENT_KINDS, { message: KIND_MESSAGE })
  kind?: AdjustmentKind;

  @Trim() @IsOptional() @IsString({ message: TYPE_MESSAGE })
  type?: string;

  @IsOptional() @IsIn(ADJUSTMENT_STATUSES, { message: 'Choose pending, applied or cancelled.' })
  status?: AdjustmentStatus;
}

/** ?month=YYYY-MM: the people who can have an addition or deduction that month, and their open advances and loans. */
export class AdjustmentChoicesQueryDto {
  @Trim() @Matches(MONTH, { message: MONTH_MESSAGE })
  month: string;
}

// ---------- advances and loans ----------

const ADVANCE_AMOUNT_MESSAGE = 'Enter the amount given in EGP, more than 0, e.g. 6000.';
const GIVEN_MESSAGE = 'Enter the date it was given, as YYYY-MM-DD.';
const ADVANCE_REASON_MESSAGE = 'Say what it was given for.';
const PLAN_LENGTH = 'Keep the plan to 200 characters or fewer.';

export class CreateAdvanceDto {
  @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @IsIn(ADVANCE_KINDS, { message: 'Choose advance or loan.' })
  kind: AdvanceKind;

  @Amount(ADVANCE_AMOUNT_MESSAGE)
  amount: number;

  @IsDateOnly(GIVEN_MESSAGE)
  givenOn: string;

  @Trim() @IsString({ message: ADVANCE_REASON_MESSAGE }) @MinLength(1, { message: ADVANCE_REASON_MESSAGE }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason: string;

  /** How it is to be recovered, in HR's words: "6 installments of 1,000". */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(200, { message: PLAN_LENGTH })
  plan?: string | null;
}

/** An open one's changes: the amount (not below what is recovered and planned), the date, the reason, the plan. */
export class UpdateAdvanceDto {
  @Sent() @Amount(ADVANCE_AMOUNT_MESSAGE)
  amount?: number;

  @Sent() @IsDateOnly(GIVEN_MESSAGE)
  givenOn?: string;

  @Trim() @Sent() @IsString({ message: ADVANCE_REASON_MESSAGE }) @MinLength(1, { message: ADVANCE_REASON_MESSAGE }) @MaxLength(500, { message: 'Keep the reason to 500 characters or fewer.' })
  reason?: string;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(200, { message: PLAN_LENGTH })
  plan?: string | null;
}

/** HR marks one settled with something still outstanding: why (e.g. "Paid back in cash on 12/10/2026"). */
export class SettleAdvanceDto {
  @Trim() @IsString({ message: 'Say how it was settled.' }) @MinLength(1, { message: 'Say how it was settled.' }) @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note: string;
}

/** ?employeeId=&status=open|settled: every filter optional. */
export class AdvancesQueryDto {
  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  @IsOptional() @IsIn(ADVANCE_STATUSES, { message: 'Choose open or settled.' })
  status?: AdvanceStatus;
}
