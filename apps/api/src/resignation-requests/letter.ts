import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { RESIGNATION_LETTER_MAX_MB, RESIGNATION_LETTER_NOT_SENT, RESIGNATION_LETTER_TYPES } from '@trendlix/shared';
import type { Response } from 'express';
import { detectPaperworkType, safeFileName } from '../paperwork/paperwork-file.js';

// The signed letter of a resignation request (owner, 26 October 2026): one PDF or photo, kept as other uploads are: its
// type told by the file's first bytes, never by the browser's file type or the name, and the name cleaned before it is
// kept, shown or sent back in a header. HR uploads it since 31 October 2026 (owner: "on the resignation, the letter is
// auto generated, viewed by the employee but uploaded by the HR"); the employee's request takes no file any more.

export const LETTER_MAX_BYTES = RESIGNATION_LETTER_MAX_MB * 1024 * 1024;

/** The upload's limits: one file, a field or two. */
export const LETTER_UPLOAD = { limits: { fileSize: LETTER_MAX_BYTES, files: 2, fields: 10 }, defParamCharset: 'utf8' };

/** The employee's request: its fields as a form (the app's) or JSON, never a file. */
export const NO_LETTER = { limits: { files: 0, fields: 10 } };

export type LetterType = (typeof RESIGNATION_LETTER_TYPES)[number];

/** A letter as it is kept. */
export interface CheckedLetter {
  fileName: string;
  mimeType: LetterType;
  sizeBytes: number;
  data: Buffer;
}

const TOO_LARGE = `The letter must be ${RESIGNATION_LETTER_MAX_MB} MB or smaller.`;
const CHOOSE = 'Choose the signed letter: a PDF or a photo.';
const NOT_A_LETTER = 'The letter must be a PDF or a JPEG, PNG or WebP photo.';

/** The letter uploaded, checked by its content, and what is wrong with it: none, empty, too large, or another kind of file. */
export function checkedLetter(file: Pick<Express.Multer.File, 'buffer' | 'size' | 'originalname'> | undefined): { letter: CheckedLetter | null; problems: string[] } {
  if (!file) return { letter: null, problems: [CHOOSE] };
  if (!file.buffer?.length) return { letter: null, problems: ['The letter is empty.'] };
  if (file.size > LETTER_MAX_BYTES || file.buffer.length > LETTER_MAX_BYTES) return { letter: null, problems: [TOO_LARGE] };
  const type = detectPaperworkType(file.buffer);
  if (!type || !(RESIGNATION_LETTER_TYPES as readonly string[]).includes(type)) return { letter: null, problems: [NOT_A_LETTER] };
  return { letter: { fileName: safeFileName(file.originalname, type), mimeType: type as LetterType, sizeBytes: file.buffer.length, data: file.buffer }, problems: [] };
}

/** The upload library's refusals in plain words: a file too large, or more than one. Anything else as it is. */
@Catch(HttpException)
export class LetterUploadFilter implements ExceptionFilter {
  catch(err: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const said = err.getResponse();
    const message = typeof said === 'object' && said !== null && 'message' in said ? (said as { message: unknown }).message : said;
    if (err instanceof PayloadTooLargeException) {
      return void res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ statusCode: HttpStatus.PAYLOAD_TOO_LARGE, message: TOO_LARGE });
    }
    if (err instanceof BadRequestException && typeof message === 'string' && /^(Too many files|Unexpected (file )?field - letter)/.test(message)) {
      return void res.status(HttpStatus.BAD_REQUEST).json({ statusCode: HttpStatus.BAD_REQUEST, message: ['Attach one letter only.'] });
    }
    res.status(err.getStatus()).json(typeof said === 'string' ? { statusCode: err.getStatus(), message: said } : said);
  }
}

/** A file sent with the employee's request (an app from before 31 October 2026): People prepares the letter now. */
@Catch(HttpException)
export class NoLetterFilter implements ExceptionFilter {
  catch(err: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const said = err.getResponse();
    const message = typeof said === 'object' && said !== null && 'message' in said ? (said as { message: unknown }).message : said;
    if (err instanceof BadRequestException && typeof message === 'string' && /^(Too many files|Unexpected (file )?field)/.test(message)) {
      return void res.status(HttpStatus.BAD_REQUEST).json({ statusCode: HttpStatus.BAD_REQUEST, message: [RESIGNATION_LETTER_NOT_SENT] });
    }
    res.status(err.getStatus()).json(typeof said === 'string' ? { statusCode: err.getStatus(), message: said } : said);
  }
}
