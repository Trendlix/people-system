import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ADJUSTMENT_DAYS_MAX,
  ADJUSTMENT_KINDS,
  ADJUSTMENT_STATUSES,
  ADVANCE_KINDS,
  ADVANCE_SETTLE_WAYS,
  ADVANCE_STATUSES,
  INSTALLMENTS_MAX,
  isAdjustmentDays,
  isDaysType,
  type AdjustmentKind,
  type AdjustmentStatus,
  type AdvanceKind,
  type AdvanceSettleWay,
  type AdvanceStatus,
} from '@trendlix/shared';
import { IsDateOnly } from '../../common/date-only.js';
import { Trim, TrimOrNull } from '../../common/transforms.js';
import { MAX_MONEY } from '../../contracts/contracts.dto.js';
import { MONTH } from '../months.js';

// Additions / Deductions and advances and loans (owner, 17 October 2026; packages/shared payroll-adjustments.ts).
// Months: YYYY-MM. Dates: YYYY-MM-DD. Money: a number of EGP, to the piaster, more than 0. Text: an empty string clears
// an optional field. A type is checked against its kind, and whether it is taxed, by the service. A Bonus (days) or a
// Penalty (days) (owner, 17 October 2026) takes its days, whole or half, and no amount: the month's run works it out;
// every other type its amount and no days (the service says so when the wrong one is sent).

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

const MONTH_MESSAGE = 'Choose the month, as YYYY-MM.';
const KIND_MESSAGE = 'Choose addition or deduction.';
const TYPE_MESSAGE = 'Choose the type.';
const AMOUNT_MESSAGE = 'Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.';
const REASON_MESSAGE = 'Say what it is for.';
const TAXED_MESSAGE = 'Send whether it is taxed as true or false.';
const ADVANCE_MESSAGE = 'Choose the advance or loan it recovers.';
const DAYS_MESSAGE = `Enter the days, more than 0 and up to ${ADJUSTMENT_DAYS_MAX}, in whole or half days, e.g. 2 or 1.5.`;

/** An amount of EGP to the piaster, more than 0. */
const Amount = (message: string) =>
  applyDecorators(IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message }), Min(0.01, { message }), Max(MAX_MONEY, { message }));

/** Days, whole or half, more than 0 and up to a month's. */
const Days = () => ValidateBy({ name: 'adjustmentDays', validator: { validate: (v) => isAdjustmentDays(v), defaultMessage: () => DAYS_MESSAGE } });

/** The type sent is in days (or, changing one, may be: the service checks it against the one it has). */
const typedInDays = (o: { type?: unknown }) => typeof o.type === 'string' && isDaysType(o.type.trim());

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

  /** Every type but one in days, which has none (refused by the service when sent). */
  @ValidateIf((o: CreateAdjustmentDto) => !typedInDays(o) || o.amount !== undefined) @Amount(AMOUNT_MESSAGE)
  amount?: number;

  /** A Bonus (days) or a Penalty (days) only (owner, 17 October 2026): its days. */
  @ValidateIf((o: CreateAdjustmentDto) => typedInDays(o) || o.days !== undefined) @Days()
  days?: number;

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

  /** A Bonus (days) or a Penalty (days): its days (owner, 17 October 2026). */
  @Sent() @Days()
  days?: number;

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
const COUNT_MESSAGE = `Enter how many monthly installments, 1 to ${INSTALLMENTS_MAX}.`;
const FIRST_MONTH_MESSAGE = 'Choose the month of the first installment, as YYYY-MM.';
const INSTALLMENT_MESSAGE = 'Enter the installment in EGP, more than 0, e.g. 1000 or 1000.50.';

/**
 * Recover in installments (owner, 18 October 2026: "in the deductions i might have a loan of a medical subscription or
 * something that needs to be deducted as installments on the employee"): how many months and the first month; the
 * amounts are the plan's, equal, the last taking the rounding.
 */
export class InstallmentsPlanDto {
  @IsInt({ message: COUNT_MESSAGE }) @Min(1, { message: COUNT_MESSAGE }) @Max(INSTALLMENTS_MAX, { message: COUNT_MESSAGE })
  count: number;

  @Trim() @Matches(MONTH, { message: FIRST_MONTH_MESSAGE })
  firstMonth: string;
}

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

  /** How it is to be recovered, in HR's words: "6 installments of 1,000". With installments, the plan's words instead. */
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(200, { message: PLAN_LENGTH })
  plan?: string | null;

  /** Its installments, made at once (18 October 2026); none: recovered by deductions HR links by hand, as before. */
  @IsOptional()
  @IsObject({ message: 'Send the installments as { count, firstMonth }.' })
  @ValidateNested()
  @Type(() => InstallmentsPlanDto)
  installments?: InstallmentsPlanDto | null;
}

/** Move an installment to a later month (it and every later one move a month on): the month it is in now. */
export class PostponeInstallmentDto {
  @Trim() @Matches(MONTH, { message: 'Choose the month of the installment, as YYYY-MM.' })
  month: string;
}

/** Change an installment's amount (the later ones share what is left): its month and the new amount. */
export class ChangeInstallmentDto {
  @Trim() @Matches(MONTH, { message: 'Choose the month of the installment, as YYYY-MM.' })
  month: string;

  @Amount(INSTALLMENT_MESSAGE)
  amount: number;
}

/** ?employeeId=: whose installments the plan form warns about. */
export class InstallmentLimitQueryDto {
  @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;
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

/** The note's message by the way it is settled: why it is waived, else how it was settled. */
const settleNoteMessage = (o: object) => ((o as SettleAdvanceDto).how === 'waived' ? 'Say why it is waived.' : 'Say how it was settled.');

/**
 * HR marks one settled with something still outstanding, and how (18 October 2026, on leaving before it is paid back:
 * "taken from the final settlement, unless waived"): deducted from the final settlement (a note if HR wants), waived (a
 * note why, required) or paid back otherwise (a note how, e.g. "Paid back in cash on 12/10/2026"; the way an older
 * caller, which sends no way, settles one).
 */
export class SettleAdvanceDto {
  @IsOptional() @IsIn(ADVANCE_SETTLE_WAYS, { message: 'Choose how it is settled: deducted from the final settlement, waived or paid back.' })
  how?: AdvanceSettleWay;

  @TrimOrNull()
  @ValidateIf((o: SettleAdvanceDto) => o.how !== 'final_settlement' || (o.note !== undefined && o.note !== null))
  @IsString({ message: (args) => settleNoteMessage(args.object) })
  @MinLength(1, { message: (args) => settleNoteMessage(args.object) })
  @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}

/** ?employeeId=&status=open|settled: every filter optional. */
export class AdvancesQueryDto {
  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  @IsOptional() @IsIn(ADVANCE_STATUSES, { message: 'Choose open or settled.' })
  status?: AdvanceStatus;
}

// ---------- recurring deductions ----------

const NAME_MESSAGE = 'Say what it is for, e.g. Medical subscription (family).';
const NAME_LENGTH = 'Keep the name to 100 characters or fewer.';
const MONTHLY_MESSAGE = 'Enter the amount a month in EGP, more than 0, e.g. 350 or 350.50.';
const START_MESSAGE = 'Choose the first month it is deducted, as YYYY-MM.';
const END_MESSAGE = 'Choose the last month it is deducted, as YYYY-MM, or leave it empty to deduct it until stopped.';
const FROM_MESSAGE = 'Choose the month, as YYYY-MM.';

/**
 * A recurring deduction (owner, 18 October 2026), e.g. the employee's share of a medical subscription: the employee,
 * what it is for, the amount a month, the first month and, if it ends, the last.
 */
export class CreateRecurringDeductionDto {
  @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @Trim() @IsString({ message: NAME_MESSAGE }) @MinLength(1, { message: NAME_MESSAGE }) @MaxLength(100, { message: NAME_LENGTH })
  name: string;

  @Amount(MONTHLY_MESSAGE)
  amount: number;

  @Trim() @Matches(MONTH, { message: START_MESSAGE })
  startMonth: string;

  @TrimOrNull() @IsOptional() @Matches(MONTH, { message: END_MESSAGE })
  endMonth?: string | null;
}

/** The amount changed from a month on: this one stops then, a new one starts then. */
export class ChangeRecurringDeductionDto {
  @Amount(MONTHLY_MESSAGE)
  amount: number;

  @Trim() @Matches(MONTH, { message: FROM_MESSAGE })
  fromMonth: string;
}

/** Stopped from a month on (the first month no longer deducted), with a note if HR wants. */
export class StopRecurringDeductionDto {
  @Trim() @Matches(MONTH, { message: FROM_MESSAGE })
  fromMonth: string;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}

/** Its name, or its last month (null: until stopped). */
export class UpdateRecurringDeductionDto {
  @Trim() @Sent() @IsString({ message: NAME_MESSAGE }) @MinLength(1, { message: NAME_MESSAGE }) @MaxLength(100, { message: NAME_LENGTH })
  name?: string;

  @TrimOrNull() @IsOptional() @Matches(MONTH, { message: END_MESSAGE })
  endMonth?: string | null;
}

/** ?employeeId=&status=running|ended: running lists those still to come too; every filter optional. */
export class RecurringDeductionsQueryDto {
  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;

  @IsOptional() @IsIn(['upcoming', 'running', 'ended'], { message: 'Choose running or ended.' })
  status?: 'upcoming' | 'running' | 'ended';
}
