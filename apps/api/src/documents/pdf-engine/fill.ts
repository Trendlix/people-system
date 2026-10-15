import {
  beginText,
  concatTransformationMatrix,
  endText,
  LineCapStyle,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFName,
  type PDFOperator,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { pdfBoxCharacters, pdfCheckTicked, pdfFieldBoxes, toArabicDigits, type PdfField, type PdfRect } from '@trendlix/shared';
import { blockText, isRich, richBlocks, type TagValue } from '../engine/rich.js';
import { EmbeddedFont, glyphText, type LaidOutRun } from './embed.js';
import { fontFile, type FontScript } from './fonts.js';
import { shownPage, type ShownPage } from './pages.js';
import { charScript, visualRuns, type TextRun } from './text.js';

// Filling a PDF template in (owner's decision, 15 October 2026): the official form exactly as uploaded, its pages never
// laid out again, with each value printed on top where HR placed its field. A text field prints one line in its space,
// a boxes field one character per box, a check field its mark, a fixed field its own text. What is printed comes back
// unprotected: it is protected on its way out like every filled document (PdfService.protectedFile).

/** Room kept between a line of text and its field's left and right edges, in points. */
const PADDING = 1;
/** Text is never printed smaller than this to fit, in points. */
const SMALLEST = 3;

/** How a value prints on one line: a value with formatting (a job's duties) as its paragraphs' text, one after another. */
export function printedText(value: TagValue | undefined, language: string): string {
  if (value === undefined) return '';
  const text = isRich(value)
    ? richBlocks(value.html)
        .map((b) => blockText(b).trim())
        .filter(Boolean)
        .join(language === 'en' ? ', ' : '، ')
    : value;
  return text.replace(/\s+/g, ' ').trim();
}

/** The fonts of one document, each embedded the first time it prints, and its name on each page it prints on. */
class Fonts {
  private readonly embedded = new Map<string, EmbeddedFont>();
  private readonly names = new Map<string, PDFName>();

  constructor(private readonly doc: PDFDocument) {}

  get(script: FontScript, bold: boolean): EmbeddedFont {
    const key = `${script}:${bold}`;
    let font = this.embedded.get(key);
    if (!font) {
      font = new EmbeddedFont(this.doc, fontFile(script, bold));
      this.embedded.set(key, font);
    }
    return font;
  }

  /** The font's name in the page's resources. */
  nameOn(page: PDFPage, index: number, font: EmbeddedFont): PDFName {
    const key = `${index}:${font.ref.toString()}`;
    let name = this.names.get(key);
    if (!name) {
      name = page.node.newFontDictionary('F', font.ref);
      this.names.set(key, name);
    }
    return name;
  }

  embedAll(): void {
    for (const font of this.embedded.values()) font.embed();
  }
}

/** Where the baseline sits below a line's middle, for the font: half its ascent and descent, so the letters look centred. */
function baselineDrop(script: FontScript, bold: boolean, size: number): number {
  const { font } = fontFile(script, bold);
  return ((font.ascent + font.descent) / 2 / font.unitsPerEm) * size;
}

/** A page being drawn on: its geometry, and the operators for it (drawn in its terms as shown). */
interface Canvas {
  page: PDFPage;
  index: number;
  shown: ShownPage;
  fonts: Fonts;
  ops: PDFOperator[];
}

/** Draws one line in a rectangle (as placed: from the page's top-left corner), aligned, made smaller to fit when asked. */
function drawLine(
  canvas: Canvas,
  rect: PdfRect,
  runs: readonly TextRun[],
  options: { size: number; bold: boolean; align: 'right' | 'center' | 'left'; shrink: boolean },
): void {
  if (!runs.length) return;
  const fonts = runs.map((run) => canvas.fonts.get(run.script, options.bold));
  const layoutAt = (size: number): LaidOutRun[] => runs.map((run, i) => fonts[i].layout(run.text, size, run.direction));
  const room = Math.max(0, rect.width - 2 * PADDING);
  let size = options.size;
  let laidOut = layoutAt(size);
  const natural = laidOut.reduce((sum, r) => sum + r.width, 0);
  if (options.shrink && natural > room && natural > 0) {
    size = Math.max(SMALLEST, (size * room) / natural);
    laidOut = layoutAt(size);
  }
  const width = laidOut.reduce((sum, r) => sum + r.width, 0);

  const left = options.align === 'left' ? rect.x + PADDING : options.align === 'center' ? rect.x + (rect.width - width) / 2 : rect.x + rect.width - PADDING - width;
  // the line's middle, measured from the page's bottom as the drawing goes; the Arabic font sets the baseline when the
  // line has any Arabic
  const middle = canvas.shown.height - (rect.y + rect.height / 2);
  const script: FontScript = runs.some((r) => r.script === 'arabic') ? 'arabic' : 'latin';
  const baseline = middle - baselineDrop(script, options.bold, size);

  const ops = canvas.ops;
  ops.push(beginText(), setFillingRgbColor(0, 0, 0));
  let x = left;
  laidOut.forEach((run, i) => {
    ops.push(setFontAndSize(canvas.fonts.nameOn(canvas.page, canvas.index, fonts[i]), size));
    for (const glyph of run.glyphs) ops.push(setTextMatrix(1, 0, 0, 1, x + glyph.x, baseline + glyph.y), showText(glyphText(glyph.code)));
    x += run.width;
  });
  ops.push(endText());
}

/** A tick in the rectangle: two strokes, as no font here has the ✓ sign. */
function drawTick(canvas: Canvas, rect: PdfRect): void {
  const side = Math.min(rect.width, rect.height) * 0.7;
  const cx = rect.x + rect.width / 2;
  const cy = canvas.shown.height - (rect.y + rect.height / 2);
  const thickness = Math.max(0.8, side * 0.12);
  const start = { x: cx - side * 0.42, y: cy + side * 0.02 };
  const corner = { x: cx - side * 0.12, y: cy - side * 0.36 };
  const end = { x: cx + side * 0.45, y: cy + side * 0.4 };
  // drawn now, inside the page's drawing as shown (its operators so far go first)
  canvas.page.pushOperators(...canvas.ops.splice(0));
  const ink = rgb(0, 0, 0);
  canvas.page.drawLine({ start, end: corner, thickness, color: ink, lineCap: LineCapStyle.Round });
  canvas.page.drawLine({ start: corner, end, thickness, color: ink, lineCap: LineCapStyle.Round });
}

/**
 * The PDF template with the values printed where its fields were placed, unprotected. `values` are the printed values
 * by tag (as for a Word template); a tag without one prints nothing. `language` is the template's: a value with
 * formatting is printed as one line, its paragraphs joined with "، " (Arabic, both) or ", " (English).
 */
export async function fillPdfTemplate(
  pdf: Uint8Array,
  fields: readonly PdfField[],
  values: Readonly<Record<string, TagValue>>,
  language: string,
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const fonts = new Fonts(doc);
  const valueOf = (tag: string | null) => (tag ? printedText(values[tag], language) : '');

  for (const [index, page] of doc.getPages().entries()) {
    const onPage = fields.filter((f) => f.page === index + 1);
    if (!onPage.length) continue;
    const canvas: Canvas = { page, index, shown: shownPage(page), fonts, ops: [] };
    // drawn in the page's terms as shown: whatever its boxes and rotation, (0, 0) is its bottom-left corner as seen
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...canvas.shown.matrix));
    for (const field of onPage) {
      const bold = field.bold === true;
      if (field.kind === 'text' || field.kind === 'fixed') {
        let text = field.kind === 'fixed' ? (field.text ?? '').replace(/\s+/g, ' ').trim() : valueOf(field.tag);
        if (field.arabicDigits) text = toArabicDigits(text);
        drawLine(canvas, field, visualRuns(text, bold), { size: field.fontSize, bold, align: field.align ?? 'right', shrink: field.shrinkToFit === true });
      } else if (field.kind === 'boxes') {
        const chars = pdfBoxCharacters(field, valueOf(field.tag));
        const boxes = pdfFieldBoxes(field);
        chars.forEach((ch, i) => {
          if (ch && boxes[i]) drawLine(canvas, boxes[i], [{ script: charScript(ch, bold), text: ch, direction: 'ltr' }], { size: field.fontSize, bold, align: 'center', shrink: true });
        });
      } else if (field.kind === 'check') {
        if (!pdfCheckTicked(field, field.tag ? valueOf(field.tag) : undefined)) continue;
        const mark = (field.text ?? '').trim();
        if (!mark || mark === '✓' || mark === '✔') drawTick(canvas, field);
        else drawLine(canvas, field, visualRuns(mark, bold), { size: field.fontSize, bold, align: 'center', shrink: true });
      }
    }
    page.pushOperators(...canvas.ops, popGraphicsState());
  }
  fonts.embedAll();
  return Buffer.from(await doc.save({ addDefaultPage: false, updateFieldAppearances: false }));
}
