// Values with formatting (owner's request, 15 October 2026: the selected role's duties and responsibilities on its job
// offer, keeping the formatting they were written with: bold, indented points, no auto-numbering). A rich value is a
// job description field's HTML as the API saves it (organisation/job-titles/jd-html.ts): paragraphs (`p`, indented by
// a `data-indent` of 1 to 4), line breaks (`br`), bold (`strong`), italic (`em`), underline (`u`), and bulleted and
// numbered lists (`ul`, `ol`, `li`), nested to indent points. It is read here into blocks, each a paragraph or a list
// item, which the tag filler (tags.ts) prints as Word paragraphs, or as plain text inside a sentence.
// - A list item's bullet or number is typed text, as the web shows it (globals.css .rich-text): •, then ◦ for a point
//   under a point, then ▪; 1. 2. …, then a. b. …, then i. ii. … — never Word's numbering, which renumbers on its own.
// - Whitespace is read as a browser reads it: runs of spaces and line breaks are one space, and none at a paragraph's
//   start or end. A blank paragraph between others is kept (a blank line the author typed); blank ones at the start or
//   end, and empty list items, are left out.
// - Anything else is reduced to its text: an unknown tag is dropped and its words kept (a script's or a style's
//   dropped with it), a heading or a div is a paragraph, entities are decoded.

/** A value with formatting: a job description field's saved HTML. */
export interface RichValue {
  html: string;
}

/** What a tag is filled in with: plain text, or a value with formatting. */
export type TagValue = string | RichValue;

/** A piece of a block's text and its formatting. "\n" in the text is a line break. */
export interface RichSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** A paragraph or a list item. */
export interface RichBlock {
  /** A list item's bullet or number as printed ("•", "◦", "▪", "1.", "a.", "iv."); null for a paragraph. */
  marker: string | null;
  /**
   * How far it is indented, in levels: a paragraph's data-indent (0 to 4), a list item's nesting (1 for a point of a
   * top-level list), and a list item's later paragraphs that of their item, so they line up with its text.
   */
  indent: number;
  spans: RichSpan[];
}

export const isRich = (value: TagValue): value is RichValue => typeof value !== 'string';

/** A value as plain text: a rich value's blocks one per line, a list item after its bullet or number. */
export function valueText(value: TagValue | undefined): string {
  if (value === undefined) return '';
  return isRich(value) ? plainText(richBlocks(value.html)) : value;
}

/** Whether a value has nothing to print. */
export const isBlankValue = (value: TagValue | undefined): boolean => !valueText(value).trim();

/** Blocks as plain text: one per line, a list item after its bullet or number and a space. */
export function plainText(blocks: readonly RichBlock[]): string {
  return blocks.map((b) => (b.marker ? `${b.marker} ` : '') + b.spans.map((s) => s.text).join('')).join('\n');
}

/** The text of a block, line breaks included. */
export const blockText = (block: RichBlock): string => block.spans.map((s) => s.text).join('');

/** Paragraphs of these names, as jd-html.ts turns them into `p` when it saves. */
const PARAGRAPHS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Other tags that start and end a block of their own. */
const BREAKS = new Set(['blockquote', 'section', 'article', 'header', 'footer', 'table', 'tr', 'pre', 'address', 'figure', 'dl', 'dt', 'dd', 'hr']);
const MARKS: Record<string, 'bold' | 'italic' | 'underline'> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline' };
/** Tags whose content isn't text to print. */
const HIDDEN = /<(script|style|head|title|template|textarea|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
/** A comment (to its end, or the end), a tag (closing or not, its name and attributes), a doctype or the like, text, or a "<" that starts nothing. */
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<[!?][^>]*>|([^<]+)|(<)/g;
const INDENT = /\bdata-indent\s*=\s*(?:"\s*([1-4])\s*"|'\s*([1-4])\s*'|([1-4])(?![^\s/]))/i;
/** What a browser collapses: not the no-break space. */
const COLLAPSIBLE = /[ \t\n\r\f]+/g;

/** The blocks of a rich value's HTML, in order. */
export function richBlocks(html: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const lists: { ordered: boolean; count: number }[] = [];
  // the list items open, innermost last: each one's block, how many lists it is in, and whether its first paragraph is
  // still to come
  const items: { block: RichBlock; depth: number; fresh: boolean }[] = [];
  const marks = { bold: 0, italic: 0, underline: 0 };
  // the block text goes in now; none between blocks (in an object: the helpers below change it)
  const at: { block: RichBlock | null } = { block: null };

  const start = (indent: number, marker: string | null = null): RichBlock => {
    const block: RichBlock = { marker, indent, spans: [] };
    blocks.push(block);
    at.block = block;
    return block;
  };
  // where text with no paragraph of its own goes: a list item's later paragraph, a paragraph at the list's level, or
  // a paragraph
  const here = (): RichBlock => at.block ?? start(items.length ? items[items.length - 1].block.indent : lists.length);
  const endBlock = () => {
    at.block = null;
    if (items.length) items[items.length - 1].fresh = false;
  };
  const add = (text: string) => {
    const block = here();
    const spans = block.spans;
    const last = spans[spans.length - 1];
    const before = last?.text.at(-1);
    // one space between words, none at the start of the paragraph or of a line
    if (text.startsWith(' ') && (before === undefined || before === ' ' || before === '\n')) text = text.slice(1);
    if (text === '\n' && last?.text.endsWith(' ')) last.text = last.text.slice(0, -1);
    if (!text) return;
    const format = { bold: marks.bold > 0, italic: marks.italic > 0, underline: marks.underline > 0 };
    if (last && last.bold === format.bold && last.italic === format.italic && last.underline === format.underline) last.text += text;
    else spans.push({ text, ...format });
  };

  for (const m of html.replace(HIDDEN, '').matchAll(TOKEN)) {
    const [, closing, rawName, attributes, text, stray] = m;
    if (text !== undefined || stray !== undefined) {
      const words = decodeHtml(text ?? stray).replace(COLLAPSIBLE, ' ');
      if (at.block === null && !words.trim()) continue; // the spaces between blocks
      add(words);
      continue;
    }
    if (rawName === undefined) continue; // comment, doctype
    const name = rawName.toLowerCase();

    if (MARKS[name]) {
      const mark = MARKS[name];
      if (!closing) marks[mark]++;
      else if (marks[mark] > 0) marks[mark]--;
    } else if (name === 'br') {
      add('\n');
    } else if (PARAGRAPHS.has(name)) {
      if (closing) {
        endBlock();
      } else {
        const item = items[items.length - 1];
        if (item?.fresh && at.block === item.block && !item.block.spans.length) {
          item.fresh = false; // the item's own first paragraph: its text follows the bullet
        } else {
          // a paragraph's indent counts only outside lists (the editor indents only those)
          const indent = INDENT.exec(attributes ?? '');
          start(item ? item.block.indent : lists.length ? lists.length : Number(indent?.[1] ?? indent?.[2] ?? indent?.[3] ?? 0));
          if (item) item.fresh = false;
        }
      }
    } else if (name === 'ul' || name === 'ol') {
      if (closing) {
        const index = lists.findLastIndex((l) => l.ordered === (name === 'ol'));
        if (index >= 0) lists.length = index;
        while (items.length && items[items.length - 1].depth > lists.length) items.pop(); // its items not closed
      } else {
        lists.push({ ordered: name === 'ol', count: 0 });
      }
      endBlock();
    } else if (name === 'li') {
      if (closing) {
        items.pop();
        at.block = null;
      } else {
        while (items.length && items[items.length - 1].depth >= lists.length) items.pop(); // an item not closed before the next one
        const list = lists[lists.length - 1];
        const block = start(Math.max(1, lists.length), marker(lists, list ? ++list.count : 1));
        items.push({ block, depth: lists.length, fresh: true });
      }
    } else if (BREAKS.has(name)) {
      endBlock();
    }
  }
  return tidy(blocks);
}

/** A list item's bullet or number, as the web shows it: by how many lists of its kind it is in. */
function marker(lists: readonly { ordered: boolean }[], n: number): string {
  const list = lists[lists.length - 1];
  if (!list?.ordered) {
    const depth = lists.filter((l) => !l.ordered).length;
    return depth <= 1 ? '•' : depth === 2 ? '◦' : '▪';
  }
  const depth = lists.filter((l) => l.ordered).length;
  return `${depth <= 1 ? n : depth === 2 ? letters(n) : roman(n)}.`;
}

/** 1 → a, 26 → z, 27 → aa. */
function letters(n: number): string {
  let out = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
  return out;
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/** 4 → iv. */
function roman(n: number): string {
  let out = '';
  let k = n;
  for (const [value, digits] of ROMAN) for (; k >= value; k -= value) out += digits;
  return out;
}

/** Each block without spaces at its end or around its line breaks; blank blocks left out but blank paragraphs between others. */
function tidy(blocks: RichBlock[]): RichBlock[] {
  for (const block of blocks) {
    for (const span of block.spans) span.text = span.text.replace(/ +\n/g, '\n').replace(/\n +/g, '\n');
    const last = block.spans[block.spans.length - 1];
    if (last) last.text = last.text.replace(/ +$/, '');
    block.spans = block.spans.filter((s) => s.text !== '');
  }
  const blank = (b: RichBlock) => !blockText(b).trim();
  const first = blocks.findIndex((b) => !blank(b));
  if (first < 0) return [];
  const last = blocks.findLastIndex((b) => !blank(b));
  return blocks
    .slice(first, last + 1)
    .filter((b) => !(blank(b) && b.marker !== null))
    .map((b) => (blank(b) ? { ...b, spans: [] } : b));
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  times: '×',
  divide: '÷',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
  shy: '­',
  zwnj: '‌',
  zwj: '‍',
  lrm: '‎',
  rlm: '‏',
};

/** HTML's entities: the named ones above, and character references (&#1575; &#x627;). Any other is left as written. */
export function decodeHtml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:([a-zA-Z][a-zA-Z0-9]*)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (whole, named?: string, dec?: string, hex?: string) => {
    if (named) return HTML_ENTITIES[named] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}
