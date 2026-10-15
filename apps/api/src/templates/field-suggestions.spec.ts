import { TEMPLATE_LANGUAGES, TEMPLATE_TAG_NAMES, type TemplateLanguage } from '@trendlix/shared';
import { FIELD_LABELS, findBlanks, normalise, suggestFields, tagFor } from './field-suggestions.js';

/** The suggestions as [tag, the text they replace (or "^" for an insertion, with what comes before it)]. */
const say = (text: string, language: TemplateLanguage = 'ar') =>
  suggestFields(text, language).map((s) => [s.tag, s.from === s.to ? `${text.slice(0, s.from)}^` : text.slice(s.from, s.to)]);
const blanks = (text: string) => findBlanks(text).map((b) => text.slice(b.from, b.to));

describe('blanks a tag may replace', () => {
  it('finds runs of dots, ellipses, underscores, tatweel and dashes, with spaces or slashes between them', () => {
    expect(blanks('الاسم: _________ الجنسية: ………… التاريخ: ..../..../....')).toEqual(['_________', '…………', '..../..../....']);
    expect(blanks('Name: _ _ _  ID: ---  Sign: ـــــــ')).toEqual(['_ _ _', '---', 'ـــــــ']);
    expect(findBlanks('Name: ......')).toEqual([{ from: 6, to: 12 }]);
  });

  it('leaves out what only looks like one', () => {
    // two dots, a sentence's ellipsis, a hyphen, a date
    expect(blanks('e.g. full-time … 15-10-2026 .. ok')).toEqual([]);
    // tatweel stretching a word, also with a diacritic
    expect(blanks('عقــــد عمـــل تمهــــــيد عقَــــد')).toEqual([]);
    // an abbreviation's full stop
    expect(blanks('Mr. ______ / ID No. .........')).toEqual(['______', '.........']);
    // never inside a tag
    expect(blanks('{{a___b}} ___')).toEqual(['___']);
  });
});

describe('suggesting fields', () => {
  it("suggests the company's address after its Arabic label, as on the owner's NDA", () => {
    expect(say('ومقرها: ', 'bilingual')).toEqual([['company_address_ar', 'ومقرها: ^']]);
    expect(say('Located at: ', 'bilingual')).toEqual([]);
  });

  it('puts the tag in the blank after a recognised label', () => {
    expect(suggestFields('الاسم: _________________________', 'ar')).toEqual([
      { tag: 'full_name_ar', from: 7, to: 32, label: 'الاسم', text: '{{full_name_ar}}' },
    ]);
    expect(say('Name: ................', 'en')).toEqual([['full_name_en', '................']]);
    expect(say('الرقم القومي: ............ المقيم في .............. وعنوانه ......')).toEqual([
      ['national_id', '............'],
      ['address', '..............'],
      ['address', '......'],
    ]);
  });

  it('inserts after the label when there is no blank, at the end of the line or before the next label', () => {
    expect(suggestFields('رقم قومي:', 'ar')).toEqual([{ tag: 'national_id', from: 9, to: 9, label: 'رقم قومي', text: ' {{national_id}}' }]);
    // after the space already there, not with a second one
    expect(suggestFields('رقم قومي: ', 'ar')).toEqual([{ tag: 'national_id', from: 10, to: 10, label: 'رقم قومي', text: '{{national_id}}' }]);
    expect(say('الطرف الأول')).toEqual([['company_name_ar', 'الطرف الأول^']]);
    // a tab between the fields is not text: "Name:<tab>Date:"
    expect(say('Name:Date:', 'en')).toEqual([
      ['full_name_en', 'Name:^'],
      ['date', 'Name:Date:^'],
    ]);
  });

  it('suggests nothing where a tag is already, or where the label is part of a sentence', () => {
    expect(say('الرقم القومي: {{national_id}}')).toEqual([]);
    expect(say('السيد/ {{full_name_ar}} الطرف الثاني: {{full_name_ar}}')).toEqual([]);
    expect(say('The start date of this contract is fixed.', 'en')).toEqual([]);
    expect(say('يلتزم الطرف الثاني بالعمل')).toEqual([]);
    expect(say('ويشار إليه فيما بعد بالطرف الثاني')).toEqual([]);
    expect(say('Name: Ahmed Ali', 'en')).toEqual([]);
    // the last words of a sentence, not a label standing alone
    expect(say('ويحق للشركة الرجوع على الموظف بالتعويض الاضرار بمصلحة الطرف الاول.')).toEqual([]);
    expect(say('تم التوقيع من الطرف الأول')).toEqual([]);
    expect(say('Signed by the First Party', 'en')).toEqual([]);
    expect(say('1. Date', 'en')).toEqual([['date', '1. Date^']]);
  });

  it('passes over a title before the blank for a name', () => {
    expect(say('الطرف الثاني: السيد/ ................')).toEqual([['full_name_ar', '................']]);
    expect(say('Second Party: Mr. ______', 'en')).toEqual([['full_name_en', '______']]);
    expect(say('الاسم: السيد/ة .........')).toEqual([['full_name_ar', '.........']]);
    expect(say('ويمثلها السيد/')).toEqual([['company_rep_name', 'ويمثلها السيد/^']]);
  });

  it('chooses _en or _ar by the label’s language, and by "(Arabic)" or "in English" after it', () => {
    expect(say('Name / الاسم: ..........', 'bilingual')).toEqual([['full_name_ar', '..........']]);
    expect(say('Full Name (Arabic): .........', 'en')).toEqual([['full_name_ar', '.........']]);
    expect(say('الاسم بالإنجليزية: .........', 'ar')).toEqual([['full_name_en', '.........']]);
    expect(say('Name in English: .........', 'bilingual')).toEqual([['full_name_en', '.........']]);
    expect(say('First Party: .........', 'en')).toEqual([['company_name_en', '.........']]);
  });

  it('splits the job title and department by language on a bilingual template only', () => {
    expect(say('Job Title: ....... Department: .......', 'bilingual')).toEqual([
      ['job_title_en', '.......'],
      ['department_en', '.......'],
    ]);
    expect(say('Job Title: ....... Department: .......', 'en')).toEqual([
      ['job_title', '.......'],
      ['department', '.......'],
    ]);
    expect(say('الوظيفة: ....... الإدارة: .......', 'bilingual')).toEqual([
      ['job_title_ar', '.......'],
      ['department_ar', '.......'],
    ]);
    expect(say('المسمى الوظيفي: ....... القسم: .......', 'ar')).toEqual([
      ['job_title', '.......'],
      ['department', '.......'],
    ]);
  });

  it('takes the longest label, and an English label only where its field starts', () => {
    expect(say('Date of Birth: ...... Join Date: ...... Date: ......', 'en')).toEqual([
      ['date_of_birth', '......'],
      ['join_date', '......'],
      ['date', '......'],
    ]);
    expect(say('National ID Number: ........', 'en')).toEqual([['national_id', '........']]);
    expect(say('ID No. ........ Tel.: ........', 'en')).toEqual([
      ['national_id', '........'],
      ['phone', '........'],
    ]);
    expect(say('Company Name: ...... Bank Name: ...... Basic Salary: ......', 'en')).toEqual([]);
    expect(say('1. Name: ...... The Second Party: ......', 'en')).toEqual([
      ['full_name_en', '......'],
      ['full_name_en', '......'],
    ]);
  });

  it('reads labels whatever their case, spacing, colon, letter forms, diacritics or tatweel', () => {
    expect(say('NATIONALITY : ......', 'en')).toEqual([['nationality', '......']]);
    expect(say('FullName:......', 'en')).toEqual([['full_name_en', '......']]);
    expect(say('الأسم: ......')).toEqual([['full_name_ar', '......']]);
    expect(say('الجنسيـــة  :  ......')).toEqual([['nationality', '......']]);
    expect(say('والجنسية ......')).toEqual([['nationality', '......']]);
    expect(say('تحريراً في: ....../....../......')).toEqual([['date', '....../....../......']]);
    expect(say('المؤهل العلمي: ...... تاريخ الميلاد: ...... الرقم التأميني: ......')).toEqual([
      ['qualification', '......'],
      ['date_of_birth', '......'],
      ['insurance_no', '......'],
    ]);
    expect(say('تاريخ التعيين: ...... الراتب: ...... الأجر الشامل: ...... رقم الهاتف: ......')).toEqual([
      ['join_date', '......'],
      ['gross_salary', '......'],
      ['gross_salary', '......'],
      ['phone', '......'],
    ]);
    expect(say('Email: ...... Mobile: ...... Represented by: ......', 'en')).toEqual([
      ['work_email', '......'],
      ['phone', '......'],
      ['company_rep_name', '......'],
    ]);
  });

  it('gives the label as written, and inserts past a diacritic', () => {
    const [s] = suggestFields('الاسمُ', 'ar');
    expect([s.label, s.from, s.to]).toEqual(['الاسمُ', 6, 6]);
  });

  it('every label stands for a tag of the dictionary, in every language', () => {
    for (const entry of FIELD_LABELS) {
      for (const label of [...entry.en, ...entry.ar]) expect(normalise(label).text).toBe(normalise(label).text.trim());
      for (const template of TEMPLATE_LANGUAGES) {
        for (const language of ['en', 'ar'] as const) expect(TEMPLATE_TAG_NAMES.has(tagFor(entry, language, template))).toBe(true);
      }
    }
  });

  it('makes letter forms one and keeps a map back to the text', () => {
    expect(normalise('الإسمُ  ـــ Name')).toEqual({ text: 'الاسم ـــ name', at: [0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15] });
  });
});
