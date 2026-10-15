import { BadRequestException, StreamableFile } from '@nestjs/common';
import { contentDisposition } from '../paperwork/paperwork-file.js';
import { attachment } from '../templates/template-file.js';

// A filled document as the browser gets it (owner's request, 15 October 2026: "No doc file export, just a protected
// PDF"): generated documents, job offers and templates previewed with data are given only as protected PDFs (see
// PdfService.protectedFile), shown in the browser, or saved with ?download=1. Asking for the Word file is refused.

export const PDF_ONLY = 'Documents are given as protected PDFs only.';

/**
 * Whether the bytes are a PDF ("%PDF-" first), by their content as uploads are checked: a PDF template, and every
 * document filled in from one, is a PDF already and never goes through the converter (owner's decision, 15 October 2026).
 */
export function isPdf(data: Uint8Array): boolean {
  return data.length >= 5 && Buffer.from(data.buffer, data.byteOffset, 5).toString('latin1') === '%PDF-';
}

/** ?format= of a filled document: pdf, or none; docx (or anything else) is refused (400). */
export function pdfOnly(format: string | undefined): void {
  if (format !== undefined && format !== '' && format !== 'pdf') throw new BadRequestException(PDF_ONLY);
}

/** ?download=1 (or true): saved rather than shown in the browser. */
export function wantsDownload(download: string | undefined): boolean {
  return download === '1' || download === 'true';
}

/** The protected PDF, shown in the browser, or saved when `download`; under its own name (RFC 6266, 8187). */
export function pdfFile(file: { data: Buffer; fileName: string }, download: boolean): StreamableFile {
  return new StreamableFile(file.data, {
    type: 'application/pdf',
    length: file.data.length,
    disposition: download ? attachment(file.fileName) : contentDisposition(file.fileName),
  });
}
