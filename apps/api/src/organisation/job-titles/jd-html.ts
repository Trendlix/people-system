import sanitizeHtml from 'sanitize-html';

// A job title's job description (its purpose, duties and requirements) is simple rich text, like an email composer
// (owner's request, 15 October 2026: "allow me to format the text (bold, indent, etc.), not full format, keep the mail
// system format", and "don't auto number"): bold, italic, underline, bulleted and numbered lists (nested lists for
// indenting), paragraphs indented by level, and line breaks. No fonts, colours, sizes, headings, links or images.
// Saved as HTML, cleaned here and only here, whatever the editor or a paste from Word sends.

/** The most a field may hold once cleaned, formatting included. */
export const JD_HTML_MAX = 20_000;
/** The most that is cleaned at all: anything longer is refused as it is, without reading it. */
export const JD_HTML_RAW_MAX = 200_000;

const LINE_BREAK = /\r\n|\r|\n/;
/** A bullet starting a line of plain text, and the space after it. */
const BULLET = /^[•·▪*-]\s*/;
/** A line of plain text that is a bullet point: a bullet, then text (so "-----" or "**" stay paragraphs). */
const BULLET_LINE = /^[•·▪*-]\s*[^•·▪*\s-]/;
/** Bullets at the start of a duty, typed or pasted. */
const LEADING_BULLETS = /^[\s•·▪◦‣⁃●○■□*\-–—]+/;
/** In cleaned HTML: a tag (whether it closes, and its name), or a run of text. */
const TOKEN = /<(\/?)([a-z]+)[^>]*>|([^<]+)/g;
const BLOCKS = new Set(['p', 'li', 'ul', 'ol']);

/** A paragraph keeps its indent when it is a level from 1 to 4, and no other attribute. */
const paragraph: sanitizeHtml.Transformer = (_tag, attribs) => {
  const indent = attribs['data-indent']?.trim();
  const kept: sanitizeHtml.Attributes = indent && /^[1-4]$/.test(indent) ? { 'data-indent': indent } : {};
  return { tagName: 'p', attribs: kept };
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li'],
  allowedAttributes: { p: ['data-indent'] },
  transformTags: {
    b: 'strong',
    i: 'em',
    p: paragraph,
    div: paragraph,
    h1: paragraph,
    h2: paragraph,
    h3: paragraph,
    h4: paragraph,
    h5: paragraph,
    h6: paragraph,
  },
  // every other tag goes and its text stays (a link becomes its words), except these, whose content goes too
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'xmp', 'noscript', 'template', 'title', 'head'],
};

/**
 * A job description field as it is saved: only the allowed HTML (`p`, with a `data-indent` of 1 to 4 or none, `br`,
 * `strong`, `em`, `u`, `ul`, `ol`, `li`), or null when nothing is left to read (e.g. `<p></p>`). Text with line breaks
 * and no tags at all (an older caller's plain text) is read line by line, as the migration of 15 October 2026 read
 * what was saved before.
 */
export function sanitizeJdHtml(input: string | null | undefined): string | null {
  if (input == null) return null;
  const source = isPlainText(input) ? linesToHtml(input.split(LINE_BREAK)) : input;
  const html = sanitizeHtml(source, OPTIONS).trim();
  return textOf(html).trim() ? html : null;
}

/**
 * Whether two cleaned texts say the same thing: equal, or equal but for the paragraphs inside list items. The web's
 * editor holds each item's text in one (`<li><p>…</p></li>`), while lists converted from plain text have none
 * (`<li>…</li>`), so opening a job description and saving it unchanged is not a new version of it.
 */
export function sameJdHtml(a: string | null, b: string | null): boolean {
  return a === b || (a !== null && b !== null && withoutItemParagraphs(a) === withoutItemParagraphs(b));
}

/**
 * Lines of plain text as saved HTML, the way the migration of 15 October 2026 converted what was saved before: each
 * non-empty line a paragraph, and lines in a row that start with a bullet (•, ·, ▪, -, *) one bulleted list, the
 * bullets removed. Blank lines are dropped. Null when no line has text.
 */
export function htmlFromLines(lines: string[]): string | null {
  return sanitizeJdHtml(linesToHtml(lines));
}

/**
 * The duties as rows (KPIs will be linked to them later), read from the duties' HTML: each list item and each
 * paragraph, in order, as plain text. A list item's text leaves out the lists nested in it, whose items are rows of
 * their own; a line break, or a paragraph break inside a list item, is a space. See `dutyRow` for what is trimmed and skipped.
 */
export function dutiesFromHtml(html: string | null): string[] {
  const clean = sanitizeJdHtml(html);
  if (!clean) return [];
  const items: string[] = [];
  const open: { tag: string; item: number | null }[] = []; // the tags open now, and the item each one started
  let loose: number | null = null; // text outside any paragraph or list item, e.g. a first line typed without one
  const newItem = () => items.push('') - 1;
  const current = () => open.findLast((o) => o.item !== null)?.item ?? null;

  for (const [, closing, tag, text] of clean.matchAll(TOKEN)) {
    if (text !== undefined) {
      let item = current();
      if (item === null) item = loose ?? (loose = newItem());
      items[item] += decode(text);
    } else if (tag === 'br') {
      const item = current() ?? loose;
      if (item !== null) items[item] += ' ';
    } else {
      if (BLOCKS.has(tag)) {
        loose = null;
        const item = current(); // e.g. two paragraphs in one list item: their words stay apart
        if (item !== null) items[item] += ' ';
      }
      if (closing) {
        const at = open.map((o) => o.tag).lastIndexOf(tag);
        if (at >= 0) open.length = at;
      } else {
        const starts = tag === 'li' || (tag === 'p' && !open.some((o) => o.tag === 'li'));
        open.push({ tag, item: starts ? newItem() : null });
      }
    }
  }
  return items.map(dutyRow).filter((d): d is string => d !== null);
}

/**
 * One duty as its row says it: whitespace collapsed and trimmed, leading bullets (• · ▪ ◦ - * – …) removed; null when
 * nothing is left to read, e.g. a line of underscores between sections. Also how the rows saved before 15 October 2026
 * (one per line, bullets typed in) compare with the rows read from the duties' HTML.
 */
export function dutyRow(text: string): string | null {
  const row = text.replace(/\s+/g, ' ').replace(LEADING_BULLETS, '').trim();
  return /[\p{L}\p{N}]/u.test(row) ? row : null;
}

function linesToHtml(lines: string[]): string {
  let html = '';
  let inList = false;
  for (const line of lines.flatMap((l) => l.split(LINE_BREAK)).map((l) => l.trim())) {
    if (!line) continue;
    const bulleted = BULLET_LINE.test(line);
    if (bulleted && !inList) html += '<ul>';
    if (!bulleted && inList) html += '</ul>';
    inList = bulleted;
    html += bulleted ? `<li>${escape(line.replace(BULLET, ''))}</li>` : `<p>${escape(line)}</p>`;
  }
  return inList ? `${html}</ul>` : html;
}

function withoutItemParagraphs(html: string): string {
  const open: string[] = [];
  let out = '';
  for (const [token, closing, tag] of html.matchAll(TOKEN)) {
    if (tag && tag !== 'br') {
      if (!closing) open.push(tag);
      else if (open.includes(tag)) open.length = open.lastIndexOf(tag);
    }
    if (tag === 'p' && open.includes('li')) continue;
    out += token;
  }
  return out;
}

/** No tags at all, and more than one line. */
function isPlainText(input: string): boolean {
  return LINE_BREAK.test(input) && !/<[a-z!/?]/i.test(input);
}

/** The text of cleaned HTML, entities read. */
function textOf(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ''));
}

/** Cleaned HTML escapes only these. */
function decode(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
