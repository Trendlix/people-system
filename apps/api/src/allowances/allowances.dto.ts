import { Type } from 'class-transformer';
import { applyDecorators } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsNumber, IsUUID, Max, Min, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { Trim } from '../common/transforms.js';

// The kinds of allowance (owner's request, 15 October 2026), and the allowances of a contract or a job offer: a kind
// and an amount a month each.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

/** decimal(12, 2) holds up to 9,999,999,999.99 */
const MAX_MONEY = 9_999_999_999.99;
const AMOUNT_MESSAGE = 'Enter each allowance as an amount of more than 0, e.g. 500 or 750.50.';
const NAME_EN_MESSAGE = 'Enter the name in English (up to 100 characters), e.g. Housing.';
const NAME_AR_MESSAGE = 'Enter the name in Arabic (up to 100 characters), e.g. بدل سكن.';

/** A name of 1 to 100 characters (after trimming), with one message whatever is wrong. */
const IsName = (message: string) =>
  ValidateBy({ name: 'isName', validator: { validate: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100, defaultMessage: () => message } });

export class CreateAllowanceTypeDto {
  @Trim() @IsName(NAME_EN_MESSAGE)
  nameEn: string;

  @Trim() @IsName(NAME_AR_MESSAGE)
  nameAr: string;

  /** Counted in the salary tax: yes unless sent (a cash allowance is taxed by law, Law 91/2005 Art. 9). */
  @Sent() @IsBoolean({ message: 'Choose whether the allowance is taxed.' })
  taxable?: boolean;

  /** Counted in the insured wage, within its limits: no unless sent. */
  @Sent() @IsBoolean({ message: 'Choose whether the allowance counts in the insured wage.' })
  insured?: boolean;
}

export class UpdateAllowanceTypeDto {
  @Trim() @Sent() @IsName(NAME_EN_MESSAGE)
  nameEn?: string;

  @Trim() @Sent() @IsName(NAME_AR_MESSAGE)
  nameAr?: string;

  @Sent() @IsBoolean({ message: 'Choose whether the allowance is taxed.' })
  taxable?: boolean;

  @Sent() @IsBoolean({ message: 'Choose whether the allowance counts in the insured wage.' })
  insured?: boolean;

  /** An inactive kind isn't offered for new contracts and offers; those that have it keep it. */
  @Sent() @IsBoolean({ message: 'Choose whether the allowance is active.' })
  active?: boolean;

  /** Lower first in the lists. */
  @Sent() @IsInt({ message: 'Enter the order as a whole number, 0 to 999.' }) @Min(0, { message: 'Enter the order as 0 to 999.' }) @Max(999, { message: 'Enter the order as 0 to 999.' })
  sortOrder?: number;
}

/** One allowance of a contract or an offer: its kind and its amount a month. */
export class AllowanceAmountDto {
  @IsUUID('all', { message: 'Choose the allowance.' })
  allowanceTypeId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: AMOUNT_MESSAGE }) @Min(0.01, { message: AMOUNT_MESSAGE }) @Max(MAX_MONEY, { message: AMOUNT_MESSAGE })
  amount: number;
}

/**
 * A contract's or an offer's allowances, as one list: each kind once, each amount more than 0. Sent, it replaces the
 * whole set ([] clears it); null is refused. For a DTO field typed AllowanceAmountDto[].
 */
export const AllowanceRows = () =>
  applyDecorators(
    Sent(),
    IsArray({ message: 'Send the allowances as a list, e.g. [] for none.' }),
    ArrayMaxSize(50),
    ValidateNested({ each: true }),
    Type(() => AllowanceAmountDto),
    ArrayUnique((a: AllowanceAmountDto) => a?.allowanceTypeId, { message: 'Add each allowance once.' }),
  );
