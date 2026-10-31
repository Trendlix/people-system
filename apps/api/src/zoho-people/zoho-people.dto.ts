import { CALENDAR_LIMITS, ZOHO_EXCLUSION_REASON_MAX } from '@trendlix/shared';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { TrimOrNull } from '../common/transforms.js';

// What Organization → Zoho People sends (owner, 25 October 2026: "Yes, daily + backfill"). The shapes are checked here,
// the rules (12 months at most, up to yesterday) by packages/shared zohoFetchProblems in the service.

/** POST /zoho-people/runs: "Fetch from Zoho" for these days, everyone (none chosen) or the people chosen. */
export class ZohoFetchDto {
  @IsDateOnly('Choose the first day to fetch.')
  from!: string;

  @IsDateOnly('Choose the last day to fetch.')
  to!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000, { message: 'Choose at most 1,000 people, or everyone.' })
  @IsUUID('all', { each: true, message: 'Choose the people from the list.' })
  employeeIds?: string[] | null;
}

/** POST /zoho-people/oauth/start. */
export class ZohoPeopleStartDto {
  /** The website's own address, which the redirect URI is made from. */
  @IsString() @MaxLength(300)
  origin!: string;
}

/** POST /zoho-people/oauth/finish: what Zoho sent back to the website, passed on as it came (its accounts server too). */
export class ZohoPeopleFinishDto {
  @IsOptional() @IsString() @MaxLength(4000)
  code?: string | null;

  @IsOptional() @IsString() @MaxLength(4000)
  state?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  error?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  accountsServer?: string | null;
}

/** POST /zoho-people/test: a colleague's work email to read too, or none. */
export class ZohoPeopleTestDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(CALENDAR_LIMITS.email, { message: 'Write the colleague’s work email in full, e.g. sara@trendlix.com.' })
  email?: string | null;
}

/**
 * POST /zoho-people/exclusions: people to leave out of the Zoho fetch (owner, 31 October 2026: "can i exclude users from
 * the zoho api?"), with why (optional).
 */
export class ZohoExclusionsDto {
  @IsArray({ message: 'Choose the people to leave out of the Zoho fetch.' })
  @ArrayMinSize(1, { message: 'Choose the people to leave out of the Zoho fetch.' })
  @ArrayMaxSize(1000, { message: 'Choose at most 1,000 people at a time.' })
  @IsUUID('all', { each: true, message: 'Choose the people from the list.' })
  employeeIds!: string[];

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(ZOHO_EXCLUSION_REASON_MAX, { message: `Keep the reason to ${ZOHO_EXCLUSION_REASON_MAX} characters.` })
  reason?: string | null;
}
