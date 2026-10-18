import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { LEAVE_DOCUMENT_MAX_MB, LEAVE_DOCUMENT_TYPES, LEAVE_DOCUMENTS_MAX } from '@trendlix/shared';
import type { Response } from 'express';
import { detectPaperworkType, safeFileName } from '../paperwork/paperwork-file.js';

// A leave request's documents (a medical certificate, proof of sitting the exam: owner, 18 October 2026, the law's
// "شهادة طبية" of Art. 54 and "إثبات ما يفيد دخوله الامتحان فعليا" of Art. 126): photos or PDFs, at most
// LEAVE_DOCUMENTS_MAX, each at most LEAVE_DOCUMENT_MAX_MB, as a reimbursement's receipts. The type is told by the file's
// first bytes, never by the browser's file type or the name; the name is cleaned before it is kept, shown or sent back.

export const DOCUMENT_MAX_BYTES = LEAVE_DOCUMENT_MAX_MB * 1024 * 1024;

/** The upload's limits: one more file than may be attached, so too many is said in words (checkedDocuments). */
export const DOCUMENT_UPLOAD = {
  limits: { fileSize: DOCUMENT_MAX_BYTES, files: LEAVE_DOCUMENTS_MAX + 1, fields: 12 },
  defParamCharset: 'utf8',
};

export type DocumentType = (typeof LEAVE_DOCUMENT_TYPES)[number];

export interface CheckedDocument {
  fileName: string;
  mimeType: DocumentType;
  sizeBytes: number;
  data: Buffer;
}

const TOO_MANY = `Attach at most ${LEAVE_DOCUMENTS_MAX} documents.`;
const TOO_LARGE = `Each document must be ${LEAVE_DOCUMENT_MAX_MB} MB or smaller.`;

/** The documents uploaded, checked by their content, and what is wrong with them, each named. */
export function checkedDocuments(files: readonly Pick<Express.Multer.File, 'buffer' | 'size' | 'originalname'>[] | undefined): { documents: CheckedDocument[]; problems: string[] } {
  const list = files ?? [];
  const problems: string[] = [];
  const documents: CheckedDocument[] = [];
  if (list.length > LEAVE_DOCUMENTS_MAX) problems.push(TOO_MANY);
  list.forEach((f, i) => {
    const name = f.originalname?.trim() ? `Document ${i + 1} (${f.originalname.trim()})` : `Document ${i + 1}`;
    if (!f.buffer?.length) return void problems.push(`${name} is empty.`);
    if (f.size > DOCUMENT_MAX_BYTES || f.buffer.length > DOCUMENT_MAX_BYTES) return void problems.push(`${name} must be ${LEAVE_DOCUMENT_MAX_MB} MB or smaller.`);
    const type = detectPaperworkType(f.buffer);
    if (!type || !(LEAVE_DOCUMENT_TYPES as readonly string[]).includes(type)) return void problems.push(`${name} must be a JPEG, PNG or WebP photo, or a PDF.`);
    documents.push({ fileName: safeFileName(f.originalname, type), mimeType: type as DocumentType, sizeBytes: f.buffer.length, data: f.buffer });
  });
  return { documents, problems };
}

/** The upload library's refusals in words: a file too large while it arrives, or more files than the upload takes. */
@Catch(HttpException)
export class DocumentUploadFilter implements ExceptionFilter {
  catch(err: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const said = err.getResponse();
    const message = typeof said === 'object' && said !== null && 'message' in said ? (said as { message: unknown }).message : said;
    if (err instanceof PayloadTooLargeException) {
      return void res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ statusCode: HttpStatus.PAYLOAD_TOO_LARGE, message: TOO_LARGE });
    }
    if (err instanceof BadRequestException && typeof message === 'string' && /^(Too many files|Unexpected (file )?field - documents)/.test(message)) {
      return void res.status(HttpStatus.BAD_REQUEST).json({ statusCode: HttpStatus.BAD_REQUEST, message: [TOO_MANY] });
    }
    res.status(err.getStatus()).json(typeof said === 'string' ? { statusCode: err.getStatus(), message: said } : said);
  }
}
