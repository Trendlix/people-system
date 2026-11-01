import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { EmailTemplateDto, EmailTemplateTestDto } from './email-templates.dto.js';
import { EmailTemplatesService } from './email-templates.service.js';

// Organization → Email Templates (owner, 1 November 2026: "build the mail templetes"): HR, the CEO and a Super Admin
// read; HR and a Super Admin change them, as Recruitment Settings' emails are. "Reset to standard" is a POST, not a
// DELETE: it puts the system's words back, which HR may do (every DELETE is a Super Admin's).

const READS = ['hr', 'ceo', 'super_admin'] as const;
const MANAGES = ['hr', 'super_admin'] as const;

@Controller('email-templates')
export class EmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  /** Every email the system sends that HR may word, with its fields, the standard words and HR's. */
  @Roles(...READS)
  @Get()
  list() {
    return this.templates.list();
  }

  /** Saves HR's words for one email. */
  @Roles(...MANAGES)
  @Put(':key')
  save(@Param('key') key: string, @Body() dto: EmailTemplateDto, @CurrentUser() user: SessionUser) {
    return this.templates.save(key, dto, user);
  }

  /** "Reset to standard": the system's words again. */
  @Roles(...MANAGES)
  @Post(':key/reset')
  @HttpCode(200)
  reset(@Param('key') key: string, @CurrentUser() user: SessionUser) {
    return this.templates.reset(key, user);
  }

  /** "Send me a test": the words on screen filled with the samples, to the signed-in person. */
  @Roles(...MANAGES)
  @Post(':key/test')
  @HttpCode(200)
  test(@Param('key') key: string, @Body() dto: EmailTemplateTestDto, @CurrentUser() user: SessionUser) {
    return this.templates.test(key, dto, user);
  }
}
