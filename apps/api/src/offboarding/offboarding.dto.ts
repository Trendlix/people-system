import { Type } from 'class-transformer';
import { Allow, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  CLEARANCE_ITEM_STATUSES,
  CLEARANCE_LIMITS,
  CLEARANCE_OWNERS,
  END_REASONS,
  OFFBOARDING_STATUSES,
  REHIRE_ELIGIBILITIES,
  REHIRE_REASON_MAX,
  type ClearanceItemStatus,
  type ClearanceOwner,
  type RehireEligibility,
} from '@trendlix/shared';
import { TrimOrNull } from '../common/transforms.js';

// What the offboarding pages send (owner, 22 October 2026: the full module; packages/shared offboarding.ts). The
// checklist and the exit interview's answers are checked by the services with the shared rules (every problem in words).

/** Opening a case by hand, for an employment without one (or one cancelled). */
export class OpenCaseDto {
  @IsUUID('all', { message: 'Choose the employment.' })
  employmentId!: string;
}

export class ListCasesDto {
  @IsOptional() @IsIn([...OFFBOARDING_STATUSES, 'all'], { message: 'Choose open, completed, cancelled or all.' })
  status?: (typeof OFFBOARDING_STATUSES)[number] | 'all';
}

/** Clearing an item (done, not applicable), or putting it back to pending, with an optional note. */
export class MarkItemDto {
  @IsIn(CLEARANCE_ITEM_STATUSES, { message: 'Choose done, not applicable or pending.' })
  status!: ClearanceItemStatus;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(CLEARANCE_LIMITS.note, { message: `Keep the note to ${CLEARANCE_LIMITS.note} characters or fewer.` })
  note?: string | null;
}

/** A one-off item on a case. */
export class AddItemDto {
  @IsString({ message: 'Give the item a name.' }) @MaxLength(CLEARANCE_LIMITS.label, { message: `Keep the name to ${CLEARANCE_LIMITS.label} characters or fewer.` })
  label!: string;

  @IsIn(CLEARANCE_OWNERS, { message: 'Choose who clears it.' })
  owner!: ClearanceOwner;
}

/** Completing a case; a Super Admin with items pending gives the reason. */
export class CompleteCaseDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(CLEARANCE_LIMITS.overrideReason, { message: `Keep the reason to ${CLEARANCE_LIMITS.overrideReason} characters or fewer.` })
  overrideReason?: string | null;
}

export class RehireDto {
  @IsIn(REHIRE_ELIGIBILITIES, { message: 'Choose whether they could be hired again.' })
  eligibility!: RehireEligibility;

  @TrimOrNull() @IsOptional() @IsString() @MaxLength(REHIRE_REASON_MAX, { message: `Keep the reason to ${REHIRE_REASON_MAX} characters or fewer.` })
  reason?: string | null;
}

/** An exit interview's answers (exitInterviewProblems checks them). */
export class ExitInterviewDto {
  @Allow()
  reason!: unknown;

  @Allow()
  ratings!: unknown;

  @Allow()
  recommend!: unknown;

  @Allow()
  comments?: unknown;
}

export class DeclineInterviewDto {
  @TrimOrNull() @IsOptional() @IsString() @MaxLength(500, { message: 'Keep the note to 500 characters or fewer.' })
  note?: string | null;
}

/** The default checklist, in order: the items kept by their id, new ones without. */
export class ChecklistDto {
  @IsArray({ message: 'Send the checklist as a list.' })
  items!: { id?: unknown; label?: unknown; owner?: unknown }[];
}

const YEAR = /^\d{4}$/;

export class FormerQueryDto {
  @IsOptional() @Matches(YEAR, { message: 'Choose a year, e.g. 2026.' })
  year?: string;

  @IsOptional() @IsIn(END_REASONS, { message: 'Choose a reason.' })
  reason?: string;

  @IsOptional() @IsUUID('all', { message: 'Choose a department.' })
  departmentId?: string;
}

export class TurnoverQueryDto {
  @IsOptional() @Type(() => Number) @IsInt({ message: 'Choose a year, e.g. 2026.' }) @Min(2000, { message: 'Choose a year, e.g. 2026.' }) @Max(2100, { message: 'Choose a year, e.g. 2026.' })
  year?: number;
}

/** Whom a job offer or a new employment may be for again: the person, their national ID or their email. */
export class RehireCheckDto {
  @IsOptional() @IsUUID('all', { message: 'Choose the person.' })
  employeeId?: string;

  @IsOptional() @IsEmail({}, { message: 'Enter an email address.' }) @MaxLength(254)
  email?: string;

  @IsOptional() @Matches(/^\d{14}$/, { message: 'A national ID has 14 digits.' })
  nationalId?: string;
}
