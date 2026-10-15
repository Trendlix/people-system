import type { PdfField } from '@trendlix/shared';
import { pdfSample } from './pdf-sample.js';

// A PDF template's sample (owner's decision, 15 October 2026): made-up values, no one's data.

const at = { page: 1, x: 10, y: 10, width: 100, height: 20, fontSize: 12 };

describe('pdfSample', () => {
  it('prints a text field’s name in the template’s language, plausible digits in boxes, and ticks every check box', () => {
    const fields: PdfField[] = [
      { id: 'name', kind: 'text', tag: 'full_name_ar', ...at },
      { id: 'nid', kind: 'boxes', tag: 'national_id', boxes: 14, ...at },
      { id: 'join', kind: 'boxes', tag: 'join_date', boxes: 8, ...at },
      { id: 'pay', kind: 'boxes', tag: 'insured_salary', boxes: 5, amountPart: 'pounds', ...at },
      { id: 'phone', kind: 'boxes', tag: 'phone', boxes: 11, ...at },
      { id: 'ins', kind: 'boxes', tag: 'insurance_no', boxes: 9, ...at },
      { id: 'issued', kind: 'boxes', tag: 'id_issue_date', boxes: 6, ...at },
      { id: 'other', kind: 'boxes', tag: 'grade', boxes: 3, ...at },
      { id: 'type', kind: 'check', tag: 'employment_type_ar', equals: 'دوام كامل', ...at },
      { id: 'office', kind: 'fixed', tag: null, text: 'مكتب', ...at },
    ];
    const { fields: sampled, values } = pdfSample(fields, 'ar');
    expect(values).toEqual({
      full_name_ar: 'الاسم الكامل بالعربي',
      national_id: '29001011234567',
      join_date: '15/10/2026',
      insured_salary: '16,700.50',
      phone: '01012345678',
      insurance_no: '12345678',
      id_issue_date: '10/2026',
      grade: '1234567890',
    });
    expect(sampled.find((f) => f.id === 'type')!.tag).toBeNull(); // ticked whatever the value
    expect(sampled.filter((f) => f.kind !== 'check')).toEqual(fields.filter((f) => f.kind !== 'check'));
  });

  it('prints the English names on an English form, and a boxed value in a text field of the same tag', () => {
    const fields: PdfField[] = [
      { id: 'a', kind: 'text', tag: 'full_name_en', ...at },
      { id: 'b', kind: 'text', tag: 'join_date', ...at },
      { id: 'c', kind: 'boxes', tag: 'join_date', boxes: 8, ...at },
    ];
    expect(pdfSample(fields, 'en').values).toEqual({ full_name_en: 'Full name (English)', join_date: '15/10/2026' });
    expect(pdfSample([{ id: 'a', kind: 'text', tag: 'job_title', ...at }], 'bilingual').values).toEqual({ job_title: 'الوظيفة' });
  });
});
