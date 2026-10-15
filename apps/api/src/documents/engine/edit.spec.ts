import { realTemplate } from '../../../test/fixtures/docx.js';
import { paragraphTexts, readTags, textParts } from '../../templates/docx-tags.js';
import { readZip } from '../../templates/zip.js';
import { editText, type TextEdit } from './edit.js';
import { readParagraphs } from './paragraphs.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
/** A part holding these paragraphs, and the paragraphs back out of it. */
const part = (body: string) => `<w:document ${W}><w:body>${body}</w:body></w:document>`;
const edit = (body: string, ...edits: TextEdit[]) => {
  const out = editText(part(body), edits);
  return out.slice(part('').indexOf('<w:body>') + 8, out.lastIndexOf('</w:body>'));
};
const texts = (body: string) => paragraphTexts(part(body));

describe('changing the text of a paragraph in place (Map Fields)', () => {
  it('inserts into the run where the position falls, keeping its formatting', () => {
    const body = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Name:</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> and more</w:t></w:r></w:p>';
    // at 5 the second run starts: the tag takes its formatting
    expect(edit(body, { paragraph: 0, from: 5, to: 5, text: ' {{full_name_en}}' })).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Name:</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> {{full_name_en}} and more</w:t></w:r></w:p>',
    );
    // inside the first run
    expect(edit(body, { paragraph: 0, from: 2, to: 2, text: '{{date}}' })).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Na{{date}}me:</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> and more</w:t></w:r></w:p>',
    );
  });

  it('inserts at the very end into the last <w:t> holding text', () => {
    const body = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Name:</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t></w:t></w:r></w:p>';
    expect(edit(body, { paragraph: 0, from: 5, to: 5, text: ' {{full_name_en}}' })).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Name: {{full_name_en}}</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t></w:t></w:r></w:p>',
    );
    // what ends in a space now keeps it
    expect(edit('<w:p><w:r><w:t>Ref</w:t></w:r></w:p>', { paragraph: 0, from: 3, to: 3, text: ': ' })).toBe('<w:p><w:r><w:t xml:space="preserve">Ref: </w:t></w:r></w:p>');
  });

  it('replaces a blank spread over several runs: the tag where the blank starts, the rest taken out', () => {
    const body =
      '<w:p><w:pPr><w:bidi/></w:pPr>' +
      '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">الاسم: ....</w:t></w:r>' +
      '<w:proofErr w:type="spellStart"/>' +
      '<w:r><w:rPr><w:rtl/><w:u w:val="dotted"/></w:rPr><w:t>........</w:t></w:r>' +
      '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">.. الجنسية</w:t></w:r>' +
      '</w:p>';
    expect(texts(body)).toEqual(['الاسم: .............. الجنسية']);
    expect(edit(body, { paragraph: 0, from: 7, to: 21, text: '{{full_name_ar}}' })).toBe(
      '<w:p><w:pPr><w:bidi/></w:pPr>' +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">الاسم: {{full_name_ar}}</w:t></w:r>' +
        '<w:proofErr w:type="spellStart"/>' +
        '<w:r><w:rPr><w:rtl/><w:u w:val="dotted"/></w:rPr><w:t></w:t></w:r>' +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> الجنسية</w:t></w:r>' +
        '</w:p>',
    );
  });

  it('removes a tag split over runs, and changes one into another in the run it starts in', () => {
    const body =
      '<w:p><w:r><w:rPr><w:rtl/><w:b/></w:rPr><w:t xml:space="preserve">السيد/ {{full_</w:t></w:r>' +
      '<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>' +
      '<w:r><w:rPr><w:rtl/></w:rPr><w:t>name_ar}} المقيم</w:t></w:r></w:p>';
    expect(texts(body)).toEqual(['السيد/ {{full_name_ar}} المقيم']);
    expect(edit(body, { paragraph: 0, from: 7, to: 23, text: '' })).toBe(
      '<w:p><w:r><w:rPr><w:rtl/><w:b/></w:rPr><w:t xml:space="preserve">السيد/ </w:t></w:r>' +
        '<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>' +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> المقيم</w:t></w:r></w:p>',
    );
    // changed: the new tag in the Arabic, bold run where the old one started
    expect(edit(body, { paragraph: 0, from: 7, to: 23, text: '{{display_name}}' })).toBe(
      '<w:p><w:r><w:rPr><w:rtl/><w:b/></w:rPr><w:t xml:space="preserve">السيد/ {{display_name}}</w:t></w:r>' +
        '<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>' +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> المقيم</w:t></w:r></w:p>',
    );
  });

  it('makes several edits on one line, each range read on the line as it was', () => {
    const body = '<w:p><w:r><w:t xml:space="preserve">Name: ..... ID: {{x}} Date:</w:t></w:r></w:p>';
    const out = edit(
      body,
      { paragraph: 0, from: 27, to: 27, text: ' {{date}}' },
      { paragraph: 0, from: 6, to: 11, text: '{{full_name_en}}' },
      { paragraph: 0, from: 16, to: 21, text: '{{national_id}}' },
    );
    expect(texts(out)).toEqual(['Name: {{full_name_en}} ID: {{national_id}} Date: {{date}}']);
  });

  it('keeps the Arabic runs’ properties, and escapes what it writes', () => {
    const body = '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rFonts w:cs="Simplified Arabic"/><w:rtl/><w:lang w:bidi="ar-EG"/></w:rPr><w:t>التاريخ: &amp;</w:t></w:r></w:p>';
    expect(edit(body, { paragraph: 0, from: 8, to: 8, text: ' {{date}}' })).toBe(
      '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rFonts w:cs="Simplified Arabic"/><w:rtl/><w:lang w:bidi="ar-EG"/></w:rPr><w:t>التاريخ: {{date}} &amp;</w:t></w:r></w:p>',
    );
  });

  it("counts a text box's paragraphs as their own, after the paragraph holding the box", () => {
    const box = (inner: string) => `<w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>${inner}</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r>`;
    const body = `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r>${box('Box: ...')}<w:r><w:t>after</w:t></w:r></w:p>`;
    expect(readParagraphs(part(body)).map((p) => p.text)).toEqual(['Before after', 'Box: ...']);
    expect(edit(body, { paragraph: 1, from: 5, to: 8, text: '{{phone}}' })).toBe(
      `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r>${box('Box: {{phone}}')}<w:r><w:t>after</w:t></w:r></w:p>`,
    );
    // the holding paragraph's text continues around the box
    expect(edit(body, { paragraph: 0, from: 7, to: 7, text: '{{date}} ' })).toBe(
      `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r>${box('Box: ...')}<w:r><w:t>{{date}} after</w:t></w:r></w:p>`,
    );
  });

  it('edits a header with the prefix it declares', () => {
    const xml = '<x:hdr xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:p><x:r><x:t>Ref:</x:t></x:r></x:p></x:hdr>';
    expect(editText(xml, [{ paragraph: 0, from: 4, to: 4, text: ' {{employee_code}}' }])).toBe(
      '<x:hdr xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:p><x:r><x:t>Ref: {{employee_code}}</x:t></x:r></x:p></x:hdr>',
    );
  });

  it('writes into an empty paragraph a run formatted as its paragraph mark, without its tracked-change marks', () => {
    const body = '<w:p><w:pPr><w:bidi/><w:rPr><w:ins w:id="1" w:author="HR" w:date="2026-10-15T00:00:00Z"/><w:rtl/><w:sz w:val="28"/></w:rPr></w:pPr></w:p>';
    expect(edit(body, { paragraph: 0, from: 0, to: 0, text: '{{date}}' })).toBe(
      '<w:p><w:pPr><w:bidi/><w:rPr><w:ins w:id="1" w:author="HR" w:date="2026-10-15T00:00:00Z"/><w:rtl/><w:sz w:val="28"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:rtl/><w:sz w:val="28"/></w:rPr><w:t>{{date}}</w:t></w:r></w:p>',
    );
    expect(edit('<w:p/><w:p w:rsidR="00AB"/>', { paragraph: 1, from: 0, to: 0, text: ' {{date}}' })).toBe(
      '<w:p/><w:p w:rsidR="00AB"><w:r><w:t xml:space="preserve"> {{date}}</w:t></w:r></w:p>',
    );
  });

  it('changes nothing else, and refuses edits that overlap or fall outside the paragraph', () => {
    const body = '<w:p><w:r><w:t>abc</w:t></w:r></w:p><w:p><w:r><w:t>def</w:t></w:r></w:p>';
    expect(editText(part(body), [])).toBe(part(body));
    expect(edit(body, { paragraph: 1, from: 1, to: 2, text: 'X' })).toBe('<w:p><w:r><w:t>abc</w:t></w:r></w:p><w:p><w:r><w:t>dXf</w:t></w:r></w:p>');
    expect(() => edit(body, { paragraph: 2, from: 0, to: 0, text: 'X' })).toThrow(RangeError);
    expect(() => edit(body, { paragraph: 0, from: 2, to: 4, text: 'X' })).toThrow(RangeError);
    expect(() => edit(body, { paragraph: 0, from: 2, to: 1, text: 'X' })).toThrow(RangeError);
    expect(() => edit(body, { paragraph: 0, from: 0, to: 2, text: 'X' }, { paragraph: 0, from: 1, to: 3, text: 'Y' })).toThrow(RangeError);
    expect(() => edit(body, { paragraph: 0, from: 1, to: 1, text: 'X' }, { paragraph: 0, from: 1, to: 2, text: 'Y' })).toThrow(RangeError);
    // touching is not overlapping
    expect(texts(edit(body, { paragraph: 0, from: 0, to: 1, text: 'X' }, { paragraph: 0, from: 1, to: 1, text: 'Y' }))[0]).toBe('XYbc');
  });

  it("reads the owner's templates as the tag reader does, paragraph for paragraph", () => {
    for (const name of ['Contract', 'Resignation', 'Clearance_Dues'] as const) {
      const zip = readZip(realTemplate(name));
      for (const partName of textParts(zip.entries.map((e) => e.name))) {
        const xml = zip.read(partName)!.toString('utf8');
        expect(readParagraphs(xml).map((p) => p.text).filter(Boolean)).toEqual(paragraphTexts(xml));
      }
    }
  });

  it("edits the owner's contract and the tag reader finds the new tag where it was put", () => {
    const xml = readZip(realTemplate('Contract')).read('word/document.xml')!.toString('utf8');
    const paragraphs = readParagraphs(xml);
    const index = paragraphs.findIndex((p) => p.text.includes('{{phone}}'));
    const at = paragraphs[index].text.indexOf('{{phone}}');
    const out = editText(xml, [{ paragraph: index, from: at, to: at + '{{phone}}'.length, text: '{{work_email}}' }]);
    expect(readTags([out]).tags).toContain('work_email');
    // the file holds two copies of the contract: only the first copy's line changed
    const before = paragraphTexts(xml);
    const line = before.indexOf(paragraphs[index].text);
    expect(paragraphTexts(out)).toEqual(before.map((t, i) => (i === line ? t.replace('{{phone}}', '{{work_email}}') : t)));
  });
});
