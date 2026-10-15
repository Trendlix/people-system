import type { PdfField } from '@trendlix/shared';
import { formPdf, shownGlyphs, shownLines } from '../../test/fixtures/pdf-form.js';
import { docx, p, r } from '../../test/fixtures/docx.js';
import { isPdf } from '../pdf/pdf-file.js';
import { readZip } from '../templates/zip.js';
import { filledFileName, fillVersion } from './fill-version.js';

// Every fill goes through one helper, which picks the engine by the version's format (owner's decision, 15 October 2026).

describe('fillVersion', () => {
  it('fills a Word template’s {{tags}} in, as a .docx', async () => {
    const filled = await fillVersion({ format: 'docx', data: docx({ body: p(r('Dear {{full_name_en}}')) }), language: 'en' }, { full_name_en: 'Omar' });
    expect(isPdf(filled)).toBe(false);
    expect(readZip(filled).read('word/document.xml')!.toString('utf8')).toContain('Dear Omar');
  });

  it('prints a PDF form’s values where its fields were placed, as a PDF', async () => {
    const fields: PdfField[] = [{ id: 'a', kind: 'text', tag: 'full_name_en', page: 1, x: 100, y: 100, width: 200, height: 16, fontSize: 12, align: 'left' }];
    const filled = await fillVersion({ format: 'pdf', data: await formPdf(), pdfFields: fields as never, language: 'en' }, { full_name_en: 'Omar' });
    expect(isPdf(filled)).toBe(true);
    expect(shownLines(await shownGlyphs(filled))).toEqual(['Omar']);
    // a PDF without fields yet: the form as it is
    expect(isPdf(await fillVersion({ format: 'pdf', data: await formPdf(), pdfFields: null, language: 'ar' }, {}))).toBe(true);
  });

  it('names the filled file after what it is', () => {
    expect(filledFileName('Form 1 - E-0001 - Omar A. Ali', 'pdf')).toBe('Form 1 - E-0001 - Omar A. Ali.pdf');
    expect(filledFileName('Contract - E-0001 - Omar', 'docx')).toBe('Contract - E-0001 - Omar.docx');
  });
});
