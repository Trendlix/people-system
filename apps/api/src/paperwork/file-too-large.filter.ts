import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import type { Response } from 'express';
import { PAPERWORK_MAX_MB } from './paperwork-file.js';

// The upload limit is enforced while the file arrives, before the handler runs; this says so in words HR understand
// instead of the upload library's "File too large".
@Catch(PayloadTooLargeException)
export class FileTooLargeFilter implements ExceptionFilter {
  catch(_err: PayloadTooLargeException, host: ArgumentsHost) {
    const status = HttpStatus.PAYLOAD_TOO_LARGE;
    const message = `Each file must be ${PAPERWORK_MAX_MB} MB or smaller.`;
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message });
  }
}
