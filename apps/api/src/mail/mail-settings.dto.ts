import { MAIL_LIMITS, MAIL_PROVIDERS, MAIL_SECURITIES, type MailProvider, type MailSecurity } from '@trendlix/shared';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// What Organization → Email Settings sends (owner, 23 October 2026: "why dont we add SMTP setup in the organization
// setup"). The shapes are checked here, the rules (a full sender address, what a switched-on set needs) by packages/shared
// mailSettingsProblems in the service. The password is never trimmed nor echoed in a message.

/** The server and the sender: what a save and a test both take. */
export class MailServerDto {
  @IsIn(MAIL_PROVIDERS, { message: 'Choose the email provider.' })
  provider!: MailProvider;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MAIL_LIMITS.host, { message: 'Write the server’s name, e.g. smtp.gmail.com.' })
  host?: string | null;

  @IsInt({ message: 'The port is a whole number from 1 to 65535, usually 587 or 465.' })
  @Min(1, { message: 'The port is a whole number from 1 to 65535, usually 587 or 465.' })
  @Max(65535, { message: 'The port is a whole number from 1 to 65535, usually 587 or 465.' })
  port!: number;

  @IsIn(MAIL_SECURITIES, { message: 'Choose how the connection is secured.' })
  security!: MailSecurity;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MAIL_LIMITS.username, { message: `Keep the username to ${MAIL_LIMITS.username} characters or fewer.` })
  username?: string | null;

  /** Empty or left out: the saved one stays. */
  @IsOptional() @IsString({ message: 'Write the password as text.' }) @MaxLength(MAIL_LIMITS.password, { message: `Keep the password to ${MAIL_LIMITS.password} characters or fewer.` })
  password?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MAIL_LIMITS.fromName, { message: `Keep the sender’s name to ${MAIL_LIMITS.fromName} characters or fewer.` })
  fromName?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MAIL_LIMITS.address, { message: 'Write the sender’s address in full, e.g. hr@trendlix.com.' })
  fromAddress?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MAIL_LIMITS.address, { message: 'Write the reply-to address in full, or leave it empty.' })
  replyTo?: string | null;
}

/** PUT /mail-settings: the settings, and whether the system sends with them. */
export class MailSettingsDto extends MailServerDto {
  @IsBoolean({ message: 'Say whether the system sends its emails with these settings.' })
  enabled!: boolean;
}

/** POST /mail-settings/test: the form's values as they are (saved or not), and where to (default: the caller). */
export class MailTestDto extends MailServerDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(MAIL_LIMITS.address, { message: 'Write the address to send the test to in full, e.g. hr@trendlix.com.' })
  to?: string | null;
}
