import { WHATSAPP_LANGUAGES, WHATSAPP_LIMITS, WHATSAPP_MESSAGE_STATUSES, WHATSAPP_TEMPLATE_KEYS, type WhatsAppLanguage } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { TrimOrNull } from '../common/transforms.js';

// What the WhatsApp pages send (owner, 24 October 2026: "how to make whatsapp notifications?"). The shapes are checked
// here, the rules (Meta's ids, what a switched-on set needs, quiet hours) by packages/shared whatsappSettingsProblems in
// the service. A token or a secret is never echoed in a message.

/** PUT /whatsapp/settings. An empty token or app secret keeps the saved one. */
export class WhatsAppSettingsDto {
  @IsOptional() @TrimOrNull() @IsString() @MaxLength(WHATSAPP_LIMITS.id, { message: 'The phone number ID is the long number in WhatsApp → API Setup, digits only.' })
  phoneNumberId?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(WHATSAPP_LIMITS.id, { message: 'The WhatsApp Business Account ID is the long number in WhatsApp → API Setup, digits only.' })
  businessAccountId?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(40, { message: 'Write the business number with its country code, e.g. +20 100 123 4567.' })
  displayPhone?: string | null;

  /** Empty or left out: the saved one stays. */
  @IsOptional() @IsString({ message: 'Paste the access token as text.' }) @MaxLength(WHATSAPP_LIMITS.token, { message: 'Paste the access token on its own, as Meta gave it.' })
  accessToken?: string | null;

  @IsOptional() @IsString({ message: 'Paste the app secret as text.' }) @MaxLength(WHATSAPP_LIMITS.appSecret, { message: 'Paste the app secret as App settings → Basic shows it.' })
  appSecret?: string | null;

  @IsBoolean({ message: 'Say whether the system sends WhatsApp messages.' })
  enabled!: boolean;

  @IsBoolean({ message: 'Say whether there are quiet hours.' })
  quietHours!: boolean;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(5)
  quietFrom?: string | null;

  @IsOptional() @TrimOrNull() @IsString() @MaxLength(5)
  quietTo?: string | null;
}

/** POST /whatsapp/settings/test: the number to send the test to. */
export class WhatsAppTestDto {
  @IsString({ message: 'Write the number to send the test to.' })
  @MaxLength(WHATSAPP_LIMITS.phone + 10, { message: 'Write the number to send the test to with its country code, e.g. +20 100 123 4567.' })
  to!: string;
}

/** GET /whatsapp/messages: the filters. */
export class ListWhatsAppMessagesDto {
  @IsOptional() @IsIn(WHATSAPP_MESSAGE_STATUSES, { message: 'Choose a status from the list.' })
  status?: string;

  @IsOptional() @IsIn([...WHATSAPP_TEMPLATE_KEYS, 'stop_confirmation'], { message: 'Choose a type from the list.' })
  template?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Choose the first day.' })
  from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Choose the last day.' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Choose a page from 1.' })
  @Min(1, { message: 'Choose a page from 1.' })
  @Max(10_000, { message: 'Choose a page from 1.' })
  page?: number;
}

/** PUT /me/whatsapp: on or off, the language, the groups (one not sent stays as it is; all on when turning it on). */
export class MyWhatsAppDto {
  @IsBoolean({ message: 'Say whether to send you WhatsApp messages.' })
  on!: boolean;

  @IsIn(WHATSAPP_LANGUAGES, { message: 'Choose English or Arabic.' })
  language!: WhatsAppLanguage;

  @IsOptional()
  @IsObject({ message: 'Choose the messages you want.' })
  groups?: Record<string, boolean>;
}
