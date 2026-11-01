import { EMAIL_TEMPLATE_LIMITS } from '@trendlix/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// What Organization → Email Templates sends (owner, 1 November 2026: "build the mail templetes"). The shapes are checked
// here, the rules (one line, this email's fields, the code or the link it needs) by packages/shared emailTemplateProblems
// in the service.

/** PUT /email-templates/:key: HR's subject and text, with {{fields}}. */
export class EmailTemplateDto {
  @IsString({ message: 'Write the subject.' })
  @MaxLength(EMAIL_TEMPLATE_LIMITS.subject, { message: `Keep the subject to ${EMAIL_TEMPLATE_LIMITS.subject} characters.` })
  subject!: string;

  @IsString({ message: 'Write the email’s text.' })
  @MaxLength(EMAIL_TEMPLATE_LIMITS.body, { message: `Keep the text to ${EMAIL_TEMPLATE_LIMITS.body.toLocaleString('en-US')} characters.` })
  body!: string;
}

/** POST /email-templates/:key/test: the words as they are on screen (saved or not); left out, the saved or standard ones. */
export class EmailTemplateTestDto {
  @IsOptional()
  @IsString({ message: 'Write the subject.' })
  @MaxLength(EMAIL_TEMPLATE_LIMITS.subject, { message: `Keep the subject to ${EMAIL_TEMPLATE_LIMITS.subject} characters.` })
  subject?: string;

  @IsOptional()
  @IsString({ message: 'Write the email’s text.' })
  @MaxLength(EMAIL_TEMPLATE_LIMITS.body, { message: `Keep the text to ${EMAIL_TEMPLATE_LIMITS.body.toLocaleString('en-US')} characters.` })
  body?: string;
}
