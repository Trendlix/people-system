import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RESIGNATION_REASON_MAX, RESIGNATION_REQUEST_STATUSES, type ResignationRequestStatus } from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim } from '../common/transforms.js';

// The employee's resignation request (owner, 26 October 2026: "but the employee has to request resignation and then the
// HR generates the document"; packages/shared resignation-request.ts). Sent as JSON, or as a form (the app's before 31
// October 2026, when People began preparing the letter): a field may arrive as text. The rules about the dates and the
// confirmation are the shared checks', said in words by the service; here only the shapes.

/** "true" / "yes" / "on" / true as true; anything else false. */
const Ticked = () => Transform(({ value }) => value === true || (typeof value === 'string' && ['true', 'yes', 'on', '1'].includes(value.trim().toLowerCase())));

/** An empty field is none. */
const EmptyIsNone = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value));

export class CreateResignationRequestDto {
  /** Why they resign: short. */
  /** Empty is said by the service with the other problems (resignationProblems), all at once. */
  @Trim() @IsOptional() @IsString({ message: 'Enter your reason for resigning.' })
  reason?: string;

  /** The last working day they would like, YYYY-MM-DD (today or later); none to leave it to the notice. */
  @EmptyIsNone() @IsOptional() @IsDateOnly('Enter a real date for your preferred last working day, or leave it empty.')
  preferredLastDay?: string;

  /** "I understand a resignation counts once certified at the labour office (Decree 187/2025)." */
  @Ticked() @IsOptional() @IsBoolean()
  confirmed?: boolean;
}

export class ListResignationRequestsDto {
  @IsOptional() @IsIn(RESIGNATION_REQUEST_STATUSES, { message: `status must be one of ${RESIGNATION_REQUEST_STATUSES.join(', ')}.` })
  status?: ResignationRequestStatus;
}

export class ReturnResignationRequestDto {
  @Trim() @IsString({ message: 'Enter why the request is returned.' }) @MinLength(1, { message: 'Enter why the request is returned.' }) @MaxLength(1000)
  reason: string;
}
