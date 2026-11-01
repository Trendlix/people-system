import { Module } from '@nestjs/common';
import { EmailTemplatesController } from './email-templates.controller.js';
import { EmailTemplatesService } from './email-templates.service.js';

/** Organization → Email Templates: HR's words for the emails the system sends (1 November 2026). */
@Module({ controllers: [EmailTemplatesController], providers: [EmailTemplatesService] })
export class EmailTemplatesModule {}
