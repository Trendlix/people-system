import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { RECRUITMENT_LIMITS } from '@trendlix/shared';
import type { Response } from 'express';

// The upload library's refusals of a CV in words the applicant understands: a file too large while it arrives (before
// the handler runs), or more than one file. Anything else as it is.

const TOO_LARGE = `Your CV must be ${RECRUITMENT_LIMITS.cvMb} MB or smaller.`;

@Catch(HttpException)
export class CvUploadFilter implements ExceptionFilter {
  catch(err: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const said = err.getResponse();
    const message = typeof said === 'object' && said !== null && 'message' in said ? (said as { message: unknown }).message : said;
    if (err instanceof PayloadTooLargeException) {
      return void res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ statusCode: HttpStatus.PAYLOAD_TOO_LARGE, message: [TOO_LARGE] });
    }
    if (err instanceof BadRequestException && typeof message === 'string' && /^(Too many files|Unexpected (file )?field)/.test(message)) {
      return void res.status(HttpStatus.BAD_REQUEST).json({ statusCode: HttpStatus.BAD_REQUEST, message: ['Attach one CV, as a PDF or a Word file.'] });
    }
    res.status(err.getStatus()).json(typeof said === 'string' ? { statusCode: err.getStatus(), message: said } : said);
  }
}
