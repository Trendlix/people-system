import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Trim, TrimOrNull } from '../../common/transforms.js';

const Code = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));
const CODE = /^[A-Z0-9-]{1,10}$/;
const CODE_MESSAGE = 'Grade code: up to 10 letters or digits, e.g. G4.';
/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

export class CreateGradeDto {
  @Code()
  @Matches(CODE, { message: CODE_MESSAGE })
  code: string;

  /** 1 = the lowest level; higher ranks sit higher in the hierarchy. */
  @IsInt({ message: 'Enter the rank as a whole number, 1 for the lowest level.' })
  @Min(1)
  @Max(99)
  rank: number;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Enter the level, e.g. Senior.' })
  @MaxLength(100)
  levelEn: string;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  levelAr?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(300)
  description?: string | null;
}

export class UpdateGradeDto {
  @Code()
  @Sent()
  @Matches(CODE, { message: CODE_MESSAGE })
  code?: string;

  @Sent()
  @IsInt({ message: 'Enter the rank as a whole number, 1 for the lowest level.' })
  @Min(1)
  @Max(99)
  rank?: number;

  @Trim()
  @Sent()
  @IsString()
  @IsNotEmpty({ message: 'Enter the level, e.g. Senior.' })
  @MaxLength(100)
  levelEn?: string;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(100)
  levelAr?: string | null;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(300)
  description?: string | null;
}
