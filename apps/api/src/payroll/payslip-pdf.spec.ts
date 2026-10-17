import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { shownGlyphs, shownLines, type ShownGlyph } from '../../test/fixtures/pdf-form.js';
import { payslipSource, pngImage } from '../../test/fixtures/payslip.js';
import { protectPdf } from '../pdf/pdf.service.js';
import { payslipContent, type PayslipContent } from './payslip-content.js';
import { payslipPdf, type PayslipLogo } from './payslip-pdf.js';

// A payslip drawn (owner's decisions, 16 October 2026): one A4 page, its text printed through the PDF templates'
// engine and read back glyph by glyph through the fonts' ToUnicode maps; the Arabic one mirrored, right to left.

const A4 = { width: 595.28, height: 841.89 };
const META = { title: 'Payslip October 2026 · EMP-0142', author: 'TrendLIX' };

const draw = (content: PayslipContent, logo: PayslipLogo | null = null) => payslipPdf(content, logo, META);

/** The glyphs of a line as read back that contains `text`. */
function glyphsOf(glyphs: readonly ShownGlyph[], text: string): ShownGlyph[] {
  const lines = new Map<number, ShownGlyph[]>();
  for (const g of glyphs.filter((x) => x.text)) {
    const key = [...lines.keys()].find((y) => Math.abs(y - g.y) < 0.5) ?? g.y;
    lines.set(key, [...(lines.get(key) ?? []), g]);
  }
  for (const line of lines.values()) {
    const sorted = [...line].sort((a, b) => a.x - b.x);
    const seen = sorted.map((g) => g.text).join('');
    const at = seen.indexOf(text);
    if (at >= 0) {
      // a glyph can stand for more than one letter: count letters to find where the text starts and ends
      let letters = 0;
      const out: ShownGlyph[] = [];
      for (const g of sorted) {
        if (letters >= at && letters < at + text.length) out.push(g);
        letters += g.text.length;
      }
      return out;
    }
  }
  return [];
}

/** The page's fonts, by their names without the subset tag. */
async function fontNames(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  return [...fonts.entries()].map(([, ref]) => doc.context.lookup(ref, PDFDict).get(PDFName.of('BaseFont'))!.toString().replace(/^\/[A-Z]{6}\+/, '')).sort();
}

/** Whether the page draws an image. */
async function hasImage(pdf: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(pdf);
  const xObjects = doc.getPage(0).node.Resources()!.lookupMaybe(PDFName.of('XObject'), PDFDict);
  return !!xObjects && [...xObjects.entries()].some(([, ref]) => doc.context.lookup(ref)?.toString().includes('/Subtype /Image'));
}

describe('payslipPdf: in English', () => {
  let pdf: Buffer;
  let glyphs: ShownGlyph[];
  let lines: string[];

  beforeAll(async () => {
    pdf = await draw(payslipContent(payslipSource('monthly'), 'en'));
    glyphs = await shownGlyphs(pdf);
    lines = shownLines(glyphs);
  });

  it('is one A4 page, unprotected (it is protected on its way to being kept), titled', async () => {
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual(A4);
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getTitle()).toBe(META.title);
    expect(doc.getAuthor()).toBe('TrendLIX');
  });

  it('prints every part of the payslip, top to bottom', () => {
    // the header's two sides first, each line on its own baseline
    for (const text of ['TrendLIX', 'Payslip', 'October 2026', 'Cairo · Tax registration no. 512-384-907', 'Paid on 29/10/2026']) expect(lines).toContain(text);
    const expected = [
      'Mariam Adel Hassan',
      'CIB · account ending 4821',
      'This Month',
      '165:30 of 176:00',
      'Soft skills 70% · Performance 65% · Client satisfaction 72% · Attendance 100%',
      'Earnings',
      'Fixed salary',
      '80% of the 24,000.00 gross',
      'Total earnings',
      'Deductions',
      'Martyrs’ Fund',
      'Total deductions',
      'Net pay',
      'Twenty thousand three hundred twenty-eight Egyptian pounds and eighty-two piasters only',
      'Transferred to CIB ···4821',
      'On top of your pay, the company pays 3,131.25 social insurance for you: 18.75% of the insured wage.',
      'Year to Date · January to October 2026',
      'Approved by the CEO on 27/10/2026 · Issued on 29/10/2026 · PAY-2026-10 · EMP-0142',
      'Issued by the system; it needs no signature. Confidential to the employee.',
    ];
    let from = 0;
    for (const text of expected) {
      const at = lines.findIndex((l, i) => i >= from && l.includes(text));
      expect(at, text).toBeGreaterThanOrEqual(from);
      from = at;
    }
  });

  it('puts each amount on its row’s line, at the end (the right)', () => {
    expect(lines).toContain('Total earnings25,524.00');
    expect(lines).toContain('Total deductions5,195.18');
    expect(lines.some((l) => l.startsWith('Performance adjustment') && l.endsWith('−1,116.00'))).toBe(true);
    const amount = glyphsOf(glyphs, '19,200.00');
    const label = glyphsOf(glyphs, 'Fixed salary');
    expect(amount.at(-1)!.x).toBeGreaterThan(A4.width - 60);
    expect(label[0].x).toBeLessThan(60);
  });

  it('keeps everything inside the page’s margins', () => {
    for (const g of glyphs.filter((x) => x.text)) {
      expect(g.x).toBeGreaterThanOrEqual(40);
      expect(g.x).toBeLessThan(A4.width - 40);
      expect(g.y).toBeGreaterThan(30);
      expect(g.y).toBeLessThan(A4.height - 30);
    }
  });

  it('embeds only the Latin fonts it prints with, subset', async () => {
    expect(await fontNames(pdf)).toEqual(['NotoSans-Bold', 'NotoSans-Regular']);
    expect(pdf.length).toBeLessThan(60_000);
  });
});

describe('payslipPdf: in Arabic', () => {
  let glyphs: ShownGlyph[];
  let lines: string[];
  let pdf: Buffer;

  beforeAll(async () => {
    pdf = await draw(payslipContent(payslipSource('monthly'), 'ar'));
    glyphs = await shownGlyphs(pdf);
    lines = shownLines(glyphs);
  });

  it('is one A4 page in Arabic, with the Arabic font and the Latin one for the codes', async () => {
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual(A4);
    expect(await fontNames(pdf)).toEqual(['NotoNaskhArabic-Bold', 'NotoNaskhArabic-Regular', 'NotoSans-Bold', 'NotoSans-Regular']);
  });

  it('prints right to left: read back as seen, the Arabic is reversed and the numbers in their own order', () => {
    // as seen, left to right (the name shares its baseline with the employee code, in the other column)
    expect(lines.some((l) => l.endsWith('نسح لداع ميرم'))).toBe(true);
    expect(lines.some((l) => l.startsWith('٥١٢-٣٨٤-٩٠٧ '))).toBe(true);
    expect(lines.some((l) => l.includes('١٧٦:٠٠ نم ١٦٥:٣٠'))).toBe(true);
    expect(lines.some((l) => l.startsWith('PAY-2026-10 · EMP-0142 · ٢٩/١٠/٢٠٢٦'))).toBe(true);
    expect(lines.some((l) => l.includes('CIB ···٤٨٢١'))).toBe(true);
    expect(lines.some((l) => l.startsWith('−١٬١١٦٫٠٠'))).toBe(true);
    // no Latin digit but in the codes
    expect(lines.map((l) => l.replace(/PAY-\d{4}-\d{2}|EMP-\d{4}/g, '')).filter((l) => /[0-9]/.test(l))).toEqual([]);
  });

  it('is the English page mirrored: the labels on the right, the amounts on the left', () => {
    const middle = A4.width / 2;
    const name = glyphsOf(glyphs, 'نسح لداع ميرم');
    const amount = glyphsOf(glyphs, '١٩٬٢٠٠٫٠٠');
    expect(name.length).toBeGreaterThan(0);
    expect(Math.min(...name.map((g) => g.x))).toBeGreaterThan(middle);
    expect(Math.max(...name.map((g) => g.x))).toBeGreaterThan(A4.width - 60);
    expect(Math.max(...amount.map((g) => g.x))).toBeLessThan(middle);
    expect(Math.min(...amount.map((g) => g.x))).toBeLessThan(60);
    // the company's name opposite the title, as in English but mirrored
    expect(glyphsOf(glyphs, 'TrendLIX')[0].x).toBeGreaterThan(middle);
  });

  it('joins the Arabic letters: their joining forms, the dots placed as marks', () => {
    // a mark (an Arabic letter's dots) reads back as nothing
    expect(glyphs.some((g) => g.font.includes('NotoNaskhArabic') && g.text === '')).toBe(true);
  });
});

describe('payslipPdf: the company’s logo', () => {
  const logo = pngImage(200, 50, (x) => (x < 50 ? [29, 78, 110] : [255, 255, 255]));

  it('prints a PNG logo in place of the name', async () => {
    const pdf = await draw(payslipContent(payslipSource('monthly'), 'en'), { data: logo, type: 'image/png' });
    expect(await hasImage(pdf)).toBe(true);
    expect(shownLines(await shownGlyphs(pdf))).not.toContain('TrendLIX');
  });

  it('prints the name when the logo is a type the PDF can’t take, or broken', async () => {
    for (const bad of [
      { data: Buffer.from('RIFF0000WEBPVP8 '), type: 'image/webp' },
      { data: Buffer.from('not a png'), type: 'image/png' },
    ]) {
      const pdf = await draw(payslipContent(payslipSource('monthly'), 'en'), bad);
      expect(await hasImage(pdf)).toBe(false);
      expect(shownLines(await shownGlyphs(pdf))).toContain('TrendLIX');
    }
  });
});

describe('payslipPdf: fitting on one page', () => {
  it('a long payslip (many allowances, every cut, a part month) is drawn closer and smaller, still on one page', async () => {
    const allowances = Array.from({ length: 14 }, (_, i) => ({ name: `Allowance ${i + 1}`, amount: 100 + i, taxable: i % 2 === 0, insured: false }));
    const source = payslipSource('monthly', {
      terms: {
        paidDays: 19,
        allowances,
        // the month's additions and deductions (17 October 2026: the grid's moved there)
        adjustments: [
          { id: 'p1', kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days: 1, reason: 'Invented' },
          { id: 'c1', kind: 'addition', type: 'commission', taxed: true, amount: 1250, reason: 'Invented sales' },
          { id: 'c2', kind: 'deduction', type: 'correction', taxed: false, amount: 300, reason: 'Invented correction' },
        ],
      },
      inputs: { workedHours: 120, noShowDays: 1 },
    });
    for (const language of ['en', 'ar'] as const) {
      const pdf = await draw(payslipContent(source, language));
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
      const glyphs = (await shownGlyphs(pdf)).filter((g) => g.text);
      expect(Math.min(...glyphs.map((g) => g.y))).toBeGreaterThan(20);
      expect(Math.max(...glyphs.map((g) => g.y))).toBeLessThan(A4.height - 20);
      const lines = shownLines(glyphs);
      expect(lines.some((l) => l.includes('Allowance 14'))).toBe(true);
      // the footer, last
      expect(lines.at(-2)).toMatch(language === 'en' ? /PAY-2026-10 · EMP-0142$/ : /^PAY-2026-10 · EMP-0142/);
    }
  });

  it('a short one is drawn at full size: 9-point rows, 7-point labels', async () => {
    const glyphs = await shownGlyphs(await draw(payslipContent(payslipSource('hourly'), 'en')));
    expect(glyphsOf(glyphs, 'Correction')[0].size).toBe(9);
    expect(glyphsOf(glyphs, 'Days paid')[0].size).toBe(7);
  });
});

describe('payslipPdf: protected as it is kept', () => {
  it('protectPdf encrypts it, one page still', async () => {
    const protectedPdf = await protectPdf(await draw(payslipContent(payslipSource('hourly'), 'ar')));
    const doc = await PDFDocument.load(protectedPdf, { ignoreEncryption: true });
    expect(doc.isEncrypted).toBe(true);
    expect(doc.getPageCount()).toBe(1);
  });
});
