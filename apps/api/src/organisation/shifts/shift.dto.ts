import { Transform } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { TIME_OF_DAY } from '../../common/time-of-day.js';

const Code = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));
const TIME_MESSAGE = 'Use 24-hour time, e.g. 09:00.';

export class CreateShiftDto {
  @Code()
  @Matches(/^[A-Z0-9-]{1,10}$/, { message: 'Shift code: up to 10 letters or digits, e.g. A.' })
  code: string;

  @Matches(TIME_OF_DAY, { message: TIME_MESSAGE })
  startTime: string;

  @Matches(TIME_OF_DAY, { message: TIME_MESSAGE })
  endTime: string;

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
