import { paragraphTexts } from '../../templates/docx-tags.js';
import { fillTags } from './tags.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
/** A part holding these paragraphs, and the paragraphs back out of it. */
const part = (body: string) => `<w:document ${W}><w:body>${body}</w:body></w:document>`;
const fill = (body: string, values: Record<string, string>) => {
  const out = fillTags(part(body), values);
  return out.slice(part('').indexOf('<w:body>') + 8, out.lastIndexOf('</w:body>'));
};

describe('putting values in place of tags', () => {
  it('puts the value in the run the tag starts in, keeping its formatting, and takes the rest of the tag out of the next runs', () => {
    const body =
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>الاسم: {{full_</w:t></w:r>' +
      '<w:proofErr w:type="spellStart"/>' +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>name</w:t></w:r>' +
      '<w:proofErr w:type="spellEnd"/><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>' +
      '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">_ar}} شكراً</w:t></w:r>' +
      '</w:p>';
    expect(fill(body, { full_name_ar: 'أحمد محمد علي' })).toBe(
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>الاسم: أحمد محمد علي</w:t></w:r>' +
        '<w:proofErr w:type="spellStart"/>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t></w:t></w:r>' +
        '<w:proofErr w:type="spellEnd"/><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>' +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> شكراً</w:t></w:r>' +
        '</w:p>',
    );
  });

  it('starts the value where the first brace is, even alone in its run', () => {
    expect(fill('<w:p><w:r><w:t>{</w:t></w:r><w:r><w:t>{phone}</w:t></w:r><w:r><w:t>}.</w:t></w:r></w:p>', { phone: '0100' })).toBe(
      '<w:p><w:r><w:t>0100</w:t></w:r><w:r><w:t></w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>',
    );
  });

  it('fills several tags sharing runs, and tags with spaces inside the braces', () => {
    const body = '<w:p><w:r><w:t>{{start_date}} – {{end</w:t></w:r><w:r><w:t>_date}}{{ job_title }}</w:t></w:r></w:p>';
    expect(fill(body, { start_date: '15/10/2026', end_date: '14/10/2027', job_title: 'محاسب' })).toBe(
      '<w:p><w:r><w:t>15/10/2026 – 14/10/2027</w:t></w:r><w:r><w:t>محاسب</w:t></w:r></w:p>',
    );
  });

  it('adds xml:space="preserve" where a rewritten text starts or ends with a space', () => {
    expect(fill('<w:p><w:r><w:t>{{a}}</w:t></w:r><w:r><w:t>x</w:t></w:r></w:p>', { a: ' padded ' })).toBe(
      '<w:p><w:r><w:t xml:space="preserve"> padded </w:t></w:r><w:r><w:t>x</w:t></w:r></w:p>',
    );
    // what is left of the next run starts with a space now
    expect(fill('<w:p><w:r><w:t>{{a</w:t></w:r><w:r><w:t xml:space="default">}} after</w:t></w:r></w:p>', { a: 'A' })).toBe(
      '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>',
    );
  });

  it('escapes values and leaves out characters XML cannot hold', () => {
    const out = fill('<w:p><w:r><w:t>{{company}}</w:t></w:r></w:p>', { company: 'Smith & Sons <Ltd> "$&"\u0001' });
    expect(out).toBe('<w:p><w:r><w:t>Smith &amp; Sons &lt;Ltd&gt; "$&amp;"</w:t></w:r></w:p>');
    expect(paragraphTexts(part(out))).toEqual(['Smith & Sons <Ltd> "$&"']);
  });

  it('reads tags written with entities, and keeps the entities of the text around them', () => {
    expect(fill('<w:p><w:r><w:t>&#123;&#123;a&#x7D;&#x7d; &amp; &quot;b&quot;</w:t></w:r></w:p>', { a: 'A' })).toBe(
      '<w:p><w:r><w:t>A &amp; "b"</w:t></w:r></w:p>',
    );
  });

  it('turns a line break in a value into <w:br/> within the same run', () => {
    const body = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Address: {{address}}.</w:t></w:r></w:p>';
    expect(fill(body, { address: 'Line 1\nLine 2\r\n Line 3' })).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Address: Line 1</w:t><w:br/><w:t>Line 2</w:t><w:br/><w:t xml:space="preserve"> Line 3.</w:t></w:r></w:p>',
    );
  });

  it('leaves a tag without a value as it is', () => {
    const body = '<w:p><w:r><w:t>{{full_name_ar}} {{phone}}</w:t></w:r></w:p><w:p><w:r><w:t>{{ phone }}</w:t></w:r></w:p>';
    expect(fill(body, { full_name_ar: 'أحمد' })).toBe('<w:p><w:r><w:t>أحمد {{phone}}</w:t></w:r></w:p><w:p><w:r><w:t>{{ phone }}</w:t></w:r></w:p>');
    expect(fillTags(part(body), {})).toBe(part(body)); // nothing to fill: unchanged
  });

  it('does not join paragraphs: a tag split over two paragraphs is not one', () => {
    const body = '<w:p><w:r><w:t>{{a</w:t></w:r></w:p><w:p><w:r><w:t>}}</w:t></w:r></w:p>';
    expect(fill(body, { a: 'A' })).toBe(body);
  });

  it("fills a text box's paragraphs on their own, and the paragraph holding the box around it", () => {
    const box = '<w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>{{b}}</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r>';
    expect(fill(`<w:p><w:r><w:t>{{a</w:t></w:r>${box}<w:r><w:t>}}!</w:t></w:r></w:p>`, { a: 'A', b: 'B' })).toBe(
      `<w:p><w:r><w:t>A</w:t></w:r>${box.replace('{{b}}', 'B')}<w:r><w:t>!</w:t></w:r></w:p>`,
    );
  });

  it('uses the prefix the part declares', () => {
    const xml = '<x:hdr xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:p><x:r><x:t>{{a}}</x:t></x:r></x:p></x:hdr>';
    expect(fillTags(xml, { a: 'A\nB' })).toBe(
      '<x:hdr xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:p><x:r><x:t>A</x:t><x:br/><x:t>B</x:t></x:r></x:p></x:hdr>',
    );
  });
});
