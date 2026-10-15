import { TAG_GROUP_LABELS, TAG_GROUPS, TEMPLATE_TAGS, type TagGroup, type TemplateLanguage, type TemplateTag } from '@trendlix/shared';
import type { FieldEdit, MapFieldsRequest, TemplateLine, TextRange } from '../../../lib/types';
import { count, matchesTag } from './tag-check';

// Map Fields (owner's request, 15 October 2026: "I want a manual mapping fix"): HR places, changes or removes {{tags}} in
// a template version inside the system, instead of typing them in Word. Nothing is saved until "Save as a new draft",
// which sends the changes to POST /templates/versions/:id/map; the API makes a new draft from them (the uploaded file
// never changes), checked and published on the template's page as usual. The API's rules, checked here first for a
// quick answer: a change puts '' or one known {{tag}} (with at most one space before and after it) in place of a range
// of a line that is empty (an insertion), exactly an existing tag, or inside a blank; the wording itself is never
// changed; changes on one line don't overlap; at most 200 at once. Every offset is into the line's text as the API sent
// it, before any change. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** The most changes saved at once (the API's limit). */
export const MAX_EDITS = 200;
/** The longest note ("What changed") sent with them, as on an upload. */
export const NOTE_MAX = 500;

const KNOWN: ReadonlyMap<string, TemplateTag> = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));

/** The tag list's entry for a tag, or undefined when it isn't in the list. */
export const knownTag = (tag: string): TemplateTag | undefined => KNOWN.get(tag);

/** {{tag}} as written in the file. */
export const braces = (tag: string) => `{{${tag}}}`;

// ---------- pending changes ----------

/** add: a field put in at a point; fill: in place of a blank; change: an existing tag replaced; remove: one taken out. */
export type EditKind = 'add' | 'fill' | 'change' | 'remove';

/** A change made on the page and not saved yet. */
export interface PendingEdit extends TextRange {
  /** Unique on the page: for React's keys and Undo. */
  key: string;
  /** The line's id. */
  line: string;
  /** What takes the place of [from, to): '' or one {{tag}}, with a space before or after it where an insertion needs one. */
  text: string;
  kind: EditKind;
  /** The field put in; null when a tag is removed. */
  tag: string | null;
  /** The tag replaced or removed; null for add and fill. */
  was: string | null;
  /** The line's text it replaces: the tag or the blank; '' for an insertion. */
  replaced: string;
  /** The suggestion it was made from (suggestionKey), if any. */
  suggestion?: string;
}

export type Built = { edit: PendingEdit } | { error: string };

const isInsertion = (r: TextRange) => r.from === r.to;

/**
 * Whether two changes of one line overlap, so they can't both be sent: their ranges share a character; one is put in
 * strictly inside the other's range; or both are put in at the same point (which would go first is anyone's guess).
 * Touching is fine: a field put in just after a tag.
 */
export function overlaps(a: TextRange, b: TextRange): boolean {
  if (isInsertion(a) && isInsertion(b)) return a.from === b.from;
  if (isInsertion(a)) return b.from < a.from && a.from < b.to;
  if (isInsertion(b)) return a.from < b.from && b.from < a.to;
  return a.from < b.to && b.from < a.to;
}

/** The pending change of the same line that `edit` overlaps, or undefined. */
export function clashWith(edit: Pick<PendingEdit, 'line' | 'from' | 'to'>, edits: readonly PendingEdit[]): PendingEdit | undefined {
  return edits.find((e) => e.line === edit.line && overlaps(e, edit));
}

/** Whether an offset falls strictly inside one of the line's tags (a field can't go in the middle of a tag). */
export function insideTag(line: Pick<TemplateLine, 'tags'>, offset: number): boolean {
  return line.tags.some((t) => t.from < offset && offset < t.to);
}

const SPACE = /\s/;
const OPENING = /[([{«“‘/]/;
const WORD = /[\p{L}\p{N}]/u;

/**
 * The text that puts {{tag}} in at an offset of a line: with a space before it unless it starts the line or follows a
 * space or an opening bracket or quote, and a space after it when a letter or digit follows ("Name:" → "Name: {{tag}}").
 */
export function insertionText(text: string, offset: number, tag: string): string {
  const before = offset > 0 ? text[offset - 1] : '';
  const after = offset < text.length ? text[offset] : '';
  const lead = before && !SPACE.test(before) && !OPENING.test(before) ? ' ' : '';
  const trail = after && WORD.test(after) ? ' ' : '';
  return `${lead}${braces(tag)}${trail}`;
}

const unknownField = (tag: string) => `${braces(tag)} is not in the tag list: choose a field from the list.`;

/** Puts a field in at an offset of a line (at its end, or after a text in it). */
export function addAt(line: TemplateLine, offset: number, tag: string, key: string): Built {
  if (!knownTag(tag)) return { error: unknownField(tag) };
  if (!Number.isInteger(offset) || offset < 0 || offset > line.text.length) return { error: 'That place is not in this line.' };
  if (insideTag(line, offset)) return { error: 'A field can’t go in the middle of a tag: choose another place.' };
  return { edit: { key, line: line.id, from: offset, to: offset, text: insertionText(line.text, offset, tag), kind: 'add', tag, was: null, replaced: '' } };
}

/** Puts a field in place of one of the line's blanks (by its position in line.blanks). */
export function fillBlank(line: TemplateLine, blank: number, tag: string, key: string): Built {
  const range = line.blanks[blank];
  if (!range) return { error: 'That blank is not in this line.' };
  if (!knownTag(tag)) return { error: unknownField(tag) };
  const { from, to } = range;
  return { edit: { key, line: line.id, from, to, text: braces(tag), kind: 'fill', tag, was: null, replaced: line.text.slice(from, to) } };
}

/** Replaces one of the line's tags (by its position in line.tags) with another field. */
export function changeTag(line: TemplateLine, index: number, tag: string, key: string): Built {
  const found = line.tags[index];
  if (!found) return { error: 'That tag is not in this line.' };
  if (!knownTag(tag)) return { error: unknownField(tag) };
  if (found.tag === tag) return { error: `It is ${braces(tag)} already: choose another field.` };
  const { from, to } = found;
  return { edit: { key, line: line.id, from, to, text: braces(tag), kind: 'change', tag, was: found.tag, replaced: line.text.slice(from, to) } };
}

/** Takes one of the line's tags (by its position in line.tags) out. */
export function removeTag(line: TemplateLine, index: number, key: string): Built {
  const found = line.tags[index];
  if (!found) return { error: 'That tag is not in this line.' };
  const { from, to } = found;
  return { edit: { key, line: line.id, from, to, text: '', kind: 'remove', tag: null, was: found.tag, replaced: line.text.slice(from, to) } };
}

/** How a suggestion is known on the page (to dismiss it): its line and its position in line.suggestions. */
export const suggestionKey = (line: Pick<TemplateLine, 'id'>, index: number) => `${line.id}#${index}`;

/** '' or one {{tag}}, with at most one space before and after it: what a change may put in (the API's rule). */
const TAG_TEXT = /^ ?\{\{[A-Za-z0-9_]+\}\} ?$/;

/**
 * The change a suggestion makes: its text as the API gives it (already with a space before it, or not, as the place
 * needs); from an API that leaves it out, " {{tag}}" put in at its point, or {{tag}} in place of its blank.
 */
export function fromSuggestion(line: TemplateLine, index: number, key: string): Built {
  const s = line.suggestions[index];
  if (!s) return { error: 'That suggestion is not in this line.' };
  if (!knownTag(s.tag)) return { error: unknownField(s.tag) };
  if (s.from < 0 || s.to > line.text.length || s.from > s.to) return { error: 'That suggestion is not in this line.' };
  const given = typeof s.text === 'string' && TAG_TEXT.test(s.text) && s.text.trim() === braces(s.tag) ? s.text : null;
  const base = { key, line: line.id, from: s.from, to: s.to, tag: s.tag, was: null, suggestion: suggestionKey(line, index) };
  return isInsertion(s)
    ? { edit: { ...base, text: given ?? ` ${braces(s.tag)}`, kind: 'add', replaced: '' } }
    : { edit: { ...base, text: given ?? braces(s.tag), kind: 'fill', replaced: line.text.slice(s.from, s.to) } };
}

/**
 * Adds a change to the pending ones. A tag or blank changed again replaces the earlier change of it, in its place in the
 * list ("Change" twice, or Remove after Change); any other overlap is refused, with what to do.
 */
export function addEdit(edits: readonly PendingEdit[], edit: PendingEdit): { edits: PendingEdit[] } | { error: string } {
  const same = edits.findIndex((e) => e.line === edit.line && !isInsertion(e) && e.from === edit.from && e.to === edit.to);
  if (same >= 0 && !isInsertion(edit)) return { edits: edits.map((e, i) => (i === same ? edit : e)) };
  const clash = clashWith(edit, edits);
  if (clash) return { error: `This place already has a change (${describeEdit(clash)}): undo it first, or choose another place.` };
  return { edits: [...edits, edit] };
}

/** The pending changes without one (Undo). */
export const undoEdit = (edits: readonly PendingEdit[], key: string) => edits.filter((e) => e.key !== key);

/** A line's text with the changes made (those of other lines are ignored). */
export function applyEdits(line: Pick<TemplateLine, 'id' | 'text'>, edits: readonly PendingEdit[]): string {
  const mine = ordered(edits.filter((e) => e.line === line.id));
  let out = '';
  let pos = 0;
  for (const e of mine) {
    if (e.from < pos) continue; // overlapping: never kept (addEdit refuses it)
    out += line.text.slice(pos, e.from) + e.text;
    pos = e.to;
  }
  return out + line.text.slice(pos);
}

/** Changes in the order they fall in a line: by where they start, an insertion before a range starting at the same point. */
function ordered<E extends TextRange>(edits: readonly E[]): E[] {
  return [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
}

// ---------- showing a line ----------

/** A piece of a line as shown: its own text, a tag or a blank as in the file, or a pending change. */
export type Segment =
  | { kind: 'text'; from: number; to: number; text: string }
  | { kind: 'tag'; from: number; to: number; text: string; index: number; tag: string; known: boolean }
  | { kind: 'blank'; from: number; to: number; text: string; index: number }
  | { kind: 'edit'; from: number; to: number; edit: PendingEdit };

/**
 * A line in pieces as the page shows it, with the pending changes in their places: the line's text, its tags (to
 * change or remove), its blanks (to put a field in) and each change (a field put in, a tag struck through, …).
 */
export function lineSegments(line: TemplateLine, edits: readonly PendingEdit[]): Segment[] {
  const marks = [
    ...line.tags.map((t, index) => ({ from: t.from, to: t.to, mark: { kind: 'tag' as const, index, tag: t.tag, known: t.known } })),
    ...line.blanks.map((b, index) => ({ from: b.from, to: b.to, mark: { kind: 'blank' as const, index } })),
  ]
    .filter((m) => m.from < m.to)
    .sort((a, b) => a.from - b.from);
  const out: Segment[] = [];

  // the line as in the file between two offsets, in pieces at its tags and blanks
  const plain = (from: number, to: number) => {
    let at = from;
    for (const m of marks) {
      if (m.to <= at || m.from >= to) continue;
      if (m.from > at) out.push({ kind: 'text', from: at, to: m.from, text: line.text.slice(at, m.from) });
      const start = Math.max(m.from, at);
      const end = Math.min(m.to, to);
      out.push({ ...m.mark, from: start, to: end, text: line.text.slice(start, end) });
      at = end;
    }
    if (at < to) out.push({ kind: 'text', from: at, to, text: line.text.slice(at, to) });
  };

  let pos = 0;
  for (const edit of ordered(edits.filter((e) => e.line === line.id))) {
    if (edit.from < pos) continue;
    plain(pos, edit.from);
    out.push({ kind: 'edit', from: edit.from, to: edit.to, edit });
    pos = edit.to;
  }
  plain(pos, line.text.length);
  return out;
}

/** The suggestions of a line still offered: not dismissed, of a field in the tag list, and not where a change is already. */
export function openSuggestions(line: TemplateLine, edits: readonly PendingEdit[], dismissed: ReadonlySet<string>) {
  return line.suggestions
    .map((s, index) => ({ ...s, index, key: suggestionKey(line, index) }))
    .filter((s) => !dismissed.has(s.key) && knownTag(s.tag) && s.from <= s.to && s.to <= line.text.length && !clashWith({ ...s, line: line.id }, edits));
}

/**
 * The changes "Add all suggestions" makes: every open suggestion of every line, in order, leaving out one that falls
 * where an earlier one goes; `skipped` counts those.
 */
export function allSuggestions(
  lines: readonly TemplateLine[],
  edits: readonly PendingEdit[],
  dismissed: ReadonlySet<string>,
  key: (n: number) => string,
): { edits: PendingEdit[]; added: number; skipped: number } {
  let out = [...edits];
  let added = 0;
  let skipped = 0;
  for (const line of lines) {
    for (const s of openSuggestions(line, edits, dismissed)) {
      const built = fromSuggestion(line, s.index, key(added));
      const next = 'edit' in built ? addEdit(out, built.edit) : built;
      if ('edits' in next) {
        out = next.edits;
        added++;
      } else skipped++;
    }
  }
  return { edits: out, added, skipped };
}

/** How many suggestions are open on all the lines (for "Add all suggestions (n)"). */
export function openSuggestionCount(lines: readonly TemplateLine[], edits: readonly PendingEdit[], dismissed: ReadonlySet<string>): number {
  return lines.reduce((n, line) => n + openSuggestions(line, edits, dismissed).length, 0);
}

/**
 * A line as the page and the API's messages name it: its number within its part, and the part when the file has
 * several ("Line 13 of the body", as the API says it; "Line 13" in a file that is all body).
 */
export function lineName(line: Pick<TemplateLine, 'index' | 'partLabel'>, parts: boolean): string {
  return parts ? `Line ${line.index + 1} of the ${line.partLabel.toLowerCase()}` : `Line ${line.index + 1}`;
}

/** Whether a line has anything to map: a tag, a blank or a suggestion (the "only lines with …" filter keeps these). */
export const hasFields = (line: Pick<TemplateLine, 'tags' | 'blanks' | 'suggestions'>) => line.tags.length + line.blanks.length + line.suggestions.length > 0;

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;

/**
 * Which way a line reads: right to left when it has more Arabic letters than Latin ones (its tags, written in Latin
 * letters, aren't counted); a line with neither reads as the document does.
 */
export function lineDirection(text: string, language: TemplateLanguage): 'rtl' | 'ltr' {
  const words = text.replace(/\{\{[^{}]*\}\}/g, ' ');
  const arabic = words.match(ARABIC)?.length ?? 0;
  const latin = words.match(LATIN)?.length ?? 0;
  if (arabic === latin) return language === 'ar' ? 'rtl' : 'ltr';
  return arabic > latin ? 'rtl' : 'ltr';
}

// ---------- where a field goes ----------

/** A word of a line as offered in "after this word": its text (with which one it is, when it comes more than once) and the offset after it. */
export interface WordChoice {
  label: string;
  offset: number;
}

/**
 * The words of a line (split at spaces), each with the offset just after it, for "after this word": a word that comes
 * more than once is numbered ("the (2)"), and a place in the middle of a tag is left out.
 */
export function lineWords(line: Pick<TemplateLine, 'text' | 'tags'>): WordChoice[] {
  const seen = new Map<string, number>();
  const words: WordChoice[] = [];
  for (const m of line.text.matchAll(/\S+/g)) {
    const offset = (m.index ?? 0) + m[0].length;
    if (insideTag(line, offset)) continue;
    const n = (seen.get(m[0]) ?? 0) + 1;
    seen.set(m[0], n);
    words.push({ label: n > 1 ? `${m[0]} (${n})` : m[0], offset });
  }
  return words;
}

/** At most this many characters of the line are quoted to say where a field goes. */
const QUOTE_MAX = 24;

/** The quote isolated from the words around it (FSI … PDI), so Arabic quoted in an English sentence reads the right way. */
const isolate = (text: string) => `\u2068${text}\u2069`;

/**
 * Where a field put in at an offset goes, in words, quoting the end of the text before it: "at the start of the line",
 * "after “Name:”", "at the end, after “…National ID:”" (the quote isolated, as plain text and in a select's options).
 */
export function afterLabel(text: string, offset: number): string {
  const before = text.slice(0, offset).trimEnd();
  if (!before) return 'at the start of the line';
  const words = before.split(/\s+/);
  let tail = words.pop() ?? '';
  while (words.length && words[words.length - 1].length + 1 + tail.length <= QUOTE_MAX) tail = `${words.pop()} ${tail}`;
  const quote = tail.length > QUOTE_MAX ? `…${tail.slice(-QUOTE_MAX)}` : words.length ? `…${tail}` : tail;
  return offset >= text.trimEnd().length ? `at the end, after “${isolate(quote)}”` : `after “${isolate(quote)}”`;
}

/**
 * The offset just after a text typed from the line ("after this text"): its first occurrence, as typed, else ignoring
 * capitals; with why not when it isn't in the line or ends in the middle of a tag.
 */
export function offsetAfter(line: Pick<TemplateLine, 'text' | 'tags'>, typed: string): { offset: number } | { error: string } {
  const phrase = typed.trim();
  if (!phrase) return { error: 'Type a word or phrase from the line.' };
  let at = line.text.indexOf(phrase);
  // ignoring capitals, when lower case keeps the lengths (it does for Latin and Arabic letters)
  if (at < 0 && line.text.toLowerCase().length === line.text.length && phrase.toLowerCase().length === phrase.length) {
    at = line.text.toLowerCase().indexOf(phrase.toLowerCase());
  }
  if (at < 0) return { error: `“${phrase}” is not in this line: type it as it is written there.` };
  const offset = at + phrase.length;
  if (insideTag(line, offset)) return { error: `“${phrase}” ends in the middle of a tag: choose another text.` };
  return { offset };
}

// ---------- the field picker ----------

export interface PickerGroup {
  group: TagGroup;
  label: string;
  tags: TemplateTag[];
}

/** The tag list by group, as the tag reference shows it, with only the tags that match a search (by tag or label). */
export function pickerGroups(query: string): PickerGroup[] {
  return TAG_GROUPS.map((group) => ({ group, label: TAG_GROUP_LABELS[group], tags: TEMPLATE_TAGS.filter((t) => t.group === group && matchesTag(t, query)) })).filter(
    (g) => g.tags.length > 0,
  );
}

// ---------- the summary and saving ----------

export interface EditCounts {
  /** Fields put in: at a point or in a blank. */
  added: number;
  changed: number;
  removed: number;
  total: number;
}

export function countEdits(edits: readonly Pick<PendingEdit, 'kind'>[]): EditCounts {
  const added = edits.filter((e) => e.kind === 'add' || e.kind === 'fill').length;
  const changed = edits.filter((e) => e.kind === 'change').length;
  const removed = edits.filter((e) => e.kind === 'remove').length;
  return { added, changed, removed, total: edits.length };
}

/** "3 fields added, 1 changed, 1 removed" ("field" said once, on the first); "No changes yet" when there are none. */
export function summaryText(counts: Omit<EditCounts, 'total'>): string {
  const parts: string[] = [];
  for (const [n, done] of [
    [counts.added, 'added'],
    [counts.changed, 'changed'],
    [counts.removed, 'removed'],
  ] as const) {
    if (!n) continue;
    parts.push(parts.length ? `${n} ${done}` : `${count(n, 'field')} ${done}`);
  }
  return parts.length ? parts.join(', ') : 'No changes yet';
}

/** One pending change in words, for the list of changes: "{{national_id}} added", "{{nam}} changed to {{full_name_ar}}", … */
export function describeEdit(edit: Pick<PendingEdit, 'kind' | 'tag' | 'was'>): string {
  const tag = braces(edit.tag ?? '');
  const was = braces(edit.was ?? '');
  switch (edit.kind) {
    case 'add':
      return `${tag} added`;
    case 'fill':
      return `${tag} put in a blank`;
    case 'change':
      return `${was} changed to ${tag}`;
    case 'remove':
      return `${was} removed`;
  }
}

/** Why the changes can't be saved yet, or null when they can. */
export function saveProblem(edits: readonly unknown[], note = ''): string | null {
  if (!edits.length) return 'Make at least one change first.';
  if (edits.length > MAX_EDITS) return `At most ${MAX_EDITS} changes can be saved at once: undo ${edits.length - MAX_EDITS}, save, then map the rest on the new draft.`;
  if (note.trim().length > NOTE_MAX) return `The note must be ${NOTE_MAX} characters or fewer.`;
  return null;
}

/** The body of POST /map: the changes in the document's order (by line, then where they start), and the note if any. */
export function buildRequest(edits: readonly PendingEdit[], lines: readonly Pick<TemplateLine, 'id'>[], note = ''): MapFieldsRequest {
  const position = new Map(lines.map((l, i) => [l.id, i]));
  const sorted = [...edits].sort((a, b) => (position.get(a.line) ?? 0) - (position.get(b.line) ?? 0) || a.from - b.from || a.to - b.to);
  const trimmed = note.trim();
  return { edits: sorted.map(({ line, from, to, text }) => ({ line, from, to, text })), ...(trimmed && { note: trimmed }) };
}

/**
 * What the server action makes of what the page sent (anything can be posted to it): the request, cleaned, or what is
 * wrong with it. The API checks every rule again, against the file.
 */
export function readRequest(input: unknown): { request: MapFieldsRequest } | { errors: string[] } {
  const body = (input ?? {}) as { edits?: unknown; note?: unknown };
  if (!Array.isArray(body.edits)) return { errors: ['Make at least one change first.'] };
  const note = typeof body.note === 'string' ? body.note : '';
  const problem = saveProblem(body.edits, note);
  if (problem) return { errors: [problem] };
  const edits: FieldEdit[] = [];
  for (const raw of body.edits as unknown[]) {
    const e = (raw ?? {}) as Partial<Record<keyof FieldEdit, unknown>>;
    const fine =
      typeof e.line === 'string' &&
      e.line.length > 0 &&
      e.line.length <= 200 &&
      Number.isInteger(e.from) &&
      Number.isInteger(e.to) &&
      (e.from as number) >= 0 &&
      (e.from as number) <= (e.to as number) &&
      typeof e.text === 'string' &&
      (e.text === '' || TAG_TEXT.test(e.text));
    if (!fine) return { errors: ['A change could not be read. Reload the page and make it again.'] };
    edits.push({ line: e.line as string, from: e.from as number, to: e.to as number, text: e.text as string });
  }
  const trimmed = note.trim();
  return { request: { edits, ...(trimmed && { note: trimmed }) } };
}
