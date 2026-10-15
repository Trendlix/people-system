// A small PDF writer for the document adjuster (components/adjust): pictures already compressed as JPEG, one a page,
// put in a PDF as they are (DCTDecode: a PDF reader decodes JPEG itself), so nothing is compressed twice and no library
// is needed. What a PDF needs and no more: the catalog, the page tree, each page with its picture and the few words that
// draw it, the table of where each object starts (xref) and the trailer.
//
// A page takes the size of its picture at 300 dots per inch, or exactly A4 when the picture has nearly the shape of
// an A4 sheet (a whole page cut out of a scan), so that it prints on one sheet. Pure: tested in pdf-writer.test.ts.

/** What a JPEG says about itself: its size in pixels and how many colour components it has (1 grey, 3 colour, 4 CMYK). */
export interface JpegInfo {
  width: number;
  height: number;
  components: 1 | 3 | 4;
}

/** The size, in pixels, and the colours of a JPEG, read from its frame header; null when it is not a JPEG. */
export function jpegInfo(b: Uint8Array): JpegInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i++; // a fill byte before a marker
      continue;
    }
    i += 2;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) continue; // markers that stand alone
    if (m === 0xd9 || m === 0xda) return null; // the end, or the picture's data, before any frame header
    if (i + 1 >= b.length) return null;
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2) return null;
    // the frame headers: C0 to CF, but C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 7 >= b.length) return null;
      const height = (b[i + 3] << 8) | b[i + 4];
      const width = (b[i + 5] << 8) | b[i + 6];
      const components = b[i + 7];
      if (!width || !height || (components !== 1 && components !== 3 && components !== 4)) return null;
      return { width, height, components };
    }
    i += len;
  }
  return null;
}

/** An A4 sheet, in points (1/72 inch): 210 × 297 mm. */
export const A4_POINTS: readonly [number, number] = [(210 / 25.4) * 72, (297 / 25.4) * 72];
/** How far a picture's shape may be from an A4 sheet's and still be put on one (3%). */
export const A4_TOLERANCE = 0.03;
/** The dots per inch a page is sized at when it is not A4. */
export const PAGE_DPI = 300;

/**
 * The page a picture of w × h pixels goes on, in points: A4 (portrait or landscape) when its shape is within 3% of an A4
 * sheet's, else its own size at `dpi`. `scale`: points per pixel of the picture on it, fitted inside and centred.
 */
export function pageFor(w: number, h: number, dpi = PAGE_DPI): { width: number; height: number; a4: boolean; scale: number } {
  const [a, b] = A4_POINTS;
  const near = (sheetW: number, sheetH: number) => Math.abs(w / h / (sheetW / sheetH) - 1) <= A4_TOLERANCE;
  const sheet = near(a, b) ? [a, b] : near(b, a) ? [b, a] : null;
  if (sheet) return { width: sheet[0], height: sheet[1], a4: true, scale: Math.min(sheet[0] / w, sheet[1] / h) };
  // never smaller than the 3 points the PDF standard allows, nor larger than its 14 400
  const k = 72 / dpi;
  const width = Math.min(14400, Math.max(3, w * k));
  const height = Math.min(14400, Math.max(3, h * k));
  return { width, height, a4: false, scale: Math.min(width / w, height / h) };
}

/** The dots per inch a picture of w × h pixels prints at on its page (pageFor): 300, or what fits it on an A4 sheet. */
export const printDpi = (w: number, h: number) => Math.round(72 / pageFor(w, h).scale);

/** A number as PDF writes it: at most two decimals, no trailing zeros. */
const num = (v: number) => {
  const s = v.toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

/** Text as bytes, one a character (all that is written here is ASCII, but the binary marks of the header). */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Any text as a PDF string: UTF-16 with its byte order mark, in hexadecimal, so that Arabic names come through. */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

export interface PdfOptions {
  /** The dots per inch of a page that is not A4 (300). */
  dpi?: number;
  /** The document's title, kept in its properties. */
  title?: string;
}

/**
 * A PDF of the JPEG pictures `jpegs`, one a page, in their order. Throws when one is not a JPEG, or there is none.
 */
export function writePdf(jpegs: readonly Uint8Array[], options: PdfOptions = {}): Uint8Array {
  if (!jpegs.length) throw new Error('A PDF needs at least one page.');
  const infos = jpegs.map((j, i) => {
    const info = jpegInfo(j);
    if (!info) throw new Error(`Page ${i + 1} is not a JPEG picture.`);
    return info;
  });

  const parts: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const put = (b: Uint8Array) => {
    parts.push(b);
    length += b.length;
  };
  const text = (s: string) => put(latin1(s));
  /** Object n starts here. */
  const begin = (n: number) => {
    offsets[n] = length;
    text(`${n} 0 obj\n`);
  };

  // the header, then a comment of bytes above 127, which tells programs that the file holds binary data
  text('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

  // objects: 1 the catalog, 2 the page tree, 3 the document's properties, then three for each page (the page, its
  // picture and the words that draw it)
  const pageObj = (k: number) => 4 + 3 * k;
  begin(1);
  text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  text(`<< /Type /Pages /Kids [${infos.map((_, k) => `${pageObj(k)} 0 R`).join(' ')}] /Count ${infos.length} >>\nendobj\n`);
  begin(3);
  text(`<< /Producer (People System)${options.title ? ` /Title ${pdfText(options.title)}` : ''} >>\nendobj\n`);

  const COLOURS = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' } as const;
  infos.forEach((info, k) => {
    const { width: w, height: h, components } = info;
    const page = pageFor(w, h, options.dpi);
    // the picture fitted inside the page and centred (it fills a page sized from it)
    const iw = w * page.scale;
    const ih = h * page.scale;
    const draw = `q\n${num(iw)} 0 0 ${num(ih)} ${num((page.width - iw) / 2)} ${num((page.height - ih) / 2)} cm\n/Im0 Do\nQ\n`;
    const n = pageObj(k);

    begin(n);
    text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources << /XObject << /Im0 ${n + 1} 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> /Contents ${n + 2} 0 R >>\nendobj\n`,
    );
    begin(n + 1);
    // a CMYK JPEG (as Adobe writes them) holds its colours inverted
    const decode = components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    text(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${COLOURS[components]} /BitsPerComponent 8${decode} ` +
        `/Filter /DCTDecode /Length ${jpegs[k].length} >>\nstream\n`,
    );
    put(jpegs[k]);
    text('\nendstream\nendobj\n');
    begin(n + 2);
    text(`<< /Length ${draw.length} >>\nstream\n${draw}endstream\nendobj\n`);
  });

  // where each object starts: entries of exactly 20 bytes, the first for the free object 0
  const xref = length;
  const count = offsets.length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  text(table);
  text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** At most how many bytes a PDF adds to its pictures: the objects and tables around them, and a title of `title` characters. */
export const pdfOverhead = (pages: number, title = 0) => 1024 + 4 * title + 600 * pages;
