import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';

// The year's official holidays (owner's request, 16 October 2026; Organization → Holidays since the owner's "make
// holiday a separate tab" the same day): a day and its name in English, its name in Arabic if HR gives one. Dates
// YYYY-MM-DD; an empty Arabic name clears it. A year's list can be imported from a file too (owner's request, 16 October
// 2026: "allow me to import yearly holiday list"): previewed, then confirmed with the file's fingerprint.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

/** The years a holiday can be in: wide enough for any run, narrow enough to catch a mistyped year. */
export const HOLIDAY_YEARS = { from: 2000, to: 2100 } as const;

const DATE_MESSAGE = "Enter the holiday's date, as YYYY-MM-DD.";
const NAME_MESSAGE = "Enter the holiday's name in English.";
const NAME_LENGTH_MESSAGE = 'Keep the name to 100 characters or fewer.';
const YEAR_MESSAGE = `Choose a year from ${HOLIDAY_YEARS.from} to ${HOLIDAY_YEARS.to}.`;

export class CreateHolidayDto {
  @IsDateOnly(DATE_MESSAGE)
  date: string;

  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @IsNotEmpty({ message: NAME_MESSAGE })
  @MaxLength(100, { message: NAME_LENGTH_MESSAGE })
  nameEn: string;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100, { message: NAME_LENGTH_MESSAGE })
  nameAr?: string | null;
}

export class UpdateHolidayDto {
  @Sent() @IsDateOnly(DATE_MESSAGE)
  date?: string;

  @Trim()
  @Sent()
  @IsString({ message: NAME_MESSAGE })
  @IsNotEmpty({ message: NAME_MESSAGE })
  @MaxLength(100, { message: NAME_LENGTH_MESSAGE })
  nameEn?: string;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100, { message: NAME_LENGTH_MESSAGE })
  nameAr?: string | null;
}

export class HolidaysQueryDto {
  /** The year's holidays only; every holiday when not sent. */
  @Transform(({ value }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value))
  @IsOptional()
  @IsInt({ message: YEAR_MESSAGE })
  @Min(HOLIDAY_YEARS.from, { message: YEAR_MESSAGE })
  @Max(HOLIDAY_YEARS.to, { message: YEAR_MESSAGE })
  year?: number;
}

const PREVIEW_FIRST = 'Preview the file before importing it.';

/**
 * Confirming an import (POST /payroll/holidays/import, with the file again): the fingerprint the preview answered, so
 * what is imported is the file that was previewed.
 */
export class ConfirmHolidayImportDto {
  @Matches(/^[0-9a-f]{64}$/, { message: PREVIEW_FIRST })
  fingerprint: string;
}
