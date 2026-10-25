import { applyDecorators } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { MAX_MONEY } from '../contracts/contracts.dto.js';

// Client accounts, their size tiers and their assignments (owner, 25 October 2026: "if an employee has an allowance per
// account, how can we deal with it?"; packages/shared client-accounts.ts). Dates YYYY-MM-DD; money in EGP a month, to
// the piaster, more than 0; text trimmed, an empty one clearing an optional field.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

const NAME_EN = 'Enter the account’s name in English (up to 150 characters), e.g. Acme Foods.';
const NAME_AR = 'Enter the name in Arabic in up to 150 characters, or leave it empty.';
const CODE = 'Enter the code in up to 30 letters, digits and dashes, e.g. ACME-01, or leave it empty.';
const AMOUNT = 'Enter the amount in EGP a month, more than 0, e.g. 1500 or 1500.50.';
const DATE = 'Enter the date as YYYY-MM-DD.';
const NOTE = 'Keep the note to 500 characters or fewer.';
const TIER = 'Choose the size from the list, or none.';
const TEAM = 'Choose the department or team from the list, or none.';

/** An amount of EGP a month, to the piaster, more than 0. */
const Amount = () => applyDecorators(IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: AMOUNT }), Min(0.01, { message: AMOUNT }), Max(MAX_MONEY, { message: AMOUNT }));

export class CreateClientAccountDto {
  @Trim() @IsString({ message: NAME_EN }) @MinLength(1, { message: NAME_EN }) @MaxLength(150, { message: NAME_EN })
  nameEn: string;

  @TrimOrNull() @IsOptional() @IsString({ message: NAME_AR }) @MaxLength(150, { message: NAME_AR })
  nameAr?: string | null;

  @TrimOrNull() @IsOptional() @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{0,29}$/, { message: CODE })
  code?: string | null;

  /** A size tier: its default amount fills in the account's when none is sent. */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: TIER })
  tierId?: string | null;

  /** The default amount a month for the people assigned; the tier's when not sent (one of them is needed). */
  @IsOptional() @Amount()
  defaultAmount?: number;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: TEAM })
  departmentId?: string | null;

  @TrimOrNull() @IsOptional() @IsString({ message: NOTE }) @MaxLength(500, { message: NOTE })
  notes?: string | null;
}

export class UpdateClientAccountDto {
  @Trim() @Sent() @IsString({ message: NAME_EN }) @MinLength(1, { message: NAME_EN }) @MaxLength(150, { message: NAME_EN })
  nameEn?: string;

  @TrimOrNull() @IsOptional() @IsString({ message: NAME_AR }) @MaxLength(150, { message: NAME_AR })
  nameAr?: string | null;

  @TrimOrNull() @IsOptional() @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{0,29}$/, { message: CODE })
  code?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: TIER })
  tierId?: string | null;

  /** The default for the next people assigned: those assigned already keep their own amounts. */
  @Sent() @Amount()
  defaultAmount?: number;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: TEAM })
  departmentId?: string | null;

  @TrimOrNull() @IsOptional() @IsString({ message: NOTE }) @MaxLength(500, { message: NOTE })
  notes?: string | null;
}

/** Ends an account on a day: its open assignments end then. */
export class EndClientAccountDto {
  @Trim() @IsDateOnly(DATE)
  endedOn: string;
}

export class CreateAssignmentDto {
  @IsUUID('all', { message: 'Choose the employee.' })
  employeeId: string;

  @Trim() @IsDateOnly(DATE)
  fromDate: string;

  /** None: still held. */
  @TrimOrNull() @IsOptional() @IsDateOnly(DATE)
  toDate?: string | null;

  /** The account's default when not sent. */
  @IsOptional() @Amount()
  amount?: number;

  @TrimOrNull() @IsOptional() @IsString({ message: NOTE }) @MaxLength(500, { message: NOTE })
  note?: string | null;
}

export class UpdateAssignmentDto {
  @Trim() @Sent() @IsDateOnly(DATE)
  fromDate?: string;

  /** null: open again (still held). */
  @TrimOrNull() @IsOptional() @IsDateOnly(DATE)
  toDate?: string | null;

  @Sent() @Amount()
  amount?: number;

  @TrimOrNull() @IsOptional() @IsString({ message: NOTE }) @MaxLength(500, { message: NOTE })
  note?: string | null;
}

const TIER_NAME = 'Enter the size’s name (up to 50 characters), e.g. Small.';

export class CreateTierDto {
  @Trim() @IsString({ message: TIER_NAME }) @MinLength(1, { message: TIER_NAME }) @MaxLength(50, { message: TIER_NAME })
  nameEn: string;

  @Amount()
  defaultAmount: number;
}

export class UpdateTierDto {
  @Trim() @Sent() @IsString({ message: TIER_NAME }) @MinLength(1, { message: TIER_NAME }) @MaxLength(50, { message: TIER_NAME })
  nameEn?: string;

  @Sent() @Amount()
  defaultAmount?: number;

  /** Lower first. */
  @Sent() @IsInt({ message: 'Enter the order as a whole number, 0 to 999.' }) @Min(0, { message: 'Enter the order as 0 to 999.' }) @Max(999, { message: 'Enter the order as 0 to 999.' })
  sortOrder?: number;
}
