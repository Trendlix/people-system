import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { FORM_VALIDATION, FormValidationPipe } from './common/validation.js';

// Shared by main.ts and the end-to-end tests so both run the same app.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new FormValidationPipe(FORM_VALIDATION));
  app.useGlobalFilters(new PrismaExceptionFilter());
}
