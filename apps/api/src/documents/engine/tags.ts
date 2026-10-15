import { TAG_PATTERN } from '@trendlix/shared';
import { richParagraphs } from './paragraphs.js';
import { isRich, richBlocks, valueText, type TagValue } from './rich.js';
import { applyEdits, descendants, escapeText, innerText, parseXml, wordPrefix, type XmlEdit, type XmlElement } from './xml.js';

// Putting the values in place of the {{tags}} of one part (spec §8; owner's request, 15 October 2026). Word splits
// what is typed into runs whenever the formatting, the spell checker or a bookmark says so, so a tag is often spread
// over several <w:t>. Each paragraph is read as the tag reader (templates/docx-tags.ts) reads it: its <w:t> texts
// joined in order, other markup ignored, a text box's paragraphs each a paragraph of their own. The joined text keeps
// a map back to the <w:t> each character came from. For each tag found:
// - the value goes in the <w:t> where the tag's first character is, in place of the tag, so it takes that run's
//   formatting;
// - the tag's other characters are taken out of the <w:t> they are in (which may leave an empty <w:t>);
// - only the <w:t> elements changed are rewritten. A value's line breaks become <w:br/> in the same run, and
//   xml:space="preserve" is added where a rewritten text starts or ends with a space, so Word keeps it.
// A value with formatting (rich.ts: the role's duties, owner's request of 15 October 2026) on a line of its own (the
// only text of its paragraph, spaces aside) replaces the whole paragraph with its own paragraphs, bold and indented
// points kept (paragraphs.ts). Elsewhere, inside a sentence, it is put in as plain text like any other value, and so it
// is where the paragraph holds what replacing it would lose: a picture, a text box, a field, a note's or a comment's
// mark, a symbol, a content control.
// A tag without a value is left as it is: the caller checks for missing values first.

interface Text {
  el: XmlElement;
  /** Where its text starts in the paragraph's. */
  from: number;
  text: string;
}

/** The elements in a paragraph that replacing the whole paragraph would lose (by local name). */
const KEPT_IN_PLACE = new Set(
  'p drawing pict object AlternateContent fldChar fldSimple instrText footnoteReference endnoteReference commentReference sym sdt'.split(' '),
);
/** The markers moved to the first of the paragraphs replacing it (by local name): ranges that may end elsewhere. */
const MARKERS = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'permStart', 'permEnd']);
const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/** The part's XML with every tag that has a value replaced; unchanged when there is none. */
export function fillTags(xml: string, values: Readonly<Record<string, TagValue>>): string {
  if (!xml.includes('{') && !xml.includes('&#123;') && !xml.includes('&#x7')) return xml;
  const w = wordPrefix(xml);
  const P = `${w}:p`;
  const T = `${w}:t`;

  const paragraphs: { p: XmlElement; texts: XmlElement[] }[] = [];
  const collect = (el: XmlElement, paragraph: XmlElement[] | null) => {
    for (const child of el.children) {
      if (child.name === P) {
        const own: XmlElement[] = [];
        paragraphs.push({ p: child, texts: own });
        collect(child, own);
      } else if (child.name === T) {
        if (paragraph && !child.empty) paragraph.push(child);
      } else {
        collect(child, paragraph);
      }
    }
  };
  collect(parseXml(xml), null);

  const edits: XmlEdit[] = [];
  for (const { p, texts: elements } of paragraphs) {
    let from = 0;
    const texts: Text[] = elements.map((el) => {
      const text = innerText(xml, el);
      const t = { el, from, text };
      from += text.length;
      return t;
    });
    const joined = texts.map((t) => t.text).join('');
    const found = [...joined.matchAll(new RegExp(TAG_PATTERN.source, 'g'))].filter((m) => Object.hasOwn(values, m[1]));
    if (!found.length) continue;

    // a rich value alone on its line: the paragraph is replaced
    const only = found.length === 1 ? found[0] : null;
    const value = only ? values[only[1]] : undefined;
    if (only && value !== undefined && isRich(value) && !joined.slice(0, only.index).trim() && !joined.slice(only.index + only[0].length).trim()) {
      const blocks = richBlocks(value.html);
      if (blocks.length && replaceable(p, w)) {
        const run = texts.find((t) => only.index < t.from + t.text.length)?.el.parent;
        const own = (el: XmlElement | null | undefined, name: string) => el?.children.find((c) => c.name === `${w}:${name}`);
        const pPr = own(p, 'pPr');
        const rPr = run?.name === `${w}:r` ? own(run, 'rPr') : undefined;
        const markers = [...descendants(p)].filter((el) => el.name.startsWith(`${w}:`) && MARKERS.has(localName(el.name)));
        const paragraphsXml = richParagraphs(blocks, {
          w,
          startTag: xml.slice(p.start, p.openEnd),
          pPr: pPr ? xml.slice(pPr.start, pPr.end) : null,
          rPr: rPr ? xml.slice(rPr.start, rPr.end) : null,
          markers: markers.map((el) => xml.slice(el.start, el.end)).join(''),
        });
        edits.push({ start: p.start, end: p.end, text: paragraphsXml });
        continue;
      }
    }

    const matches = found.map((m) => ({ start: m.index, end: m.index + m[0].length, value: valueText(values[m[1]]) }));

    for (const t of texts) {
      const to = t.from + t.text.length;
      const touching = matches.filter((m) => m.start < to && m.end > t.from);
      if (!touching.length) continue;
      // the text kept, and each value starting here, in order
      const pieces: { text: string; value: boolean }[] = [];
      let at = t.from;
      for (const m of touching) {
        if (m.start > at) pieces.push({ text: joined.slice(at, m.start), value: false });
        if (m.start >= t.from) pieces.push({ text: m.value, value: true });
        at = Math.max(at, m.end);
      }
      if (at < to) pieces.push({ text: joined.slice(at, to), value: false });
      edits.push({ start: t.el.start, end: t.el.end, text: rewrite(xml, t.el, pieces, w) });
    }
  }
  return applyEdits(xml, edits);
}

/** Whether the paragraph can be replaced as a whole: it holds nothing that would be lost (see KEPT_IN_PLACE). */
function replaceable(p: XmlElement, w: string): boolean {
  if (p.empty) return false;
  for (const el of descendants(p)) {
    const local = localName(el.name);
    if (KEPT_IN_PLACE.has(local) && (el.name.startsWith(`${w}:`) || local === 'AlternateContent')) return false;
  }
  return true;
}

const LINE_BREAK = /\r\n|\r|\n/;
const EDGE_SPACE = /^[ \t\r\n]|[ \t\r\n]$/;

/** A <w:t> holding these pieces: a value's line breaks become <w:br/> between <w:t> elements of the same run. */
function rewrite(xml: string, el: XmlElement, pieces: readonly { text: string; value: boolean }[], w: string): string {
  const lines = [''];
  for (const piece of pieces) {
    const [first, ...rest] = piece.value ? piece.text.split(LINE_BREAK) : [piece.text];
    lines[lines.length - 1] += first;
    lines.push(...rest);
  }
  const startTag = xml.slice(el.start, el.openEnd);
  const preserving = withPreserve(startTag);
  return lines
    .map((line) => `${EDGE_SPACE.test(line) ? preserving : startTag}${escapeText(line)}</${w}:t>`)
    .join(`<${w}:br/>`);
}

/** The start tag with xml:space="preserve". */
function withPreserve(startTag: string): string {
  if (/\sxml:space\s*=\s*["']preserve["']/.test(startTag)) return startTag;
  if (/\sxml:space\s*=/.test(startTag)) return startTag.replace(/(\sxml:space\s*=\s*)(["'])[^"']*\2/, '$1"preserve"');
  return startTag.replace(/\s*>$/, ' xml:space="preserve">');
}
