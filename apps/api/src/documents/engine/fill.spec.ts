import { CONTRACT_TAGS, contentTypes, docx, footerXml, headerXml, p, r, realTemplate } from '../../../test/fixtures/docx.js';
import { paragraphTexts, readDocx, textParts } from '../../templates/docx-tags.js';
import { readZip, writeZip, ZipError } from '../../templates/zip.js';
import { arabicAmountInWords, arabicDuration, arabicWeekday, fillTemplate } from './index.js';
import { resolveTarget } from './mail-merge.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const text = (file: Buffer, name: string) => readZip(file).read(name)?.toString('utf8') ?? null;

/** Every start tag closed by its own end tag, in order. */
function wellFormed(xml: string): boolean {
  const open: string[] = [];
  for (const m of xml.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([^\s/>]+)(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    if (m[2] === undefined || m[0].endsWith('/>')) continue;
    if (m[1] !== '/') open.push(m[2]);
    else if (open.pop() !== m[2]) return false;
  }
  return open.length === 0;
}

describe("filling in the owner's contract template", () => {
  const template = realTemplate('Contract');
  const values: Record<string, string> = {
    day_name: arabicWeekday('2026-10-15'),
    contract_date: '15/10/2026',
    full_name_ar: 'أحمد محمد علي',
    address: '12 شارع النيل، الدقي، الجيزة',
    phone: '01012345678',
    national_id: '29001011234567',
    id_printed_no: 'JX1234567',
    id_issue_date: '01/01/2020',
    qualification: 'بكالوريوس تجارة',
    job_title: 'محاسب',
    duration: arabicDuration(12),
    start_date: '15/10/2026',
    end_date: '14/10/2027',
    gross_salary: '15,000',
    gross_salary_words: arabicAmountInWords(15000),
    net_salary: '13,069.65',
    net_salary_words: arabicAmountInWords(13069.65),
  };
  const filled = fillTemplate(template, values);
  const before = readZip(template);
  const after = readZip(filled);
  const changed = ['word/document.xml', 'word/settings.xml', 'word/_rels/settings.xml.rels', '[Content_Types].xml'];

  it('fills every tag it uses', () => {
    expect(Object.keys(values).sort()).toEqual([...CONTRACT_TAGS].sort());
    expect(readDocx(template).tags).toEqual(CONTRACT_TAGS);
    // read again by the tag reader, which also checks it is still a Word document
    expect(readDocx(filled)).toEqual({ tags: [], unknownTags: [], broken: [] });
    const document = text(filled, 'word/document.xml')!;
    for (const value of Object.values(values)) expect(document).toContain(value);
    expect(document).toContain('<w:t>خمسة عشر ألف جنيه مصري فقط لا غير</w:t>');
  });

  it("puts the name in the run the tag was in, with that run's formatting", () => {
    const document = text(filled, 'word/document.xml')!;
    const nameRun = [...document.matchAll(/<w:r>(?:(?!<\/w:r>)[\s\S])*<\/w:r>/g)].map((m) => m[0]).find((run) => run.includes('أحمد محمد علي'))!;
    expect(nameRun).toContain('<w:b/>');
    expect(nameRun).toContain('<w:sz w:val="36"/>');
    expect(nameRun).toContain('<w:u w:val="single"/>');
  });

  it('unwraps the 33 merge fields to their text and keeps the page numbers live', () => {
    expect(text(template, 'word/document.xml')!.match(/w:fldCharType="begin"/g)).toHaveLength(33);
    for (const name of textParts(after.entries.map((e) => e.name))) {
      const xml = text(filled, name)!;
      expect(xml).not.toMatch(/MERGEFIELD/);
      if (!name.includes('footer')) expect(xml).not.toMatch(/fldChar|instrText|fldSimple/);
    }
    for (const footer of ['word/footer1.xml', 'word/footer2.xml']) {
      expect(text(filled, footer)).toMatch(/<w:instrText xml:space="preserve"> PAGE <\/w:instrText>/);
      expect(text(filled, footer)!.match(/<w:fldChar /g)).toHaveLength(3);
    }
    // the merge fields' last displayed values stay as text: the title before the name
    expect(text(filled, 'word/document.xml')).toContain('<w:t>السيد</w:t>');
  });

  it('removes the mail merge: the setting, its relationships, the recipient data and its content type', () => {
    const settings = text(template, 'word/settings.xml')!;
    const mailMerge = settings.slice(settings.indexOf('<w:mailMerge>'), settings.indexOf('</w:mailMerge>') + '</w:mailMerge>'.length);
    expect(mailMerge).toContain('Contracts Source.xlsx');
    expect(text(filled, 'word/settings.xml')).toBe(settings.replace(mailMerge, ''));

    expect(text(template, 'word/_rels/settings.xml.rels')).toMatch(/mailMergeSource/);
    expect(text(filled, 'word/_rels/settings.xml.rels')).toMatch(new RegExp(`<Relationships xmlns="${RELS}"></Relationships>$`)); // all three were
    expect(before.has('word/recipientData.xml')).toBe(true);
    expect(after.has('word/recipientData.xml')).toBe(false);

    const types = text(template, '[Content_Types].xml')!;
    const recipientOverride = types.match(/<Override PartName="\/word\/recipientData\.xml"[^>]*\/>/)![0];
    expect(text(filled, '[Content_Types].xml')).toBe(types.replace(recipientOverride, ''));
  });

  it('copies every other entry as it was stored, in the same order, and deflates the parts changed', () => {
    expect(after.entries.map((e) => e.name)).toEqual(before.entries.map((e) => e.name).filter((name) => name !== 'word/recipientData.xml'));
    for (const { name } of after.entries) {
      if (changed.includes(name)) {
        expect(after.raw(name)!.method).toBe(8);
        expect(wellFormed(text(filled, name)!)).toBe(true);
      } else {
        expect(after.raw(name)!.data.equals(before.raw(name)!.data)).toBe(true);
        expect(after.raw(name)!.crc).toBe(before.raw(name)!.crc);
      }
    }
    expect(after.read('word/media/image1.jpeg')!.equals(before.read('word/media/image1.jpeg')!)).toBe(true);
  });

  it('fills the other real templates too', () => {
    for (const name of ['Resignation', 'Clearance_Dues'] as const) {
      const real = realTemplate(name);
      const tags = readDocx(real).tags;
      const out = fillTemplate(real, Object.fromEntries(tags.map((tag) => [tag, `«${tag}»`])));
      expect(readDocx(out)).toEqual({ tags: [], unknownTags: [], broken: [] });
      for (const part of textParts(readZip(out).entries.map((e) => e.name))) expect(wellFormed(text(out, part)!)).toBe(true);
    }
  });
});

describe('filling in a template', () => {
  it('fills headers, footers, footnotes and endnotes, and leaves comments alone', () => {
    const notes = (kind: 'footnotes' | 'endnotes') => `<w:${kind} ${W}>${p(r(`{{${kind === 'footnotes' ? 'tax_reg_no' : 'date'}}}`))}</w:${kind}>`;
    const page = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const file = docx({
      body: p(r('{{full_name_ar}}')),
      parts: {
        'word/header1.xml': headerXml(p(r('{{company_name_ar}}'))),
        'word/footer1.xml': footerXml(p(r('{{employee_code}} – '), page)),
        'word/footnotes.xml': notes('footnotes'),
        'word/endnotes.xml': notes('endnotes'),
        'word/comments.xml': `<w:comments ${W}>${p(r('{{full_name_ar}}'))}</w:comments>`,
      },
    });
    const out = fillTemplate(file, { full_name_ar: 'منى', company_name_ar: 'تريندليكس', employee_code: 'TL-007', tax_reg_no: '123-456', date: '15/10/2026' });
    expect(text(out, 'word/document.xml')).toContain(r('منى'));
    expect(text(out, 'word/header1.xml')).toBe(headerXml(p(r('تريندليكس'))));
    expect(text(out, 'word/footer1.xml')).toBe(footerXml(p(r('TL-007 – '), page)));
    expect(text(out, 'word/footnotes.xml')).toContain(r('123-456'));
    expect(text(out, 'word/endnotes.xml')).toContain(r('15/10/2026'));
    expect(text(out, 'word/comments.xml')).toContain('{{full_name_ar}}');
  });

  it("prints a value with formatting on a line of its own as paragraphs, and inside a sentence as text", () => {
    const file = docx({ body: p(r('{{full_name_ar}}')) + p(r(' {{job_duties}} ')) + p(r('المهام: {{job_duties}}')) });
    const out = fillTemplate(file, { full_name_ar: 'منى', job_duties: { html: '<p>قيادة <strong>الفريق</strong></p><ul><li>متابعة العملاء</li></ul>' } });
    const document = text(out, 'word/document.xml')!;
    expect(readDocx(out)).toEqual({ tags: [], unknownTags: [], broken: [] });
    expect(wellFormed(document)).toBe(true);
    expect(paragraphTexts(document)).toEqual(['منى', 'قيادة الفريق', '•متابعة العملاء', 'المهام: قيادة الفريق• متابعة العملاء']);
    expect(document).toContain('<w:r><w:rPr><w:b/><w:bCs/><w:rtl/></w:rPr><w:t>الفريق</w:t></w:r>');
    expect(document).toContain('<w:p><w:pPr><w:bidi/><w:ind w:left="720" w:hanging="360"/></w:pPr>');
  });

  it('leaves tags without a value for the caller to notice', () => {
    const out = fillTemplate(docx({ body: p(r('{{full_name_ar}} {{phone}}')) }), { full_name_ar: 'منى' });
    expect(readDocx(out).tags).toEqual(['phone']);
  });

  it('gives back the same file when there is nothing to change', () => {
    const file = docx({ body: p(r('بدون علامات')), parts: { 'word/media/logo.png': 'not really a png' } });
    expect(fillTemplate(file, { full_name_ar: 'منى' }).equals(file)).toBe(true);
  });

  it('opens as a zip with [Content_Types].xml intact', () => {
    const file = docx({ body: p(r('{{full_name_ar}}')) });
    const out = readZip(fillTemplate(file, { full_name_ar: 'منى & شركاه' }));
    expect(out.read('[Content_Types].xml')!.toString('utf8')).toBe(contentTypes());
    expect(out.read('word/document.xml')!.toString('utf8')).toContain('<w:t xml:space="preserve">منى &amp; شركاه</w:t>');
  });

  it('removes a mail merge declared anywhere, and keeps the relationships that are not part of it', () => {
    const settingsRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS}">` +
      `<Relationship Id="rId1" Type="${REL_TYPE}/mailMergeSource" Target="file:///Z:\\HR\\Contracts\\Contracts%20Source.xlsx" TargetMode="External"/>` +
      `<Relationship Id="rId2" Type="${REL_TYPE}/recipientData" Target="recipientData.xml"/>` +
      `<Relationship Id="rId3" Type="${REL_TYPE}/attachedTemplate" Target="file:///C:\\Templates\\Normal.dotm" TargetMode="External"/>` +
      `<Relationship Id="rId4" Type="${REL_TYPE}/mailMergeHeaderSource" Target="file:///Z:\\HR\\headers.xlsx" TargetMode="External"/>` +
      '</Relationships>';
    const settings =
      `<w:settings ${W} ${R}><w:zoom w:percent="100"/>` +
      '<w:mailMerge><w:mainDocumentType w:val="formLetters"/><w:linkToQuery/><w:dataType w:val="native"/><w:headerSource r:id="rId4"/><w:dataSource r:id="rId1"/><w:odso><w:recipientData r:id="rId2"/></w:odso></w:mailMerge>' +
      '<w:attachedTemplate r:id="rId3"/></w:settings>';
    const types = contentTypes().replace(
      '</Types>',
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/recipientData.xml" ContentType="application/vnd.ms-word.mailMergeRecipientData+xml"/></Types>',
    );
    const template = writeZip([
      { name: '[Content_Types].xml', data: types },
      { name: 'word/document.xml', data: `<w:document ${W}><w:body>${p(r('{{full_name_ar}}'))}</w:body></w:document>` },
      { name: 'word/settings.xml', data: settings },
      { name: 'word/_rels/settings.xml.rels', data: settingsRels },
      { name: 'word/recipientData.xml', data: '<w:recipients/>' },
      { name: 'word/_rels/recipientData.xml.rels', data: `<Relationships xmlns="${RELS}"/>` },
    ]);
    const out = fillTemplate(template, { full_name_ar: 'منى' });
    expect(readZip(out).entries.map((e) => e.name)).toEqual(['[Content_Types].xml', 'word/document.xml', 'word/settings.xml', 'word/_rels/settings.xml.rels']);
    expect(text(out, 'word/settings.xml')).toBe(`<w:settings ${W} ${R}><w:zoom w:percent="100"/><w:attachedTemplate r:id="rId3"/></w:settings>`);
    expect(text(out, 'word/_rels/settings.xml.rels')).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS}">` +
        `<Relationship Id="rId3" Type="${REL_TYPE}/attachedTemplate" Target="file:///C:\\Templates\\Normal.dotm" TargetMode="External"/>` +
        '</Relationships>',
    );
    expect(text(out, '[Content_Types].xml')).not.toContain('recipientData');
    expect(text(out, '[Content_Types].xml')).toContain('/word/settings.xml');
  });

  it('resolves relationship targets to part names', () => {
    expect(resolveTarget('word/_rels/settings.xml.rels', 'recipientData.xml')).toBe('word/recipientData.xml');
    expect(resolveTarget('_rels/.rels', 'word/document.xml')).toBe('word/document.xml');
    expect(resolveTarget('word/_rels/document.xml.rels', '../customXml/item1.xml')).toBe('customXml/item1.xml');
    expect(resolveTarget('word/_rels/document.xml.rels', '/word/media/image%201.png')).toBe('word/media/image 1.png');
  });

  it('refuses what is not a Word document', () => {
    expect(() => fillTemplate(writeZip([{ name: 'xl/workbook.xml', data: '<workbook/>' }]), {})).toThrow('Not a Word document');
    expect(() => fillTemplate(Buffer.from('%PDF-1.4'), {})).toThrow(ZipError);
  });
});
