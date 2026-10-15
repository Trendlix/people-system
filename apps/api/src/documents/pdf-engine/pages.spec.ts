import { PDFDocument } from '@cantoo/pdf-lib';
import { formPdf } from '../../../test/fixtures/pdf-form.js';
import { protectPdf } from '../../pdf/pdf.service.js';
import { PDF_PROTECTED, PdfTemplateError, readPdfTemplate, shownPage } from './pages.js';

// A PDF template's pages as the editor shows them (pdf.js: the CropBox within the MediaBox, turned by /Rotate), and the
// PDFs the library refuses (owner's decision, 15 October 2026).

const refusal = async (data: Uint8Array) => {
  const err = await readPdfTemplate(data).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PdfTemplateError);
  return (err as Error).message;
};

describe('readPdfTemplate', () => {
  it('answers each page as shown, in points to two decimals', async () => {
    const pages = await readPdfTemplate(
      await formPdf([
        { width: 612.12, height: 1008.12 },
        { width: 595, height: 842, rotate: 90 },
        { width: 600, height: 800, cropBox: [50, 100, 400, 500] },
        { width: 600, height: 800, cropBox: [50, 100, 400, 500], rotate: 270 },
        { width: 600, height: 800, rotate: 45 }, // not a quarter turn: none, as pdf.js takes it
      ]),
    );
    expect(pages).toEqual([
      { width: 612.12, height: 1008.12 },
      { width: 842, height: 595 },
      { width: 400, height: 500 },
      { width: 500, height: 400 },
      { width: 600, height: 800 },
    ]);
  });

  it('refuses a protected PDF, even one that opens without a password', async () => {
    expect(await refusal(await protectPdf(await formPdf()))).toBe(PDF_PROTECTED);
    expect(PDF_PROTECTED).toBe('This PDF is protected. Save an unprotected copy of it and upload that.');
  });

  it('refuses more than 20 pages, a damaged file and one with no pages', async () => {
    expect(await refusal(await formPdf(Array.from({ length: 21 }, () => ({ width: 612, height: 1008 }))))).toBe(
      "This PDF has 21 pages; a form can have at most 20. Upload only the form's pages.",
    );
    expect((await readPdfTemplate(await formPdf(Array.from({ length: 20 }, () => ({ width: 612, height: 1008 }))))).length).toBe(20);
    expect(await refusal(Buffer.from('%PDF-1.7\nnot really a PDF'))).toMatch(/^This PDF (is damaged and can't be read|has no pages)\. Save it again as a PDF and upload that\.$/);
    const empty = await PDFDocument.create();
    expect(await refusal(await empty.save({ addDefaultPage: false }))).toBe('This PDF has no pages. Save it again as a PDF and upload that.');
  });

  it('refuses a page with no size', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 1008]);
    doc.addPage([0, 0]);
    expect(await refusal(await doc.save())).toBe('Page 2 of this PDF has no size. Save it again as a PDF and upload that.');
  });
});

describe('shownPage', () => {
  it('gives the transformation from the page as shown to its own space, for each quarter turn', async () => {
    const doc = await PDFDocument.load(
      await formPdf([
        { width: 600, height: 800, cropBox: [50, 100, 400, 500] },
        { width: 600, height: 800, cropBox: [50, 100, 400, 500], rotate: 90 },
        { width: 600, height: 800, cropBox: [50, 100, 400, 500], rotate: 180 },
        { width: 600, height: 800, cropBox: [50, 100, 400, 500], rotate: -90 },
      ]),
    );
    const shown = doc.getPages().map(shownPage);
    // the crop's corners: left 50, bottom 100, right 450, top 600
    expect(shown.map((s) => s.matrix)).toEqual([
      [1, 0, 0, 1, 50, 100],
      [0, 1, -1, 0, 450, 100],
      [-1, 0, 0, -1, 450, 600],
      [0, -1, 1, 0, 50, 600],
    ]);
    // the top-left corner as shown: the crop's top-left; turned a quarter clockwise, its bottom-left; upside down, its
    // bottom-right; a quarter anticlockwise, its top-right
    const corner = (i: number) => {
      const [a, b, c, d, e, f] = shown[i].matrix;
      const [x, y] = [0, shown[i].height];
      return [a * x + c * y + e, b * x + d * y + f];
    };
    expect(corner(0)).toEqual([50, 600]);
    expect(corner(1)).toEqual([50, 100]);
    expect(corner(2)).toEqual([450, 100]);
    expect(corner(3)).toEqual([450, 600]);
  });
});
