import { decodeEntities } from '../../templates/docx-tags.js';

// Just enough XML for editing Word's parts in place: the elements with where each starts and ends in the text, and
// edits given as ranges of that text. Everything not edited stays exactly as Word wrote it (no parse and reprint), so
// a filled-in document differs from its template only where a tag or a field was.

export interface XmlElement {
  /** Qualified name as written, e.g. "w:t". The root (the whole part) is "". */
  name: string;
  /** The start tag's "<". */
  start: number;
  /** Just after the start tag's ">". */
  openEnd: number;
  /** The end tag's "<" (openEnd for an empty element). */
  closeStart: number;
  /** Just after the end tag's ">" (openEnd for an empty element). */
  end: number;
  /** Written <x/>. */
  empty: boolean;
  parent: XmlElement | null;
  children: XmlElement[];
}

// One piece of markup, as in templates/docx-tags.ts: a comment, CDATA, a declaration or processing instruction, or an
// element's start or end tag (a quoted attribute value may hold ">").
const MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([^\s/>]+)(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** The elements of a part, under a root covering the whole text. A part cut short or badly nested is read as far as it goes. */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '', start: 0, openEnd: 0, closeStart: xml.length, end: xml.length, empty: false, parent: null, children: [] };
  const open: XmlElement[] = [root];
  MARKUP.lastIndex = 0;
  for (let m = MARKUP.exec(xml); m; m = MARKUP.exec(xml)) {
    const name = m[3];
    if (name === undefined) continue; // comment, CDATA, declaration
    const at = m.index;
    const after = MARKUP.lastIndex;
    if (m[2] === '/') {
      // an end tag closes its element, and any left open inside it
      const index = open.findLastIndex((el) => el.name === name);
      if (index <= 0) continue;
      while (open.length > index) {
        const el = open.pop()!;
        el.closeStart = at;
        el.end = el.name === name ? after : at;
      }
      continue;
    }
    const parent = open[open.length - 1];
    const empty = m[0].endsWith('/>');
    const el: XmlElement = { name, start: at, openEnd: after, closeStart: after, end: after, empty, parent, children: [] };
    parent.children.push(el);
    if (!empty) open.push(el);
  }
  for (const el of open.slice(1)) el.closeStart = el.end = xml.length;
  return root;
}

/** Every element under `el`, in document order. */
export function* descendants(el: XmlElement): Generator<XmlElement> {
  for (const child of el.children) {
    yield child;
    yield* descendants(child);
  }
}

/** An attribute of an element's start tag, entities decoded; null when it has none. */
export function attribute(xml: string, el: XmlElement, name: string): string | null {
  const tag = xml.slice(el.start, el.openEnd);
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) if (m[1] === name) return decodeEntities(m[2] ?? m[3]);
  return null;
}

/** The text inside an element (a <w:t>, an <w:instrText>): entities decoded, CDATA as written, comments left out. */
export function innerText(xml: string, el: XmlElement): string {
  const raw = xml.slice(el.openEnd, el.closeStart);
  if (!raw.includes('<')) return decodeEntities(raw);
  let out = '';
  for (const m of raw.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[^>]*>|[^<]+/g)) {
    if (m[1] !== undefined) out += m[1];
    else if (!m[0].startsWith('<')) out += decodeEntities(m[0]);
  }
  return out;
}

export interface XmlEdit {
  start: number;
  end: number;
  text: string;
}

/** Replaces the edits' ranges. Where edits overlap, the one starting first (the outer one, at a tie) wins. */
export function applyEdits(xml: string, edits: readonly XmlEdit[]): string {
  if (!edits.length) return xml;
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let at = 0;
  for (const edit of sorted) {
    if (edit.start < at) continue; // inside one already made
    out += xml.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + xml.slice(at);
}

export const removal = (el: XmlElement): XmlEdit => ({ start: el.start, end: el.end, text: '' });

/** Text made safe to put between tags. */
export function escapeText(text: string): string {
  return withoutNonXml(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Without the characters XML 1.0 can't hold (control characters but tab and line breaks, U+FFFE, U+FFFF): a value
 * carrying one would make Word refuse the whole file. */
function withoutNonXml(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0xfffe || code === 0xffff) continue;
    out += text[i];
  }
  return out;
}

const WORD_NAMESPACES = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main', // what Word writes
  'http://purl.oclc.org/ooxml/wordprocessingml/main', // "Strict Open XML"
];

/** The prefix a part uses for WordprocessingML: "w" in every file Word writes. */
export function wordPrefix(xml: string): string {
  for (const m of xml.matchAll(/xmlns:([\w.-]+)\s*=\s*["']([^"']+)["']/g)) if (WORD_NAMESPACES.includes(m[2])) return m[1];
  return 'w';
}
