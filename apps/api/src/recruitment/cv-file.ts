import { RECRUITMENT_LIMITS } from '@trendlix/shared';

// An applicant's CV (owner, 22 October 2026; the brief: "a CV upload (PDF or DOCX, at most 5 MB, checked by magic
// number)"): its type told by its first bytes, never by the browser's word or the name; a Word file is a zip holding
// word/document.xml. The name is cleaned before it is kept, shown or sent back in a header.

export const CV_MAX_BYTES = RECRUITMENT_LIMITS.cvMb * 1024 * 1024;

export const PDF = 'application/pdf';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type CvType = typeof PDF | typeof DOCX;

/** The upload's limits: the file a little over, so too large is said in words. */
export const CV_UPLOAD = {
  limits: { fileSize: CV_MAX_BYTES + 1, files: 1, fields: 30 },
  defParamCharset: 'utf8',
};

/** What the file is: a PDF, a Word file (.docx), or neither. */
export function cvTypeOf(data: Buffer): CvType | null {
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') return PDF;
  // a zip (PK\x03\x04) whose entries include the Word document's body
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04 && data.includes('word/document.xml')) return DOCX;
  return null;
}

/** The name kept: no folders, no control or direction characters, none of < > : " | ? *, at most 120 characters, and the right extension. */
export function cvFileName(name: string | undefined, type: CvType): string {
  const extension = type === PDF ? 'pdf' : 'docx';
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = Array.from(base.normalize('NFC'))
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return !(c < 0x20 || (c >= 0x7f && c < 0xa0) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff);
    })
    .join('')
    .replace(/[<>:"|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const stem = clean.replace(/\.[^.\s]{1,5}$/, '').replace(/^[\s.]+|[\s.]+$/g, '');
  const short = Array.from(stem).slice(0, 120 - extension.length - 1).join('').trim();
  return `${short || 'CV'}.${extension}`;
}

/** What is wrong with the CV sent, in words; null when it is fine. */
export function cvProblem(file: { buffer?: Buffer; size?: number } | undefined): string | null {
  if (!file?.buffer?.length) return 'Attach your CV, as a PDF or a Word file.';
  if ((file.size ?? file.buffer.length) > CV_MAX_BYTES || file.buffer.length > CV_MAX_BYTES) return `Your CV must be ${RECRUITMENT_LIMITS.cvMb} MB or smaller.`;
  if (!cvTypeOf(file.buffer)) return 'Your CV must be a PDF or a Word file (.docx).';
  return null;
}
