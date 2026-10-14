import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

// Turns common database errors into clear HTTP responses instead of a 500.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, message] = describe(err);
    res.status(status).json({ statusCode: status, message });
  }
}

function describe(err: Prisma.PrismaClientKnownRequestError): [number, string] {
  switch (err.code) {
    case 'P2002':
      return [HttpStatus.CONFLICT, 'A record with the same name already exists.'];
    case 'P2003':
      return [HttpStatus.CONFLICT, 'This record is linked to other records, so it cannot be changed or deleted.'];
    case 'P2025':
      return [HttpStatus.NOT_FOUND, 'Record not found.'];
    default:
      return [HttpStatus.INTERNAL_SERVER_ERROR, 'Database error.'];
  }
}
