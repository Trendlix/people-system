import { MEETING_LIMITS, MEETING_OWNERS, MEETING_PROVIDERS, type MeetingOwner, type MeetingProvider } from '@trendlix/shared';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// What Organization → Meetings and Your Meetings send (owner, 24 October 2026: "make it both"). The shapes are checked
// here, the rules (a Google client ID's ending, Microsoft's GUIDs, Zoom's ids) by packages/shared meetingAppProblems in
// the service. A secret is never trimmed nor echoed in a message.

/** PUT /meetings/apps/:provider: a provider's app; an empty or left-out secret keeps the saved one. */
export class MeetingAppDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MEETING_LIMITS.id, { message: `Keep the client ID to ${MEETING_LIMITS.id} characters or fewer.` })
  clientId?: string | null;

  @IsOptional() @IsString({ message: 'Paste the client secret as text.' }) @MaxLength(MEETING_LIMITS.secret, { message: `Keep the client secret to ${MEETING_LIMITS.secret} characters or fewer.` })
  clientSecret?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MEETING_LIMITS.id, { message: `Keep the tenant ID to ${MEETING_LIMITS.id} characters or fewer.` })
  tenantId?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MEETING_LIMITS.id, { message: `Keep the account ID to ${MEETING_LIMITS.id} characters or fewer.` })
  accountId?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MEETING_LIMITS.id, { message: `Keep the General app’s client ID to ${MEETING_LIMITS.id} characters or fewer.` })
  userClientId?: string | null;

  @IsOptional() @IsString({ message: 'Paste the General app’s client secret as text.' }) @MaxLength(MEETING_LIMITS.secret, { message: `Keep the General app’s client secret to ${MEETING_LIMITS.secret} characters or fewer.` })
  userClientSecret?: string | null;
}

/** POST /meetings/company/:provider/host: the company's Microsoft mailbox or Zoom user meetings are made in. */
export class MeetingHostDto {
  @IsString({ message: 'Write the host’s email in full, e.g. hr@trendlix.com.' }) @MaxLength(MEETING_LIMITS.email, { message: 'Write the host’s email in full, e.g. hr@trendlix.com.' })
  hostEmail!: string;
}

/** PUT /meetings/default: a company connection's choice ("company:zoom"), or null for none. */
export class MeetingDefaultDto {
  @ValidateIf((_o, v) => v !== null) @IsString({ message: 'Choose one of the company’s connections, or none.' }) @MaxLength(40)
  choice!: string | null;
}

/** POST /meetings/oauth/start. */
export class MeetingStartDto {
  @IsIn(MEETING_PROVIDERS, { message: 'Choose Google, Microsoft or Zoom.' })
  provider!: MeetingProvider;

  @IsIn(MEETING_OWNERS, { message: 'Say whose account it is: the company’s or your own.' })
  owner!: MeetingOwner;

  /** The website's own address, which the redirect URI is made from. */
  @IsString() @MaxLength(300)
  origin!: string;
}

/** POST /meetings/oauth/finish: what the provider sent back to the website, passed on as it came. */
export class MeetingFinishDto {
  @IsIn(MEETING_PROVIDERS, { message: 'Choose Google, Microsoft or Zoom.' })
  provider!: MeetingProvider;

  @IsOptional() @IsString() @MaxLength(4000)
  code?: string | null;

  @IsOptional() @IsString() @MaxLength(4000)
  state?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  error?: string | null;
}
