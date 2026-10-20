import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, IsNumber, IsOptional, Matches, Max, Min, ValidateBy } from 'class-validator';
import { TIME_OF_DAY } from '../../common/time-of-day.js';

const Code = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));
const TIME_MESSAGE = 'Use 24-hour time, e.g. 09:00.';
const HOURS_MESSAGE = 'Enter the hours to work a day in half hours from 0.5, e.g. 9 or 8.5, or leave them empty for the whole shift.';
const COUNT_UNTIL_MESSAGE = 'Use 24-hour time for the time hours count until, e.g. 20:00, or leave it empty.';

/**
 * The time a day's hours count until (owner, 20 October 2026: "no working hours to be counted after 8 PM even if the
 * check out was 11 PM"): a time of day, or null (or not sent on a new shift): the window's end and grace, as before.
 * That it is at or after the end, the same day, is checked with the shift's times (ShiftsService).
 */
const CountUntil = () => applyDecorators(IsOptional(), Matches(TIME_OF_DAY, { message: COUNT_UNTIL_MESSAGE }));

/**
 * A shift's hours to work a day (owner, 16 October 2026: "my company shift is to maintain 9 hours within the shift
 * window, its like flexible shift"): in half hours from 0.5 up to 24; null clears them (the whole window). That they
 * fit in the shift's window is checked with its times (ShiftsService).
 */
const HoursToWork = () =>
  applyDecorators(
    IsOptional(),
    IsNumber({ allowNaN: false, allowInfinity: false }, { message: HOURS_MESSAGE }),
    Min(0.5, { message: HOURS_MESSAGE }),
    Max(24, { message: HOURS_MESSAGE }),
    ValidateBy({ name: 'halfHours', validator: { validate: (v: unknown) => typeof v === 'number' && Number.isInteger(v * 2), defaultMessage: () => HOURS_MESSAGE } }),
  );

export class CreateShiftDto {
  @Code()
  @Matches(/^[A-Z0-9-]{1,10}$/, { message: 'Shift code: up to 10 letters or digits, e.g. A.' })
  code: string;

  @Matches(TIME_OF_DAY, { message: TIME_MESSAGE })
  startTime: string;

  @Matches(TIME_OF_DAY, { message: TIME_MESSAGE })
  endTime: string;

  /** The hours to work a day within the window; null or not sent: the whole window. */
  @HoursToWork()
  hoursPerDay?: number | null;

  /** Hours count until it, a long day making up short ones (20 October 2026); null or not sent: the end and grace. */
  @CountUntil()
  countUntil?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  graceMinutes?: number;

  /** 0 = Sunday … 6 = Saturday */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one working day.' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];
}

export class UpdateShiftDto {
  @IsOptional()
  @Code()
  @Matches(/^[A-Z0-9-]{1,10}$/, { message: 'Shift code: up to 10 letters or digits, e.g. A.' })
  code?: string;

  @IsOptional()
  @Matches(TIME_OF_DAY, { message: TIME_MESSAGE })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_OF_DAY, { message: TIME_MESSAGE })
  endTime?: string;

  /** null clears them: the whole window. */
  @HoursToWork()
  hoursPerDay?: number | null;

  /** null clears it: the window's end and grace, as before (20 October 2026). */
  @CountUntil()
  countUntil?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  graceMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one working day.' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];
}
