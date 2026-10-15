import {
  CLEARANCE_TAGS,
  contentTypes,
  CONTRACT_TAGS,
  docx,
  footerXml,
  headerXml,
  p,
  patchCentral,
  r,
  realTemplate,
  RESIGNATION_TAGS,
  TEMPLATE_TYPE,
} from '../../test/fixtures/docx.js';
import { BROKEN_MAX, DocxError, paragraphTexts, readDocx, readTags, tagsInText, textParts } from './docx-tags.js';
import { writeZip } from './zip.js';

/** The message readDocx refuses `data` with. */
function refusal(data: Buffer): string {
  try {
    readDocx(data);
  } catch (err) {
    if (err instanceof DocxError) return err.message;
    throw err;
  }
  throw new Error('not refused');
}

const SAVE_AS = 'Save it as a Word document (.docx) and upload again.';

describe('reading the tags of a Word template', () => {
  it('puts a tag back together across three runs, with spell-check and bookmark marks between them', () => {
    const body =
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr>' +
      '<w:r><w:t>الاسم: {{full_</w:t></w:r>' +
      '<w:proofErr w:type="spellStart"/>' +
      '<w:r><w:rPr><w:b/><w:noProof/></w:rPr><w:t>name</w:t></w:r>' +
      '<w:proofErr w:type="spellEnd"/><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>' +
      '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">_ar}} </w:t></w:r>' +
      '</w:p>';
    expect(readDocx(docx({ body }))).toEqual({ tags: ['full_name_ar'], unknownTags: [], broken: [] });
  });

  it('reads headers and footers after the body, in order of first appearance', () => {
    const file = docx({
      body: p(r('{{full_name_ar}}')) + p(r('{{date}} {{full_name_ar}}')),
      parts: {
        'word/header2.xml': headerXml(p(r('{{employee_code}}'))),
        'word/header1.xml': headerXml(p(r('{{company_name_ar}} {{date}}'))),
        'word/footer1.xml': footerXml(p(r('{{commercial_reg_no}}'))),
        'word/footnotes.xml': `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p(r('{{tax_reg_no}}'))}</w:footnotes>`,
        'word/comments.xml': `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p(r('{{not_printed}}'))}</w:comments>`,
      },
    });
    expect(readDocx(file)).toEqual({
      tags: ['full_name_ar', 'date', 'company_name_ar', 'employee_code', 'commercial_reg_no', 'tax_reg_no'],
      unknownTags: [], // comments aren't printed, so not read
      broken: [],
    });
  });

  it('orders the parts: body, headers and footers by number, footnotes, endnotes', () => {
    const names = ['word/endnotes.xml', 'word/footer2.xml', 'word/header10.xml', 'word/styles.xml', 'word/header2.xml', 'word/document.xml', 'word/footnotes.xml', 'word/footer1.xml'];
    expect(textParts(names)).toEqual([
      'word/document.xml',
      'word/header2.xml',
      'word/header10.xml',
      'word/footer1.xml',
      'word/footer2.xml',
      'word/footnotes.xml',
      'word/endnotes.xml',
    ]);
  });

  it('decodes entities next to tags', () => {
    const body = p(r('Smith &amp; Sons{{full_name_en}}&amp;{{job_title}} &lt;{{date}}&gt; &quot;x&quot;'), r('&#123;&#123;phone&#x7d;&#x7D;'));
    expect(readDocx(docx({ body }))).toEqual({ tags: ['full_name_en', 'job_title', 'date', 'phone'], unknownTags: [], broken: [] });
    expect(paragraphTexts(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:document>`)).toEqual([
      'Smith & Sons{{full_name_en}}&{{job_title}} <{{date}}> "x"{{phone}}',
    ]);
  });

  it('tells known tags from unknown ones, without repeats', () => {
    const body = p(r('{{full_name_ar}} {{salary}} {{ full_name_ar }}')) + p(r('{{ Full_Name_AR }} {{salary}} {{national_id}}'));
    expect(readDocx(docx({ body }))).toEqual({ tags: ['full_name_ar', 'national_id'], unknownTags: ['salary', 'Full_Name_AR'], broken: [] });
  });

  it('flags fragments that look like a tag but are not one', () => {
    expect(tagsInText('الاسم {{ full_name_ar وعنوانه {full_name} ورقمه national_id}} و{{full name}}')).toEqual({
      names: [],
      broken: ['{{ full_name_ar', '{full_name}', 'national_id}}', '{{full name}}'],
    });
    expect(tagsInText('{{phone} {date}} {{}} {{الاسم}}')).toEqual({ names: [], broken: ['{{phone}', '{date}}', '{{}}', '{{الاسم}}'] });
    // a good tag next to a broken one: each is what it is
    expect(tagsInText('{{full_name_ar}}}} {{date}}')).toEqual({ names: ['full_name_ar', 'date'], broken: ['}}'] });
    // braces that aren't tags: a clause number, literal braces around a tag
    expect(tagsInText('البند {1} و{ 2 } {{{date}}}')).toEqual({ names: ['date'], broken: [] });
  });

  it('flags a tag split over two paragraphs', () => {
    const body = p(r('{{full_')) + p(r('name_ar}}'));
    expect(readDocx(docx({ body }))).toEqual({ tags: [], unknownTags: [], broken: ['{{full_', 'name_ar}}'] });
  });

  it('keeps at most 20 broken fragments, without repeats', () => {
    const body = Array.from({ length: 30 }, (_, i) => p(r(`{x${i}}`))).join('') + p(r('{x0}'));
    const { broken } = readTags([`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:document>`]);
    expect(broken).toHaveLength(BROKEN_MAX);
    expect(broken.slice(0, 2)).toEqual(['{x0}', '{x1}']);
  });

  it('reads only printed text: not field codes, deleted text or markup', () => {
    const body =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> MERGEFIELD {{field_code}} </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>{{day_name}}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:del w:id="1" w:author="HR"><w:r><w:delText>{{deleted}}</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="HR"><w:r><w:t>{{date}}</w:t></w:r></w:ins>' +
      '<!-- {{comment}} --><w:r><w:tab/><w:t/><w:t xml:space="preserve"> </w:t></w:r></w:p>';
    expect(readDocx(docx({ body }))).toEqual({ tags: ['day_name', 'date'], unknownTags: [], broken: [] });
  });

  it('reads a text box as paragraphs of its own, in document order', () => {
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>before {{date}}</w:t></w:r><w:r><w:drawing><w:txbxContent>' +
      '<w:p><w:r><w:t>{{full_name_ar}}</w:t></w:r></w:p>' +
      '</w:txbxContent></w:drawing></w:r><w:r><w:t> after</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>{{phone}}</w:t></w:r></w:p></w:body></w:document>';
    expect(paragraphTexts(xml)).toEqual(['before {{date}} after', '{{full_name_ar}}', '{{phone}}']);
    expect(readTags([xml]).tags).toEqual(['date', 'full_name_ar', 'phone']);
  });

  it('reads a part that uses another prefix for WordprocessingML', () => {
    const xml = '<x:document xmlns:x="http://purl.oclc.org/ooxml/wordprocessingml/main"><x:body><x:p><x:r><x:t>{{iban}}</x:t></x:r></x:p></x:body></x:document>';
    expect(readTags([xml]).tags).toEqual(['iban']);
  });

  describe('the real templates', () => {
    it('the contract gives exactly the tags document-rules.json lists for it', () => {
      expect(readDocx(realTemplate('Contract'))).toEqual({ tags: CONTRACT_TAGS, unknownTags: [], broken: [] });
    });

    it('the resignation request', () => {
      expect(readDocx(realTemplate('Resignation'))).toEqual({ tags: RESIGNATION_TAGS, unknownTags: [], broken: [] });
    });

    it('the clearance and dues declaration', () => {
      expect(readDocx(realTemplate('Clearance_Dues'))).toEqual({ tags: CLEARANCE_TAGS, unknownTags: [], broken: [] });
    });
  });

  describe('what is not a Word document', () => {
    it('a file that is not a zip', () => {
      expect(refusal(Buffer.from('%PDF-1.7\n%%EOF\n'))).toBe(`This file isn't a Word document. ${SAVE_AS}`);
      expect(refusal(Buffer.from('just some text'))).toBe(`This file isn't a Word document. ${SAVE_AS}`);
    });

    it('an old Word document (.doc), or one protected by a password', () => {
      const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
      expect(refusal(ole)).toContain('old Word document (.doc)');
      expect(refusal(ole)).toContain('save it as a Word document (.docx) and upload again.');
    });

    it('a zip without word/document.xml, or without [Content_Types].xml', () => {
      expect(refusal(writeZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'xl/workbook.xml', data: '<workbook/>' }]))).toBe(
        `This file isn't a Word document. ${SAVE_AS}`,
      );
      expect(refusal(writeZip([{ name: 'word/document.xml', data: '<w:document/>' }]))).toBe(`This file isn't a Word document. ${SAVE_AS}`);
    });

    it('a Word template (.dotx), or a document with macros', () => {
      expect(refusal(docx({ body: p(r('{{date}}')), mainType: TEMPLATE_TYPE }))).toBe(`This is a Word template (.dotx). ${SAVE_AS}`);
      expect(refusal(docx({ body: '', mainType: 'application/vnd.ms-word.document.macroEnabled.main+xml' }))).toBe(
        `This Word document contains macros (.docm). ${SAVE_AS}`,
      );
    });

    it('a zip bomb', () => {
      const bomb = patchCentral(docx({ body: p(r('{{date}}')) }), 'word/document.xml', (z, at) => z.writeUInt32LE(60 * 1024 * 1024, at + 24));
      expect(refusal(bomb)).toMatch(/^This file expands to more than 50 MB/);
      const lying = patchCentral(
        writeZip([
          { name: '[Content_Types].xml', data: contentTypes() },
          { name: 'word/document.xml', data: Buffer.alloc(2 * 1024 * 1024, 0x20) },
        ]),
        'word/document.xml',
        (z, at) => z.writeUInt32LE(1000, at + 24),
      );
      expect(refusal(lying)).toMatch(/^This file expands to more than 50 MB/);
    });

    it('a file protected by a password inside the zip, and a damaged one', () => {
      const file = docx({ body: p(r('{{date}}')) });
      expect(refusal(patchCentral(file, 'word/document.xml', (z, at) => z.writeUInt16LE(z.readUInt16LE(at + 8) | 1, at + 8)))).toMatch(/protected by a password/);
      expect(refusal(patchCentral(file, 'word/document.xml', (z, at) => z.writeUInt32LE((z.readUInt32LE(at + 16) ^ 1) >>> 0, at + 16)))).toMatch(/damaged/);
    });
  });
});
