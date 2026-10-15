import { ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** Messages of nested fields (e.g. a new employee's national ID) as written, not prefixed with "identity.". */
export class FormValidationPipe extends ValidationPipe {
  protected override prependConstraintsWithParentProp(_parentPath: string, error: ValidationError): ValidationError {
    return error;
  }
}

/** How every request body is checked: unknown fields refused, values turned into the DTO's (trimmed, tidied …). */
export const FORM_VALIDATION: ValidationPipeOptions = { whitelist: true, forbidNonWhitelisted: true, transform: true };

const pipe = new FormValidationPipe(FORM_VALIDATION);

/**
 * Checks values against a DTO exactly as a request body is checked (same transforms, validators and messages), for
 * values that don't arrive as a body of their own: e.g. an employee's change request, checked as an HR edit of the
 * profile would be. Answers the DTO with its tidied values; throws the same 400 as a request would.
 */
export async function validated<T extends object>(dto: new () => T, values: object): Promise<T> {
  return (await pipe.transform(values, { type: 'body', metatype: dto })) as T;
}
