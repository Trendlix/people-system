import type { PdfField } from '@trendlix/shared';
import { formPdf, shownGlyphs, shownLines } from '../../test/fixtures/pdf-form.js';
import { docx, p, r } from '../../test/fixtures/docx.js';
import { isPdf } from '../pdf/pdf-file.js';
import { readZip } from '../templates/zip.js';
import { arabicDocument, arabicNumberText, slotArabicDigits } from '@trendlix/shared';
import { arabicDigitValues, filledFileName, fillVersion, requiredTags } from './fill-version.js';

// Every fill goes through one helper, which picks the engine by the version's format (owner's decision, 15 October 2026).

describe('fillVersion', () => {
  it('fills a Word template’s {{tags}} in, as a .docx', async () => {
    const filled = await fillVersion({ slotKey: 'hr_letter_en', format: 'docx', data: docx({ body: p(r('Dear {{full_name_en}}')) }), language: 'en' }, { full_name_en: 'Omar' });
    expect(isPdf(filled)).toBe(false);
    expect(readZip(filled).read('word/document.xml')!.toString('utf8')).toContain('Dear Omar');
  });

  it('prints a PDF form’s values where its fields were placed, as a PDF', async () => {
    const fields: PdfField[] = [{ id: 'a', kind: 'text', tag: 'full_name_en', page: 1, x: 100, y: 100, width: 200, height: 16, fontSize: 12, align: 'left' }];
    const filled = await fillVersion({ slotKey: 'nda', format: 'pdf', data: await formPdf(), pdfFields: fields as never, language: 'en' }, { full_name_en: 'Omar' });
    expect(isPdf(filled)).toBe(true);
    expect(shownLines(await shownGlyphs(filled))).toEqual(['Omar']);
    // a PDF without fields yet: the form as it is
    expect(isPdf(await fillVersion({ slotKey: 'nda', format: 'pdf', data: await formPdf(), pdfFields: null, language: 'ar' }, {}))).toBe(true);
  });

  it('a preview’s optional fields with no value print blank; the others print what they are given (the label)', async () => {
    const fields: PdfField[] = [
      { id: 'a', kind: 'text', tag: 'building_no', page: 1, x: 100, y: 100, width: 200, height: 16, fontSize: 12, align: 'left', optional: true },
      { id: 'b', kind: 'text', tag: 'building_no', page: 1, x: 100, y: 200, width: 200, height: 16, fontSize: 12, align: 'left' },
      { id: 'c', kind: 'boxes', tag: 'insurance_sector_code', page: 1, x: 100, y: 300, width: 40, height: 16, fontSize: 12, boxes: 2, optional: true },
    ];
    const version = { slotKey: 'insurance_form_1', format: 'pdf', data: await formPdf(), pdfFields: fields as never, language: 'en' };
    const values = { building_no: '[Building number]', insurance_sector_code: '[Sector code]' };
    expect(shownLines(await shownGlyphs(await fillVersion(version, values, new Set(['building_no', 'insurance_sector_code']))))).toEqual(['[Building number]']);
    // without `blank` (a generated document), every field prints its value
    expect(shownLines(await shownGlyphs(await fillVersion(version, { building_no: '12', insurance_sector_code: '07' })))).toEqual(['١٢', '١٢', '٠٧']);
  });

  // the owner, 16 October 2026: "all numbers in the social insurance forms to be printed in ٠-٩ digits"
  it('a social insurance form prints every number in ٠-٩, whatever its fields were saved with; an email keeps its own', async () => {
    const fields: PdfField[] = [
      { id: 'no', kind: 'text', tag: 'insurance_no', page: 1, x: 100, y: 100, width: 200, height: 16, fontSize: 12, align: 'left' },
      { id: 'wage', kind: 'boxes', tag: 'insurance_insured_salary', page: 1, x: 100, y: 200, width: 100, height: 16, fontSize: 12, boxes: 5, boxAlign: 'right', amountPart: 'pounds' },
      { id: 'note', kind: 'fixed', tag: null, text: 'مادة 12', page: 1, x: 100, y: 300, width: 200, height: 16, fontSize: 12, align: 'left' },
      // saved with Arabic digits, yet an address keeps its own
      { id: 'email', kind: 'text', tag: 'personal_email', page: 1, x: 100, y: 400, width: 200, height: 16, fontSize: 12, align: 'left', arabicDigits: true },
    ];
    const values = { insurance_no: '1234567', insurance_insured_salary: '14,500.50', personal_email: 'omar2026@mail.test' };
    const printed = async (slotKey: string, language = 'ar') =>
      shownLines(await shownGlyphs(await fillVersion({ slotKey, format: 'pdf', data: await formPdf(), pdfFields: fields as never, language }, values)));
    expect(await printed('insurance_form_1')).toEqual(['١٢٣٤٥٦٧', '١٤٥٠٠', '١٢ ةدام', 'omar2026@mail.test']);
    expect(await printed('insurance_form_6', 'en')).toEqual(['١٢٣٤٥٦٧', '١٤٥٠٠', '١٢ ةدام', 'omar2026@mail.test']);
    // any other form in Arabic too (owner, 22 October 2026: "make sure this in any arabic document")
    expect(await printed('nda')).toEqual(['١٢٣٤٥٦٧', '١٤٥٠٠', '١٢ ةدام', 'omar2026@mail.test']);
    // in English or both languages, each field as saved
    expect(await printed('nda', 'en')).toEqual(['1234567', '14500', '12 ةدام', 'omar٢٠٢٦@mail.test']);
    expect(await printed('nda', 'bilingual')).toEqual(['1234567', '14500', '12 ةدام', 'omar٢٠٢٦@mail.test']);
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

// The owner, 22 October 2026: "in contracts, i need the dates and numbers in arabic ٠-٩", then "make sure this in any
// arabic document".
describe('an Arabic document’s numbers in ٠-٩', () => {
  it('turns digits and percent signs, keeps the comma and the point; keeps an email or a web address', () => {
    // dates year first without zeros (owner, 22 October 2026: "year first then without zeros")
    expect(arabicNumberText('15/07/2025')).toBe('٢٠٢٥/٧/١٥');
    expect(arabicNumberText('اعتبارا من 06/05/2026 وحتى 05/05/2027،')).toBe('اعتبارا من ٢٠٢٦/٥/٦ وحتى ٢٠٢٧/٥/٥،');
    expect(arabicNumberText('10,500')).toBe('١٠,٥٠٠');
    expect(arabicNumberText('1,250,000.75')).toBe('١,٢٥٠,٠٠٠.٧٥');
    expect(arabicNumberText('20%')).toBe('٢٠٪');
    expect(arabicNumberText('02/2025')).toBe('٢٠٢٥/٢');
    expect(arabicNumberText('عشرة آلاف وخمسمائة جنيه')).toBe('عشرة آلاف وخمسمائة جنيه');
    expect(arabicNumberText('omar2@mail.test')).toBe('omar2@mail.test');
    expect(arabicNumberText('https://trendlix.com/2025')).toBe('https://trendlix.com/2025');
    // word by word: a code with Latin letters keeps its digits, the rest of the text doesn't
    expect(arabicNumberText('KX1234567')).toBe('KX1234567');
    expect(arabicNumberText('CON-2026-0044 / CON-2026-0044-A1: 10,500')).toBe('CON-2026-0044 / CON-2026-0044-A1: ١٠,٥٠٠');
    expect(arabicNumberText('15 شارع عباس العقاد')).toBe('١٥ شارع عباس العقاد');
    expect(arabicNumberText('للتواصل omar2@mail.test أو 01012345678')).toBe('للتواصل omar2@mail.test أو ٠١٠١٢٣٤٥٦٧٨');
  });

  it('applies to every document in Arabic, never to an English or a bilingual one', () => {
    expect(arabicDocument('ar')).toBe(true);
    expect(arabicDocument('en')).toBe(false);
    expect(arabicDocument('bilingual')).toBe(false);
    expect(arabicDocument(null)).toBe(false);
    // a PDF form in Arabic: every field but a check box, an email's and an English tag's
    expect(slotArabicDigits('nda', { kind: 'text', tag: 'start_date' }, 'ar')).toBe(true);
    expect(slotArabicDigits('nda', { kind: 'fixed', tag: null }, 'ar')).toBe(true);
    expect(slotArabicDigits('nda', { kind: 'text', tag: 'personal_email' }, 'ar')).toBe(false);
    expect(slotArabicDigits('nda', { kind: 'text', tag: 'full_name_en' }, 'ar')).toBe(false);
    expect(slotArabicDigits('nda', { kind: 'check', tag: null }, 'ar')).toBeNull();
    expect(slotArabicDigits('nda', { kind: 'text', tag: 'start_date' }, 'en')).toBeNull();
    expect(slotArabicDigits('nda', { kind: 'text', tag: 'start_date' })).toBeNull();
  });

  it('keeps an email’s and an English tag’s digits; a formatted value’s text only, never its tags or entities', () => {
    expect(
      arabicDigitValues({
        start_date: '15/07/2025',
        gross_salary: '10,500',
        personal_email: 'omar2@mail.test',
        gross_salary_en: '10,500',
        jd_duties: { html: '<p data-indent="2">Edit 3 videos &amp; 2 reels&#8203;</p>' },
      }),
    ).toEqual({
      start_date: '٢٠٢٥/٧/١٥',
      gross_salary: '١٠,٥٠٠',
      personal_email: 'omar2@mail.test',
      gross_salary_en: '10,500',
      jd_duties: { html: '<p data-indent="2">Edit ٣ videos &amp; ٢ reels&#8203;</p>' },
    });
    // a phone number kept left to right, its + in front
    expect(arabicDigitValues({ phone: '+201091861314' })).toEqual({ phone: '\u202A+٢٠١٠٩١٨٦١٣١٤\u202C' });
    expect(arabicDigitValues({ phone: '' })).toEqual({ phone: '' });
  });

  it('fills an Arabic contract and an Arabic letter with ٠-٩, and an English letter with 0-9', async () => {
    const body = p(r('اعتبارا من {{start_date}} براتب {{gross_salary}}'));
    const ar = await fillVersion({ slotKey: 'contract_full_time', format: 'docx', data: docx({ body }), language: 'ar' }, { start_date: '15/07/2025', gross_salary: '10,500' });
    expect(readZip(ar).read('word/document.xml')!.toString('utf8')).toContain('اعتبارا من ٢٠٢٥/٧/١٥ براتب ١٠,٥٠٠');
    const letter = await fillVersion({ slotKey: 'hr_letter_ar', format: 'docx', data: docx({ body: p(r('تحريرا في {{date}}')) }), language: 'ar' }, { date: '22/10/2026' });
    expect(readZip(letter).read('word/document.xml')!.toString('utf8')).toContain('تحريرا في ٢٠٢٦/١٠/٢٢');
    const en = await fillVersion({ slotKey: 'hr_letter_en', format: 'docx', data: docx({ body: p(r('From {{start_date}}')) }), language: 'en' }, { start_date: '15/07/2025' });
    expect(readZip(en).read('word/document.xml')!.toString('utf8')).toContain('From 15/07/2025');
  });
});
