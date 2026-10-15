import type { PdfField } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { formatOf, templateFileName } from '../templates/template-file.js';
import { fillTemplate, type TagValue } from './engine/index.js';
import { fillPdfTemplate } from './pdf-engine/index.js';

// Every document filled in from a template goes through here (generated documents, job offers, previews): a Word
// template has its {{tags}} replaced (engine/), a PDF form has the values printed where its fields were placed
// (pdf-engine/, owner's decision, 15 October 2026). Either way the result leaves the system only as a protected PDF.

/** What filling a version in reads of it, beside its tags. */
export const FILLED_FROM = { format: true, data: true, pdfFields: true, language: true } satisfies Prisma.TemplateVersionSelect;

/** A version to fill in: its file, its format and (a PDF) its fields, and its language. */
export interface FillableVersion {
  format: string;
  data: Uint8Array;
  pdfFields?: Prisma.JsonValue | null;
  language: string;
}

/** The version filled in with the values (by tag): a .docx for a Word template, a PDF for a PDF form. */
export async function fillVersion(version: FillableVersion, values: Readonly<Record<string, TagValue>>): Promise<Buffer> {
  if (formatOf(version.format) === 'pdf') {
    const fields = Array.isArray(version.pdfFields) ? (version.pdfFields as unknown as PdfField[]) : [];
    return fillPdfTemplate(version.data, fields, values, version.language);
  }
  return fillTemplate(Buffer.from(version.data), values);
}

/** A filled document's file name: the stem, cleaned, with the extension of what the version fills in (.docx or .pdf). */
export function filledFileName(stem: string, format: string): string {
  const as = formatOf(format);
  return templateFileName(`${stem}.${as}`, as);
}
