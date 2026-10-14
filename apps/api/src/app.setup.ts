import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import cookieParser from 'cookie-parser';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';

/** Messages of nested fields (e.g. a new employee's national ID) as written, not prefixed with "identity.". */
class FormValidationPipe extends ValidationPipe {
  protected override prependConstraintsWithParentProp(_parentPath: string, error: ValidationError): ValidationError {
    return error;
  }
}

// Shared by main.ts and the end-to-end tests so both run the same app.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new FormValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
}
