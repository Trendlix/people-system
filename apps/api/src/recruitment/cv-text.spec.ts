import { PDFDocument, PDFString, StandardFonts, type PDFPage } from '@cantoo/pdf-lib';
import { CV_LINKS_HEADING, cvFacts, cvGuesses, cvPrefillOf, withFileLinks } from '@trendlix/shared';
import { docx, p, r } from '../../test/fixtures/docx.js';
import { DOCX, PDF } from './cv-file.js';
import { cvText, cvTextParts } from './cv-text.js';

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

  // owner, 29 October 2026: "the OCR is not filling the linkedin link like in the candidate profile"
  describe('the links behind its words', () => {
    const LINKEDIN = 'https://www.linkedin.com/in/mona-adel-hassan';
    /** A link behind a PDF's words ("LinkedIn", an icon), its address nowhere in the text. */
    const linkOn = (doc: PDFDocument, page: PDFPage, uri: string, y: number) =>
      page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, y, 140, y + 14], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) } })));

    it('keeps a PDF’s after its text, under their heading: the LinkedIn link found for the CV and the careers form', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      ['Mona Adel Hassan', 'Video Editor', 'LinkedIn | Email me | Portfolio'].forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 20, size: 12, font }));
      linkOn(doc, page, LINKEDIN, 718);
      linkOn(doc, page, 'mailto:mona.work@mail.test?subject=Hello', 700);
      linkOn(doc, page, 'https://www.behance.net/monaadel', 682);
      const file = Buffer.from(await doc.save());
      expect((await cvTextParts(file, PDF)).links).toEqual([LINKEDIN, 'mailto:mona.work@mail.test?subject=Hello', 'https://www.behance.net/monaadel']);
      const text = await cvText(file, PDF);
      expect(text.split('\n').slice(-4)).toEqual([CV_LINKS_HEADING, LINKEDIN, 'mona.work@mail.test', 'https://www.behance.net/monaadel']);
      const facts = cvFacts(text);
      expect(facts.linkedin).toMatch(/linkedin\.com\/in\/mona-adel-hassan$/);
      expect(facts.emails).toContain('mona.work@mail.test');
      // the careers form's fill-in from the CV reads it too
      expect(cvPrefillOf(text).linkedin).toMatch(/linkedin\.com\/in\/mona-adel-hassan/);
      // what the rules read of the CV itself unchanged: the name and the role
      expect(cvGuesses(text, 'cv.pdf').fullName).toBe('Mona Adel Hassan');
    });

    it('a scan with links is still a scan: no text (the OCR service reads it), its links apart', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage();
      linkOn(doc, page, LINKEDIN, 700);
      const file = Buffer.from(await doc.save());
      expect(await cvText(file, PDF)).toBe('');
      expect(await cvTextParts(file, PDF)).toEqual({ text: '', links: [LINKEDIN] });
    });

    it('keeps a Word file’s hyperlinks, not its other relationships', async () => {
      const rels =
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://linkedin.com/in/omar-khaled?trk=a&amp;b=c" TargetMode="External"/>' +
        '</Relationships>';
      const file = docx({ body: p(r('Omar Khaled')) + p(r('omar.khaled@mail.test')) + p(r('LinkedIn')), parts: { 'word/_rels/document.xml.rels': rels } });
      const text = await cvText(file, DOCX);
      expect(text.split('\n').slice(-2)).toEqual([CV_LINKS_HEADING, 'https://linkedin.com/in/omar-khaled?trk=a&b=c']);
      expect(cvFacts(text).linkedin).toMatch(/linkedin\.com\/in\/omar-khaled/);
    });

    it('leaves out a link the text names already, others than web and mail, and keeps at most 10 within the length', () => {
      expect(withFileLinks('See linkedin.com/in/mona-adel', ['https://www.linkedin.com/in/mona-adel/'])).toBe('See linkedin.com/in/mona-adel');
      expect(withFileLinks('CV', ['javascript:alert(1)', 'file:///etc/passwd', 'tel:+20100'])).toBe('CV');
      const many = Array.from({ length: 12 }, (_, i) => `https://site${i}.test`);
      expect(withFileLinks('CV', many).split('\n').slice(3)).toHaveLength(10);
      const capped = withFileLinks('x'.repeat(100), [LINKEDIN], 80);
      expect(capped.length).toBeLessThanOrEqual(80);
      expect(capped.endsWith(LINKEDIN)).toBe(true);
    });
  });
});
