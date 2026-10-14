import { ArrayMaxSize, ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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

  /** For a team: the department it belongs to. Empty for a department. */
  @TrimOrNull()
  @IsOptional()
  @IsUUID('all', { message: 'Choose the department this team belongs to.' })
  parentId?: string | null;
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

  /** For a team: the department it belongs to. Empty (null) makes it a department of its own. */
  @TrimOrNull()
  @IsOptional()
  @IsUUID('all', { message: 'Choose the department this team belongs to.' })
  parentId?: string | null;
}

/** The new order of all departments (parentId empty), or of all the teams of one department. */
export class ReorderDepartmentsDto {
  @TrimOrNull()
  @IsOptional()
  @IsUUID('all', { message: 'Choose the department whose teams are reordered.' })
  parentId?: string | null;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}
