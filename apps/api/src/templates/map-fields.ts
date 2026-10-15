import { TAG_PATTERN, TEMPLATE_TAG_NAMES, type TemplateLanguage } from '@trendlix/shared';
import { editText, readParagraphs, type TextEdit } from '../documents/engine/index.js';
import { textParts } from './docx-tags.js';
import { findBlanks, suggestFields, type FieldSuggestion, type TextRange } from './field-suggestions.js';
import { readZip, writeZip, type ZipFile, type ZipRawFile } from './zip.js';

// Map Fields (owner's request, 15 October 2026: "I want a manual mapping fix"): HR places, changes or removes {{tags}}
// in a template version inside the system instead of typing them in Word. The version's lines are its paragraphs
// with text, part by part in the order the tag reader reads them (the body, headers, footers, footnotes, endnotes),
// each numbered within its part as paragraphTexts numbers them. Saving makes a new file; the version's own is never
// changed. The template's wording is never changed either: an edit may only
// - insert one tag anywhere on a line (not inside another tag);
// - change or remove a tag: its range is exactly the tag's;
// - fill a blank (dots, dashes, underscores) with one tag: its range lies inside the blank.
// The text put in is one known {{tag}}, with at most one space before and after it, or nothing to remove a tag.

export const MAX_EDITS = 200;

export interface LineTag extends TextRange {
  tag: string;
  /** In the tag dictionary (packages/shared TEMPLATE_TAGS). */
  known: boolean;
}

export interface TemplateLine {
  /** "<part>#<index>", e.g. "word/document.xml#12". */
  id: string;
  part: string;
  partLabel: string;
  /** Its position among the part's lines (paragraphs with text), from 0. */
  index: number;
  text: string;
  tags: LineTag[];
  blanks: TextRange[];
  suggestions: FieldSuggestion[];
}

/** What a part is called on the page. */
export function partLabel(part: string): string {
  if (part === 'word/document.xml') return 'Body';
  if (/^word\/header\d*\.xml$/.test(part)) return 'Header';
  if (/^word\/footer\d*\.xml$/.test(part)) return 'Footer';
  if (part === 'word/footnotes.xml') return 'Footnotes';
  if (part === 'word/endnotes.xml') return 'Endnotes';
  return part;
}

/** A line as messages name it: "Line 13 of the body". */
const lineName = (line: TemplateLine) => `Line ${line.index + 1} of the ${line.partLabel.toLowerCase()}`;

interface Part {
  name: string;
  xml: string;
  /** Each line, with its paragraph's position in readParagraphs(xml). */
  lines: { line: TemplateLine; paragraph: number }[];
}

function readParts(data: Buffer, language: TemplateLanguage | null) {
  const zip = readZip(data);
  const parts: Part[] = textParts(zip.entries.map((e) => e.name)).map((name) => {
    const xml = zip.read(name)!.toString('utf8');
    const lines: Part['lines'] = [];
    readParagraphs(xml).forEach(({ text }, paragraph) => {
      if (!text) return;
      const index = lines.length;
      const tags = [...text.matchAll(new RegExp(TAG_PATTERN.source, 'g'))].map((m) => ({
        tag: m[1],
        from: m.index,
        to: m.index + m[0].length,
        known: TEMPLATE_TAG_NAMES.has(m[1]),
      }));
      const blanks = findBlanks(text);
      const suggestions = language ? suggestFields(text, language, blanks) : [];
      lines.push({ line: { id: `${name}#${index}`, part: name, partLabel: partLabel(name), index, text, tags, blanks, suggestions }, paragraph });
    });
    return { name, xml, lines };
  });
  return { zip, parts };
}

/** The lines of a template version's file, with their tags, blanks and the fields suggested for them. */
export function templateLines(data: Buffer, language: TemplateLanguage): TemplateLine[] {
  return readParts(data, language).parts.flatMap((p) => p.lines.map((l) => l.line));
}

/** An edit HR can't make, said in words they act on. */
export class MapFieldsError extends Error {}

export interface FieldEdit {
  /** A line's id. */
  line: string;
  from: number;
  to: number;
  text: string;
}

export interface MappedFile {
  file: Buffer;
  /** Tags put in: in a blank or between words. */
  inserted: number;
  /** Tags replaced by another. */
  changed: number;
  /** Tags taken out. */
  removed: number;
}

const TAG_TEXT = /^( ?)\{\{\s*([A-Za-z0-9_]+)\s*\}\}( ?)$/;

/**
 * The file with these edits made, each checked against the rules above; throws a MapFieldsError naming the line
 * otherwise. Every range is of the line as it is in `data`: edits on one line must not overlap, and are made together
 * (as if from the end of the line backwards). Parts not edited are copied byte for byte.
 */
export function mapFields(data: Buffer, edits: readonly FieldEdit[]): MappedFile {
  if (!edits.length) throw new MapFieldsError('Make at least one change.');
  if (edits.length > MAX_EDITS) throw new MapFieldsError(`Make at most ${MAX_EDITS} changes at a time.`);
  const { zip, parts } = readParts(data, null);
  const lines = new Map(parts.flatMap((part) => part.lines.map((l) => [l.line.id, { ...l, part }] as const)));

  const counts = { inserted: 0, changed: 0, removed: 0 };
  const byPart = new Map<Part, TextEdit[]>();
  const byLine = new Map<string, FieldEdit[]>();
  for (const edit of edits) {
    const found = lines.get(edit.line);
    if (!found) throw new MapFieldsError(`There is no line "${edit.line}" in this version. Reload the page and try again.`);
    const { line, paragraph, part } = found;
    const name = lineName(line);
    const { from, to } = edit;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > line.text.length) {
      throw new MapFieldsError(`${name}: the place to change isn't on the line. Reload the page and try again.`);
    }

    let text = '';
    if (edit.text !== '') {
      const m = TAG_TEXT.exec(edit.text);
      if (!m) throw new MapFieldsError(`${name}: put in one tag, such as {{national_id}}, or nothing to take a tag out.`);
      if (!TEMPLATE_TAG_NAMES.has(m[2])) throw new MapFieldsError(`${name}: {{${m[2]}}} isn't a tag the system knows.`);
      text = `${m[1]}{{${m[2]}}}${m[3]}`;
    }

    if (from === to) {
      if (!text) throw new MapFieldsError(`${name}: choose the tag to put in.`);
      if (line.tags.some((t) => t.from < from && from < t.to)) throw new MapFieldsError(`${name}: a tag can't go inside another tag.`);
      counts.inserted++;
    } else if (line.tags.some((t) => t.from === from && t.to === to)) {
      counts[text ? 'changed' : 'removed']++;
    } else if (line.blanks.some((b) => b.from <= from && to <= b.to)) {
      if (!text) throw new MapFieldsError(`${name}: choose the tag to put in the blank.`);
      counts.inserted++;
    } else {
      throw new MapFieldsError(`${name}: only a tag or a blank (dots, dashes or underscores) can be replaced. The template's wording is never changed.`);
    }

    byLine.set(line.id, [...(byLine.get(line.id) ?? []), edit]);
    byPart.set(part, [...(byPart.get(part) ?? []), { paragraph, from, to, text }]);
  }

  for (const [id, list] of byLine) {
    const sorted = [...list].sort((a, b) => a.from - b.from || a.to - b.to);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].from < sorted[i - 1].to || sorted[i].from === sorted[i - 1].from) {
        throw new MapFieldsError(`${lineName(lines.get(id)!.line)}: two changes overlap. Make one change at each place.`);
      }
    }
  }

  const changed = new Map([...byPart].map(([part, list]) => [part.name, editText(part.xml, list)]));
  const files = zip.entries.map((e): ZipFile | ZipRawFile => {
    const xml = changed.get(e.name);
    return xml === undefined ? { name: e.name, raw: zip.raw(e.name)! } : { name: e.name, data: xml };
  });
  return { file: writeZip(files), ...counts };
}
