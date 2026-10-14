import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';
import { LatinDigits, Trim, TrimOrNull } from '../common/transforms.js';

// Every field is optional: send only what changes. An empty string clears a field.
export class UpdateCompanyDto {
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Enter the company name in English.' })
  @MaxLength(150)
  nameEn?: string;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(150)
  nameAr?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  activity?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(50)
  commercialRegNo?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(30)
  taxRegNo?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(30)
  insuranceEmployerNo?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(300)
  addressAr?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(300)
  addressEn?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  city?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid company email address.' })
  @MaxLength(254)
  email?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsUrl({}, { message: 'Enter a valid website, e.g. trendlix.com.' })
  @MaxLength(200)
  website?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(150)
  repName?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  repTitle?: string | null;

  @LatinDigits()
  @TrimOrNull()
  @IsOptional()
  @Matches(/^[23]\d{13}$/, { message: 'The representative’s national ID must be 14 digits, starting with 2 or 3.' })
  repNationalId?: string | null;
}
