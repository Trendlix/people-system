import type { PdfField } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { pdfOptionalTags } from '../templates/pdf-fields.js';
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

/** A version's PDF fields as saved; none for a Word template. */
export const pdfFieldsOf = (pdfFields: Prisma.JsonValue | null | undefined): PdfField[] => (Array.isArray(pdfFields) ? (pdfFields as unknown as PdfField[]) : []);

/**
 * The tags of a version that stop a document while they have no value: all it prints, but on a PDF form those only
 * optional fields print (owner, 15 October 2026), which are then left blank. Every tag of a Word template counts.
 */
export function requiredTags(version: { tags: readonly string[]; pdfFields?: Prisma.JsonValue | null }): string[] {
  const optional = new Set(pdfOptionalTags(pdfFieldsOf(version.pdfFields)));
  return version.tags.filter((tag) => !optional.has(tag));
}

/**
 * The version filled in with the values (by tag): a .docx for a Word template, a PDF for a PDF form. `blank`: tags with
 * no value that a preview prints as their label, whose optional fields on a PDF form print nothing instead.
 */
export async function fillVersion(version: FillableVersion, values: Readonly<Record<string, TagValue>>, blank: ReadonlySet<string> = new Set()): Promise<Buffer> {
  if (formatOf(version.format) === 'pdf') {
    const left = (f: PdfField) => f.optional === true && (f.kind === 'text' || f.kind === 'boxes') && f.tag !== null && blank.has(f.tag);
    const fields = pdfFieldsOf(version.pdfFields).map((f) => (left(f) ? { ...f, tag: null } : f));
    return fillPdfTemplate(version.data, fields, values, version.language);
  }
  return fillTemplate(Buffer.from(version.data), values);
}

/** A filled document's file name: the stem, cleaned, with the extension of what the version fills in (.docx or .pdf). */
export function filledFileName(stem: string, format: string): string {
  const as = formatOf(format);
  return templateFileName(`${stem}.${as}`, as);
}
