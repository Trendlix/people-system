import { decodeHtml, isBlankValue, plainText, richBlocks, valueText, type RichBlock } from './rich.js';

/** A block's text, its formatted pieces marked: **bold**, _italic_, __underlined__. */
const shown = (b: RichBlock) => ({
  marker: b.marker,
  indent: b.indent,
  text: b.spans.map((s) => (s.bold ? `**${s.text}**` : s.italic ? `_${s.text}_` : s.underline ? `__${s.text}__` : s.text)).join(''),
});
const read = (html: string) => richBlocks(html).map(shown);

describe('reading a rich value', () => {
  it("reads the editor's paragraphs, bold, italic and underline, and its nested bullets as indented points", () => {
    const html =
      '<p>Leads the <strong>sales</strong> team, <em>daily</em> and <u>weekly</u>.</p>' +
      '<ul><li><p>Plans the targets</p><ul><li><p>by month</p><ul><li><p>by week</p></li></ul></li></ul></li><li><p><strong>Reports</strong> to the CEO</p></li></ul>' +
      '<p data-indent="2">An indented note</p>';
    expect(read(html)).toEqual([
      { marker: null, indent: 0, text: 'Leads the **sales** team, _daily_ and __weekly__.' },
      { marker: '•', indent: 1, text: 'Plans the targets' },
      { marker: '◦', indent: 2, text: 'by month' },
      { marker: '▪', indent: 3, text: 'by week' },
      { marker: '•', indent: 1, text: '**Reports** to the CEO' },
      { marker: null, indent: 2, text: 'An indented note' },
    ]);
  });

  it('types the numbers of a numbered list, as the web shows them: 1. 2., then a. b., then i. ii.', () => {
    const html = '<ol><li><p>One</p><ol><li><p>Sub</p></li><li><p>Sub</p><ol><li><p>Deep</p></li><li><p>Deep</p></li><li><p>Deep</p></li><li><p>Deep</p></li></ol></li></ol></li><li><p>Two</p></li></ol>';
    expect(read(html).map((b) => `${b.indent} ${b.marker} ${b.text}`)).toEqual(['1 1. One', '2 a. Sub', '2 b. Sub', '3 i. Deep', '3 ii. Deep', '3 iii. Deep', '3 iv. Deep', '1 2. Two']);
    // a bulleted list in a numbered one is bulleted, and the numbers go on after it
    expect(read('<ol><li>A<ul><li>point</li></ul></li><li>B</li></ol>').map((b) => b.marker)).toEqual(['1.', '•', '2.']);
  });

  it('reads lists as saved from plain text (no paragraph in an item), and an item’s later paragraphs in line with its text', () => {
    expect(read('<ul><li>Prepare reports</li><li>Follow up</li></ul>')).toEqual([
      { marker: '•', indent: 1, text: 'Prepare reports' },
      { marker: '•', indent: 1, text: 'Follow up' },
    ]);
    expect(read('<ul><li><p>First</p><p>more on it</p></li><li>Second<p>and more</p></li></ul>')).toEqual([
      { marker: '•', indent: 1, text: 'First' },
      { marker: null, indent: 1, text: 'more on it' },
      { marker: '•', indent: 1, text: 'Second' },
      { marker: null, indent: 1, text: 'and more' },
    ]);
  });

  it('reads whitespace as a browser does, keeps line breaks and no-break spaces, and decodes entities', () => {
    const [block] = richBlocks('<p>\n  Sales &amp; marketing&nbsp;team <br>\n   next  line &lt;b&gt; &#1605;&#x0631; </p>');
    expect(block.spans).toEqual([{ text: 'Sales & marketing team\nnext line <b> مر', bold: false, italic: false, underline: false }]);
    // one space between words across formatting (the first one's), none at a paragraph's start or end
    expect(read('<p> <strong> Bold </strong> plain <em> </em></p>')).toEqual([{ marker: null, indent: 0, text: '**Bold **plain' }]);
  });

  it('keeps blank paragraphs between others, and leaves out blank ones at the ends and empty points', () => {
    expect(read('<p></p><p> </p><p>One</p><p></p><p><br></p><p>Two</p><ul><li><p></p></li><li><p>Point</p></li></ul><p></p>')).toEqual([
      { marker: null, indent: 0, text: 'One' },
      { marker: null, indent: 0, text: '' },
      { marker: null, indent: 0, text: '' },
      { marker: null, indent: 0, text: 'Two' },
      { marker: '•', indent: 1, text: 'Point' },
    ]);
    expect(richBlocks('<p></p>')).toEqual([]);
    expect(richBlocks('')).toEqual([]);
  });

  it('reduces anything else to its text', () => {
    const html =
      '<h2>Role</h2><div>In <span style="color:red">red</span> and a <a href="https://x.test">link</a></div>' +
      '<script>alert(1)</script><style>p{}</style><!-- a comment --><table><tr><td>Cell</td></tr></table>' +
      'Loose text 1 < 2 <b>bold</b><i>italic</i><p data-indent="9">no such indent</p>';
    expect(read(html)).toEqual([
      { marker: null, indent: 0, text: 'Role' },
      { marker: null, indent: 0, text: 'In red and a link' },
      { marker: null, indent: 0, text: 'Cell' },
      { marker: null, indent: 0, text: 'Loose text 1 < 2 **bold**_italic_' },
      { marker: null, indent: 0, text: 'no such indent' },
    ]);
    // an item outside a list, and lists left open
    expect(read('<li>Alone</li><ul><li>Open<ul><li>Inner')).toEqual([
      { marker: '•', indent: 1, text: 'Alone' },
      { marker: '•', indent: 1, text: 'Open' },
      { marker: '◦', indent: 2, text: 'Inner' },
    ]);
  });

  it('decodes the named entities it knows and character references; leaves others as written', () => {
    expect(decodeHtml('&ndash; &hellip; &rsquo; &#169; &#xA9; &unknown; &#0; &#xD800;')).toBe('– … ’ © © &unknown; &#0; &#xD800;');
  });

  it('as plain text: one block a line, each point after its bullet or number', () => {
    const html = '<p>Leads the <strong>team</strong>:</p><ul><li><p>Plans</p><ul><li>by month</li></ul></li></ul><ol><li>First<br>line two</li></ol>';
    expect(plainText(richBlocks(html))).toBe('Leads the team:\n• Plans\n◦ by month\n1. First\nline two');
    expect(valueText({ html })).toBe(plainText(richBlocks(html)));
    expect(valueText('plain')).toBe('plain');
    expect(valueText(undefined)).toBe('');
  });

  it('a value is blank when it has nothing to read', () => {
    expect(isBlankValue('')).toBe(true);
    expect(isBlankValue('  ')).toBe(true);
    expect(isBlankValue(undefined)).toBe(true);
    expect(isBlankValue({ html: '<p></p><ul><li><p> </p></li></ul><p><br></p>' })).toBe(true);
    expect(isBlankValue({ html: '<p>&nbsp;</p>' })).toBe(true);
    expect(isBlankValue({ html: '<p>x</p>' })).toBe(false);
    expect(isBlankValue('x')).toBe(false);
  });
});
