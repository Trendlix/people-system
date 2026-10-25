import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { LINKEDIN_LIMITS } from '@trendlix/shared';
import { TrimOrNull } from '../common/transforms.js';

// What the careers forms' new addresses take (owner, 25 October 2026: "can i use linkedin to complete the data? and for
// creatives, they need to add their portfolios"; packages/shared cv-contacts.ts, linkedin-signin.ts, portfolio.ts): the
// CV read on the spot, LinkedIn's sign-in (start, the return, the details opened for the form), and their settings in
// Recruitment Settings (the portfolio per position; LinkedIn's app). The services check every rule, in words.

/** POST /public/cv-prefill: a multipart form with the CV as `cv`, and the address the website saw. */
export class CvPrefillDto {
  @IsOptional() @IsString() @MaxLength(100)
  ip?: string;
}

/** POST /public/linkedin/start. */
export class LinkedInStartDto {
  /** "job:<slug>" or "general". */
  @IsOptional() @IsString() @MaxLength(120)
  form?: string;

  /** The job page's ?src= (LinkedIn, Facebook groups …), kept for the way back. */
  @IsOptional() @IsString() @MaxLength(60)
  src?: string | null;

  /** The website's own address: without `careersBase`, the redirect URL is its /careers/linkedin/callback. */
  @IsOptional() @IsString() @MaxLength(200)
  origin?: string;

  /**
   * The careers pages' public address (packages/shared careers-base.ts: the website's CAREERS_BASE_URL, else its own
   * address and /careers): the redirect URL is its /linkedin/callback.
   */
  @IsOptional() @IsString() @MaxLength(200)
  careersBase?: string;
}

/** POST /public/linkedin/finish: LinkedIn's return as the website got it, with the browser's half of the state. */
export class LinkedInFinishDto {
  @IsOptional() @IsString() @MaxLength(4000)
  state?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  binding?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  code?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  error?: string | null;
}

/** POST /public/linkedin/open: what LinkedIn gave, opened for the form it was for. */
export class LinkedInOpenDto {
  @IsOptional() @IsString() @MaxLength(4000)
  ticket?: string;

  @IsOptional() @IsString() @MaxLength(120)
  form?: string;
}

/** PUT /recruitment/settings/portfolio: every position's setting, checked by the service (portfolioSettingProblems). */
export class PortfolioSettingsDto {
  @IsArray({ message: 'Send the positions as a list.' }) @ArrayMaxSize(2000, { message: 'Too many positions at once.' }) @Allow()
  positions!: unknown[];
}

/** PUT /recruitment/settings/linkedin: a field left out stays; an empty secret keeps the one set. */
export class LinkedInSettingsDto {
  @IsOptional() @IsBoolean({ message: 'Switch LinkedIn sign-in on or off.' })
  enabled?: boolean;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(LINKEDIN_LIMITS.clientId, { message: 'Paste the client ID as LinkedIn shows it.' })
  clientId?: string | null;

  @IsOptional() @IsString() @MaxLength(LINKEDIN_LIMITS.clientSecret, { message: 'Paste the client secret as LinkedIn shows it.' })
  clientSecret?: string | null;
}
