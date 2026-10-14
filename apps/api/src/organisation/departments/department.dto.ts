import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim, TrimOrNull } from '../../common/transforms.js';

export class CreateDepartmentDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Enter the department name in English.' })
  @MaxLength(100)
  nameEn: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string | null;
}

export class UpdateDepartmentDto {
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Enter the department name in English.' })
  @MaxLength(100)
  nameEn?: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string | null;
}
