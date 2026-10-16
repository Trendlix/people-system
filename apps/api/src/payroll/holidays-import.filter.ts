import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import type { Response } from 'express';
import { TOO_LARGE } from './holidays-import.js';

// A holiday list's size limit (holidays-import.ts: 1 MB, smaller than paperwork's 10 MB) is enforced while the file
// arrives, before the handler runs; this says so in words HR understand instead of the upload library's "File too
// large", as paperwork's FileTooLargeFilter does for its own limit.
@Catch(PayloadTooLargeException)
export class HolidayFileTooLargeFilter implements ExceptionFilter {
  catch(_err: PayloadTooLargeException, host: ArgumentsHost) {
    const status = HttpStatus.PAYLOAD_TOO_LARGE;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message: TOO_LARGE });
  }
}
