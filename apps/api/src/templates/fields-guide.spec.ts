import { TAG_GROUP_LABELS, TAG_GROUPS, TEMPLATE_FOLDER_LABELS, TEMPLATE_SLOTS, TEMPLATE_TAGS } from '@trendlix/shared';
import { paragraphTexts, readDocx } from './docx-tags.js';
import { FIELDS_GUIDE_FILE_NAME, fieldsGuideDocx, titleCase } from './fields-guide.js';
import { readZip } from './zip.js';

const OPTIONS = { companyName: 'TrendLIX', date: '15/10/2026' };
const guide = fieldsGuideDocx(OPTIONS);
const zip = readZip(guide);
const part = (name: string) => zip.read(name)?.toString('utf8') ?? '';
const documentXml = part('word/document.xml');
const texts = paragraphTexts(documentXml);
const count = (xml: string, piece: string) => xml.split(piece).length - 1;

/** Whether every start tag has its end tag, properly nested (no XML parser in the API's dependencies). */
function wellFormed(xml: string): boolean {
  const open: string[] = [];
  for (const [whole, closing, name] of xml.matchAll(/<\?[^>]*\?>|<(\/?)([\w:.-]+)(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    if (name === undefined || whole.endsWith('/>')) continue;
    if (!closing) open.push(name);
    else if (open.pop() !== name) return false;
  }
  return open.length === 0 && !/&(?!(?:amp|lt|gt|quot|apos);)/.test(xml);
}

describe('the Fields Guide', () => {
  it('is a Word file the tag reader opens: every tag of the list, none unknown or broken', () => {
    const reading = readDocx(guide);
    expect([...reading.tags].sort()).toEqual(TEMPLATE_TAGS.map((t) => t.tag).sort());
    expect(reading.unknownTags).toEqual([]);
    expect(reading.broken).toEqual([]);
    expect(FIELDS_GUIDE_FILE_NAME).toBe('Template Fields Guide.docx');
  });

  it('starts with its title in English and Arabic, the company and the date, then how to use the fields', () => {
    expect(texts.slice(0, 3)).toEqual(['Template Fields Guide', 'دليل حقول القوالب', 'TrendLIX · 15/10/2026']);
    expect(texts[3]).toContain(`${TEMPLATE_TAGS.length} fields in ${TAG_GROUPS.length} groups`);
    const steps = texts.slice(texts.indexOf('How to Use the Fields') + 1, texts.indexOf('Fields by Group'));
    // numbered (the tab after the number isn't text)
    expect(steps.map((s) => /^\d+\./.exec(s)?.[0])).toEqual(steps.map((_, i) => `${i + 1}.`));
    for (const said of [
      'two curly braces on each side, e.g. {{full_name_ar}}',
      'check the tags the system found, then publish it',
      'Mail Merge fields',
      'takes the formatting of the place where it’s typed',
      'DD/MM/YYYY (e.g. 15/10/2026)',
      'bilingual template (Arabic and English side by side), use the _ar and _en tags',
      'only those allowed to see that data can generate',
      'says which field is missing and where to fill it in',
    ]) {
      expect(steps.some((s) => s.includes(said)), said).toBe(true);
    }
  });

  it('has a section per tag group, in order, with every field: its tag, labels, source and notes', () => {
    const headings = TAG_GROUPS.map((g) => titleCase(TAG_GROUP_LABELS[g]));
    expect(headings).toContain('Job and Contract');
    expect(headings).toContain('Resignation and Ending');
    const at = headings.map((h) => texts.indexOf(h));
    expect(at.every((i) => i > texts.indexOf('Fields by Group'))).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(texts.indexOf('Templates in the Library')).toBeGreaterThan(at[at.length - 1]);

    for (const t of TEMPLATE_TAGS) {
      const row = texts.indexOf(`{{${t.tag}}}`);
      expect(row, t.tag).toBeGreaterThan(at[TAG_GROUPS.indexOf(t.group)]);
      expect(texts.slice(row + 1, row + 4)).toEqual([t.labelEn, t.labelAr, t.source]);
      const notes = texts.slice(row + 4, row + 4 + (t.restricted ? 1 : 0) + (t.note ? 1 : 0));
      expect(notes).toEqual([...(t.restricted ? ['Restricted'] : []), ...(t.note ? [t.note] : [])]);
    }
    expect(texts.filter((s) => s === 'Restricted').length).toBe(TEMPLATE_TAGS.filter((t) => t.restricted).length);
  });

  it('sets the tags in the monospace Tag style, and the Arabic right to left', () => {
    expect(part('word/styles.xml')).toContain('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
    expect(documentXml).toContain('<w:r><w:rPr><w:rStyle w:val="TagCode"/><w:noProof/></w:rPr><w:t xml:space="preserve">{{national_id}}</w:t></w:r>');
    // the الحقل column: a right-to-left paragraph and run
    const arabicCell = (label: string) =>
      `<w:p><w:pPr><w:pStyle w:val="TableText"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/><w:lang w:bidi="ar-EG"/></w:rPr><w:t xml:space="preserve">${label}</w:t></w:r></w:p>`;
    for (const t of TEMPLATE_TAGS) expect(documentXml, t.tag).toContain(arabicCell(t.labelAr));
    // an Arabic phrase among English is one right-to-left run, the punctuation between its words included
    const rtlRun = (text: string) => `<w:rPr><w:rtl/><w:lang w:bidi="ar-EG"/></w:rPr><w:t xml:space="preserve">${text}</w:t>`;
    expect(documentXml).toContain(rtlRun('فقط … لا غير'));
    expect(documentXml).toContain(rtlRun('راتب شهري / بالساعة'));
  });

  it('repeats each table’s shaded header row on every page', () => {
    const tables = TAG_GROUPS.filter((g) => TEMPLATE_TAGS.some((t) => t.group === g)).length + 1;
    expect(count(documentXml, '<w:tbl>')).toBe(tables);
    expect(count(documentXml, '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>')).toBe(tables);
    expect(count(documentXml, '<w:shd w:val="clear" w:color="auto" w:fill="DEEAF6"/>')).toBe(tables * 5);
    expect(texts.filter((s) => s === 'الحقل').length).toBe(tables - 1);
    expect(part('word/styles.xml')).toContain('<w:tblStylePr w:type="firstRow">');
  });

  it('lists the templates of the library: name, folder, language, who it applies to and who signs', () => {
    const library = texts.slice(texts.indexOf('Templates in the Library'));
    expect(library.slice(2, 7)).toEqual(['Template', 'Folder', 'Language', 'Applies To', 'Signed By']);
    for (const slot of TEMPLATE_SLOTS) expect(library, slot.key).toContain(titleCase(slot.name));

    const row = (key: string) => {
      const at = library.indexOf(titleCase(TEMPLATE_SLOTS.find((s) => s.key === key)!.name));
      return library.slice(at, at + 6);
    };
    expect(row('contract_full_time').slice(0, 5)).toEqual(['Contract · Full-time (Official Copy)', 'Contracts', 'Arabic', 'Full-time', 'The employee and the company']);
    expect(row('nda').slice(0, 5)).toEqual(['NDA', TEMPLATE_FOLDER_LABELS.nda, 'Chosen on upload', 'All employment types', 'The employee and the company']);
    expect(row('hr_letter_en').slice(2, 5)).toEqual(['English', 'All employment types', 'The company']);
    expect(row('payslip_ar').slice(4, 5)).toEqual(['Not signed']);
    // the paid trainee's training agreement, the unpaid intern's internship agreement, one certificate for both (19 October 2026)
    expect(row('contract_trainee').slice(0, 4)).toEqual(['Training Agreement · Trainee', 'Contracts', 'Chosen on upload', 'Trainee']);
    expect(row('contract_internship').slice(0, 4)).toEqual(['Internship Agreement · Unpaid Internship', 'Contracts', 'Chosen on upload', 'Unpaid internship (outside the labour law)']);
    expect(row('offer_trainee').slice(3, 4)).toEqual(['Trainee']);
    expect(row('cert_internship').slice(3, 4)).toEqual(['Trainee, Unpaid internship (outside the labour law)']);
    // the social insurance copy's salary tags read the insured salary
    expect(row('contract_full_time_insurance')[1]).toBe(
      'On this template, {{gross_salary}} prints the value of {{insured_salary}}, {{gross_salary_words}} the value of {{insured_salary_words}} and {{gross_salary_words_en}} the value of {{insured_salary_words_en}}.',
    );
  });

  it('is an A4 landscape page with a footer: the date and Page X of Y', () => {
    expect(documentXml).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');
    expect(documentXml).toContain('<w:footerReference w:type="default" r:id="rId3"/>');
    expect(part('word/_rels/document.xml.rels')).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"');
    const footer = part('word/footer1.xml');
    expect(paragraphTexts(footer)).toEqual(['Template Fields Guide · 15/10/2026Page 1 of 1']);
    expect(footer).toContain('<w:instrText xml:space="preserve"> PAGE </w:instrText>');
    expect(footer).toContain('<w:instrText xml:space="preserve"> NUMPAGES </w:instrText>');
  });

  it('has the styles Word needs, in a font that has Arabic', () => {
    const styles = part('word/styles.xml');
    for (const id of ['Normal', 'Title', 'Heading1', 'Heading2', 'TableText', 'Footer', 'TagCode', 'FieldsTable']) expect(styles, id).toContain(`w:styleId="${id}"`);
    expect(styles).toContain('<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>');
    expect(styles).toContain('<w:name w:val="heading 1"/>');
  });

  it('is a complete package: every part declared and linked is there, and every part is well-formed XML', () => {
    expect(zip.entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/settings.xml',
      'word/footer1.xml',
    ]);
    for (const [, name] of part('[Content_Types].xml').matchAll(/PartName="\/([^"]+)"/g)) expect(zip.has(name), name).toBe(true);
    for (const [, target] of part('_rels/.rels').matchAll(/Target="([^"]+)"/g)) expect(zip.has(target), target).toBe(true);
    for (const [, target] of part('word/_rels/document.xml.rels').matchAll(/Target="([^"]+)"/g)) expect(zip.has(`word/${target}`), target).toBe(true);
    for (const e of zip.entries) expect(wellFormed(part(e.name)), e.name).toBe(true);
    expect(wellFormed('<w:p><w:r></w:p></w:r>')).toBe(false);
  });

  it('without a company row, the line under the title is the date alone; the same day always gives the same bytes', () => {
    const plain = fieldsGuideDocx({ companyName: null, date: '01/11/2026' });
    expect(paragraphTexts(readZip(plain).read('word/document.xml')!.toString('utf8'))[2]).toBe('01/11/2026');
    expect(Buffer.compare(fieldsGuideDocx(OPTIONS), guide)).toBe(0);
  });

  it('escapes what XML reserves in the company name, and leaves out what it can’t hold', () => {
    const escaped = readZip(fieldsGuideDocx({ companyName: 'A & B <Co>\u0007', date: '15/10/2026' })).read('word/document.xml')!.toString('utf8');
    expect(escaped).toContain('A &amp; B &lt;Co&gt; · 15/10/2026');
    expect(paragraphTexts(escaped)[2]).toBe('A & B <Co> · 15/10/2026');
    expect(wellFormed(escaped)).toBe(true);
  });
});

describe('titleCase, for the guide’s headings', () => {
  it('capitalises each word but the short ones inside, and leaves capitals and Arabic as they are', () => {
    expect(titleCase('Job and contract')).toBe('Job and Contract');
    expect(titleCase('Contract · Full-time (official copy)')).toBe('Contract · Full-time (Official Copy)');
    expect(titleCase('NDA')).toBe('NDA');
    expect(titleCase('Resignation request (طلب استقالة)')).toBe('Resignation Request (طلب استقالة)');
  });
});
