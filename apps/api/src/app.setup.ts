import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AuditService } from './audit/audit.service.js';
import { auditRequests } from './audit/audit-requests.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { ExampleRecorder, recordExamplesTo } from './docs/example-recorder.js';
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
  // the audit log (owner, 31 October 2026: "i want a log for all actions taken on the system"): where each request came
  // from, for the entries it writes ("with location and ip capture"), and the changes a signed-in person was refused
  app.use(auditRequests(app.get(AuditService)));
  app.useGlobalPipes(new FormValidationPipe(FORM_VALIDATION));
  app.useGlobalFilters(new PrismaExceptionFilter());
  // the API documentation's examples (31 October 2026), recorded only while the end-to-end tests run with DOCS_RECORD
  // set (npm run docs:examples); never on the server
  const recordTo = process.env.DOCS_RECORD;
  if (recordTo && process.env.NODE_ENV !== 'production') {
    app.useGlobalInterceptors(new ExampleRecorder());
    recordExamplesTo(recordTo);
  }
}
