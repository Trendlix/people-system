import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import type { PdfField } from '@trendlix/shared';
import { fillerContent, fillerMatrix, formPdf, shownGlyphs, shownLines } from '../../../test/fixtures/pdf-form.js';
import { fillPdfTemplate, printedText } from './fill.js';

// Filling a PDF template in (owner's decision, 15 October 2026): the form as uploaded, with the values printed where the
// fields were placed. What was printed is read back glyph by glyph through the fonts' ToUnicode maps.

const field = (f: Partial<PdfField> & Pick<PdfField, 'id' | 'kind'>): PdfField => ({ tag: null, page: 1, x: 100, y: 100, width: 300, height: 16, fontSize: 12, ...f });

/** The fonts the filled PDF embeds on its first page: their names and whether each has its font file. */
async function embeddedFonts(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  return [...fonts.entries()].map(([, ref]) => {
    const font = doc.context.lookup(ref, PDFDict);
    const cid = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const descriptor = cid.lookup(PDFName.of('FontDescriptor'), PDFDict);
    return { name: font.get(PDFName.of('BaseFont'))!.toString(), encoding: font.get(PDFName.of('Encoding'))!.toString(), hasFile: descriptor.has(PDFName.of('FontFile2')) };
  });
}

describe('fillPdfTemplate', () => {
  it('prints on the original pages: as many, the same size, the form itself untouched', async () => {
    const form = await formPdf();
    const filled = await fillPdfTemplate(form, [field({ id: 'name', kind: 'text', tag: 'full_name_en', align: 'left' })], { full_name_en: 'Omar Khaled' }, 'en');
    const before = await PDFDocument.load(form);
    const after = await PDFDocument.load(filled);
    expect(after.getPageCount()).toBe(2);
    expect(after.getPages().map((p) => p.getSize())).toEqual(before.getPages().map((p) => p.getSize()));
    // unprotected: it is protected on its way out
    expect(after.isEncrypted).toBe(false);
    expect(shownLines(await shownGlyphs(filled))).toEqual(['Omar Khaled']);
  });

  it('embeds the fonts it prints with, subset (only the letters printed), and no other', async () => {
    const filled = await fillPdfTemplate(
      await formPdf(),
      [field({ id: 'ar', kind: 'text', tag: 'full_name_ar' }), field({ id: 'en', kind: 'text', tag: 'personal_email', y: 140, bold: true })],
      { full_name_ar: 'محمد', personal_email: 'omar@example.com' },
      'ar',
    );
    const fonts = await embeddedFonts(filled);
    expect(fonts.map((f) => f.name.replace(/^\/[A-Z]{6}\+/, '')).sort()).toEqual(['NotoNaskhArabic-Regular', 'NotoSans-Bold']);
    expect(fonts.every((f) => /^\/[A-Z]{6}\+/.test(f.name) && f.encoding === '/Identity-H' && f.hasFile)).toBe(true);
    // a few kilobytes of fonts, not the whole files (Noto Sans alone is 420 KB)
    expect(filled.length - (await formPdf()).length).toBeLessThan(40_000);
  });

  it('prints Arabic joined, right to left, with the digits, Latin words and brackets inside it the right way round', async () => {
    const filled = await fillPdfTemplate(
      await formPdf(),
      [field({ id: 'address', kind: 'text', tag: 'address' }), field({ id: 'reason', kind: 'text', tag: 'reason_ar', y: 140, width: 480, x: 60 })],
      { address: '١٢ شارع محمد', reason_ar: 'رقم 15/10/2026 (محمد) CIB' },
      'ar',
    );
    // read as seen, left to right: the reading order is right to left, so the Arabic comes out reversed, the digits not
    const [address, reason] = shownLines(await shownGlyphs(filled));
    expect(address).toBe('دمحم عراش ١٢');
    expect(reason).toBe('CIB (دمحم) 15/10/2026 مقر');
    // joined: the letters of محمد are their joining forms, not the letters on their own
    const glyphs = await shownGlyphs(filled);
    const mim = glyphs.filter((g) => g.text === 'م');
    expect(mim.length).toBeGreaterThan(0);
  });

  it('aligns right (the default), left or centre, and shrinks a long value to fit when asked', async () => {
    const at = async (f: Partial<PdfField>, value = 'Omar') => {
      const glyphs = await shownGlyphs(await fillPdfTemplate(await formPdf(), [field({ id: 'a', kind: 'text', tag: 'full_name_en', ...f })], { full_name_en: value }, 'en'));
      return { first: glyphs[0], last: glyphs[glyphs.length - 1], size: glyphs[0].size };
    };
    const right = await at({});
    const left = await at({ align: 'left' });
    const center = await at({ align: 'center' });
    expect(left.first.x).toBeCloseTo(101, 0); // 1 point inside the field
    expect(right.first.x).toBeGreaterThan(center.first.x);
    expect(center.first.x).toBeGreaterThan(left.first.x);
    expect(right.last.x).toBeLessThan(400);
    const long = 'Omar Khaled Mahmoud Abdelrahman Elsayed Ibrahim';
    expect((await at({ width: 100 }, long)).size).toBe(12); // without shrinking: printed as it is
    const shrunk = await at({ width: 100, shrinkToFit: true }, long);
    expect(shrunk.size).toBeLessThan(12);
    expect(shrunk.first.x).toBeGreaterThanOrEqual(100);
  });

  it('prints one character in each box: a national ID, a date in its order, the pounds and piastres of an amount', async () => {
    const filled = await fillPdfTemplate(
      await formPdf(),
      [
        field({ id: 'id', kind: 'boxes', tag: 'national_id', width: 280, height: 20, boxes: 14 }),
        field({ id: 'date', kind: 'boxes', tag: 'join_date', y: 140, width: 160, boxes: 8, groups: [4, 2, 2], groupGap: 12, dateOrder: 'YMD' }),
        field({ id: 'pounds', kind: 'boxes', tag: 'insured_salary', y: 180, width: 100, boxes: 5, boxAlign: 'right', amountPart: 'pounds' }),
        field({ id: 'piastres', kind: 'boxes', tag: 'insured_salary', x: 400, y: 180, width: 40, boxes: 2, amountPart: 'piasters' }),
      ],
      { national_id: '29001011234567', join_date: '05/01/2026', insured_salary: '9,400.50' },
      'ar',
    );
    const glyphs = await shownGlyphs(filled);
    const id = glyphs.filter((g) => Math.abs(g.x - 100) < 290 && g.y > 880);
    expect(id.map((g) => g.text).join('')).toBe('29001011234567');
    // each digit centred in its 20-point box
    id.forEach((g, i) => expect(g.x).toBeGreaterThan(100 + 20 * i));
    id.forEach((g, i) => expect(g.x).toBeLessThan(100 + 20 * (i + 1)));
    expect(shownLines(glyphs).slice(1)).toEqual(['20260105', '940050']);
  });

  it('ticks a check box always, or when its tag prints the value; a mark of its own is printed as text', async () => {
    const fields = [
      field({ id: 'always', kind: 'check', width: 16 }),
      field({ id: 'type', kind: 'check', tag: 'employment_type_ar', equals: 'دوام كامل', x: 200, width: 16 }),
      field({ id: 'not', kind: 'check', tag: 'employment_type_ar', equals: 'دوام جزئي', x: 300, width: 16 }),
      field({ id: 'x', kind: 'check', text: 'X', x: 400, width: 16 }),
    ];
    const filled = await fillPdfTemplate(await formPdf(), fields, { employment_type_ar: 'دوام كامل' }, 'ar');
    expect(shownLines(await shownGlyphs(filled))).toEqual(['X']);
    // the ticks are strokes: two lines for each ticked box (the unconditional one and the matching one), none for the other
    expect((await fillerContent(filled)).match(/ l\n/g)?.length).toBe(4);
  });

  it('prints a fixed text, a value with formatting on one line, and nothing for a tag without a value', async () => {
    const fields = [
      field({ id: 'office', kind: 'fixed', text: 'مكتب الدقي' }),
      field({ id: 'duties', kind: 'text', tag: 'job_duties', y: 140, width: 480, x: 60 }),
      field({ id: 'none', kind: 'text', tag: 'reason_ar', y: 180 }),
    ];
    const filled = await fillPdfTemplate(await formPdf(), fields, { job_duties: { html: '<p>Sales</p><ul><li>Reports</li></ul>' } }, 'en');
    expect(shownLines(await shownGlyphs(filled))).toEqual(['يقدلا بتكم', 'Sales, Reports']);
  });

  it('prints where the field was placed on the page as shown, whatever its rotation and crop', async () => {
    // placed 100 points from the left and 50 from the top of the page as shown, its first letter's baseline 50 + 10
    // (half the field's height) + a little below its top
    const place = [field({ id: 'a', kind: 'text', tag: 'full_name_en', x: 100, y: 50, width: 200, height: 20, align: 'left' })];
    /** Where the first letter lands in the page's own space. */
    const at = async (page: Parameters<typeof formPdf>[0]) => {
      const filled = await fillPdfTemplate(await formPdf(page), place, { full_name_en: 'O' }, 'en');
      const [a, b, c, d, e, f] = await fillerMatrix(filled);
      const { x, y } = (await shownGlyphs(filled))[0];
      return { x: a * x + c * y + e, y: b * x + d * y + f };
    };
    const plain = await at([{ width: 600, height: 800 }]);
    expect(plain.x).toBeCloseTo(101, 3);
    expect(800 - plain.y).toBeGreaterThan(60);
    expect(800 - plain.y).toBeLessThan(70);
    const drop = 800 - plain.y - 60;
    // cropped: from the crop's top-left corner
    const cropped = await at([{ width: 600, height: 800, cropBox: [50, 100, 400, 600] }]);
    expect(cropped.x).toBeCloseTo(50 + 101, 3);
    expect(cropped.y).toBeCloseTo(100 + 600 - 60 - drop, 3);
    // turned a quarter clockwise: the page's left edge is shown at the top, its bottom edge on the left
    const turned = await at([{ width: 600, height: 800, rotate: 90 }]);
    expect(turned.x).toBeCloseTo(60 + drop, 3);
    expect(turned.y).toBeCloseTo(101, 3);
    // upside down
    const upsideDown = await at([{ width: 600, height: 800, rotate: 180 }]);
    expect(upsideDown.x).toBeCloseTo(600 - 101, 3);
    expect(upsideDown.y).toBeCloseTo(60 + drop, 3);
  });

  it('says how a value prints on one line', () => {
    expect(printedText('  Omar\n Khaled ', 'en')).toBe('Omar Khaled');
    expect(printedText({ html: '<p>أ</p><p>ب</p>' }, 'ar')).toBe('أ، ب');
    expect(printedText(undefined, 'ar')).toBe('');
  });
});
