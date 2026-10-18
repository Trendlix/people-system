import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import {
  CHOSEN_STATUSES,
  EMPLOYMENT_TYPES,
  END_REASONS,
  WORK_ARRANGEMENTS,
  WORK_NATURES,
  type ChosenStatus,
  type EmploymentType,
  type EndReason,
  type WorkArrangement,
  type WorkNature,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { TrimOrNull } from '../common/transforms.js';

// One period of employment (see the Employment model). Text fields: an empty string clears them. Dates: YYYY-MM-DD.

/** Present (even as null) means "change it"; for fields that cannot be empty, null is then refused. */
const Sent = () => ValidateIf((_o, v) => v !== undefined);

/** The employment types by the labour law (owner, 18 October 2026), as the messages name them. */
export const EMPLOYMENT_TYPE_MESSAGE = 'Choose an employment type: full_time, part_time, trainee or freelance (outside the labour law).';
export const WORK_NATURE_MESSAGE = 'Choose the nature of the work: regular, temporary, casual or seasonal.';
export const COMMISSION_MESSAGE = 'Send whether the pay is by commission as true or false.';

class EmploymentFieldsDto {
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

  /**
   * Hazardous or unhealthy work, or work in a remote area: 7 more days of annual leave (Labour Law 14/2025 Art. 124;
   * owner, 18 October 2026: "can you apply the leaves according to the law?"). Off unless sent.
   */
  @Sent() @IsBoolean({ message: 'Send whether the work is hazardous as true or false.' })
  hazardousWork?: boolean;

  /**
   * Paid by commission, a full-time employment only (owner, 18 October 2026: Sales became Full-time with this flag; the
   * law's wage includes "العمولة أو النسبة المئوية", Labour Law 14/2025 Art. 1(4)(أ)). Off unless sent; cleared when the
   * type changes to another than full-time.
   */
  @Sent() @IsBoolean({ message: COMMISSION_MESSAGE })
  paidByCommission?: boolean;

  /** The nature of the work (Art. 1(6–8)): regular unless sent; casual work is warned of past 6 months. */
  @Sent() @IsIn(WORK_NATURES, { message: WORK_NATURE_MESSAGE })
  workNature?: WorkNature;
}

/**
 * No status: the system sets it, Probation while the worked-out probation runs, else Active (owner's decision, 16
 * October 2026). Sent, it is refused as a field the employment does not take, like the probation end.
 */
export class CreateEmploymentDto extends EmploymentFieldsDto {
  @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
  employmentType: EmploymentType;

  @IsDateOnly('Enter the join date.')
  joinDate: string;
}

export class UpdateEmploymentDto extends EmploymentFieldsDto {
  /**
   * HR chooses Active or On leave only, and only while the employment is one of them: Probation and Notice period are
   * the system's, and Resigned and Terminated come from ending it (owner's decision, 16 October 2026).
   */
  @Sent() @IsIn(CHOSEN_STATUSES, { message: 'Choose Active or On leave. Probation and Notice period are set by the system.' })
  status?: ChosenStatus;

  @Sent() @IsIn(EMPLOYMENT_TYPES, { message: EMPLOYMENT_TYPE_MESSAGE })
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
