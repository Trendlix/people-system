import { TEMPLATE_TAGS, type PdfField } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  asItWraps,
  boxSamples,
  canBeOptional,
  canWrap,
  changeKind,
  changeTag,
  dateKind,
  defaultBoxes,
  digitsSetting,
  fieldLabel,
  isAmountTag,
  isOptional,
  newField,
  printsArabicDigits,
  sampleText,
  sampleValue,
  TAGS_BY_GROUP,
  withLines,
  withOptional,
} from './samples';

const field = (over: Partial<PdfField> = {}): PdfField => ({ id: 'a1b2c3d4', kind: 'text', tag: 'full_name_ar', page: 1, x: 100, y: 200, width: 150, height: 16, fontSize: 11, ...over });

describe('what kind of value a tag has', () => {
  it('knows date and month tags from their notes', () => {
    expect(dateKind('join_date')).toBe('date');
    expect(dateKind('date_of_birth')).toBe('date');
    expect(dateKind('id_issue_date')).toBe('month');
    expect(dateKind('full_name_ar')).toBeNull();
    expect(dateKind(null)).toBeNull();
  });

  it('knows the amounts of the Pay group, not their words, a share or the list of allowances', () => {
    expect(isAmountTag('gross_salary')).toBe(true);
    expect(isAmountTag('insured_salary')).toBe(true);
    expect(isAmountTag('allowances_total')).toBe(true);
    expect(isAmountTag('gross_salary_words')).toBe(false);
    expect(isAmountTag('basic_percent')).toBe(false);
    expect(isAmountTag('allowances_ar')).toBe(false);
    expect(isAmountTag('national_id')).toBe(false);
  });
});

describe('sample values', () => {
  it('gives each kind of tag a plausible value that is no one’s data', () => {
    expect(sampleValue('national_id')).toBe('29001011234567');
    expect(sampleValue('company_rep_national_id_ar')).toBe('29001011234567');
    expect(sampleValue('join_date')).toBe('15/10/2026');
    expect(sampleValue('id_issue_date')).toBe('10/2026');
    expect(sampleValue('insured_salary')).toBe('16,700.50');
    expect(sampleValue('phone')).toBe('01012345678');
    expect(sampleValue('insurance_no', 12)).toBe('123456789012');
    expect(sampleValue(null, 3)).toBe('123');
  });

  it('shows the characters in the boxes as the filled PDF prints them', () => {
    expect(boxSamples(field({ kind: 'boxes', tag: 'national_id', boxes: 14 })).join('')).toBe('29001011234567');
    expect(boxSamples(field({ kind: 'boxes', tag: 'join_date', boxes: 8, dateOrder: 'YMD' })).join('')).toBe('20261015');
    expect(boxSamples(field({ kind: 'boxes', tag: 'join_date', boxes: 8 })).join('')).toBe('15102026');
    expect(boxSamples(field({ kind: 'boxes', tag: 'insured_salary', boxes: 6, amountPart: 'pounds', boxAlign: 'right' }))).toEqual(['', '1', '6', '7', '0', '0']);
    expect(boxSamples(field({ kind: 'boxes', tag: 'insured_salary', boxes: 2, amountPart: 'piasters' }))).toEqual(['5', '0']);
    expect(boxSamples(field({ kind: 'boxes', tag: 'national_id', boxes: 3, arabicDigits: true }))).toEqual(['٢', '٩', '٠']);
    expect(boxSamples(field({ kind: 'boxes', tag: 'insurance_no', boxes: 4 }))).toEqual(['1', '2', '3', '4']);
  });

  it('shows the tag’s label in the template’s language, the check’s mark, or the fixed text', () => {
    expect(sampleText(field(), 'ar')).toBe('الاسم الكامل بالعربي');
    expect(sampleText(field(), 'bilingual')).toBe('الاسم الكامل بالعربي');
    expect(sampleText(field(), 'en')).toBe('Full name (Arabic)');
    expect(sampleText(field({ kind: 'check', tag: null }), 'ar')).toBe('✓');
    expect(sampleText(field({ kind: 'check', tag: null, text: 'X' }), 'ar')).toBe('X');
    expect(sampleText(field({ kind: 'fixed', tag: null, text: 'مكتب تأمينات الدقي' }), 'ar')).toBe('مكتب تأمينات الدقي');
  });

  it('names a field for the list and screen readers', () => {
    expect(fieldLabel(field())).toBe('Full name (Arabic)');
    expect(fieldLabel(field({ kind: 'check', tag: null }))).toBe('Check mark');
    expect(fieldLabel(field({ kind: 'check', tag: 'nationality', equals: 'مصري' }))).toBe('Check mark: Nationality is مصري');
    expect(fieldLabel(field({ kind: 'fixed', tag: null, text: ' Cairo ' }))).toBe('Fixed text: Cairo');
    expect(fieldLabel(field({ kind: 'fixed', tag: null }))).toBe('Fixed text');
  });

  it('lists every tag once, by group', () => {
    expect(TAGS_BY_GROUP.flatMap((g) => g.tags).length).toBe(TEMPLATE_TAGS.length);
    expect(TAGS_BY_GROUP[0]).toMatchObject({ group: 'employee', label: 'Employee' });
  });
});

describe('new fields and their kinds', () => {
  const rect = { x: 10, y: 20, width: 150, height: 16 };

  it('places a tag as text lined up for the language, a check mark, or fixed text', () => {
    expect(newField({ kind: 'tag', tag: 'full_name_ar' }, 'id000001', 2, rect, 'ar')).toEqual({ id: 'id000001', kind: 'text', tag: 'full_name_ar', page: 2, ...rect, fontSize: 11, align: 'right', shrinkToFit: true });
    expect(newField({ kind: 'tag', tag: 'full_name_en' }, 'id000002', 1, rect, 'en').align).toBe('left');
    expect(newField({ kind: 'check' }, 'id000003', 1, rect, 'ar')).toMatchObject({ kind: 'check', tag: null });
    expect(newField({ kind: 'fixed' }, 'id000004', 1, rect, 'ar')).toMatchObject({ kind: 'fixed', tag: null, text: '' });
  });

  it('starts boxes as the tag needs them', () => {
    expect(defaultBoxes('national_id', 'ar')).toEqual({ boxes: 14 });
    expect(defaultBoxes('join_date', 'ar')).toEqual({ boxes: 8, groups: [4, 2, 2], dateOrder: 'YMD' });
    expect(defaultBoxes('join_date', 'en')).toEqual({ boxes: 8, groups: [2, 2, 4], dateOrder: 'DMY' });
    expect(defaultBoxes('id_issue_date', 'ar')).toEqual({ boxes: 6, groups: [4, 2], dateOrder: 'YMD' });
    expect(defaultBoxes('gross_salary', 'ar')).toEqual({ boxes: 6, amountPart: 'pounds', boxAlign: 'right' });
    expect(defaultBoxes('phone', 'ar')).toEqual({ boxes: 11 });
    expect(defaultBoxes('employee_code', 'ar')).toEqual({ boxes: 10 });
  });

  it('turns a field into another kind with that kind’s defaults, keeping where it is', () => {
    const text = field({ tag: 'national_id', align: 'right', shrinkToFit: true, bold: true });
    const boxes = changeKind(text, 'boxes', 'ar');
    expect(boxes).toMatchObject({ kind: 'boxes', tag: 'national_id', boxes: 14, x: 100, y: 200, width: 150, bold: true });
    expect(boxes).not.toHaveProperty('align');
    expect(changeKind(boxes, 'text', 'ar')).toMatchObject({ kind: 'text', align: 'right', shrinkToFit: true });
    expect(changeKind(boxes, 'text', 'ar')).not.toHaveProperty('boxes');
    expect(changeKind(text, 'fixed', 'ar')).toMatchObject({ kind: 'fixed', tag: null, text: '' });
    expect(changeKind(text, 'check', 'ar')).toMatchObject({ kind: 'check', tag: 'national_id' });
    expect(changeKind(text, 'text', 'ar')).toBe(text);
  });

  it('gives a boxes field the new tag’s boxes when its tag changes', () => {
    const id = changeKind(field({ tag: 'national_id' }), 'boxes', 'ar');
    expect(changeTag({ ...id, boxGap: 1.5 }, 'join_date', 'ar')).toMatchObject({ tag: 'join_date', boxes: 8, groups: [4, 2, 2], dateOrder: 'YMD', boxGap: 1.5 });
    expect(changeTag(field(), 'full_name_en', 'ar')).toMatchObject({ kind: 'text', tag: 'full_name_en' });
  });
});

describe('optional fields', () => {
  it('lets text and boxes be optional, not a check mark or fixed text', () => {
    expect(canBeOptional('text')).toBe(true);
    expect(canBeOptional('boxes')).toBe(true);
    expect(canBeOptional('check')).toBe(false);
    expect(canBeOptional('fixed')).toBe(false);
  });

  it('makes a field optional, and back, leaving nothing behind when it is not', () => {
    const on = withOptional(field({ tag: 'building_no' }), true);
    expect(on.optional).toBe(true);
    expect(isOptional(on)).toBe(true);
    const off = withOptional(on, false);
    expect(off).not.toHaveProperty('optional');
    expect(isOptional(off)).toBe(false);
    expect(off).toEqual(field({ tag: 'building_no' }));
  });

  it('never makes a check mark or fixed text optional', () => {
    expect(withOptional(field({ kind: 'check' }), true)).not.toHaveProperty('optional');
    expect(isOptional(field({ kind: 'fixed', optional: true }))).toBe(false);
  });

  it('stays optional between text and boxes, and stops being so as a check mark or fixed text', () => {
    const text = field({ tag: 'building_no', optional: true });
    const boxes = changeKind(text, 'boxes', 'ar');
    expect(boxes.optional).toBe(true);
    expect(changeKind(boxes, 'text', 'ar').optional).toBe(true);
    expect(changeKind(text, 'check', 'ar')).not.toHaveProperty('optional');
    expect(changeKind(text, 'fixed', 'ar')).not.toHaveProperty('optional');
    expect(changeKind(field({ tag: 'building_no' }), 'boxes', 'ar')).not.toHaveProperty('optional');
  });

  it('keeps it when the tag changes', () => {
    const boxes = changeKind(field({ tag: 'building_no', optional: true }), 'boxes', 'ar');
    expect(changeTag(boxes, 'insurance_no', 'ar').optional).toBe(true);
    expect(changeTag(field({ optional: true }), 'personal_email', 'ar').optional).toBe(true);
  });
});

// A text field that takes more than one line (owner, 16 October 2026): text and fixed text, 1 to 4 lines.
describe('lines', () => {
  it('lets text and fixed text wrap, not boxes or a check mark', () => {
    expect(['text', 'fixed', 'boxes', 'check'].map((k) => canWrap(k as PdfField['kind']))).toEqual([true, true, false, false]);
  });

  it('gives a field 1 to 4 lines, leaving nothing behind for one', () => {
    expect(withLines(field(), 2).lines).toBe(2);
    expect(withLines(field({ kind: 'fixed', tag: null, text: 'x' }), 4).lines).toBe(4);
    expect(withLines(field(), 9).lines).toBe(4);
    expect(withLines(field(), 2.6).lines).toBe(3);
    expect(withLines(field({ lines: 3 }), 1)).toEqual(field());
    expect(withLines(field({ lines: 3 }), 0)).not.toHaveProperty('lines');
    expect(withLines(field({ kind: 'boxes', boxes: 4 }), 2)).not.toHaveProperty('lines');
  });

  it('keeps its lines between text and fixed text, and drops them as boxes or a check mark', () => {
    const text = field({ lines: 2 });
    expect(changeKind(text, 'fixed', 'ar').lines).toBe(2);
    expect(changeKind(changeKind(text, 'fixed', 'ar'), 'text', 'ar').lines).toBe(2);
    expect(changeKind(text, 'boxes', 'ar')).not.toHaveProperty('lines');
    expect(changeKind(text, 'check', 'ar')).not.toHaveProperty('lines');
    expect(changeKind(field(), 'fixed', 'ar')).not.toHaveProperty('lines');
  });

  it('wraps a sample as the PDF does: never starting a line with a sign standing alone', () => {
    expect(asItWraps('بكالوريوس التجارة - شعبة المحاسبة - جامعة طنطا')).toBe('بكالوريوس التجارة\u00a0- شعبة المحاسبة\u00a0- جامعة طنطا');
    expect(asItWraps('Omar Khaled')).toBe('Omar Khaled');
    expect(asItWraps('a / b')).toBe('a\u00a0/ b');
    expect(asItWraps('end -')).toBe('end\u00a0-');
  });
});

// A social insurance form prints every number in ٠-٩ but an email's, whatever a field was saved with (owner, 16 October
// 2026); any other template, as each field is set.
describe('the digits a field prints', () => {
  const FORM_1 = 'insurance_form_1';

  it('follows the slot’s rule on a social insurance form, else the field’s own setting', () => {
    expect(printsArabicDigits(field({ tag: 'insurance_no' }), FORM_1)).toBe(true);
    expect(printsArabicDigits(field({ kind: 'boxes', tag: 'national_id', arabicDigits: false }), 'insurance_form_6')).toBe(true);
    expect(printsArabicDigits(field({ kind: 'fixed', tag: null }), FORM_1)).toBe(true);
    expect(printsArabicDigits(field({ tag: 'personal_email', arabicDigits: true }), FORM_1)).toBe(false);
    expect(printsArabicDigits(field({ kind: 'boxes', tag: 'national_id' }), 'nda')).toBe(false);
    expect(printsArabicDigits(field({ kind: 'boxes', tag: 'national_id', arabicDigits: true }), 'nda')).toBe(true);
    expect(printsArabicDigits(field({ kind: 'boxes', tag: 'national_id', arabicDigits: true }))).toBe(true);
  });

  it('shows the setting ticked and locked on a social insurance form, unticked and locked for an email, free elsewhere', () => {
    expect(digitsSetting(field({ kind: 'boxes', tag: 'national_id' }), FORM_1)).toEqual({ checked: true, locked: 'Social insurance forms always print ٠-٩.' });
    expect(digitsSetting(field({ tag: 'personal_email', arabicDigits: true }), FORM_1)).toEqual({ checked: false, locked: 'Emails keep their own digits.' });
    expect(digitsSetting(field({ kind: 'boxes', tag: 'national_id', arabicDigits: true }), 'nda')).toEqual({ checked: true, locked: null });
    expect(digitsSetting(field({ kind: 'boxes', tag: 'national_id' }), null)).toEqual({ checked: false, locked: null });
    // a check mark prints no digits: as it is set
    expect(digitsSetting(field({ kind: 'check', tag: null }), FORM_1)).toEqual({ checked: false, locked: null });
  });

  it('shows the boxes’ samples in ٠-٩ on a social insurance form', () => {
    const id = field({ kind: 'boxes', tag: 'national_id', boxes: 14 });
    expect(boxSamples(id, FORM_1).join('')).toBe('٢٩٠٠١٠١١٢٣٤٥٦٧');
    expect(boxSamples(field({ kind: 'boxes', tag: 'join_date', boxes: 8, dateOrder: 'YMD' }), 'insurance_form_6').join('')).toBe('٢٠٢٦١٠١٥');
    expect(boxSamples(id, 'nda').join('')).toBe('29001011234567');
    expect(boxSamples(id).join('')).toBe('29001011234567');
  });

  it('shows a fixed text’s digits in ٠-٩ on a social insurance form, an email’s label as it is', () => {
    const office = field({ kind: 'fixed', tag: null, text: 'مكتب 12' });
    expect(sampleText(office, 'ar', FORM_1)).toBe('مكتب ١٢');
    expect(sampleText(office, 'ar', 'nda')).toBe('مكتب 12');
    expect(sampleText(office, 'ar')).toBe('مكتب 12');
    expect(sampleText({ ...office, arabicDigits: true }, 'ar')).toBe('مكتب ١٢');
    expect(sampleText(field({ tag: 'personal_email' }), 'en', FORM_1)).toBe(sampleText(field({ tag: 'personal_email' }), 'en'));
  });
});
