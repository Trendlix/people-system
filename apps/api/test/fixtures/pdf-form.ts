import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, rgb, type PDFRef } from '@cantoo/pdf-lib';

// PDF forms for the tests of PDF templates (owner's decision, 15 October 2026): blank pages built with the library, a
// line drawn on each so they aren't empty, of any size, rotation and crop; and what a filled one prints, read back
// glyph by glyph through each font's ToUnicode map.

export interface FormPage {
  width: number;
  height: number;
  rotate?: number;
  /** x, y, width, height in the page's own space. */
  cropBox?: [number, number, number, number];
}

/** A form of blank pages (612 × 1008, as the social insurance forms, unless given). */
export async function formPdf(pages: FormPage[] = [{ width: 612, height: 1008 }, { width: 612, height: 1008 }]): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const page = doc.addPage([p.width, p.height]);
    page.drawLine({ start: { x: 36, y: 36 }, end: { x: p.width - 36, y: 36 }, thickness: 1, color: rgb(0, 0, 0) });
    if (p.cropBox) page.setCropBox(...p.cropBox);
    // set as it is, a rotation that isn't a quarter turn too (the library's setRotation refuses one)
    if (p.rotate) page.node.set(PDFName.of('Rotate'), PDFNumber.of(p.rotate));
  }
  return Buffer.from(await doc.save());
}

/** A glyph shown by the filler: its text (through the ToUnicode map; '' for a mark), font, size and where, in the page's own space. */
export interface ShownGlyph {
  page: number;
  text: string;
  font: string;
  size: number;
  /** The text matrix's translation, after the "cm" the filler opens its drawing with. */
  x: number;
  y: number;
}

const decode = (doc: PDFDocument, object: unknown): string => {
  const stream = object instanceof PDFRawStream ? object : (doc.context.lookup(object as PDFRef) as PDFRawStream);
  return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
};

/** Each Noto font of the page (the filler's): its resource name, its BaseFont and its glyphs' text by code. */
function fontsOf(doc: PDFDocument, pageIndex: number): Map<string, { baseFont: string; text: Map<string, string> }> {
  const fonts = new Map<string, { baseFont: string; text: Map<string, string> }>();
  const resources = doc.getPage(pageIndex).node.Resources();
  const dict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!dict) return fonts;
  for (const [name, ref] of dict.entries()) {
    const font = doc.context.lookup(ref, PDFDict);
    const baseFont = font.get(PDFName.of('BaseFont'))?.toString() ?? '';
    if (!baseFont.includes('Noto')) continue;
    const cmap = decode(doc, font.get(PDFName.of('ToUnicode')));
    const text = new Map<string, string>();
    for (const [, code, unicode] of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]+)>/gi)) {
      text.set(code.toLowerCase(), Buffer.from(unicode, 'hex').swap16().toString('utf16le'));
    }
    fonts.set(name.toString(), { baseFont, text });
  }
  return fonts;
}

/** What the filler printed on each page, glyph by glyph, in the order drawn (left to right as seen, per line). */
export async function shownGlyphs(pdf: Uint8Array): Promise<ShownGlyph[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const glyphs: ShownGlyph[] = [];
  doc.getPages().forEach((page, index) => {
    const fonts = fontsOf(doc, index);
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const content = streams.map((s) => decode(doc, s)).join('\n');
    let font: { name: string; baseFont: string; text: Map<string, string> } | null = null;
    let size = 0;
    let at = { x: 0, y: 0 };
    const ops = /(\/\S+)\s+([\d.]+)\s+Tf|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9a-fA-F]+)>\s*Tj/g;
    for (const m of content.matchAll(ops)) {
      if (m[1]) {
        const f = fonts.get(m[1]);
        font = f ? { name: m[1], ...f } : null;
        size = Number(m[2]);
      } else if (m[3] !== undefined) {
        at = { x: Number(m[7]), y: Number(m[8]) };
      } else if (m[9] && font) {
        for (let i = 0; i < m[9].length; i += 4) {
          glyphs.push({ page: index + 1, text: font.text.get(m[9].slice(i, i + 4).toLowerCase()) ?? '', font: font.baseFont, size, x: at.x, y: at.y });
        }
      }
    }
  });
  return glyphs;
}

/** The text printed on a page as seen: the glyphs of each line (the same baseline, within half a point) left to right. */
export function shownLines(glyphs: readonly ShownGlyph[], page = 1): string[] {
  const lines: { y: number; glyphs: ShownGlyph[] }[] = [];
  for (const g of glyphs.filter((x) => x.page === page && x.text)) {
    const line = lines.find((l) => Math.abs(l.y - g.y) < 0.5);
    if (line) line.glyphs.push(g);
    else lines.push({ y: g.y, glyphs: [g] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => [...l.glyphs].sort((a, b) => a.x - b.x).map((g) => g.text).join(''));
}

/** The filler's drawing on a page (the last content stream), as text. */
export async function fillerContent(pdf: Uint8Array, page = 1): Promise<string> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const contents = doc.getPage(page - 1).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return decode(doc, streams[streams.length - 1]);
}

/** The transformation the filler's drawing opens with ("a b c d e f cm"): from the page as shown to the page's own space. */
export async function fillerMatrix(pdf: Uint8Array, page = 1): Promise<number[]> {
  const m = /^q\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm/.exec(await fillerContent(pdf, page));
  return m ? m.slice(1).map(Number) : [];
}
