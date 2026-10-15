import { readParagraphs, rewriteText, textElements, type Paragraph, type TextPiece } from './paragraphs.js';
import { applyEdits, wordPrefix, type XmlEdit, type XmlElement } from './xml.js';

// Changing the text of a part's paragraphs in place, for Map Fields (owner's request, 15 October 2026: "I want a
// manual mapping fix"): HR places, changes or removes {{tags}} inside the system instead of in Word. A paragraph is
// read as the tag reader reads it (paragraphs.ts), and an edit replaces a range [from, to) of its text, the same way
// fillTags puts a value in place of a tag:
// - the new text goes in the <w:t> where `from` falls, so it takes that run's formatting (Arabic runs keep their
//   <w:rtl/>, a bold label stays bold); an insertion at the very end of the paragraph goes in its last <w:t>;
// - the rest of the range is taken out of the <w:t> elements it spans (which may leave an empty <w:t>);
// - a paragraph with no <w:t> at all gets a new run at its end, formatted as the paragraph mark (<w:pPr><w:rPr>);
// - only the <w:t> elements changed are rewritten, with xml:space="preserve" where a text starts or ends with a space.
// Everything else stays exactly as Word wrote it.

export interface TextEdit {
  /** The paragraph's position in readParagraphs(xml): every <w:p> of the part, in document order, from 0. */
  paragraph: number;
  /** The range of its text replaced: [from, to), in UTF-16 code units; from = to inserts. */
  from: number;
  to: number;
  /** What goes in its place ('' removes the range). */
  text: string;
}

/**
 * The part's XML with these edits made. Edits on one paragraph must not overlap, nor two start at the same place; each
 * range is of the paragraph's text as it is before any edit. Throws a RangeError otherwise (the caller checks first).
 */
export function editText(xml: string, edits: readonly TextEdit[]): string {
  if (!edits.length) return xml;
  const w = wordPrefix(xml);
  const paragraphs = readParagraphs(xml);
  const byParagraph = new Map<number, TextEdit[]>();
  for (const edit of edits) {
    const p = paragraphs[edit.paragraph];
    if (!p) throw new RangeError(`There is no paragraph ${edit.paragraph}.`);
    const { from, to } = edit;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > p.text.length) {
      throw new RangeError(`[${from}, ${to}) is not a range of paragraph ${edit.paragraph}, of ${p.text.length} characters.`);
    }
    byParagraph.set(edit.paragraph, [...(byParagraph.get(edit.paragraph) ?? []), edit]);
  }

  const out: XmlEdit[] = [];
  for (const [index, list] of byParagraph) {
    const sorted = [...list].sort((a, b) => a.from - b.from || a.to - b.to);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].from < sorted[i - 1].to || sorted[i].from === sorted[i - 1].from) {
        throw new RangeError(`Edits overlap in paragraph ${index}.`);
      }
    }
    out.push(...paragraphEdits(xml, paragraphs[index], sorted, w));
  }
  return applyEdits(xml, out);
}

/** The markup edits making these text edits (sorted, not overlapping) in one paragraph. */
function paragraphEdits(xml: string, p: Paragraph, edits: readonly TextEdit[], w: string): XmlEdit[] {
  if (!p.texts.length) {
    // nothing to write into: every edit is an insertion at 0, into a new run
    const text = edits.map((e) => e.text).join('');
    return text ? [newRun(xml, p.el, text, w)] : [];
  }

  // where each edit's text goes: the <w:t> holding the character at `from`, or the last one for the very end
  const holding = p.texts.filter((t) => t.text.length);
  const last = holding.at(-1) ?? p.texts.at(-1)!;
  const home = new Map(edits.map((e) => [e, holding.find((t) => t.from <= e.from && e.from < t.from + t.text.length) ?? last]));

  const out: XmlEdit[] = [];
  for (const t of p.texts) {
    const end = t.from + t.text.length;
    const touching = edits.filter((e) => home.get(e) === t || (e.from < end && e.to > t.from));
    if (!touching.length) continue;
    // the text kept, and each new text starting here, in order
    const pieces: TextPiece[] = [];
    let at = t.from;
    for (const e of touching) {
      if (e.from > at) pieces.push({ text: p.text.slice(at, Math.min(e.from, end)), value: false });
      if (home.get(e) === t && e.text) pieces.push({ text: e.text, value: true });
      at = Math.max(at, Math.min(e.to, end));
    }
    if (at < end) pieces.push({ text: p.text.slice(at, end), value: false });
    out.push({ start: t.el.start, end: t.el.end, text: rewriteText(xml, t.el, pieces, w) });
  }
  return out;
}

// Tracked-change marks on the paragraph mark: they belong to the mark, not to a run's properties.
const MARK_ONLY = ['ins', 'del', 'moveFrom', 'moveTo'];

/** A run holding `text` at the end of a paragraph that has no <w:t>, with the paragraph mark's run properties. */
function newRun(xml: string, paragraph: XmlElement, text: string, w: string): XmlEdit {
  const pPr = paragraph.children.find((c) => c.name === `${w}:pPr`);
  const rPr = pPr?.children.find((c) => c.name === `${w}:rPr`);
  let properties = '';
  if (rPr) {
    let at = rPr.start;
    for (const child of rPr.children.filter((c) => MARK_ONLY.some((name) => c.name === `${w}:${name}`))) {
      properties += xml.slice(at, child.start);
      at = child.end;
    }
    properties += xml.slice(at, rPr.end);
  }
  const run = `<${w}:r>${properties}${textElements(`<${w}:t>`, [{ text, value: true }], w)}</${w}:r>`;
  if (!paragraph.empty) return { start: paragraph.closeStart, end: paragraph.closeStart, text: run };
  // <w:p/>: opened and closed around the run
  const open = xml.slice(paragraph.start, paragraph.openEnd).replace(/\s*\/>$/, '>');
  return { start: paragraph.start, end: paragraph.end, text: `${open}${run}</${w}:p>` };
}
