import { describe, expect, it } from 'vitest';
import { indentFromMargin, isBlankRichText, richTextValue, sanitizeRichText, wordListItem } from './rich-text';

describe('rich text as it is shown', () => {
  it('keeps what the editor writes as it is', () => {
    const html =
      '<p><strong>Employee Relations</strong></p><ul><li><p>Act as the <em>first</em> point of <u>contact</u>.</p>' +
      '<ul><li><p>Handle concerns.</p></li></ul></li></ul><ol><li><p>One</p></li></ol><p data-indent="2">Line<br>break</p>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('drops other tags and every attribute but a paragraph’s indent, and keeps the text', () => {
    expect(
      sanitizeRichText('<h1 class="x">Title</h1><p style="color:red" data-indent="3" onclick="alert(1)">A <a href="javascript:alert(1)">link</a></p>'),
    ).toBe('Title<p data-indent="3">A link</p>');
    expect(sanitizeRichText('<P DATA-INDENT=2>Up</P><p data-indent="5">Too far</p><li data-indent="1">x</li>')).toBe(
      '<p data-indent="2">Up</p><p>Too far</p><li>x</li>',
    );
  });

  it('drops scripts, styles and comments with what is in them', () => {
    expect(sanitizeRichText('<p>a</p><script>alert(1)</script><style>p{}</style><!-- note --><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(sanitizeRichText('<p>a</p><script>alert(1)')).toBe('<p>a</p>');
  });

  it('shows a < or > that is not an allowed tag as text', () => {
    expect(sanitizeRichText('<p>1 < 2 > 0 &amp; <img src=x onerror=alert(1)></p>')).toBe('<p>1 &lt; 2 &gt; 0 &amp; </p>');
    expect(sanitizeRichText('<p title="a>b">x</p>')).toBe('<p>b"&gt;x</p>');
  });

  it('closes every tag in order, so nothing spills out', () => {
    expect(sanitizeRichText('<p><strong>bold')).toBe('<p><strong>bold</strong></p>');
    expect(sanitizeRichText('<ul><li><em>a</li><li>b</ul>')).toBe('<ul><li><em>a</em></li><li>b</li></ul>');
    expect(sanitizeRichText('</strong></p>text</ul>')).toBe('text');
    // a paragraph or a list does not start inside a paragraph or formatting; a list item ends the one before it
    expect(sanitizeRichText('<p><strong>a<ul><li>b<li>c</ul>')).toBe('<p><strong>a</strong></p><ul><li>b</li><li>c</li></ul>');
    expect(sanitizeRichText('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe('<ul><li>a<ul><li>b</li></ul></li></ul>');
  });
});

describe('an empty field', () => {
  it('is nothing to read', () => {
    for (const html of [null, undefined, '', '<p></p>', '<p> </p>', '<p>&nbsp;<br></p>', '<ul><li><p></p></li></ul>']) {
      expect(isBlankRichText(html)).toBe(true);
    }
    expect(isBlankRichText('<p>x</p>')).toBe(false);
  });

  it('is sent as "", and anything else as it is', () => {
    expect(richTextValue('<p></p>')).toBe('');
    expect(richTextValue('<p><strong>Duties</strong></p>')).toBe('<p><strong>Duties</strong></p>');
  });
});

describe('pasting from Word or Google Docs', () => {
  it('reads an indent from the left margin, in steps of half an inch', () => {
    expect(indentFromMargin('36pt')).toBe(1);
    expect(indentFromMargin('.5in')).toBe(1);
    expect(indentFromMargin('1.0in')).toBe(2);
    expect(indentFromMargin('40px')).toBe(1);
    expect(indentFromMargin('108pt')).toBe(3);
    expect(indentFromMargin('5in')).toBe(4);
    expect(indentFromMargin('0in')).toBe(0);
    expect(indentFromMargin('')).toBe(0);
    expect(indentFromMargin('-36pt')).toBe(0);
  });

  it('tells Word’s list paragraphs apart, and numbered lists from bulleted ones', () => {
    expect(wordListItem("text-indent:-.25in;mso-list:l0 level1 lfo1", '·')).toEqual({ list: 'l0', level: 1, ordered: false });
    expect(wordListItem('mso-list:l2 level2 lfo3', 'o')).toEqual({ list: 'l2', level: 2, ordered: false });
    expect(wordListItem('mso-list: l1 level1 lfo2', '1.  ')).toEqual({ list: 'l1', level: 1, ordered: true });
    expect(wordListItem('mso-list:l1 level3 lfo2', 'iv.')).toEqual({ list: 'l1', level: 3, ordered: true });
    expect(wordListItem('mso-list:l1 level2 lfo2', 'a)')).toEqual({ list: 'l1', level: 2, ordered: true });
    expect(wordListItem('margin-left:.5in', '·')).toBeNull();
  });
});
