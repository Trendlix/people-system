import type { TextDirection } from '@cantoo/fontkit';
import bidiFactory from 'bidi-js';
import { fontFile, type FontScript } from './fonts.js';

// One line of text as a PDF prints it (owner's decision, 15 October 2026: Arabic printed correctly on the official
// forms): the letters joined, the words right to left, and digits, Latin words and emails inside Arabic text in their
// own order. A PDF draws glyphs left to right where it is told, so the line is cut into runs, each in one font and one
// direction, and the runs put in the order they are seen (the Unicode Bidirectional Algorithm, by bidi-js).
//
// The font engine (fontkit) joins the Arabic letters of a run and, told the run is right to left, turns it round
// itself, as seen: it needs the letters in reading order to join them. A right-to-left run with no Arabic letters
// (punctuation, a bracket) is turned round here instead, and mirrored ("(" printed as ")"), so it never depends on what
// the font's own mirroring covers.

const bidi = bidiFactory();

/** A run of one line, in the order the line is seen, left to right: the text to lay out, in its font and direction. */
export interface TextRun {
  script: FontScript;
  text: string;
  direction: TextDirection;
}

/** Arabic letters, digits and signs (Arabic, its supplement and extended blocks, presentation forms). */
const isArabic = (cp: number): boolean =>
  (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0x08a0 && cp <= 0x08ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);

/** Letters and digits of any other script: always printed in the Latin font. */
const isLetterOrDigit = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);

/** Which way a line reads: left to right, right to left, or (auto) as its first strong character does. */
export type LineDirection = 'ltr' | 'rtl' | 'auto';

/** Which way a value reads: as its first strong character (Arabic: right to left), left to right when it has none. */
export function paragraphDirection(text: string): 'ltr' | 'rtl' {
  if (!text) return 'ltr';
  return (bidi.getEmbeddingLevels(text, 'auto').paragraphs[0]?.level ?? 0) % 2 ? 'rtl' : 'ltr';
}

/**
 * The runs of a line, left to right as seen. The line's direction is its first strong character's (Arabic: right to
 * left), left to right when it has none (a date, a number), unless `direction` says it: a line of a value that wraps
 * reads as the whole value does, whatever its own first word. Each character is printed in the Arabic font when it is
 * Arabic, in the Latin font when it is another letter or digit; a space or a sign in the font of the character before
 * it (else after it) at the same level, unless only one font has it.
 */
export function visualRuns(line: string, bold = false, direction: LineDirection = 'auto'): TextRun[] {
  if (!line) return [];
  const { levels } = bidi.getEmbeddingLevels(line, direction);
  const mirrored = bidi.getMirroredCharactersMap(line, levels);
  const arabicFont = fontFile('arabic', bold).font;
  const latinFont = fontFile('latin', bold).font;

  // the characters (code points), each with its level, and its font when it decides one
  const chars: { ch: string; index: number; level: number; script: FontScript | null }[] = [];
  for (let i = 0; i < line.length; ) {
    const cp = line.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    let script: FontScript | null;
    if (isArabic(cp)) script = arabicFont.hasGlyphForCodePoint(cp) || !latinFont.hasGlyphForCodePoint(cp) ? 'arabic' : 'latin';
    else if (isLetterOrDigit(ch)) script = 'latin';
    else {
      const inArabic = arabicFont.hasGlyphForCodePoint(cp);
      const inLatin = latinFont.hasGlyphForCodePoint(cp);
      script = inArabic && inLatin ? null : inArabic ? 'arabic' : 'latin';
    }
    chars.push({ ch, index: i, level: levels[i], script });
    i += ch.length;
  }
  // a space or a sign both fonts have: the font beside it at the same level, else the level's own
  chars.forEach((c, i) => {
    if (c.script) return;
    const before = i > 0 && chars[i - 1].level === c.level ? chars[i - 1].script : null;
    let after: FontScript | null = null;
    for (let j = i + 1; j < chars.length && chars[j].level === c.level && !after; j++) after = chars[j].script;
    c.script = before ?? after ?? (c.level % 2 ? 'arabic' : 'latin');
  });

  // runs of one level and one font, in the line's own order
  const runs: { level: number; script: FontScript; chars: typeof chars }[] = [];
  for (const c of chars) {
    const last = runs[runs.length - 1];
    if (last && last.level === c.level && last.script === c.script) last.chars.push(c);
    else runs.push({ level: c.level, script: c.script!, chars: [c] });
  }

  // as seen (rule L2): from the highest level down to the lowest odd one, every stretch of runs at that level or higher
  // is reversed
  const highest = Math.max(...runs.map((r) => r.level));
  const lowestOdd = Math.min(...runs.map((r) => (r.level % 2 ? r.level : Infinity)));
  for (let level = highest; level >= lowestOdd && Number.isFinite(lowestOdd); level--) {
    for (let i = 0; i < runs.length; ) {
      if (runs[i].level < level) {
        i++;
        continue;
      }
      let j = i;
      while (j < runs.length && runs[j].level >= level) j++;
      runs.splice(i, j - i, ...runs.slice(i, j).reverse());
      i = j;
    }
  }

  return runs.map((run): TextRun => {
    const text = run.chars.map((c) => c.ch).join('');
    if (run.level % 2 === 0) return { script: run.script, text, direction: 'ltr' };
    // Arabic letters: the engine joins them and turns them round; anything else is turned round and mirrored here
    if (run.chars.some((c) => isArabic(c.ch.codePointAt(0)!))) return { script: run.script, text, direction: 'rtl' };
    const seen = run.chars.map((c) => mirrored.get(c.index) ?? c.ch).reverse();
    return { script: run.script, text: seen.join(''), direction: 'ltr' };
  });
}

/**
 * How wide a line prints at 1 point: its runs laid out as the PDF prints them (embed.ts), so its width at any size is
 * this times the size.
 */
export function naturalWidth(line: string, bold = false, direction: LineDirection = 'auto'): number {
  return visualRuns(line, bold, direction).reduce((sum, run) => {
    const { font } = fontFile(run.script, bold);
    const laidOut = font.layout(run.text, undefined, undefined, undefined, run.direction);
    const advance = laidOut.glyphs.reduce((w, glyph, i) => w + (laidOut.positions?.[i]?.xAdvance ?? glyph.advanceWidth), 0);
    return sum + advance / font.unitsPerEm;
  }, 0);
}

/** The font a single character (a box's) is printed in. */
export function charScript(ch: string, bold = false): FontScript {
  const cp = ch.codePointAt(0) ?? 0;
  const inArabic = fontFile('arabic', bold).font.hasGlyphForCodePoint(cp);
  if (isArabic(cp)) return inArabic || !fontFile('latin', bold).font.hasGlyphForCodePoint(cp) ? 'arabic' : 'latin';
  return fontFile('latin', bold).font.hasGlyphForCodePoint(cp) || !inArabic ? 'latin' : 'arabic';
}
