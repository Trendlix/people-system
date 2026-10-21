import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  ASSET_CONDITIONS,
  ASSET_MONEY_MAX,
  CUSTODY_FILTERS,
  CUSTODY_ITEMS_MAX,
  CUSTODY_KINDS,
  CUSTODY_TERMS_MAX,
  CUSTODY_TEXT_LIMITS,
  MAINTENANCE_TEXT_LIMITS,
  RETURN_CONDITIONS,
  type AssetCondition,
  type CustodyFilter,
  type CustodyKind,
  type ReturnCondition,
} from '@trendlix/shared';
import { IsDateOnly } from '../common/date-only.js';
import { Trim, TrimOrNull } from '../common/transforms.js';

// What the custody pages send (Assets step 3, owner, 21 October 2026; packages/shared custody.ts). Each field checked
// here on its own, in words; the rules between fields (a shoot's return date, the assets' statuses, the terms) are the
// shared ones, checked by the services.

const keep = (max: number, what: string) => MaxLength(max, { message: `Keep the ${what} to ${max} characters or fewer.` });

/** An asset handed over, with its condition and accessories as they went out (its condition now unless given). */
export class HandoverItemDto {
  @IsUUID('all', { message: 'Choose the assets from the list.' })
  assetId!: string;

  @IsOptional() @IsIn(ASSET_CONDITIONS, { message: 'Choose the condition it goes out in.' })
  conditionOut?: AssetCondition | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(CUSTODY_TEXT_LIMITS.accessories, 'accessories')
  accessories?: string | null;
}

/** A handover: the employee, a shoot (with its return date) or a long-term assignment, the assets and the kits. */
export class HandoverDto {
  @IsUUID('all', { message: 'Choose the employee.' })
  employeeId!: string;

  @IsIn(CUSTODY_KINDS, { message: 'Choose a shoot or a long-term assignment.' })
  kind!: CustodyKind;

  /** YYYY-MM-DD: a shoot's return date. */
  @IsOptional() @IsDateOnly('Enter the return date as YYYY-MM-DD.')
  dueDate?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(CUSTODY_TEXT_LIMITS.purpose, 'purpose')
  purpose?: string | null;

  /** Who handed it over, as written: the signed-in person unless sent. */
  @IsOptional() @TrimOrNull() @IsString() @keep(CUSTODY_TEXT_LIMITS.handedOverBy, 'name of who handed it over')
  handedOverBy?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(CUSTODY_TEXT_LIMITS.notes, 'notes')
  notes?: string | null;

  @IsOptional()
  @IsArray({ message: 'Choose the assets to hand over.' })
  @ArrayMaxSize(CUSTODY_ITEMS_MAX, { message: `Hand over at most ${CUSTODY_ITEMS_MAX} assets at a time.` })
  @ValidateNested({ each: true })
  @Type(() => HandoverItemDto)
  items?: HandoverItemDto[];

  /** The kit quick-add: each kit's available assets added, the others skipped (and said why). */
  @IsOptional()
  @IsArray({ message: 'Choose the kits.' })
  @ArrayMaxSize(20, { message: 'Add at most 20 kits at a time.' })
  @IsUUID('all', { each: true, message: 'Choose the kits from the list.' })
  kitIds?: string[];
}

/** An item received back: good, damaged or missing, with notes. */
export class ReturnLineDto {
  @IsUUID('all', { message: 'Choose the items received back.' })
  itemId!: string;

  @IsIn(RETURN_CONDITIONS, { message: 'Say whether it came back good, damaged or missing.' })
  condition!: ReturnCondition;

  @IsOptional() @TrimOrNull() @IsString() @keep(CUSTODY_TEXT_LIMITS.returnNotes, 'notes')
  notes?: string | null;
}

export class ReturnDto {
  @IsArray({ message: 'Choose the items received back.' })
  @ArrayMinSize(1, { message: 'Choose the items received back.' })
  @ArrayMaxSize(CUSTODY_ITEMS_MAX, { message: `Receive at most ${CUSTODY_ITEMS_MAX} items at a time.` })
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}

/** GET /assets/custody: ?filter=active|overdue|unsigned|closed|all &q= (a code, a name or an employee code) &page=. */
export class CustodyListQueryDto {
  @IsOptional() @IsIn(CUSTODY_FILTERS, { message: 'Choose Active, Overdue, Not signed, Closed or All.' })
  filter?: CustodyFilter;

  @IsOptional() @Trim() @IsString() @MaxLength(100, { message: 'Keep the search to 100 characters or fewer.' })
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'Choose a page.' }) @Min(1, { message: 'Choose a page.' }) @Max(100_000)
  page?: number;
}

/** GET /assets/custody/people: ?q= a name or an employee code; none: everyone holding something now. */
export class CustodyPeopleQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(100, { message: 'Keep the search to 100 characters or fewer.' })
  q?: string;
}

/** The custody terms, one a term; `standard: true` for the standard wording again. */
export class CustodyTermsDto {
  @IsOptional()
  @IsArray({ message: 'Write the terms, one a line.' })
  @ArrayMaxSize(CUSTODY_TERMS_MAX, { message: `Keep the terms to ${CUSTODY_TERMS_MAX} or fewer.` })
  @IsString({ each: true, message: 'Write the terms, one a line.' })
  @MaxLength(CUSTODY_TEXT_LIMITS.term, { each: true, message: `Keep each term to ${CUSTODY_TEXT_LIMITS.term} characters or fewer.` })
  terms?: string[];

  @IsOptional() @IsIn([true], { message: 'Send standard: true for the standard wording.' })
  standard?: true;
}

/** Sent to repair, or back from it: the day (today unless given), the vendor, the notes, and back, the cost (a value). */
export class RepairDto {
  @IsOptional() @IsDateOnly('Enter the date as YYYY-MM-DD.')
  on?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(MAINTENANCE_TEXT_LIMITS.vendor, 'vendor')
  vendor?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @keep(MAINTENANCE_TEXT_LIMITS.notes, 'notes')
  notes?: string | null;

  /** The repair's cost in EGP: from the CEO, Finance or a Super Admin only (403 from anyone else). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the cost in EGP, with at most 2 decimals, e.g. 1500 or 1500.50.' })
  @Min(0, { message: 'The cost can’t be below 0.' })
  @Max(ASSET_MONEY_MAX, { message: 'The cost is too large.' })
  cost?: number | null;
}

/** Marked lost or found: why, in a few words. */
export class LostFoundDto {
  @IsOptional() @TrimOrNull() @IsString() @keep(MAINTENANCE_TEXT_LIMITS.notes, 'notes')
  notes?: string | null;
}
