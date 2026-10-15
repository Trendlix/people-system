import { paragraphTexts } from '../../templates/docx-tags.js';
import type { TagValue } from './rich.js';
import { fillTags } from './tags.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
/** A part holding these paragraphs, and the paragraphs back out of it. */
const part = (body: string) => `<w:document ${W}><w:body>${body}</w:body></w:document>`;
const fill = (body: string, values: Record<string, TagValue>) => {
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

describe('putting a value with formatting in place of a tag', () => {
  const DUTIES = '<p>Leads the <strong>sales</strong> team.</p><ul><li><p>Plans the <em>targets</em></p><ul><li><p>by month</p></li></ul></li></ul>';
  const pPr = '<w:pPr><w:pStyle w:val="Body"/><w:spacing w:after="120"/><w:jc w:val="both"/><w:rPr><w:sz w:val="24"/></w:rPr></w:pPr>';
  const rPr = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="1F3864"/><w:sz w:val="22"/></w:rPr>';
  /** The runs' formatting with these added where the schema puts them. */
  const runWith = (...added: ('b' | 'i' | 'u' | 'rtl')[]) =>
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>' +
    (added.includes('b') ? '<w:b/><w:bCs/>' : '') +
    (added.includes('i') ? '<w:i/><w:iCs/>' : '') +
    '<w:color w:val="1F3864"/><w:sz w:val="22"/>' +
    (added.includes('u') ? '<w:u w:val="single"/>' : '') +
    (added.includes('rtl') ? '<w:rtl/>' : '') +
    '</w:rPr>';

  it("replaces a paragraph holding only the tag with the value's paragraphs, each with its paragraph's and run's formatting", () => {
    const body = `<w:p w:rsidR="00A1">${pPr}<w:r>${rPr}<w:t xml:space="preserve">  {{job_duties}} </w:t></w:r></w:p>`;
    expect(fill(body, { job_duties: { html: DUTIES } })).toBe(
      `<w:p w:rsidR="00A1">${pPr}` +
        `<w:r>${runWith()}<w:t xml:space="preserve">Leads the </w:t></w:r>` +
        `<w:r>${runWith('b')}<w:t>sales</w:t></w:r>` +
        `<w:r>${runWith()}<w:t xml:space="preserve"> team.</w:t></w:r></w:p>` +
        // a point: indented half an inch, its bullet typed and hanging before its text
        `<w:p>${pPr.replace('<w:jc', '<w:ind w:left="720" w:hanging="360"/><w:jc')}` +
        `<w:r>${runWith()}<w:t>•</w:t><w:tab/></w:r>` +
        `<w:r>${runWith()}<w:t xml:space="preserve">Plans the </w:t></w:r>` +
        `<w:r>${runWith('i')}<w:t>targets</w:t></w:r></w:p>` +
        // a point under it: one more level in
        `<w:p>${pPr.replace('<w:jc', '<w:ind w:left="1440" w:hanging="360"/><w:jc')}` +
        `<w:r>${runWith()}<w:t>◦</w:t><w:tab/></w:r>` +
        `<w:r>${runWith()}<w:t>by month</w:t></w:r></w:p>`,
    );
    // read back: one paragraph each, no tag left
    expect(paragraphTexts(part(fill(body, { job_duties: { html: DUTIES } })))).toEqual(['Leads the sales team.', '•Plans the targets', '◦by month']);
  });

  it('takes the formatting of the run the tag starts in when Word split it, and replaces the paragraph all the same', () => {
    const body = `<w:p><w:r>${rPr}<w:t>{{job_</w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:i/></w:rPr><w:t>duties}}</w:t></w:r></w:p>`;
    expect(fill(body, { job_duties: { html: '<p><u>Underlined</u> text</p>' } })).toBe(
      `<w:p><w:r>${runWith('u')}<w:t>Underlined</w:t></w:r><w:r>${rPr}<w:t xml:space="preserve"> text</w:t></w:r></w:p>`,
    );
  });

  it('indents a paragraph by its level from where the template paragraph starts, and a point with its bullet hanging', () => {
    const indented = '<w:pPr><w:ind w:left="200" w:right="100" w:firstLine="300"/></w:pPr>';
    const out = fill(`<w:p>${indented}<w:r><w:t>{{job_duties}}</w:t></w:r></w:p>`, { job_duties: { html: '<p>Plain</p><p data-indent="2">Two levels</p><ol><li>First</li></ol>' } });
    const props = [...out.matchAll(/<w:pPr>.*?<\/w:pPr>/g)].map((m) => m[0]);
    expect(props).toEqual([
      indented, // as it was
      '<w:pPr><w:ind w:right="100" w:firstLine="300" w:left="1640"/></w:pPr>',
      '<w:pPr><w:ind w:right="100" w:left="920" w:hanging="360"/></w:pPr>', // the first line hangs instead
    ]);
    expect(paragraphTexts(part(out))).toEqual(['Plain', 'Two levels', '1.First']);
  });

  it('makes a paragraph with Arabic in it right to left', () => {
    const out = fill(`<w:p>${pPr}<w:r>${rPr}<w:t>{{job_duties}}</w:t></w:r></w:p>`, { job_duties: { html: '<p>قيادة <strong>فريق</strong> المبيعات</p><ul><li>Reports in English</li></ul>' } });
    expect(out).toBe(
      `<w:p>${pPr.replace('<w:spacing', '<w:bidi/><w:spacing')}` +
        `<w:r>${runWith('rtl')}<w:t xml:space="preserve">قيادة </w:t></w:r>` +
        `<w:r>${runWith('b', 'rtl')}<w:t>فريق</w:t></w:r>` +
        `<w:r>${runWith('rtl')}<w:t xml:space="preserve"> المبيعات</w:t></w:r></w:p>` +
        // a point with no Arabic stays as the template's paragraph is
        `<w:p>${pPr.replace('<w:jc', '<w:ind w:left="720" w:hanging="360"/><w:jc')}<w:r>${runWith()}<w:t>•</w:t><w:tab/></w:r><w:r>${runWith()}<w:t>Reports in English</w:t></w:r></w:p>`,
    );
  });

  it("keeps a line break in the value as Word's, and leaves Word's numbering, tracked changes and a section break to the right paragraph", () => {
    const props =
      '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:sectPr><w:pgSz w:w="11906"/></w:sectPr>' +
      '<w:pPrChange w:id="1" w:author="HR"><w:pPr/></w:pPrChange></w:pPr>';
    const out = fill(`<w:p>${props}<w:r><w:rPr><w:b/><w:rPrChange w:id="2" w:author="HR"><w:rPr/></w:rPrChange></w:rPr><w:t>{{job_duties}}</w:t></w:r></w:p>`, {
      job_duties: { html: '<p>One<br>line two</p><p>Two</p>' },
    });
    expect(out).toBe(
      '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>One</w:t><w:br/><w:t>line two</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Two</w:t></w:r></w:p>',
    );
  });

  it('keeps bookmarks and comment ranges, in the first paragraph; a blank paragraph between others stays a blank line', () => {
    const body = '<w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:commentRangeStart w:id="5"/><w:r><w:t>{{job_duties}}</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>';
    expect(fill(body, { job_duties: { html: '<p>A</p><p></p><p>B</p>' } })).toBe(
      '<w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:commentRangeStart w:id="5"/><w:bookmarkEnd w:id="0"/><w:r><w:t>A</w:t></w:r></w:p>' +
        '<w:p></w:p>' +
        '<w:p><w:r><w:t>B</w:t></w:r></w:p>',
    );
  });

  it('inside a sentence, puts the value in as plain text: its blocks a line each, a point after its bullet', () => {
    const body = `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">Your duties: {{job_duties}}. Thank you.</w:t></w:r></w:p>`;
    expect(fill(body, { job_duties: { html: DUTIES } })).toBe(
      `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">Your duties: Leads the sales team.</w:t><w:br/><w:t xml:space="preserve">• Plans the targets</w:t><w:br/>` +
        '<w:t xml:space="preserve">◦ by month. Thank you.</w:t></w:r></w:p>',
    );
    // two tags on the line: both as text
    expect(fill('<w:p><w:r><w:t>{{job_duties}}{{job_title}}</w:t></w:r></w:p>', { job_duties: { html: '<p><strong>Sells</strong></p>' }, job_title: ' (Sales)' })).toBe(
      '<w:p><w:r><w:t>Sells (Sales)</w:t></w:r></w:p>',
    );
  });

  it('puts it in as plain text where replacing the paragraph would lose something: a picture, a field, a text box', () => {
    const picture = '<w:r><w:drawing><wp:inline/></w:drawing></w:r>';
    expect(fill(`<w:p>${picture}<w:r><w:t>{{job_duties}}</w:t></w:r></w:p>`, { job_duties: { html: '<p>A</p><ul><li>B</li></ul>' } })).toBe(
      `<w:p>${picture}<w:r><w:t>A</w:t><w:br/><w:t>• B</w:t></w:r></w:p>`,
    );
    const field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    expect(fill(`<w:p><w:r><w:t>{{job_duties}}</w:t></w:r>${field}</w:p>`, { job_duties: { html: '<p>A</p>' } })).toBe(`<w:p><w:r><w:t>A</w:t></w:r>${field}</w:p>`);
    // a text box's own paragraph is replaced; the paragraph holding the box keeps it
    const box = (inner: string) => `<w:r><w:drawing><w:txbxContent>${inner}</w:txbxContent></w:drawing></w:r>`;
    expect(fill(`<w:p>${box('<w:p><w:r><w:t>{{job_duties}}</w:t></w:r></w:p>')}</w:p>`, { job_duties: { html: '<p>A</p><p>B</p>' } })).toBe(
      `<w:p>${box('<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>')}</w:p>`,
    );
  });

  it('an empty value takes the tag out and leaves the paragraph, as an empty text does', () => {
    const body = `<w:p>${pPr}<w:r>${rPr}<w:t>{{job_duties}}</w:t></w:r></w:p>`;
    expect(fill(body, { job_duties: { html: '<p></p>' } })).toBe(`<w:p>${pPr}<w:r>${rPr}<w:t></w:t></w:r></w:p>`);
    expect(fill(body, { job_duties: { html: '' } })).toBe(fill(body, { job_duties: '' }));
  });

  it('escapes the text and leaves out characters XML cannot hold', () => {
    expect(fill('<w:p><w:r><w:t>{{job_duties}}</w:t></w:r></w:p>', { job_duties: { html: '<p>R&amp;D &lt;team&gt; "x"\u0001</p>' } })).toBe(
      '<w:p><w:r><w:t>R&amp;D &lt;team&gt; "x"</w:t></w:r></w:p>',
    );
  });
});
