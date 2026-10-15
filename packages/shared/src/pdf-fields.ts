// PDF templates (owner's decision, 15 October 2026): an official form uploaded as a PDF (social insurance Forms 1 and
// 6 …) is never converted. HR places each field on the form once (Templates → a version → Place fields); every document
// is the original PDF with the values printed where the fields were placed. Word templates stay for the company's own
// documents, whose text flows.

/**
 * How a field prints:
 * - text: one line on the form's line or in its space (a name, an address, a job title);
 * - boxes: one character per printed box (the national ID's 14 boxes, a date's day, month and year boxes, a wage's
 *   pounds and piastres);
 * - check: a mark in a box, always, or only when a tag has a given value (e.g. the category "عاملين لدى الغير");
 * - fixed: the same text on every document (e.g. the insurance office's name).
 */
export const PDF_FIELD_KINDS = ['text', 'boxes', 'check', 'fixed'] as const;
export type PdfFieldKind = (typeof PDF_FIELD_KINDS)[number];

export const PDF_FIELD_ALIGNS = ['right', 'center', 'left'] as const;
export type PdfFieldAlign = (typeof PDF_FIELD_ALIGNS)[number];

/** A date's order in its boxes, read left to right: YMD for an Arabic form (the day in the right-most boxes), DMY otherwise. */
export const PDF_DATE_ORDERS = ['YMD', 'DMY'] as const;
export type PdfDateOrder = (typeof PDF_DATE_ORDERS)[number];

/**
 * One field placed on a PDF template. Positions and sizes are in PDF points (1/72 inch); x from the page's left edge,
 * y from its TOP edge (as the screen draws it), of the field's top-left corner.
 */
export interface PdfField {
  /** Made by the editor, unique within the version. */
  id: string;
  kind: PdfFieldKind;
  /** A TEMPLATE_TAGS tag for text and boxes; for check, null (always ticked) or the tag `equals` is compared with; null for fixed. */
  tag: string | null;
  /** fixed: the text to print; check: the mark (✓ unless set, e.g. "X"). */
  text?: string;
  /** check with a tag: ticked only when the tag's printed value is this (e.g. gender "ذكر"). */
  equals?: string;
  /** 1-based. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** In points, 5 to 36. */
  fontSize: number;
  bold?: boolean;
  /** text and fixed: right for Arabic (the default), left, or center. */
  align?: PdfFieldAlign;
  /** text and fixed: a value too long for the width is printed smaller rather than past the end. */
  shrinkToFit?: boolean;
  /** boxes: how many boxes the field covers; the characters are spread one per box, centred, left to right. */
  boxes?: number;
  /** boxes: the boxes split into groups left to right, e.g. [4, 2, 2] for a date; they add up to `boxes`. */
  groups?: number[];
  /** boxes: the space between two groups, in points (a printed "/" or a gap). */
  groupGap?: number;
  /** boxes: the space between two boxes inside a group, in points (0: boxes touching). */
  boxGap?: number;
  /** boxes: per-box nudges in points, by box index (left to right), for boxes printed unevenly. */
  nudges?: { dx: number; dy: number }[];
  /** boxes: a value with fewer characters than boxes starts in the left-most box (the default) or ends in the right-most (an amount). */
  boxAlign?: 'left' | 'right';
  /** boxes with a date tag (DD/MM/YYYY): which part goes in which boxes, read left to right; DMY unless set. */
  dateOrder?: PdfDateOrder;
  /** boxes with an amount tag (15,000.50): only the pounds (15000) or only the two piastre digits (50, 00 for none). */
  amountPart?: 'pounds' | 'piasters';
  /** Print digits as Arabic-Indic ٠-٩ instead of 0-9. */
  arabicDigits?: boolean;
  /**
   * text and boxes: the document is made even when the tag has no value, the field left blank (a building number, a
   * personal email); otherwise a tag with no value stops it, as in a Word template.
   */
  optional?: boolean;
}

/** A PDF template's pages, in points: the editor draws the fields to scale on them. */
export interface PdfPageSize {
  width: number;
  height: number;
}

/** At most this many fields on one PDF template, and pages in one PDF template. */
export const PDF_FIELDS_MAX = 300;
export const PDF_TEMPLATE_PAGES_MAX = 20;

export const PDF_FONT_SIZE_MIN = 5;
export const PDF_FONT_SIZE_MAX = 36;

/** A rectangle on a page, in points, from the page's top-left corner (as PdfField). */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The groups a boxes field is split into: its own when they add up to its boxes, else one group of all of them. */
export function pdfFieldGroups(field: Pick<PdfField, 'boxes' | 'groups'>): number[] {
  const boxes = Math.max(1, Math.floor(field.boxes ?? 1));
  const groups = field.groups?.filter((g) => Number.isInteger(g) && g > 0) ?? [];
  return groups.length && groups.reduce((a, b) => a + b, 0) === boxes ? groups : [boxes];
}

/**
 * Where each box of a boxes field is, left to right: the field's width shared out equally among its boxes once the gaps
 * between boxes (boxGap) and between groups (groupGap) are taken off, each box then moved by its nudge. The editor draws
 * these and the filled PDF prints in them, so both always agree.
 */
export function pdfFieldBoxes(field: Pick<PdfField, 'x' | 'y' | 'width' | 'height' | 'boxes' | 'groups' | 'boxGap' | 'groupGap' | 'nudges'>): PdfRect[] {
  const groups = pdfFieldGroups(field);
  const boxes = groups.reduce((a, b) => a + b, 0);
  const boxGap = Math.max(0, field.boxGap ?? 0);
  const groupGap = Math.max(0, field.groupGap ?? 0);
  const gaps = (boxes - groups.length) * boxGap + (groups.length - 1) * groupGap;
  const width = Math.max(0, (field.width - gaps) / boxes);
  const rects: PdfRect[] = [];
  let x = field.x;
  groups.forEach((size, g) => {
    if (g > 0) x += groupGap - boxGap;
    for (let i = 0; i < size; i++) {
      const nudge = field.nudges?.[rects.length];
      rects.push({ x: x + (nudge?.dx ?? 0), y: field.y + (nudge?.dy ?? 0), width, height: field.height });
      x += width + boxGap;
    }
  });
  return rects;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** 0-9 as ٠-٩. */
export const toArabicDigits = (text: string): string => text.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]);

/** ٠-٩ (and Persian ۰-۹) as 0-9. */
const toLatinDigits = (text: string): string =>
  text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * The character printed in each box of a boxes field (left to right; '' leaves the box empty), from the tag's printed
 * value: a date (DD/MM/YYYY) as its digits in the field's dateOrder, an amount (15,000.50) as its pounds or piastres
 * when amountPart is set, anything else as its characters without spaces or dashes. A value longer than the boxes keeps the
 * characters nearest the side it is aligned to.
 */
export function pdfBoxCharacters(field: Pick<PdfField, 'boxes' | 'boxAlign' | 'dateOrder' | 'amountPart' | 'arabicDigits'>, value: string): string[] {
  const boxes = Math.max(1, Math.floor(field.boxes ?? 1));
  let text = toLatinDigits(value).replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const month = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (date) {
    const [d, m, y] = [date[1].padStart(2, '0'), date[2].padStart(2, '0'), date[3]];
    text = field.dateOrder === 'YMD' ? `${y}${m}${d}` : `${d}${m}${y}`;
  } else if (month) {
    const [m, y] = [month[1].padStart(2, '0'), month[2]];
    text = field.dateOrder === 'YMD' ? `${y}${m}` : `${m}${y}`;
  } else if (field.amountPart && /^-?[\d,]+(\.\d+)?$/.test(text)) {
    const [pounds, piastres = ''] = text.replace(/,/g, '').split('.');
    text = field.amountPart === 'pounds' ? pounds : piastres.padEnd(2, '0').slice(0, 2);
  } else {
    // spaces and dashes only lay the value out (a tax number kept as 123-456-789): the boxes do that
    text = text.replace(/[\s\-\u2010-\u2015]+/g, '');
  }
  if (field.arabicDigits) text = toArabicDigits(text);
  let chars = Array.from(text);
  const right = field.boxAlign === 'right';
  if (chars.length > boxes) chars = right ? chars.slice(chars.length - boxes) : chars.slice(0, boxes);
  const pad: string[] = Array(boxes - chars.length).fill('');
  return right ? [...pad, ...chars] : [...chars, ...pad];
}

/** Whether a check field is ticked: always without a tag, else when the tag's printed value is its `equals`. */
export function pdfCheckTicked(field: Pick<PdfField, 'tag' | 'equals'>, value: string | undefined): boolean {
  if (!field.tag) return true;
  return (value ?? '').trim() !== '' && (value ?? '').trim() === (field.equals ?? '').trim();
}
