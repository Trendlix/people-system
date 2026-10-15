import type { PdfField } from '@trendlix/shared';
import { formPdf, shownGlyphs, shownLines } from '../../test/fixtures/pdf-form.js';
import { docx, p, r } from '../../test/fixtures/docx.js';
import { isPdf } from '../pdf/pdf-file.js';
import { readZip } from '../templates/zip.js';
import { filledFileName, fillVersion, requiredTags } from './fill-version.js';

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

  it('a preview’s optional fields with no value print blank; the others print what they are given (the label)', async () => {
    const fields: PdfField[] = [
      { id: 'a', kind: 'text', tag: 'building_no', page: 1, x: 100, y: 100, width: 200, height: 16, fontSize: 12, align: 'left', optional: true },
      { id: 'b', kind: 'text', tag: 'building_no', page: 1, x: 100, y: 200, width: 200, height: 16, fontSize: 12, align: 'left' },
      { id: 'c', kind: 'boxes', tag: 'insurance_sector_code', page: 1, x: 100, y: 300, width: 40, height: 16, fontSize: 12, boxes: 2, optional: true },
    ];
    const version = { format: 'pdf', data: await formPdf(), pdfFields: fields as never, language: 'en' };
    const values = { building_no: '[Building number]', insurance_sector_code: '[Sector code]' };
    expect(shownLines(await shownGlyphs(await fillVersion(version, values, new Set(['building_no', 'insurance_sector_code']))))).toEqual(['[Building number]']);
    // without `blank` (a generated document), every field prints its value
    expect(shownLines(await shownGlyphs(await fillVersion(version, { building_no: '12', insurance_sector_code: '07' })))).toEqual(['12', '12', '07']);
  });

  it('every tag stops a document while it has no value but those only optional fields of a PDF form print', () => {
    const fields: PdfField[] = [
      { id: 'a', kind: 'text', tag: 'building_no', page: 1, x: 100, y: 100, width: 200, height: 16, fontSize: 12, optional: true },
      { id: 'b', kind: 'text', tag: 'full_name_ar', page: 1, x: 100, y: 200, width: 200, height: 16, fontSize: 12 },
    ];
    expect(requiredTags({ tags: ['full_name_ar', 'building_no'], pdfFields: fields as never })).toEqual(['full_name_ar']);
    expect(requiredTags({ tags: ['full_name_ar', 'building_no'], pdfFields: null })).toEqual(['full_name_ar', 'building_no']);
    expect(requiredTags({ tags: ['full_name_ar'] })).toEqual(['full_name_ar']);
  });

  it('names the filled file after what it is', () => {
    expect(filledFileName('Form 1 - E-0001 - Omar A. Ali', 'pdf')).toBe('Form 1 - E-0001 - Omar A. Ali.pdf');
    expect(filledFileName('Contract - E-0001 - Omar', 'docx')).toBe('Contract - E-0001 - Omar.docx');
  });
});
