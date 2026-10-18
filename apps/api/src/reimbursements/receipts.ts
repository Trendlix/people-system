import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { REIMBURSEMENT_RECEIPT_MAX_MB, REIMBURSEMENT_RECEIPT_TYPES, REIMBURSEMENT_RECEIPTS_MAX } from '@trendlix/shared';
import type { Response } from 'express';
import { detectPaperworkType, safeFileName } from '../paperwork/paperwork-file.js';

// A claim's receipts (owner, 18 October 2026: a receipt required or not, by the type): photos or PDFs, at most
// REIMBURSEMENT_RECEIPTS_MAX, each at most REIMBURSEMENT_RECEIPT_MAX_MB. The type is told by the file's first bytes, as
// paperwork's is, never by the browser's file type or the name; the name is cleaned before it is kept, shown or sent
// back in a header.

export const RECEIPT_MAX_BYTES = REIMBURSEMENT_RECEIPT_MAX_MB * 1024 * 1024;

/** The upload's limits: one more file than may be attached, so too many is said in words (checkedReceipts), not by the upload library. */
export const RECEIPT_UPLOAD = {
  limits: { fileSize: RECEIPT_MAX_BYTES, files: REIMBURSEMENT_RECEIPTS_MAX + 1, fields: 10 },
  defParamCharset: 'utf8',
};

export type ReceiptType = (typeof REIMBURSEMENT_RECEIPT_TYPES)[number];

/** A receipt as it is kept. */
export interface CheckedReceipt {
  fileName: string;
  mimeType: ReceiptType;
  sizeBytes: number;
  data: Buffer;
}

const TOO_MANY = `Attach at most ${REIMBURSEMENT_RECEIPTS_MAX} receipts.`;
const TOO_LARGE = `Each receipt must be ${REIMBURSEMENT_RECEIPT_MAX_MB} MB or smaller.`;

/**
 * The receipts uploaded, checked by their content, and what is wrong with them, each named: too many, an empty file,
 * one too large, one that isn't a JPEG, PNG or WebP photo or a PDF.
 */
export function checkedReceipts(files: readonly Pick<Express.Multer.File, 'buffer' | 'size' | 'originalname'>[] | undefined): { receipts: CheckedReceipt[]; problems: string[] } {
  const list = files ?? [];
  const problems: string[] = [];
  const receipts: CheckedReceipt[] = [];
  if (list.length > REIMBURSEMENT_RECEIPTS_MAX) problems.push(TOO_MANY);
  list.forEach((f, i) => {
    const name = f.originalname?.trim() ? `Receipt ${i + 1} (${f.originalname.trim()})` : `Receipt ${i + 1}`;
    if (!f.buffer?.length) return void problems.push(`${name} is empty.`);
    if (f.size > RECEIPT_MAX_BYTES || f.buffer.length > RECEIPT_MAX_BYTES) return void problems.push(`${name} must be ${REIMBURSEMENT_RECEIPT_MAX_MB} MB or smaller.`);
    const type = detectPaperworkType(f.buffer);
    if (!type || !(REIMBURSEMENT_RECEIPT_TYPES as readonly string[]).includes(type)) return void problems.push(`${name} must be a JPEG, PNG or WebP photo, or a PDF.`);
    receipts.push({ fileName: safeFileName(f.originalname, type), mimeType: type as ReceiptType, sizeBytes: f.buffer.length, data: f.buffer });
  });
  return { receipts, problems };
}

/**
 * The upload library's refusals in words the employee understands: a file too large while it arrives (before the
 * handler runs), or more files than the upload takes. Anything else as it is.
 */
@Catch(HttpException)
export class ReceiptUploadFilter implements ExceptionFilter {
  catch(err: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const said = err.getResponse();
    const message = typeof said === 'object' && said !== null && 'message' in said ? (said as { message: unknown }).message : said;
    if (err instanceof PayloadTooLargeException) {
      return void res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ statusCode: HttpStatus.PAYLOAD_TOO_LARGE, message: TOO_LARGE });
    }
    if (err instanceof BadRequestException && typeof message === 'string' && /^(Too many files|Unexpected (file )?field - receipts)/.test(message)) {
      return void res.status(HttpStatus.BAD_REQUEST).json({ statusCode: HttpStatus.BAD_REQUEST, message: [TOO_MANY] });
    }
    res.status(err.getStatus()).json(typeof said === 'string' ? { statusCode: err.getStatus(), message: said } : said);
  }
}
