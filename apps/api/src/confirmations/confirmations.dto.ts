import { CHANGE_REQUEST_STATUSES, type ChangeRequestStatus } from '@trendlix/shared';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// The employee's own check of their details (owner's decision, 15 October 2026). Whether the statement is ticked, its
// version and a rejection's reason are checked by ConfirmationsService, so each has its own message.

/** The employee confirms their details: the statement ticked, and the version of it they read. */
export class ConfirmDto {
  @IsOptional() @IsBoolean({ message: 'Tick the statement to confirm your details.' })
  accept?: boolean;

  @IsInt({ message: 'Send the version of the statement you read.' })
  disclaimerVersion: number;
}

/**
 * A change the employee asks for: { field: new value or null }, for the fields they confirm (CONFIRM_FIELDS). The
 * values are checked as an HR edit of the profile checks them (UpdateEmployeeDto), by ConfirmationsService.
 */
export class CreateChangeRequestDto {
  @IsObject({ message: 'Send the changes as { field: new value }.' })
  changes: Record<string, unknown>;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
}

/** HR or an Admin approving a change request: an optional note. Rejecting: the reason, required. */
export class DecisionNoteDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
}

/** Every status, for the Details Changes page's All (owner's decision, 17 October 2026). */
export const ALL_CHANGE_REQUESTS = 'all';

/** A status, or `all` for every request; none: those waiting (HR's queue). */
export class ListChangeRequestsDto {
  @IsOptional() @IsIn([...CHANGE_REQUEST_STATUSES, ALL_CHANGE_REQUESTS], { message: 'Choose a status: pending, approved, rejected, cancelled or all.' })
  status?: ChangeRequestStatus | typeof ALL_CHANGE_REQUESTS;
}
