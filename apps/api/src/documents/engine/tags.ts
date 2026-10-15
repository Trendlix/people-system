import { TAG_PATTERN } from '@trendlix/shared';
import { readParagraphs, rewriteText, type TextPiece } from './paragraphs.js';
import { applyEdits, wordPrefix, type XmlEdit } from './xml.js';

// Putting the values in place of the {{tags}} of one part (spec §8; owner's request, 15 October 2026). Word splits
// what is typed into runs whenever the formatting, the spell checker or a bookmark says so, so a tag is often spread
// over several <w:t>. Each paragraph is read as the tag reader (templates/docx-tags.ts) reads it (paragraphs.ts): its
// <w:t> texts joined in order, other markup ignored, a text box's paragraphs each a paragraph of their own. The joined
// text keeps a map back to the <w:t> each character came from. For each tag found:
// - the value goes in the <w:t> where the tag's first character is, in place of the tag, so it takes that run's
//   formatting;
// - the tag's other characters are taken out of the <w:t> they are in (which may leave an empty <w:t>);
// - only the <w:t> elements changed are rewritten. A value's line breaks become <w:br/> in the same run, and
//   xml:space="preserve" is added where a rewritten text starts or ends with a space, so Word keeps it.
// A tag without a value is left as it is: the caller checks for missing values first.

/** The part's XML with every tag that has a value replaced; unchanged when there is none. */
export function fillTags(xml: string, values: Readonly<Record<string, string>>): string {
  if (!xml.includes('{') && !xml.includes('&#123;') && !xml.includes('&#x7')) return xml;
  const w = wordPrefix(xml);

  const edits: XmlEdit[] = [];
  for (const { texts, text: joined } of readParagraphs(xml)) {
    const matches = [...joined.matchAll(new RegExp(TAG_PATTERN.source, 'g'))]
      .filter((m) => Object.hasOwn(values, m[1]))
      .map((m) => ({ start: m.index, end: m.index + m[0].length, value: String(values[m[1]]) }));
    if (!matches.length) continue;

    for (const t of texts) {
      const to = t.from + t.text.length;
      const touching = matches.filter((m) => m.start < to && m.end > t.from);
      if (!touching.length) continue;
      // the text kept, and each value starting here, in order
      const pieces: TextPiece[] = [];
      let at = t.from;
      for (const m of touching) {
        if (m.start > at) pieces.push({ text: joined.slice(at, m.start), value: false });
        if (m.start >= t.from) pieces.push({ text: m.value, value: true });
        at = Math.max(at, m.end);
      }
      if (at < to) pieces.push({ text: joined.slice(at, to), value: false });
      edits.push({ start: t.el.start, end: t.el.end, text: rewriteText(xml, t.el, pieces, w) });
    }
  }
  return applyEdits(xml, edits);
}
