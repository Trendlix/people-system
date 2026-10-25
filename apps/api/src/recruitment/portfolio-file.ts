import { PORTFOLIO_FILE_FIELD, PORTFOLIO_LIMITS, portfolioLinksSent } from '@trendlix/shared';
import { CV_MAX_BYTES, cvFileName, PDF } from './cv-file.js';

// The careers forms' portfolio (owner, 25 October 2026: "for creatives, they need to add their portfolios"; packages/
// shared portfolio.ts): the links as sent (the new forms' list, or an older page's one "portfolio"), and the PDF case
// study, kept as the CV is (the same limits: at most 5 MB, its type told by its first bytes, its name cleaned). The two
// careers forms take the CV and the PDF as two files of one upload.

/** The careers forms' upload: the CV and the PDF case study, each at most 5 MB (a little over, so too large is said in words). */
export const CAREERS_UPLOAD = {
  limits: { fileSize: CV_MAX_BYTES + 1, files: 2, fields: 40 },
  defParamCharset: 'utf8',
};

/** The upload's files: the CV and the PDF case study, one each. */
export const CAREERS_FILES = [
  { name: 'cv', maxCount: 1 },
  { name: PORTFOLIO_FILE_FIELD, maxCount: 1 },
];

/** The two files as the upload gives them. */
export type CareersFiles = { cv?: Express.Multer.File[]; portfolioFile?: Express.Multer.File[] } | undefined;

/** The links a form sent: the list (portfolioLinks, a JSON list), else an older page's one "portfolio". */
export function portfolioSent(dto: { portfolioLinks?: string; portfolio?: string }): string[] {
  if (typeof dto.portfolioLinks === 'string') return portfolioLinksSent(dto.portfolioLinks);
  return typeof dto.portfolio === 'string' && dto.portfolio.trim() ? [dto.portfolio.trim()] : [];
}

/** What is wrong with the PDF case study, in words; null when fine (or none sent). */
export function portfolioFileProblem(file: { buffer?: Buffer; size?: number } | undefined): string | null {
  if (!file?.buffer?.length) return null;
  if ((file.size ?? file.buffer.length) > CV_MAX_BYTES || file.buffer.length > CV_MAX_BYTES) return `Your portfolio PDF must be ${PORTFOLIO_LIMITS.fileMb} MB or smaller.`;
  if (file.buffer.toString('ascii', 0, 5) !== '%PDF-') return 'Your portfolio file must be a PDF.';
  return null;
}

/** The PDF case study as kept: its name cleaned, its type, its size and bytes. */
export function portfolioFileRow(file: Express.Multer.File): { fileName: string; mimeType: string; sizeBytes: number; data: Uint8Array<ArrayBuffer> } {
  return { fileName: cvFileName(file.originalname || 'Portfolio', PDF), mimeType: PDF, sizeBytes: file.buffer.length, data: new Uint8Array(file.buffer) };
}
