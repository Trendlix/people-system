import { createHash } from 'node:crypto';
import { PDFHexString, PDFString, type PDFDocument, type PDFRef } from '@cantoo/pdf-lib';
import type { Glyph, Subset, TextDirection } from '@cantoo/fontkit';
import type { FontFile } from './fonts.js';

// A font embedded in a filled PDF template, glyph by glyph. Noto Naskh Arabic, like most good Arabic fonts, prints a
// letter as its shape and its dots as marks placed on it by the font's positioning table; pdf-lib's own text drawing
// keeps only each glyph's width, which leaves the dots astray. So the text is laid out here (fontkit: the letters
// joined, the marks placed) and each glyph drawn where the layout puts it, in a font embedded subset: only the glyphs
// printed, as a CID font (Identity-H, two bytes a glyph) with a ToUnicode map, so the text reads back as text. One
// glyph can stand for several letters (ب ت ث ن ي share a shape before their dots; أ is an alef and a hamza mark), so
// each glyph gets a code of its own for each letter it is drawn for, all of them mapped to the one glyph.

/** A glyph to draw: its code (CID) in the embedded font and where it goes, in points from the run's start on its baseline. */
export interface PlacedGlyph {
  code: string;
  x: number;
  y: number;
}

/** A run laid out at a size: its glyphs and its width, in points. */
export interface LaidOutRun {
  glyphs: PlacedGlyph[];
  width: number;
}

/** UTF-16BE hex of the text a glyph stands for, for the ToUnicode map. */
const utf16Hex = (codePoints: readonly number[]): string =>
  Array.from(String.fromCodePoint(...codePoints))
    .flatMap((ch) => {
      const units: string[] = [];
      for (let i = 0; i < ch.length; i++) units.push(ch.charCodeAt(i).toString(16).padStart(4, '0'));
      return units;
    })
    .join('');

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

export class EmbeddedFont {
  /** The font's object, written by embed() once everything is drawn. */
  readonly ref: PDFRef;
  private readonly subset: Subset;
  /** The codes given (1, 2 …; 0 is the missing glyph), by glyph and the letters it stands for: each one's glyph in the subset. */
  private readonly codes = new Map<string, { code: number; gid: number; glyph: Glyph; codePoints: number[] }>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly file: FontFile,
  ) {
    this.ref = doc.context.nextRef();
    this.subset = file.font.createSubset();
  }

  /**
   * `text` laid out at `size` in `direction`: right to left, it is given in reading order and comes back as seen (its
   * letters joined, its marks placed); left to right, as it is.
   */
  layout(text: string, size: number, direction: TextDirection): LaidOutRun {
    const { font } = this.file;
    const run = font.layout(text, undefined, undefined, undefined, direction);
    const scale = size / font.unitsPerEm;
    const glyphs: PlacedGlyph[] = [];
    let pen = 0;
    run.glyphs.forEach((glyph, i) => {
      const position = run.positions?.[i] ?? { xAdvance: glyph.advanceWidth, yAdvance: 0, xOffset: 0, yOffset: 0 };
      glyphs.push({ code: this.codeOf(glyph), x: (pen + position.xOffset) * scale, y: position.yOffset * scale });
      pen += position.xAdvance;
    });
    return { glyphs, width: pen * scale };
  }

  /** Writes the font into the document: the subset, its widths and its ToUnicode map. Nothing when nothing was drawn. */
  embed(): void {
    if (!this.codes.size) return;
    const { context } = this.doc;
    const { font } = this.file;
    const scale = 1000 / font.unitsPerEm;
    const used = [...this.codes.values()].sort((a, b) => a.code - b.code);
    // a subset's name starts with six capital letters of its own (ISO 32000-1 §9.6.4), here from the glyphs it holds
    const digest = createHash('sha256').update([...this.codes.keys()].join(';')).digest();
    const tag = Array.from(digest.subarray(0, 6), (b) => String.fromCharCode(65 + (b % 26))).join('');
    const name = `${tag}+${(font.postscriptName ?? 'Font').replace(/[^\x21-\x7e]|[()<>[\]{}/%#]/g, '')}`;

    const bytes = this.subset.encode();
    const fontFile = context.register(context.flateStream(bytes, { Length1: bytes.length }));
    const { minX, minY, maxX, maxY } = font.bbox;
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: name,
        Flags: 4, // symbolic: its glyphs are reached by their codes, not a standard encoding
        FontBBox: [minX * scale, minY * scale, maxX * scale, maxY * scale],
        ItalicAngle: font.italicAngle,
        Ascent: font.ascent * scale,
        Descent: font.descent * scale,
        CapHeight: (font.capHeight || font.ascent) * scale,
        XHeight: (font.xHeight || 0) * scale,
        StemV: 0,
        FontFile2: fontFile,
      }),
    );
    const cidFont = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: name,
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: descriptor,
        CIDToGIDMap: context.register(context.flateStream(this.cidToGid(used))),
        W: [1, used.map((u) => Math.round(u.glyph.advanceWidth * scale))],
      }),
    );
    const toUnicode = context.register(context.flateStream(this.unicodeMap(used)));
    context.assign(
      this.ref,
      context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [cidFont], ToUnicode: toUnicode }),
    );
  }

  /** The code of the glyph drawn for these letters, the glyph added to the subset the first time. */
  private codeOf(glyph: Glyph): string {
    const key = `${glyph.id}:${glyph.codePoints.join(',')}`;
    let entry = this.codes.get(key);
    if (!entry) {
      entry = { code: this.codes.size + 1, gid: this.subset.includeGlyph(glyph), glyph, codePoints: [...glyph.codePoints] };
      this.codes.set(key, entry);
    }
    return hex4(entry.code);
  }

  /** Each code's glyph in the subset, two bytes each (big-endian), from code 0. */
  private cidToGid(used: readonly { code: number; gid: number }[]): Uint8Array {
    const map = new Uint8Array(2 * (used.length + 1));
    for (const u of used) {
      map[2 * u.code] = u.gid >> 8;
      map[2 * u.code + 1] = u.gid & 0xff;
    }
    return map;
  }

  /** Each code's text: a mark (an Arabic letter's dots) stands for none. */
  private unicodeMap(used: readonly { code: number; codePoints: number[] }[]): string {
    const mapped = used.filter((u) => u.codePoints.length > 0);
    const blocks: string[] = [];
    for (let i = 0; i < mapped.length; i += 100) {
      const block = mapped.slice(i, i + 100);
      blocks.push(`${block.length} beginbfchar\n${block.map((u) => `<${hex4(u.code)}> <${utf16Hex(u.codePoints)}>`).join('\n')}\nendbfchar`);
    }
    return [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <ffff>',
      'endcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
  }
}

/** A glyph's code as the content stream shows it. */
export const glyphText = (code: string) => PDFHexString.of(code);
