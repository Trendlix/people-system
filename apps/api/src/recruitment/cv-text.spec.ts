import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { cvGuesses } from '@trendlix/shared';
import { docx, p, r } from '../../test/fixtures/docx.js';
import { DOCX, PDF } from './cv-file.js';
import { cvText } from './cv-text.js';

// A CV's text for the bulk upload (owner, 22 October 2026: "is there a way to easy apply from linkedin?" … "why not"):
// a PDF's lines as pdf.js reads them, a Word file's paragraphs; a scanned or damaged file gives none. Made-up people.

async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 20, size: 12, font }));
  return Buffer.from(await doc.save());
}

describe('a CV’s text', () => {
  it('reads a PDF’s lines, and the person from them', async () => {
    const text = await cvText(await pdfOf(['Curriculum Vitae', 'Mona Adel Hassan', 'mona.adel@mail.test | +20 100 123 4567']), PDF);
    expect(text.split('\n').map((l) => l.trim())).toEqual(['Curriculum Vitae', 'Mona Adel Hassan', 'mona.adel@mail.test | +20 100 123 4567']);
    expect(cvGuesses(text, 'cv.pdf')).toEqual({ fullName: 'Mona Adel Hassan', email: 'mona.adel@mail.test', mobile: '+201001234567' });
  });

  it('reads a Word file’s paragraphs', async () => {
    const file = docx({ body: p(r('Omar Khaled')) + p(r('omar.khaled@mail.test')) + p(r('Mobile 011 2345 6789')) });
    const text = await cvText(file, DOCX);
    expect(cvGuesses(text, 'cv.docx')).toEqual({ fullName: 'Omar Khaled', email: 'omar.khaled@mail.test', mobile: '+201123456789' });
  });

  it('gives no text for a scanned PDF (no text on its pages) or a damaged file', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await cvText(Buffer.from(await doc.save()), PDF)).toBe('');
    expect(await cvText(Buffer.from('%PDF-1.7 broken'), PDF)).toBe('');
    expect(await cvText(Buffer.from('PK\x03\x04 broken'), DOCX)).toBe('');
  });
});
