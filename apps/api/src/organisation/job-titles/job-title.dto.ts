import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim, TrimOrNull } from '../../common/transforms.js';

// Trims each duty and drops blank lines.
const CleanDuties = () =>
  Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((d) => (typeof d === 'string' ? d.trim() : d)).filter((d) => d !== '')
      : value,
  );

export class CreateJobTitleDto {
  @IsUUID('all', { message: 'Choose a department.' })
  departmentId: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Enter the job title in English.' })
  @MaxLength(150)
  titleEn: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  titleAr?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  grade?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  jdPurpose?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  jdRequirements?: string | null;

  @CleanDuties()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  duties?: string[];
}

export class UpdateJobTitleDto {
  @IsOptional()
  @IsUUID('all', { message: 'Choose a department.' })
  departmentId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Enter the job title in English.' })
  @MaxLength(150)
  titleEn?: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  titleAr?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  grade?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  jdPurpose?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  jdRequirements?: string | null;

  @CleanDuties()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  duties?: string[];
}
