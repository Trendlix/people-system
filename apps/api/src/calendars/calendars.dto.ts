import { CALENDAR_LIMITS, CALENDAR_PROVIDERS, MEETING_OWNERS, ZOHO_DATA_CENTRES, type CalendarProvider, type MeetingOwner } from '@trendlix/shared';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// What Organization → Calendars and each person's Interview Hours page send (owner, 25 October 2026: "its zoho mails").
// The shapes are checked here, the rules (a Zoho client ID's shape, the data centre) by packages/shared
// calendarAppProblems in the service. A secret is never trimmed nor echoed in a message.

/** PUT /calendars/apps/zoho: the Zoho app; an empty or left-out secret keeps the saved one. */
export class CalendarAppDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(CALENDAR_LIMITS.id, { message: `Keep the client ID to ${CALENDAR_LIMITS.id} characters or fewer.` })
  clientId?: string | null;

  @IsOptional() @IsString({ message: 'Paste the client secret as text.' }) @MaxLength(CALENDAR_LIMITS.secret, { message: `Keep the client secret to ${CALENDAR_LIMITS.secret} characters or fewer.` })
  clientSecret?: string | null;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsIn(ZOHO_DATA_CENTRES.map((d) => d.key), { message: 'Choose the data centre the company’s Zoho account is in.' })
  dataCentre?: string | null;
}

/** POST /calendars/company/zoho/test: a colleague's work email to read too, or none. */
export class CalendarTestDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(CALENDAR_LIMITS.email, { message: 'Write the colleague’s work email in full, e.g. sara@trendlix.com.' })
  email?: string | null;
}

/** POST /calendars/oauth/start. */
export class CalendarStartDto {
  @IsIn(CALENDAR_PROVIDERS, { message: 'Choose Zoho, Google or Microsoft.' })
  provider!: CalendarProvider;

  @IsIn(MEETING_OWNERS, { message: 'Say whose calendar it is: the company’s or your own.' })
  owner!: MeetingOwner;

  /** The website's own address, which the redirect URI is made from. */
  @IsString() @MaxLength(300)
  origin!: string;
}

/** POST /calendars/oauth/finish: what the provider sent back to the website, passed on as it came (Zoho's accounts server too). */
export class CalendarFinishDto {
  @IsIn(CALENDAR_PROVIDERS, { message: 'Choose Zoho, Google or Microsoft.' })
  provider!: CalendarProvider;

  @IsOptional() @IsString() @MaxLength(4000)
  code?: string | null;

  @IsOptional() @IsString() @MaxLength(4000)
  state?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  error?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  accountsServer?: string | null;
}
