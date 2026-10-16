import type { TextDirection } from '@cantoo/fontkit';
import {
  appendBezierCurve,
  beginText,
  closePath,
  endText,
  fill,
  lineTo,
  moveTo,
  PageSizes,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFImage,
  type PDFName,
  type PDFOperator,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { EmbeddedFont, glyphText } from '../documents/pdf-engine/embed.js';
import { fontFile, type FontScript } from '../documents/pdf-engine/fonts.js';
import { visualRuns, type TextRun } from '../documents/pdf-engine/text.js';
import { fillLines, wrapUnits } from '../documents/pdf-engine/wrap.js';
import { withoutMarks, type PayslipCell, type PayslipContent, type PayslipRow, type PayslipSection } from './payslip-content.js';

// A payslip drawn (owner's decisions, 16 October 2026, on the payslip proposal): one A4 page, restrained and tabular,
// the accent colour only on the header's rule, the section headings and the net band. The text goes through the PDF
// templates' own engine (documents/pdf-engine: fontkit's layout, the bidirectional algorithm, Noto Sans and Noto Naskh
// Arabic embedded subset), so Arabic prints joined and right to left as it does on the social insurance forms. The
// Arabic payslip is the English one mirrored: what is on the left is on the right, the amounts on the left. What comes
// back is unprotected: it is protected on its way to being kept (PayslipsService), like every filled document.

/** A colour as the PDF takes it: red, green, blue from 0 to 1. */
type Colour = readonly [number, number, number];
const colour = (hex: string): Colour => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Colour;

const INK = colour('#15202b');
const MUTED = colour('#5b6672');
const RULE = colour('#dce1e7');
const ACCENT = colour('#1d4e6e');
const TINT = colour('#edf3f7');
const WHITE = colour('#ffffff');
/** White at 85% over the accent: the net band's labels. */
const ON_ACCENT = colour('#d2dee6');

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
/** The margins: at the sides, and at the top and the bottom. */
const MARGIN = 42;
const MARGIN_Y = 36;
const CONTENT = PAGE_WIDTH - 2 * MARGIN;

/** The company's logo, printed when it is a PNG or a JPEG; otherwise its name is. */
export interface PayslipLogo {
  data: Uint8Array;
  type: string;
}

interface TextStyle {
  size: number;
  bold?: boolean;
  colour?: Colour;
}

/** The fonts of the document, each embedded the first time it prints. */
class Fonts {
  private readonly embedded = new Map<string, EmbeddedFont>();
  private readonly names = new Map<string, PDFName>();

  constructor(private readonly doc: PDFDocument) {}

  get(script: FontScript, bold: boolean): EmbeddedFont {
    const key = `${script}:${bold}`;
    let font = this.embedded.get(key);
    if (!font) this.embedded.set(key, (font = new EmbeddedFont(this.doc, fontFile(script, bold))));
    return font;
  }

  nameOn(page: PDFPage, font: EmbeddedFont): PDFName {
    const key = font.ref.toString();
    let name = this.names.get(key);
    if (!name) this.names.set(key, (name = page.node.newFontDictionary('F', font.ref)));
    return name;
  }

  embedAll(): void {
    for (const font of this.embedded.values()) font.embed();
  }
}

/** A line's runs as the PDF prints them, without the bidi marks that kept a piece of it the right way round. */
function runsOf(text: string, bold: boolean, direction: TextDirection): TextRun[] {
  return visualRuns(text, bold, direction)
    .map((run) => ({ ...run, text: withoutMarks(run.text) }))
    .filter((run) => run.text);
}

const widths = new Map<string, number>();

/** How wide a line prints at 1 point, measured as it is drawn (embed.ts). */
function widthAt1(text: string, bold: boolean, direction: TextDirection): number {
  const key = `${bold ? 'b' : 'r'}${direction}${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    width = runsOf(text, bold, direction).reduce((sum, run) => {
      const { font } = fontFile(run.script, bold);
      const laidOut = font.layout(run.text, undefined, undefined, undefined, run.direction);
      return sum + laidOut.glyphs.reduce((w, glyph, i) => w + (laidOut.positions?.[i]?.xAdvance ?? glyph.advanceWidth), 0) / font.unitsPerEm;
    }, 0);
    if (widths.size > 5000) widths.clear();
    widths.set(key, width);
  }
  return width;
}

/**
 * Where things go on the page and, when drawing, the drawing itself. Positions are logical: from the start of the
 * line (the left in English, the right in Arabic) and from the top of the page, so one layout draws both languages.
 * Measuring (no page) goes through the same steps without drawing, for the height.
 */
class Pen {
  /** Text reads this way; amounts always left to right. */
  readonly direction: TextDirection;
  private readonly lineFactor: number;
  private readonly baselineFactor: number;

  constructor(
    readonly rtl: boolean,
    /** How the payslip is made to fit on its page: the space between things, then everything, drawn smaller. */
    private readonly fit: Fit,
    private readonly page: PDFPage | null,
    private readonly fonts: Fonts | null,
  ) {
    this.direction = rtl ? 'rtl' : 'ltr';
    // Naskh's letters rise higher and reach lower than Latin ones
    this.lineFactor = rtl ? 1.38 : 1.25;
    this.baselineFactor = rtl ? 0.98 : 0.93;
  }

  get drawing(): boolean {
    return this.page !== null;
  }

  /** A size at the payslip's scale. */
  s(points: number): number {
    return points * this.fit.scale;
  }

  /** Space between things, up and down: squeezed first when the payslip would not fit. */
  space(points: number): number {
    return points * this.fit.scale * this.fit.squeeze;
  }

  lineHeight(size: number): number {
    return this.s(size) * this.lineFactor;
  }

  width(text: string, style: TextStyle, direction: TextDirection = this.direction): number {
    return widthAt1(text, style.bold === true, direction) * this.s(style.size);
  }

  /** The text wrapped at its spaces to lines no wider than `room`. */
  wrap(text: string, style: TextStyle, room: number): string[] {
    return fillLines(wrapUnits(text), (line) => this.width(line, style), room, 1000) ?? [text];
  }

  /** The page's x of a span `width` wide starting `from` the start of the content. */
  x(from: number, width: number): number {
    return this.rtl ? MARGIN + CONTENT - from - width : MARGIN + from;
  }

  /**
   * One line of text in the span from `from` to `to` (logical), at the start or the end of it, its line's top at
   * `top`. Returns its width.
   */
  text(text: string, style: TextStyle, top: number, from: number, to: number, align: 'start' | 'end' = 'start', direction: TextDirection = this.direction): number {
    const width = this.width(text, style, direction);
    if (!this.page || !this.fonts || !text) return width;
    const left = this.x(align === 'start' ? from : to - width, width);
    const size = this.s(style.size);
    const baseline = PAGE_HEIGHT - (top + size * this.baselineFactor);
    const ink = style.colour ?? INK;
    const ops: PDFOperator[] = [beginText(), setFillingRgbColor(...ink)];
    let x = left;
    for (const run of runsOf(text, style.bold === true, direction)) {
      const font = this.fonts.get(run.script, style.bold === true);
      const laidOut = font.layout(run.text, size, run.direction);
      ops.push(setFontAndSize(this.fonts.nameOn(this.page, font), size));
      for (const glyph of laidOut.glyphs) ops.push(setTextMatrix(1, 0, 0, 1, x + glyph.x, baseline + glyph.y), showText(glyphText(glyph.code)));
      x += laidOut.width;
    }
    ops.push(endText());
    this.page.pushOperators(...ops);
    return width;
  }

  /** Lines of text one under the other from `top`; returns the height they take. */
  lines(lines: readonly string[], style: TextStyle, top: number, from: number, to: number, align: 'start' | 'end' = 'start'): number {
    lines.forEach((line, i) => this.text(line, style, top + i * this.lineHeight(style.size), from, to, align));
    return lines.length * this.lineHeight(style.size);
  }

  /** A filled rectangle (logical span, from the top), its corners rounded when `radius` is given. */
  box(from: number, width: number, top: number, height: number, ink: Colour, radius = 0): void {
    if (!this.page) return;
    const x = this.x(from, width);
    const y = PAGE_HEIGHT - top - height;
    const r = Math.min(radius, width / 2, height / 2);
    const path = r > 0 ? roundedRect(x, y, width, height, r) : [rectangle(x, y, width, height)];
    this.page.pushOperators(pushGraphicsState(), setFillingRgbColor(...ink), ...path, fill(), popGraphicsState());
  }

  /** A horizontal rule across the span, `thickness` thick, its top at `top`. */
  rule(from: number, width: number, top: number, thickness: number, ink: Colour): void {
    this.box(from, width, top, thickness, ink);
  }

  image(image: PDFImage, from: number, top: number, width: number, height: number): void {
    if (!this.page) return;
    this.page.drawImage(image, { x: this.x(from, width), y: PAGE_HEIGHT - top - height, width, height });
  }
}

/** A rectangle's path with rounded corners, (x, y) its bottom-left corner. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): PDFOperator[] {
  const c = r * 0.5523; // a quarter circle's control points
  return [
    moveTo(x + r, y),
    lineTo(x + w - r, y),
    appendBezierCurve(x + w - r + c, y, x + w, y + r - c, x + w, y + r),
    lineTo(x + w, y + h - r),
    appendBezierCurve(x + w, y + h - r + c, x + w - r + c, y + h, x + w - r, y + h),
    lineTo(x + r, y + h),
    appendBezierCurve(x + r - c, y + h, x, y + h - r + c, x, y + h - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - c, x + r - c, y, x + r, y),
    closePath(),
  ];
}

// ---------- the payslip, top to bottom ----------

const LABEL: TextStyle = { size: 7, colour: MUTED };
const VALUE: TextStyle = { size: 9 };
const NOTE: TextStyle = { size: 7, colour: MUTED };
const HEADING: TextStyle = { size: 8.5, bold: true, colour: ACCENT };
/** The space between the blocks of the page. */
const GAP = 12;

/** The logo as drawn: within 170 × 34 points, its proportions kept. */
function logoSize(image: PDFImage, pen: Pen): { width: number; height: number } {
  const ratio = image.width / image.height || 1;
  let height = pen.s(34);
  let width = height * ratio;
  if (width > pen.s(170)) [width, height] = [pen.s(170), pen.s(170) / ratio];
  return { width, height };
}

/** The header: the logo or the company's name and its line, opposite the title; the accent rule under them. */
function header(pen: Pen, c: PayslipContent, logo: PDFImage | null, top: number): number {
  const half = CONTENT * 0.56;
  let brand = 0;
  if (logo) {
    const { width, height } = logoSize(logo, pen);
    pen.image(logo, 0, top, width, height);
    brand += height;
  } else {
    // the name as the company writes it, in Latin letters on both payslips (the proposal)
    const style: TextStyle = { size: 18, bold: true, colour: ACCENT };
    pen.text(c.company.name, style, top, 0, half, 'start', 'ltr');
    brand += pen.lineHeight(style.size);
  }
  if (c.company.line) {
    const line: TextStyle = { ...LABEL, size: 7.5 };
    brand += pen.space(3);
    brand += pen.lines(pen.wrap(c.company.line, line, half), line, top + brand, 0, half);
  }

  const kind: TextStyle = { size: 8, colour: MUTED };
  const month: TextStyle = { size: 14, bold: true };
  let title = 0;
  pen.text(c.title.kind, kind, top, CONTENT - half, CONTENT, 'end');
  title += pen.lineHeight(kind.size);
  pen.text(c.title.month, month, top + title, CONTENT - half, CONTENT, 'end');
  title += pen.lineHeight(month.size);
  if (c.title.paid) {
    pen.text(c.title.paid, kind, top + title, CONTENT - half, CONTENT, 'end');
    title += pen.lineHeight(kind.size);
  }

  const bottom = top + Math.max(brand, title) + pen.space(8);
  pen.rule(0, CONTENT, bottom, pen.s(1.5), ACCENT);
  return bottom + pen.s(1.5);
}

/** The facts, two columns, each label above its value; row by row as the proposal sets them. */
function facts(pen: Pen, c: PayslipContent, top: number): number {
  const gap = pen.s(24);
  const column = (CONTENT - gap) / 2;
  let y = top;
  for (let i = 0; i < c.facts.length; i += 2) {
    let tallest = 0;
    c.facts.slice(i, i + 2).forEach((f, j) => {
      const from = j * (column + gap);
      pen.text(f.label, LABEL, y, from, from + column);
      const value = pen.lines(pen.wrap(f.value, VALUE, column), VALUE, y + pen.lineHeight(LABEL.size), from, from + column);
      tallest = Math.max(tallest, pen.lineHeight(LABEL.size) + value);
    });
    y += tallest + (i + 2 < c.facts.length ? pen.space(4) : 0);
  }
  return y;
}

/** A section's heading; returns where what follows it starts. */
function heading(pen: Pen, text: string, top: number, after?: string): number {
  const width = pen.text(text, HEADING, top, 0, CONTENT);
  if (after) pen.text(` · ${after}`, { ...HEADING, bold: false, colour: MUTED }, top, width, CONTENT);
  return top + pen.lineHeight(HEADING.size) + pen.space(3);
}

/** This month's cells, tinted, three to a row at most, and the line of KPIs under them. */
function thisMonth(pen: Pen, c: NonNullable<PayslipContent['thisMonth']>, top: number): number {
  let y = heading(pen, c.heading, top);
  const pad = { x: pen.s(9), y: pen.space(6) };
  const value: TextStyle = { size: 11.5, bold: true };
  const rows: PayslipCell[][] = [];
  for (let i = 0; i < c.cells.length; i += 3) rows.push(c.cells.slice(i, i + 3));
  // as the proposal draws it: the cells tinted, a hairline of the rule's colour around and between them
  const hairline = pen.s(0.75);
  const heights = rows.map((cells) => {
    const width = CONTENT / cells.length;
    const height = (cell: PayslipCell) =>
      pen.lineHeight(LABEL.size) + pen.lineHeight(value.size) + (cell.note ? pen.wrap(cell.note, NOTE, width - 2 * pad.x).length * pen.lineHeight(NOTE.size) : 0);
    return Math.max(...cells.map(height)) + 2 * pad.y;
  });
  pen.box(0, CONTENT, y, heights.reduce((sum, h) => sum + h, 0) + (rows.length + 1) * hairline, RULE, pen.s(2.5));
  y += hairline;
  rows.forEach((cells, r) => {
    const width = (CONTENT - (cells.length + 1) * hairline) / cells.length;
    cells.forEach((cell, i) => {
      const left = hairline + i * (width + hairline);
      pen.box(left, width, y, heights[r], TINT);
      const from = left + pad.x;
      const to = left + width - pad.x;
      let at = y + pad.y;
      pen.text(cell.label, LABEL, at, from, to);
      at += pen.lineHeight(LABEL.size);
      pen.text(cell.value, value, at, from, to);
      at += pen.lineHeight(value.size);
      if (cell.note) pen.lines(pen.wrap(cell.note, NOTE, to - from), NOTE, at, from, to);
    });
    y += heights[r] + hairline;
  });
  if (c.line) {
    const line: TextStyle = { ...NOTE, size: 7.5 };
    y += pen.space(4);
    y += pen.lines(pen.wrap(c.line, line, CONTENT), line, y, 0, CONTENT);
  }
  return y;
}

/** Rows of a table: the label and its note at the start, the amount at the end, a rule under each but the last. */
function rows(pen: Pen, list: readonly PayslipRow[], top: number, options: { lastBold?: boolean; ruleLast?: boolean } = {}): number {
  const amountRoom = Math.max(...list.map((r) => pen.width(r.amount, { ...VALUE, bold: true }, 'ltr')), pen.s(60));
  const labelRoom = CONTENT - amountRoom - pen.s(16);
  let y = top;
  list.forEach((row, i) => {
    const last = i === list.length - 1;
    const bold = options.lastBold === true && last;
    const label: TextStyle = { ...VALUE, bold };
    y += pen.space(3);
    const labelHeight = pen.lines(pen.wrap(row.label, label, labelRoom), label, y, 0, labelRoom);
    pen.text(row.amount, { ...VALUE, bold, colour: row.value < 0 && !bold ? MUTED : INK }, y, CONTENT - amountRoom, CONTENT, 'end', 'ltr');
    let height = labelHeight;
    if (row.note) height += pen.s(0.5) + pen.lines(pen.wrap(row.note, NOTE, labelRoom), NOTE, y + labelHeight + pen.s(0.5), 0, labelRoom);
    y += height + pen.space(3);
    if (!last || options.ruleLast) {
      pen.rule(0, CONTENT, y, pen.s(0.5), RULE);
      y += pen.s(0.5);
    }
  });
  return y;
}

/** The earnings or the deductions: the heading, the rows and the total under a dark rule. */
function section(pen: Pen, s: PayslipSection, top: number): number {
  let y = heading(pen, s.heading, top);
  y = rows(pen, s.rows, y);
  pen.rule(0, CONTENT, y, pen.s(1), INK);
  y += pen.s(1) + pen.space(1);
  return rows(pen, [s.total], y, { lastBold: true });
}

/** The net band: the accent's own colour, the net and its words in white. */
function netBand(pen: Pen, c: PayslipContent['net'], top: number): number {
  const pad = { x: pen.s(13), y: pen.space(8) };
  const label: TextStyle = { size: 9.5, colour: ON_ACCENT };
  const amount: TextStyle = { size: 16, bold: true, colour: WHITE };
  const currency: TextStyle = { size: 8.5, colour: ON_ACCENT };
  const words: TextStyle = { size: 7.5, colour: ON_ACCENT };
  const inner = CONTENT - 2 * pad.x;
  const wordLines = c.words ? pen.wrap(c.words, words, inner) : [];
  const first = pen.lineHeight(amount.size);
  const height = 2 * pad.y + first + (wordLines.length ? pen.space(2) + wordLines.length * pen.lineHeight(words.size) : 0);
  pen.box(0, CONTENT, top, height, ACCENT, pen.s(3));

  const y = top + pad.y;
  // the label and the currency sit on the amount's baseline
  const drop = (size: number) => (pen.s(amount.size) - pen.s(size)) * (pen.rtl ? 0.98 : 0.93);
  pen.text(c.label, label, y + drop(label.size), pad.x, pad.x + inner);
  const currencyWidth = pen.width(c.currency, currency);
  pen.text(c.currency, currency, y + drop(currency.size), CONTENT - pad.x - currencyWidth, CONTENT - pad.x, 'end');
  pen.text(c.amount, amount, y, pad.x, CONTENT - pad.x - currencyWidth - pen.s(4), 'end', 'ltr');
  if (wordLines.length) pen.lines(wordLines, words, y + first + pen.space(2), pad.x, pad.x + inner);
  return top + height;
}

/** The company's share of the insurance: a note with a rule at its start. */
function companyShare(pen: Pen, text: string, top: number): number {
  const style: TextStyle = { size: 7, colour: MUTED };
  const indent = pen.s(9);
  const height = pen.lines(pen.wrap(text, style, CONTENT - indent), style, top, indent, CONTENT);
  pen.box(0, pen.s(2.5), top, height, RULE);
  return top + height;
}

/** The year to date: four to a row, labels above their values. */
function yearToDate(pen: Pen, c: NonNullable<PayslipContent['yearToDate']>, top: number): number {
  let y = heading(pen, c.heading, top, c.period);
  const width = CONTENT / 4;
  const value: TextStyle = { size: 10, bold: true };
  c.cells.forEach((cell, i) => {
    pen.text(cell.label, LABEL, y, i * width, (i + 1) * width - pen.s(8));
    pen.text(cell.value, value, y + pen.lineHeight(LABEL.size), i * width, (i + 1) * width - pen.s(8));
  });
  y += pen.lineHeight(LABEL.size) + pen.lineHeight(value.size);
  return y;
}

/** The footer: who approved it and when it was issued, its reference, and that it needs no signature. */
function footer(pen: Pen, c: PayslipContent['footer'], top: number): number {
  pen.rule(0, CONTENT, top, pen.s(0.5), RULE);
  let y = top + pen.s(0.5) + pen.space(6);
  y += pen.lines(pen.wrap(c.issued, NOTE, CONTENT), NOTE, y, 0, CONTENT);
  y += pen.lines(pen.wrap(c.note, NOTE, CONTENT), NOTE, y, 0, CONTENT);
  return y;
}

/** The whole payslip from the top margin; returns where it ends. */
function layout(pen: Pen, c: PayslipContent, logo: PDFImage | null): number {
  const gap = pen.space(GAP);
  let y = header(pen, c, logo, MARGIN_Y);
  y = facts(pen, c, y + gap);
  if (c.thisMonth) y = thisMonth(pen, c.thisMonth, y + gap);
  if (c.earnings) y = section(pen, c.earnings, y + gap);
  if (c.deductions) y = section(pen, c.deductions, y + gap);
  y = netBand(pen, c.net, y + gap);
  if (c.afterNet.length) y = rows(pen, c.afterNet, y + pen.space(2), { lastBold: true });
  if (c.companyShare) y = companyShare(pen, c.companyShare, y + pen.space(7));
  if (c.yearToDate) y = yearToDate(pen, c.yearToDate, y + gap);
  return footer(pen, c.footer, y + gap);
}

/** How a payslip is made to fit: everything at `scale`, the space between things at `squeeze` of that. */
interface Fit {
  scale: number;
  squeeze: number;
}

/**
 * The fits tried, in turn, until the payslip is on one page: the space between things squeezed to half, then
 * everything smaller (a payslip with many allowances on a part month).
 */
const FITS: Fit[] = [
  ...[1, 0.9, 0.8, 0.7, 0.6, 0.5].map((squeeze) => ({ scale: 1, squeeze })),
  ...[0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6].map((scale) => ({ scale, squeeze: 0.5 })),
];

/**
 * The payslip as a one-page A4 PDF, unprotected. A long one (many allowances) is drawn closer together, then
 * smaller, until it fits (FITS). `logo`
 * is printed when it is a PNG or a JPEG the PDF can take; otherwise the company's name is.
 */
export async function payslipPdf(content: PayslipContent, logo: PayslipLogo | null, meta: { title: string; author: string }): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.title);
  doc.setCreator('People System');
  doc.setProducer('People System');
  doc.setLanguage(content.language);
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  let image: PDFImage | null = null;
  if (logo) {
    try {
      if (logo.type === 'image/png') image = await doc.embedPng(logo.data);
      else if (logo.type === 'image/jpeg') image = await doc.embedJpg(logo.data);
    } catch {
      image = null; // a logo the PDF can't take: the name instead
    }
  }

  const available = PAGE_HEIGHT - MARGIN_Y;
  const fit = FITS.find((f) => layout(new Pen(content.rtl, f, null, null), content, image) <= available) ?? FITS[FITS.length - 1];
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fonts = new Fonts(doc);
  layout(new Pen(content.rtl, fit, page, fonts), content, image);
  fonts.embedAll();
  return Buffer.from(await doc.save({ addDefaultPage: false, updateFieldAppearances: false }));
}
