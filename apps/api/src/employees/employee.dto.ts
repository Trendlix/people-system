import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  DEGREES,
  EDUCATION_GRADES,
  GENDERS,
  GOVERNORATES,
  MARITAL_STATUSES,
  MILITARY_STATUSES,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { LatinDigits, Trim, TrimOrNull } from '../common/transforms.js';
import { isValidEgyptianIban, normalizeIban } from './checks.js';

// Every text field: an empty string clears it (stored as null). Dates are YYYY-MM-DD.

const LowerEmail = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value));
const Code = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value));
// spaces, dashes and brackets dropped: "010 1234-5678" → "01012345678"
const Phone = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s\-()]/g, '') || null : value));
/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

const PHONE = /^\+?\d{8,15}$/;
const PHONE_MESSAGE = (what: string) => `Enter the ${what} as digits only, e.g. 01012345678.`;
const CODE = /^EMP-\d{4,6}$/;
const CODE_MESSAGE = 'Employee code: EMP- and 4 digits, e.g. EMP-0142. Leave it empty to number automatically.';

/** Profile fields that are optional both when adding and when changing an employee. Employment is separate (employment.dto.ts). */
class EmployeeDetailsDto {
  @Code() @IsOptional() @Matches(CODE, { message: CODE_MESSAGE })
  employeeCode?: string | null;

  // ---------- identity ----------
  @TrimOrNull() @IsOptional() @IsDateOnly('Enter a real date of birth.')
  dateOfBirth?: string | null;

  @TrimOrNull() @IsOptional() @IsIn(GENDERS, { message: 'Choose Male or Female.' })
  gender?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(50)
  nationality?: string | null;

  @TrimOrNull() @IsOptional() @IsIn(MARITAL_STATUSES, { message: 'Choose a marital status from the list.' })
  maritalStatus?: string | null;

  @TrimOrNull() @IsOptional() @IsIn(MILITARY_STATUSES, { message: 'Choose a military status from the list.' })
  militaryStatus?: string | null;

  // ---------- contact ----------
  @LowerEmail() @IsOptional() @IsEmail({}, { message: 'Enter a valid work email.' }) @MaxLength(254)
  workEmail?: string | null;

  @LowerEmail() @IsOptional() @IsEmail({}, { message: 'Enter a valid personal email.' }) @MaxLength(254)
  personalEmail?: string | null;

  @LatinDigits() @Phone() @IsOptional() @Matches(PHONE, { message: PHONE_MESSAGE('mobile number') })
  mobile?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(300)
  addressAr?: string | null;

  @TrimOrNull() @IsOptional() @IsIn(GOVERNORATES, { message: 'Choose a governorate from the list.' })
  governorate?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(150)
  emergencyName?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(50)
  emergencyRelation?: string | null;

  @LatinDigits() @Phone() @IsOptional() @Matches(PHONE, { message: PHONE_MESSAGE('emergency contact’s mobile') })
  emergencyMobile?: string | null;

  // ---------- education ----------
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(150)
  university?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(150)
  faculty?: string | null;

  @TrimOrNull() @IsOptional() @IsIn(DEGREES, { message: 'Choose a degree from the list.' })
  degree?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(150)
  major?: string | null;

  @IsOptional()
  @IsInt({ message: 'Enter the graduation year as a number, e.g. 2018.' })
  @Min(1950, { message: 'Enter a graduation year from 1950 on.' })
  @Max(2100, { message: 'Enter a real graduation year.' })
  graduationYear?: number | null;

  @TrimOrNull() @IsOptional() @IsIn(EDUCATION_GRADES, { message: 'Choose a grade from the list.' })
  educationGrade?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(200)
  qualificationAr?: string | null;
}

/** National ID (restricted): changed on its own, or sent with a new employee. */
export class UpdateIdentityDto {
  @LatinDigits()
  @TrimOrNull()
  @IsOptional()
  @Matches(/^[23]\d{13}$/, { message: 'The national ID must be 14 digits, starting with 2 or 3.' })
  nationalId?: string | null;

  @LatinDigits() @TrimOrNull() @IsOptional() @IsString() @MaxLength(30)
  printedNo?: string | null;

  @TrimOrNull() @IsOptional() @IsDateOnly('Enter the ID issue date.')
  issueDate?: string | null;

  @TrimOrNull() @IsOptional() @IsDateOnly('Enter the ID expiry date.')
  expiryDate?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  issuingOffice?: string | null;
}

export class CreateEmployeeDto extends EmployeeDetailsDto {
  @Trim() @IsString() @IsNotEmpty({ message: 'Enter the full name in English.' }) @MaxLength(150)
  fullNameEn: string;

  @Trim() @IsString() @IsNotEmpty({ message: 'Enter the full name in Arabic, as printed on contracts.' }) @MaxLength(150)
  fullNameAr: string;

  /** The national ID, saved with the new employee (e.g. read from the ID card first). Empty: none yet. */
  @IsOptional()
  @IsObject({ message: 'Send the national ID details as an object.' })
  @ValidateNested()
  @Type(() => UpdateIdentityDto)
  identity?: UpdateIdentityDto | null;
}

export class UpdateEmployeeDto extends EmployeeDetailsDto {
  @Trim() @Sent() @IsString() @IsNotEmpty({ message: 'Enter the full name in English.' }) @MaxLength(150)
  fullNameEn?: string;

  @Trim() @Sent() @IsString() @IsNotEmpty({ message: 'Enter the full name in Arabic, as printed on contracts.' }) @MaxLength(150)
  fullNameAr?: string;
}

/** Bank and payment (restricted). */
export class UpdateBankDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  bankName?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  branch?: string | null;

  @LatinDigits()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '') || null : value))
  @IsOptional()
  @Matches(/^[A-Za-z0-9]{4,34}$/, { message: 'Enter the account number as letters and digits only.' })
  accountNo?: string | null;

  @LatinDigits()
  @Transform(({ value }) => (typeof value === 'string' ? normalizeIban(value) || null : value))
  @IsOptional()
  @ValidateBy({
    name: 'isEgyptianIban',
    validator: {
      validate: (v) => typeof v === 'string' && isValidEgyptianIban(v),
      defaultMessage: () => 'The IBAN must be EG followed by 27 digits, and its check digits must be right. Check it against the bank letter.',
    },
  })
  iban?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(150)
  holderName?: string | null;
}
