import { TAG_PATTERN, TEMPLATE_TAG_NAMES } from '@trendlix/shared';
import { readZip, ZipError, type ZipProblem } from './zip.js';

// Reading the merge tags of a Word template (spec §8.1; owner's request, 15 October 2026). Word splits what is typed
// into runs whenever the formatting, the spell checker or a bookmark says so, so {{full_name_ar}} is often spread over
// several <w:t> elements with other markup between them. Each paragraph's text is therefore put back together first:
// its <w:t> texts in order, every other element ignored, entities decoded; then the tags are found in it. Nothing in
// the file is changed. Deleted text in tracked changes (<w:delText>) and field codes (<w:instrText>) are not printed,
// so they are not read either.

/** What the reader found, each list in order of first appearance and without repeats. */
export interface TagReading {
  /** Tags of the dictionary (packages/shared TEMPLATE_TAGS). */
  tags: string[];
  /** Well-formed tags the dictionary doesn't have: they stop the version from being published. */
  unknownTags: string[];
  /** Fragments that look like a tag but aren't one, e.g. "{{ full_name_ar" or "{full_name}" (at most 20). */
  broken: string[];
}

export const BROKEN_MAX = 20;

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A file that isn't a Word document the library can take, with what HR should do about it. */
export class DocxError extends Error {}

const SAVE_AS_DOCX = 'Save it as a Word document (.docx) and upload again.';

// The main part's content type says what kind of Word file it is.
const MAIN_DOCUMENT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const NOT_A_DOCUMENT: Record<string, string> = {
  // A template (.dotx) is the same zip, but its main part is declared a template: a copy filled in from it would open
  // in Word as a template rather than a document. HR saves it once as a .docx instead (decision, 15 October 2026).
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml': `This is a Word template (.dotx). ${SAVE_AS_DOCX}`,
  'application/vnd.ms-word.document.macroEnabled.main+xml': `This Word document contains macros (.docm). ${SAVE_AS_DOCX}`,
  'application/vnd.ms-word.template.macroEnabledTemplate.main+xml': `This is a Word template with macros (.dotm). ${SAVE_AS_DOCX}`,
};

const ZIP_MESSAGES: Record<ZipProblem, string> = {
  not_zip: `This file isn't a Word document. ${SAVE_AS_DOCX}`,
  encrypted: `This Word file is protected by a password. Remove the password, then save it as a Word document (.docx) and upload again.`,
  zip64: `This file is too large to be a template. ${SAVE_AS_DOCX}`,
  too_large: 'The file must be 10 MB or smaller.',
  too_many_entries: `This file has too many parts to be a Word template. ${SAVE_AS_DOCX}`,
  expands_too_much: 'This file expands to more than 50 MB, which is too large for a template. Make it smaller (for example, compress its pictures in Word) and upload again.',
  unsupported_method: `This file wasn't saved by Word. Open it in Word, then save it as a Word document (.docx) and upload again.`,
  damaged: 'This Word file is damaged. Open it in Word, save it again as a Word document (.docx) and upload again.',
};

// An old Word document (.doc) and a password-protected .docx are both OLE compound files.
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const OLD_OR_PROTECTED = `This is an old Word document (.doc) or a file protected by a password. Remove any password, then save it as a Word document (.docx) and upload again.`;

/**
 * Checks that `data` is a Word document (.docx): a zip within the limits, with [Content_Types].xml and
 * word/document.xml declared as a document. Then reads its tags. Throws a DocxError saying what to do otherwise.
 */
export function readDocx(data: Buffer): TagReading {
  if (data.subarray(0, OLE.length).equals(OLE)) throw new DocxError(OLD_OR_PROTECTED);
  try {
    const zip = readZip(data);
    const types = zip.read('[Content_Types].xml');
    if (!types || !zip.has('word/document.xml')) throw new DocxError(`This file isn't a Word document. ${SAVE_AS_DOCX}`);
    const declared = overrideType(types.toString('utf8'), '/word/document.xml');
    if (declared && NOT_A_DOCUMENT[declared]) throw new DocxError(NOT_A_DOCUMENT[declared]);
    if (declared !== MAIN_DOCUMENT) throw new DocxError(`This file isn't a Word document. ${SAVE_AS_DOCX}`);
    return readTags(textParts(zip.entries.map((e) => e.name)).map((name) => zip.read(name)!.toString('utf8')));
  } catch (err) {
    // the zip itself, or a part met while reading (damaged, or a header that lies about its size)
    if (err instanceof ZipError) throw new DocxError(ZIP_MESSAGES[err.problem]);
    throw err;
  }
}

/** The content type [Content_Types].xml declares for a part, e.g. /word/document.xml. */
function overrideType(xml: string, part: string): string | null {
  for (const [element] of xml.matchAll(/<(?:[\w.-]+:)?Override\b[^>]*>/g)) {
    const attrs = attributes(element);
    if (attrs.PartName?.toLowerCase() === part) return attrs.ContentType ?? null;
  }
  return null;
}

function attributes(element: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of element.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeEntities(m[2] ?? m[3]);
  return out;
}

const PART_ORDER = [/^word\/document\.xml$/, /^word\/header(\d*)\.xml$/, /^word\/footer(\d*)\.xml$/, /^word\/footnotes\.xml$/, /^word\/endnotes\.xml$/];

/**
 * The parts whose text is printed, in the order they are read: the body, then the headers, the footers (each by
 * number), the footnotes and the endnotes.
 */
export function textParts(names: readonly string[]): string[] {
  return PART_ORDER.flatMap((pattern) =>
    names
      .map((name) => ({ name, m: pattern.exec(name) }))
      .filter((p): p is { name: string; m: RegExpExecArray } => p.m !== null)
      .sort((a, b) => Number(a.m[1] ?? 0) - Number(b.m[1] ?? 0) || a.name.localeCompare(b.name))
      .map((p) => p.name),
  );
}

/** The tags in these parts' XML, read in the order given. Pure: no zip, no I/O. */
export function readTags(partsXml: readonly string[]): TagReading {
  const tags: string[] = [];
  const unknownTags: string[] = [];
  const broken: string[] = [];
  const add = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value);
  };
  for (const xml of partsXml) {
    for (const text of paragraphTexts(xml)) {
      const found = tagsInText(text);
      for (const name of found.names) add(TEMPLATE_TAG_NAMES.has(name) ? tags : unknownTags, name);
      for (const fragment of found.broken) if (broken.length < BROKEN_MAX) add(broken, fragment);
    }
  }
  return { tags, unknownTags, broken };
}

const WORD_NAMESPACES = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main', // what Word writes
  'http://purl.oclc.org/ooxml/wordprocessingml/main', // "Strict Open XML"
];

/** The prefix the part uses for WordprocessingML: "w" in every file Word writes. */
function wordPrefix(xml: string): string {
  for (const m of xml.matchAll(/xmlns:([\w.-]+)\s*=\s*["']([^"']+)["']/g)) if (WORD_NAMESPACES.includes(m[2])) return m[1];
  return 'w';
}

// One piece of markup: a comment, CDATA, a declaration or processing instruction, or an element's start or end tag
// (with its attributes; a quoted value may hold ">").
const MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([^\s/>]+)(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/**
 * The text of each paragraph (<w:p>) of a part, in document order: its <w:t> texts joined, other markup ignored,
 * entities decoded. A text box's paragraphs sit inside the paragraph that holds the box; each is a paragraph of its
 * own, and the holding paragraph's text continues around it.
 */
export function paragraphTexts(xml: string): string[] {
  const w = wordPrefix(xml);
  const P = `${w}:p`;
  const T = `${w}:t`;
  const out: string[] = [];
  const open: { at: number; pieces: string[] }[] = []; // paragraphs being read, innermost last
  let inText = false; // inside a <w:t>
  let last = 0; // where the text after the last piece of markup starts
  const keep = (piece: string) => {
    if (inText && open.length && piece) open[open.length - 1].pieces.push(piece);
  };

  MARKUP.lastIndex = 0;
  for (let m = MARKUP.exec(xml); m; m = MARKUP.exec(xml)) {
    if (inText && m.index > last) keep(decodeEntities(xml.slice(last, m.index)));
    last = MARKUP.lastIndex;
    if (m[1] !== undefined) {
      keep(m[1]); // CDATA: as written
      continue;
    }
    const name = m[3];
    if (name === undefined) continue; // comment, declaration
    const closing = m[2] === '/';
    const empty = !closing && m[0].endsWith('/>');
    if (name === P) {
      if (closing) {
        const paragraph = open.pop();
        if (paragraph) out[paragraph.at] = paragraph.pieces.join('');
      } else if (!empty) {
        open.push({ at: out.length, pieces: [] });
        out.push('');
      }
    } else if (name === T && !empty) {
      inText = !closing;
    }
  }
  // a part cut short: what was read still counts
  for (const paragraph of open) out[paragraph.at] = paragraph.pieces.join('');
  return out.filter((text) => text !== '');
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML's five named entities and character references (&#1575; &#x627;). */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (whole, named: string, dec: string, hex: string) => {
    if (named) return NAMED_ENTITIES[named];
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// covers what was already found; never in a Word file, as XML can't hold it
const MASK = '\uffff';

/**
 * The tags in one paragraph's text, and the fragments that look like a tag but aren't one:
 * - {{…}} whose name isn't letters, digits and underscores ("{{full name}}", "{{الاسم}}");
 * - {{ or }} without its partner ("{{ full_name_ar", "full_name_ar}}", "{full_name}}");
 * - a name in single braces ("{full_name}").
 */
export function tagsInText(text: string): { names: string[]; broken: string[] } {
  const names: string[] = [];
  let masked = text;
  const cover = (start: number, length: number) => {
    masked = masked.slice(0, start) + MASK.repeat(length) + masked.slice(start + length);
  };
  for (const m of text.matchAll(new RegExp(TAG_PATTERN.source, 'g'))) {
    names.push(m[1]);
    cover(m.index, m[0].length);
  }
  if (!/[{}]/.test(masked)) return { names, broken: [] };

  // looked for in this order, each on what the ones before left
  const kinds = [
    /\{\{[^{}\uffff]{0,60}\}\}/g, // a name that isn't one
    /\{\{[ \t\u00a0]*[^\s{}\uffff]{0,40}\}?/g, // an opening without its closing
    /\{?[^\s{}\uffff]{0,40}[ \t\u00a0]*\}\}/g, // a closing without its opening
    /(?<!\{)\{[ \t\u00a0]*[A-Za-z][A-Za-z0-9_]*[ \t\u00a0]*\}(?!\})/g, // single braces
  ];
  const found: { at: number; fragment: string }[] = [];
  for (const kind of kinds) {
    for (const m of masked.matchAll(kind)) {
      found.push({ at: m.index, fragment: m[0].trim() });
      cover(m.index, m[0].length);
    }
  }
  found.sort((a, b) => a.at - b.at);
  return { names, broken: found.map((f) => f.fragment) };
}
