import { createHash } from 'node:crypto';
import type { PdfField, PdfPageSize } from '@trendlix/shared';
import { FORM_1_FIELDS, FORM_6_FIELDS, NOSI_FORM_PAGES } from './insurance-form-layouts.js';

// Starter layouts (owner's decision, 15 October 2026): the fields of a form the system already knows, placed for HR
// when that form is uploaded to its slot (the social insurance Forms 1 and 6 as the owner has them), so HR only checks
// them instead of placing each one. A form is known by its file's SHA-256, or by its pages: the owner tidies the files
// (a page number taken off), and a file of the slot with exactly the same pages is the same form saved again. Any
// other file starts with no fields. A starter layout is checked like fields HR save, and HR can change it like any other.

export interface StarterLayout {
  /** The template slot it is for, e.g. insurance_form_1. */
  slotKey: string;
  /** The SHA-256s of the files it was placed on, in hex. */
  sha256: readonly string[];
  /** The pages it was placed on, in points: a file of the slot with the same pages (to 1 pt) gets it too. */
  pages: readonly PdfPageSize[];
  /** What it is, for the audit log, e.g. "Form 1 as issued by NOSI (2 pages)". */
  note: string;
  fields: PdfField[];
}

/** The layouts the system knows. */
export const STARTER_LAYOUTS: readonly StarterLayout[] = [
  {
    slotKey: 'insurance_form_1',
    sha256: ['ede915375457785cee191e7dc7baa0498634891055b65427214ed8d1b2fdb183', '8a80df491c9afe905cff931db903c60b0d37a1c6aafb38fa17778b84663498cb'],
    pages: NOSI_FORM_PAGES,
    note: 'Form 1 (طلب اشتراك مؤمن عليه) as issued by NOSI, 2 pages',
    fields: FORM_1_FIELDS,
  },
  {
    slotKey: 'insurance_form_6',
    sha256: ['85fb1ac844d8c5b3bfe93356c6102c752a59bef53657042c55a8a226d2b3f015'],
    pages: NOSI_FORM_PAGES,
    note: 'Form 6 (إخطار بانتهاء اشتراك مؤمن عليه) as issued by NOSI, 2 pages',
    fields: FORM_6_FIELDS,
  },
];

/** Injection token: TemplatesService takes the layouts through it, so a test can give its own. */
export const STARTER_LAYOUTS_TOKEN = Symbol('STARTER_LAYOUTS');

const samePages = (a: readonly PdfPageSize[], b: readonly PdfPageSize[]): boolean =>
  a.length === b.length && a.every((p, i) => Math.abs(p.width - b[i].width) <= 1 && Math.abs(p.height - b[i].height) <= 1);

/** The starter layout for this file in this slot, if there is one: exactly this file first, else one placed on the same pages. */
export function starterLayoutFor(
  slotKey: string,
  data: Uint8Array,
  pages: readonly PdfPageSize[],
  layouts: readonly StarterLayout[] = STARTER_LAYOUTS,
): StarterLayout | null {
  const mine = layouts.filter((l) => l.slotKey === slotKey);
  if (!mine.length) return null;
  const sha256 = createHash('sha256').update(data).digest('hex');
  return mine.find((l) => l.sha256.some((s) => s.toLowerCase() === sha256)) ?? mine.find((l) => samePages(l.pages, pages)) ?? null;
}
