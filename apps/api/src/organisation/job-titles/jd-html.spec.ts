import { dutiesFromHtml, dutyRow, htmlFromLines, sameJdHtml, sanitizeJdHtml } from './jd-html.js';

describe('job description HTML', () => {
  describe('cleaning', () => {
    it('keeps the allowed tags: paragraphs, line breaks, bold, italic, underline and lists, nested too', () => {
      const html =
        '<p>Lead the <strong>HR</strong> team, <em>daily</em>, <u>on site</u>.<br />Second line.</p>' +
        '<ul><li>Recruitment<ul><li>Screening</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>';
      expect(sanitizeJdHtml(html)).toBe(html);
    });

    it('turns b into strong and i into em', () => {
      expect(sanitizeJdHtml('<p><b>Bold</b> and <i>italic</i></p>')).toBe('<p><strong>Bold</strong> and <em>italic</em></p>');
      expect(sanitizeJdHtml('<P><B>Shouted</B></P>')).toBe('<p><strong>Shouted</strong></p>');
    });

    it('drops scripts and styles with their content', () => {
      expect(sanitizeJdHtml('<p>Hello</p><script>alert(1)</script><style>p { color: red }</style>')).toBe('<p>Hello</p>');
      expect(sanitizeJdHtml('<img src=x onerror="alert(1)"><p>Clean</p>')).toBe('<p>Clean</p>');
    });

    it('drops every attribute but the indent: onclick, style and class go', () => {
      expect(sanitizeJdHtml('<p onclick="alert(1)" style="color: red" class="big">Text</p>')).toBe('<p>Text</p>');
      expect(sanitizeJdHtml('<strong style="font-size: 20px">Big</strong><li class="x" value="3">Item</li>')).toBe(
        '<strong>Big</strong><li>Item</li>',
      );
      expect(sanitizeJdHtml('<ol start="5" type="a"><li>Item</li></ol>')).toBe('<ol><li>Item</li></ol>');
    });

    it('keeps a paragraph’s indent only for levels 1 to 4', () => {
      expect(sanitizeJdHtml('<p data-indent="1">One</p><p data-indent="4">Four</p>')).toBe(
        '<p data-indent="1">One</p><p data-indent="4">Four</p>',
      );
      for (const bad of ['0', '5', '-1', '2.5', 'x', '', '1 onclick=alert(1)']) {
        expect(sanitizeJdHtml(`<p data-indent="${bad}">Text</p>`)).toBe('<p>Text</p>');
      }
      expect(sanitizeJdHtml('<p data-indent=" 2 ">Text</p>')).toBe('<p data-indent="2">Text</p>');
      expect(sanitizeJdHtml('<li data-indent="2">Item</li>')).toBe('<li>Item</li>'); // lists indent by nesting
    });

    it('makes divs and headings paragraphs', () => {
      expect(sanitizeJdHtml('<div>One</div><h2>Two</h2><h1 data-indent="3">Three</h1>')).toBe(
        '<p>One</p><p>Two</p><p data-indent="3">Three</p>',
      );
    });

    it('unwraps links, fonts and other tags to their text', () => {
      expect(sanitizeJdHtml('<p>See <a href="javascript:alert(1)">the policy</a>.</p>')).toBe('<p>See the policy.</p>');
      expect(sanitizeJdHtml('<p><span style="color: red"><font face="Arial">Red</font></span></p>')).toBe('<p>Red</p>');
    });

    it('escapes text, and reads entities once', () => {
      expect(sanitizeJdHtml('<p>R&D < 5 & "quoted"</p>')).toBe('<p>R&amp;D &lt; 5 &amp; "quoted"</p>');
      expect(sanitizeJdHtml('<p>R&amp;D</p>')).toBe('<p>R&amp;D</p>');
    });

    it('answers null when nothing is left to read', () => {
      for (const empty of [null, undefined, '', '   ', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '<ul><li> </li></ul>', '<script>x</script>']) {
        expect(sanitizeJdHtml(empty)).toBeNull();
      }
    });

    it('gives the same HTML when cleaned again, so a resent text is not a change', () => {
      const once = sanitizeJdHtml('<div><b>Lead</b></div><p data-indent="2" class="x">Plan<br>budget</p><ul><li>One</li></ul>');
      expect(sanitizeJdHtml(once)).toBe(once);
    });

    it('reads plain text with line breaks and no tags line by line, as the migration does', () => {
      expect(sanitizeJdHtml('Lead the team\n· Hire & train\n· Review')).toBe(
        '<p>Lead the team</p><ul><li>Hire &amp; train</li><li>Review</li></ul>',
      );
      expect(sanitizeJdHtml('One line, no tags')).toBe('One line, no tags');
    });
  });

  describe('the same text', () => {
    it('is the same whether or not list items hold their text in a paragraph, as the editor does', () => {
      const converted = '<p>Recruitment</p><ul><li>Post vacancies<ul><li>On LinkedIn</li></ul></li><li>Screen</li></ul>';
      const edited = '<p>Recruitment</p><ul><li><p>Post vacancies</p><ul><li><p>On LinkedIn</p></li></ul></li><li><p>Screen</p></li></ul>';
      expect(sameJdHtml(converted, edited)).toBe(true);
      expect(sameJdHtml(null, null)).toBe(true);
    });

    it('differs in text, formatting, paragraphs outside lists or emptiness', () => {
      const base = '<p>Recruitment</p><ul><li>Post vacancies</li></ul>';
      expect(sameJdHtml(base, '<p>Recruitment</p><ul><li>Post jobs</li></ul>')).toBe(false);
      expect(sameJdHtml(base, '<p>Recruitment</p><ul><li><strong>Post</strong> vacancies</li></ul>')).toBe(false);
      expect(sameJdHtml(base, 'Recruitment<ul><li>Post vacancies</li></ul>')).toBe(false);
      expect(sameJdHtml(base, '<p>Recruitment</p><ol><li>Post vacancies</li></ol>')).toBe(false);
      expect(sameJdHtml(base, null)).toBe(false);
    });
  });

  describe('plain lines as HTML', () => {
    it('makes each line a paragraph and bullet lines in a row one list, escaped, blank lines dropped', () => {
      const text = [
        '1. Recruitment & Onboarding',
        '· Post job vacancies on <LinkedIn>',
        '•  Screen candidates',
        '',
        '▪ Arrange interviews',
        '____',
        '2. Personnel & Attendance',
        '- Maintain records',
        '* Track attendance',
        '-----',
      ].join('\n');
      expect(htmlFromLines([text])).toBe(
        '<p>1. Recruitment &amp; Onboarding</p>' +
          '<ul><li>Post job vacancies on &lt;LinkedIn&gt;</li><li>Screen candidates</li><li>Arrange interviews</li></ul>' +
          '<p>____</p><p>2. Personnel &amp; Attendance</p>' +
          '<ul><li>Maintain records</li><li>Track attendance</li></ul><p>-----</p>',
      );
      expect(htmlFromLines(['Maintain employee files', '  ', 'Track attendance'])).toBe(
        '<p>Maintain employee files</p><p>Track attendance</p>',
      );
      expect(htmlFromLines([])).toBeNull();
      expect(htmlFromLines(['', ' '])).toBeNull();
    });
  });

  describe('duty rows', () => {
    it('are the list items and paragraphs, in order, as plain text', () => {
      const html =
        '<p>1. Recruitment &amp; Onboarding</p><ul><li>Post <strong>job</strong> vacancies</li><li><p>Screen candidates</p></li></ul>' +
        '<p>____</p><ol><li>Plan<ul><li>Budget &lt; 5%</li></ul>yearly</li></ol><p>  </p><p>Report<br />monthly</p><ul><li><p>Pay</p><p>on time</p></li></ul>';
      expect(dutiesFromHtml(html)).toEqual([
        '1. Recruitment & Onboarding',
        'Post job vacancies',
        'Screen candidates',
        'Plan yearly',
        'Budget < 5%',
        'Report monthly',
        'Pay on time',
      ]);
    });

    it('drop leading bullets and skip lines with nothing to read', () => {
      expect(dutiesFromHtml('<p>• Maintain records</p><p>· Track leave</p><p>▪ - Audit</p><li>-</li><p>— — —</p>')).toEqual([
        'Maintain records',
        'Track leave',
        'Audit',
      ]);
      expect(dutyRow('  ·  Post   job vacancies ')).toBe('Post job vacancies');
      expect(dutyRow('____')).toBeNull();
    });

    it('take text typed outside a paragraph as its own row', () => {
      expect(dutiesFromHtml('First line<div>Second</div><div><br></div><div>Third</div>')).toEqual(['First line', 'Second', 'Third']);
    });

    it('are none for no HTML', () => {
      expect(dutiesFromHtml(null)).toEqual([]);
      expect(dutiesFromHtml('<p></p>')).toEqual([]);
    });
  });
});
