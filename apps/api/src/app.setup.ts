import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { FORM_VALIDATION, FormValidationPipe } from './common/validation.js';
import { twilioWebhookBody, WHATSAPP_TWILIO_ROUTE, WHATSAPP_WEBHOOK_ROUTE, whatsappWebhookBody } from './whatsapp/webhook-body.js';

// Shared by main.ts and the end-to-end tests so both run the same app.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  // Meta's webhook signs the exact bytes it sends (24 October 2026): read as they came, before Nest's own parsers
  app.use(WHATSAPP_WEBHOOK_ROUTE, whatsappWebhookBody);
  // and Twilio's (25 October 2026: "Add Twilio as a choice"): its signature is over the parameters exactly as sent
  app.use(WHATSAPP_TWILIO_ROUTE, twilioWebhookBody);
  app.use(cookieParser());
  app.useGlobalPipes(new FormValidationPipe(FORM_VALIDATION));
  app.useGlobalFilters(new PrismaExceptionFilter());
}
