import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  END_REASONS,
  WORK_ARRANGEMENTS,
  type EmployeeStatus,
  type EmploymentType,
  type EndReason,
  type WorkArrangement,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { TrimOrNull } from '../common/transforms.js';

// One period of employment (see the Employment model). Text fields: an empty string clears them. Dates: YYYY-MM-DD.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

/** The statuses of a current employment; Resigned and Terminated come from ending it. */
const CURRENT_STATUSES = EMPLOYEE_STATUSES.filter((s) => s !== 'resigned' && s !== 'terminated');

class EmploymentFieldsDto {
  @Sent() @IsIn(CURRENT_STATUSES, { message: 'Choose Active, Probation, On leave or Notice period. To end an employment, use End employment.' })
  status?: EmployeeStatus;

  /**
   * A department or one of its teams. With a job title, the one the job title belongs to (a department itself or a
   * team: owner's decision, 15 October 2026); it follows the job title when left out.
   */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a department or team.' })
  departmentId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a job title.' })
  jobTitleId?: string | null;

  /** The person's own grade, within the range of grades the job title takes (owner's decision, 15 October 2026). */
  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a grade.' })
  gradeId?: string | null;

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a manager.' })
  managerId?: string | null;

  @Sent() @IsIn(WORK_ARRANGEMENTS, { message: 'Choose Office, Work from home or Hybrid.' })
  workArrangement?: WorkArrangement;

  /** 0 = Sunday … 6 = Saturday; Hybrid only */
  @Sent()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  officeDays?: number[];

  @TrimOrNull() @IsOptional() @IsUUID('all', { message: 'Choose a shift.' })
  shiftId?: string | null;

  @TrimOrNull() @IsOptional() @IsDateOnly('Enter a real date for the job description acknowledgement.')
  jdAcknowledgedAt?: string | null;
}

export class CreateEmploymentDto extends EmploymentFieldsDto {
  @IsIn(EMPLOYMENT_TYPES, { message: 'Choose an employment type.' })
  employmentType: EmploymentType;

  @IsDateOnly('Enter the join date.')
  joinDate: string;
}

export class UpdateEmploymentDto extends EmploymentFieldsDto {
  @Sent() @IsIn(EMPLOYMENT_TYPES, { message: 'Choose an employment type.' })
  employmentType?: EmploymentType;

  @Sent() @IsDateOnly('Enter the join date.')
  joinDate?: string;

  /** For an ended employment only: correcting how it ended. A current one is ended with End employment. */
  @Sent() @IsDateOnly('Enter the last working day.')
  endDate?: string;

  @Sent() @IsIn(END_REASONS, { message: 'Choose why the employment ended.' })
  endReason?: EndReason;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500)
  endNote?: string | null;
}

/** Ending the current employment: resignation, termination, the end of a contract. */
export class EndEmploymentDto {
  @IsDateOnly('Enter the last working day.')
  endDate: string;

  @IsIn(END_REASONS, { message: 'Choose why the employment ended.' })
  endReason: EndReason;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500)
  endNote?: string | null;
}
