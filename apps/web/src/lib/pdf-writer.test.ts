// The PDF writer of the document adjuster: a PDF a reader can open (header, objects where the table says, trailer), one
// page a picture, each picture kept as it is, and the size of each page.
import { describe, expect, it } from 'vitest';
import { A4_POINTS, jpegInfo, pageFor, pdfOverhead, printDpi, writePdf } from './pdf-writer';

/**
 * A stand-in for a JPEG of w × h pixels: the markers a reader looks at (start, JFIF header, a table, the frame header,
 * the start of the data and the end), with `fill` bytes of "data" between. Enough for the writer, which never decodes.
 */
function fakeJpeg(w: number, h: number, components = 3, fill = 64): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 8 + 3 * components, 8, h >> 8, h & 255, w >> 8, w & 255, components];
  for (let c = 0; c < components; c++) sof.push(c + 1, 0x11, 0);
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  const data = Array.from({ length: fill }, (_, i) => (i * 37 + w) & 0x7f);
  return Uint8Array.from([0xff, 0xd8, ...app0, ...dqt, ...sof, ...sos, ...data, 0xff, 0xd9]);
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

/** The PDF read back: checked as a reader would find its way in, from the end. */
function readPdf(b: Uint8Array) {
  const s = latin1(b);
  expect(s.startsWith('%PDF-1.4\n%')).toBe(true);
  expect(b[10]).toBeGreaterThan(127); // the binary comment
  expect(s.endsWith('%%EOF\n')).toBe(true);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)?.[1]);
  expect(s.slice(startxref, startxref + 5)).toBe('xref\n');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(startxref))!;
  const count = Number(head[1]);
  const table = s.slice(startxref + head[0].length, startxref + head[0].length + 20 * count);
  const rows = table.match(/[\s\S]{20}/g)!;
  expect(rows).toHaveLength(count);
  expect(rows[0]).toBe('0000000000 65535 f \n');
  // every object starts where the table says
  const objects = new Map<number, string>();
  for (let n = 1; n < count; n++) {
    expect(rows[n]).toMatch(/^\d{10} 00000 n \n$/);
    const at = Number(rows[n].slice(0, 10));
    expect(s.slice(at, at + `${n} 0 obj\n`.length)).toBe(`${n} 0 obj\n`);
    objects.set(n, s.slice(at, s.indexOf('endobj', at)));
  }
  const trailer = s.slice(s.indexOf('trailer', startxref));
  expect(trailer).toContain(`/Size ${count}`);
  const root = Number(/\/Root (\d+) 0 R/.exec(trailer)![1]);
  expect(objects.get(root)).toMatch(/\/Type \/Catalog/);
  const pagesRef = Number(/\/Pages (\d+) 0 R/.exec(objects.get(root)!)![1]);
  const tree = objects.get(pagesRef)!;
  const kids = [...tree.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const pageCount = Number(/\/Count (\d+)/.exec(tree)![1]);
  return { s, objects, kids, pageCount, count };
}

describe('a PDF of JPEG pictures', () => {
  it('reads the size and colours of a JPEG, and nothing from what is not one', () => {
    expect(jpegInfo(fakeJpeg(2480, 3508))).toEqual({ width: 2480, height: 3508, components: 3 });
    expect(jpegInfo(fakeJpeg(640, 480, 1))).toEqual({ width: 640, height: 480, components: 1 });
    // fill bytes before a marker are allowed
    const j = fakeJpeg(300, 200);
    const filled = Uint8Array.from([...j.slice(0, 2), 0xff, 0xff, ...j.slice(2)]);
    expect(jpegInfo(filled)).toEqual({ width: 300, height: 200, components: 3 });
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // a PNG
    expect(jpegInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toBeNull(); // no frame header
    expect(jpegInfo(new Uint8Array())).toBeNull();
  });

  it('a valid file: header, every object where the table says, the trailer pointing at the catalog, and three pages', () => {
    const pics = [fakeJpeg(2480, 3508), fakeJpeg(1200, 800, 3, 200), fakeJpeg(900, 900, 1, 10)];
    const pdf = writePdf(pics, { title: 'شهادة الميلاد birth certificate' });
    const { objects, kids, pageCount, s } = readPdf(pdf);
    expect(pageCount).toBe(3);
    expect(kids).toHaveLength(3);
    expect(s.match(/\/Type \/Page(?![s])/g)).toHaveLength(3);
    kids.forEach((kid, k) => {
      const page = objects.get(kid)!;
      expect(page).toMatch(/\/Type \/Page\b/);
      expect(page).toMatch(/\/Parent \d+ 0 R/);
      const image = objects.get(Number(/\/Im0 (\d+) 0 R/.exec(page)![1]))!;
      expect(image).toMatch(/\/Subtype \/Image/);
      expect(image).toMatch(/\/Filter \/DCTDecode/);
      expect(image).toContain(`/Length ${pics[k].length}`);
      const info = jpegInfo(pics[k])!;
      expect(image).toContain(`/Width ${info.width} /Height ${info.height}`);
      expect(image).toContain(info.components === 1 ? '/DeviceGray' : '/DeviceRGB');
      // the picture as it was, byte for byte, right after "stream"
      const at = s.indexOf(image) + image.indexOf('stream\n') + 'stream\n'.length;
      expect(latin1(pdf.slice(at, at + pics[k].length))).toBe(latin1(pics[k]));
      expect(s.slice(at + pics[k].length, at + pics[k].length + 10)).toBe('\nendstream');
      // the words that draw it, with their own length
      const content = objects.get(Number(/\/Contents (\d+) 0 R/.exec(page)![1]))!;
      const words = /stream\n([\s\S]*)endstream/.exec(content)![1];
      expect(content).toContain(`/Length ${words.length}`);
      expect(words).toMatch(/\/Im0 Do/);
    });
    // the title in UTF-16, Arabic and all
    expect(objects.get(3)).toMatch(/\/Title <FEFF0634/);
  });

  it('one picture gives one page', () => {
    const { pageCount, kids } = readPdf(writePdf([fakeJpeg(1000, 700)]));
    expect(pageCount).toBe(1);
    expect(kids).toHaveLength(1);
  });

  it('a page is its picture at 300 dpi, or A4 when the picture has nearly the shape of one', () => {
    // 1200 × 800 pixels at 300 dpi: 4 × 2.667 inches
    expect(pageFor(1200, 800)).toMatchObject({ width: 288, height: 192, a4: false });
    // the shape of A4, portrait or landscape (within 3%), whatever the number of pixels
    const [aw, ah] = A4_POINTS;
    expect(pageFor(2480, 3508)).toMatchObject({ width: aw, height: ah, a4: true });
    expect(pageFor(1700, 2338)).toMatchObject({ width: aw, height: ah, a4: true }); // 2.8% off
    expect(pageFor(3508, 2480)).toMatchObject({ width: ah, height: aw, a4: true });
    expect(pageFor(1700, 2200).a4).toBe(false); // US Letter: 8.5% off
    // the picture fitted inside A4, centred
    const p = pageFor(1700, 2338);
    expect(p.scale).toBeCloseTo(Math.min(aw / 1700, ah / 2338), 9);
    expect(printDpi(2480, 3508)).toBe(300);
    expect(printDpi(1240, 1754)).toBe(150);
    expect(printDpi(1200, 800)).toBe(300);

    const { objects, kids } = readPdf(writePdf([fakeJpeg(1200, 800), fakeJpeg(2480, 3508)]));
    expect(objects.get(kids[0])).toContain('/MediaBox [0 0 288 192]');
    expect(objects.get(kids[1])).toContain('/MediaBox [0 0 595.28 841.89]');
  });

  it('refuses no pages, or a page that is not a JPEG', () => {
    expect(() => writePdf([])).toThrow();
    expect(() => writePdf([fakeJpeg(10, 10), new Uint8Array([1, 2, 3])])).toThrow(/Page 2/);
  });

  it('adds little to the pictures, as pdfOverhead says', () => {
    const pics = Array.from({ length: 12 }, (_, i) => fakeJpeg(1000 + i, 1400, 3, 500));
    const title = 'A long title for the document, to be sure';
    const pdf = writePdf(pics, { title });
    const pictures = pics.reduce((n, p) => n + p.length, 0);
    expect(pdf.length - pictures).toBeLessThanOrEqual(pdfOverhead(pics.length, title.length));
  });

  it('puts a page on the sheet chosen for it: A5 has the shape of A4, so only the choice tells them apart', () => {
    const a5 = pageFor(1748, 2480, 300, 'a5');
    expect(a5.width).toBeCloseTo((148 / 25.4) * 72, 1);
    expect(a5.height).toBeCloseTo((210 / 25.4) * 72, 1);
    const turned = pageFor(2480, 1748, 300, 'a5');
    expect(turned.width).toBeCloseTo((210 / 25.4) * 72, 1);
    expect(pageFor(1748, 2480).a4).toBe(true); // no choice: A4, as before
  });
});
