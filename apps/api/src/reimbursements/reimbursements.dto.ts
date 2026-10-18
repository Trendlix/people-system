import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateBy } from 'class-validator';
import { EMPLOYMENT_TYPES, REIMBURSEMENT_DECISIONS, REIMBURSEMENT_STATUSES, type EmploymentType, type ReimbursementDecision, type ReimbursementStatus } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';
import { MAX_MONEY } from '../contracts/contracts.dto.js';

// Reimbursement types and claims (owner, 18 October 2026: "allow the employee to add reimbursement request … for
// specific preset up conditions", "in the setup i need to enter for it a cap"; packages/shared reimbursements.ts).
// Dates: YYYY-MM-DD. Money: a number, to the piaster. Text fields: an empty string clears them.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

const NAME_EN_MESSAGE = 'Enter the name in English (up to 100 characters), e.g. Mobile bill.';
const NAME_AR_MESSAGE = 'Enter the name in Arabic (up to 100 characters), e.g. فاتورة المحمول.';
const DESCRIPTION_LENGTH = 'Keep the description to 500 characters or fewer.';
const cap = (what: string) => `Enter the cap ${what} as an amount of more than 0, e.g. 500 or 750.50, or leave it empty for no cap.`;
const DAYS_MESSAGE = 'Enter the days after the expense it must be claimed within, 1 to 365, or leave it empty for no deadline.';
const DEPARTMENTS_MESSAGE = 'Choose the departments as a list, e.g. [] for every department.';
const GRADES_MESSAGE = 'Choose the grades as a list, e.g. [] for every grade.';
const TYPES_MESSAGE = `Choose the employment types from: ${EMPLOYMENT_TYPES.join(', ')}; [] for every employment type.`;
const AMOUNT_MESSAGE = 'Enter the amount spent, more than 0, e.g. 250 or 250.50.';
const DECISION_MESSAGE = 'Choose approve, approve_other (approve a lower amount) or reject.';
const COMMENT_LENGTH = 'Keep the comment to 1000 characters or fewer.';

/** A name of 1 to 100 characters (after trimming), with one message whatever is wrong. */
const IsName = (message: string) =>
  ValidateBy({ name: 'isName', validator: { validate: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100, defaultMessage: () => message } });

/**
 * An amount as a number the column holds, with one message whatever is wrong; more than 0 and to the piaster are the
 * shared rules' to say (reimbursementProblems, lowerAmountProblem), with the same words.
 */
const IsAmount = (message: string) =>
  ValidateBy({ name: 'isAmount', validator: { validate: (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_MONEY, defaultMessage: () => message } });

/** A number sent as text (a multipart field), Arabic-Indic digits (٠-٩) too, as a number; anything else as it came. */
const NumberOf = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const typed = value.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    return typed === '' ? value : Number(typed);
  });

/** A type's names and conditions. On a change, each field sent replaces what it has; null clears a cap, the deadline or the description. */
class ReimbursementTypeFields {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: DESCRIPTION_LENGTH })
  description?: string | null;

  /** A receipt must be attached: yes unless sent. */
  @Sent() @IsBoolean({ message: 'Choose whether a receipt is required.' })
  receiptRequired?: boolean;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: cap('a claim') }) @Min(0.01, { message: cap('a claim') }) @Max(MAX_MONEY, { message: cap('a claim') })
  capPerClaim?: number | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: cap('a month') }) @Min(0.01, { message: cap('a month') }) @Max(MAX_MONEY, { message: cap('a month') })
  capPerMonth?: number | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: cap('a year') }) @Min(0.01, { message: cap('a year') }) @Max(MAX_MONEY, { message: cap('a year') })
  capPerYear?: number | null;

  @IsOptional() @IsInt({ message: DAYS_MESSAGE }) @Min(1, { message: DAYS_MESSAGE }) @Max(365, { message: DAYS_MESSAGE })
  claimWithinDays?: number | null;

  /** Who may claim it (none chosen: everyone): departments (a department's teams with it), grades, employment types. */
  @Sent() @IsArray({ message: DEPARTMENTS_MESSAGE }) @ArrayMaxSize(200) @IsUUID('all', { each: true, message: 'Choose each department from the list.' })
  departmentIds?: string[];

  @Sent() @IsArray({ message: GRADES_MESSAGE }) @ArrayMaxSize(50) @IsUUID('all', { each: true, message: 'Choose each grade from the list.' })
  gradeIds?: string[];

  @Sent() @IsArray({ message: TYPES_MESSAGE }) @ArrayMaxSize(EMPLOYMENT_TYPES.length * 2) @IsIn(EMPLOYMENT_TYPES, { each: true, message: TYPES_MESSAGE })
  employmentTypes?: EmploymentType[];

  /** Turned off, it isn't offered for new claims; the claims sent stay. On unless sent. */
  @Sent() @IsBoolean({ message: 'Choose whether the type is on.' })
  active?: boolean;
}

export class CreateReimbursementTypeDto extends ReimbursementTypeFields {
  @Trim() @IsName(NAME_EN_MESSAGE)
  nameEn: string;

  @Trim() @IsName(NAME_AR_MESSAGE)
  nameAr: string;
}

export class UpdateReimbursementTypeDto extends ReimbursementTypeFields {
  @Trim() @Sent() @IsName(NAME_EN_MESSAGE)
  nameEn?: string;

  @Trim() @Sent() @IsName(NAME_AR_MESSAGE)
  nameAr?: string;
}

/**
 * A claim, sent as a form with its receipts (multipart, files `receipts`): the type, the expense's date, the amount spent
 * and what it was for, all required. The type's conditions are checked by the service (reimbursementProblems).
 */
export class CreateReimbursementDto {
  @Trim() @IsUUID('all', { message: 'Choose the reimbursement type.' })
  typeId: string;

  @Trim() @IsDateOnly('Enter the date of the expense, e.g. 2026-10-15.')
  expenseDate: string;

  @NumberOf() @IsAmount(AMOUNT_MESSAGE)
  amount: number;

  @Trim() @IsString({ message: 'Write what the expense was for.' }) @MinLength(1, { message: 'Write what the expense was for.' }) @MaxLength(500, { message: DESCRIPTION_LENGTH })
  description: string;
}

/** ?expenseDate=YYYY-MM-DD: what the employee's claims take of each type's caps in its month and year (today in Cairo unless sent). */
export class MyReimbursementTypesQueryDto {
  @Trim() @IsOptional() @IsDateOnly('Enter the date of the expense, e.g. 2026-10-15.')
  expenseDate?: string;
}

/** ?status=<a status, or waiting: those waiting for the caller>&employeeId= on the Reimbursements page; all unless sent. */
export class ListReimbursementsDto {
  @IsOptional() @IsIn([...REIMBURSEMENT_STATUSES, 'waiting'], { message: `Choose a status: waiting, ${REIMBURSEMENT_STATUSES.join(', ')}.` })
  status?: ReimbursementStatus | 'waiting';

  @IsOptional() @IsUUID('all', { message: 'Choose the employee.' })
  employeeId?: string;
}

/**
 * A decision on a claim (owner's answer, 18 October 2026): approve it, approve a lower amount (with the amount and a
 * comment) or reject it (with a comment). An amount sent with another decision is left aside.
 */
export class DecideReimbursementDto {
  @IsIn(REIMBURSEMENT_DECISIONS, { message: DECISION_MESSAGE })
  decision: ReimbursementDecision;

  @IsOptional() @IsAmount('Enter the amount approved, more than 0, e.g. 250 or 250.50.')
  amount?: number | null;

  @TrimOrNull() @IsOptional() @IsString({ message: 'Write a comment.' }) @MaxLength(1000, { message: COMMENT_LENGTH })
  comment?: string | null;
}
