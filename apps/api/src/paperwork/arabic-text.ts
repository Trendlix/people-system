// Arabic text read by the OCR service varies in ways a reader ignores: hamza forms, ة or ه, ى or ي, tatweel,
// diacritics, Arabic-Indic or Latin digits. Search and the ID card reader compare text after making it uniform, and
// search does the same in SQL with translate(), so both sides of a comparison are always treated alike.

const PAIRS: [string, string][] = [
  ['أ', 'ا'], // أ → ا
  ['إ', 'ا'], // إ → ا
  ['آ', 'ا'], // آ → ا
  ['ٱ', 'ا'], // ٱ → ا
  ['ة', 'ه'], // ة → ه
  ['ى', 'ي'], // ى → ي
  ['ی', 'ي'], // ی (Persian yeh, which OCR sometimes reads for ي or ى) → ي
  ['ک', 'ك'], // ک (Persian kaf) → ك
  ...digits(0x0660), // ٠-٩
  ...digits(0x06f0), // ۰-۹ (Persian forms)
];

// tatweel, the harakat (fathatan … wavy hamza below) and superscript alef
const REMOVED = [0x0640, ...Array.from({ length: 0x065f - 0x064b + 1 }, (_, i) => 0x064b + i), 0x0670].map((c) =>
  String.fromCharCode(c),
);

/** The `from` and `to` arguments of SQL translate(): characters past the end of `to` are removed. */
export const NORMALIZE_FROM = PAIRS.map(([from]) => from).join('') + REMOVED.join('');
export const NORMALIZE_TO = PAIRS.map(([, to]) => to).join('');

const MAP = new Map<string, string>([...PAIRS, ...REMOVED.map((c): [string, string] => [c, ''])]);

function digits(zero: number): [string, string][] {
  return Array.from({ length: 10 }, (_, d): [string, string] => [String.fromCharCode(zero + d), String(d)]);
}

/** Arabic-Indic digits (٠-٩ and ۰-۹) become 0-9; nothing else changes. */
export function latinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => MAP.get(d)!);
}

/**
 * The uniform text, and for each of its characters the position in the original text it came from. Lower case
 * (for Latin text), one form of each letter, Latin digits, no tatweel or diacritics, and single spaces.
 */
function uniform(text: string): { value: string; from: number[] } {
  let value = '';
  const from: number[] = [];
  let at = 0;
  for (const ch of text) {
    for (const lower of ch.toLowerCase()) {
      let c = MAP.get(lower) ?? lower;
      if (c === '') continue;
      if (/\s/.test(c)) {
        if (value === '' || value.endsWith(' ')) continue;
        c = ' ';
      }
      value += c;
      from.push(at);
    }
    at += ch.length;
  }
  return { value, from };
}

/** Text made uniform for comparing: "إقـرار  رقم ٤٥" → "اقرار رقم 45". */
export function normalizeArabic(text: string): string {
  return uniform(text).value.trim();
}

/**
 * Up to `radius` characters of `text` on each side of the first place where `needle` (already normalised) appears,
 * as written, on one line: "… استلام العهدة رقم ٤٥٦٧ بتاريخ …". The start of the text if it does not appear.
 */
export function snippet(text: string, needle: string, radius = 60): string {
  const { value, from } = uniform(text);
  const found = needle ? value.indexOf(needle) : -1;
  const last = found >= 0 ? from[found + needle.length - 1] : 0;
  const matchStart = found >= 0 ? from[found] : 0;
  const matchEnd = found >= 0 ? last + String.fromCodePoint(text.codePointAt(last)!).length : 0;
  // whole words only, but never cutting into the match
  let start = Math.max(0, matchStart - radius);
  let end = Math.min(text.length, matchEnd + radius);
  if (start > 0) start = Math.min(wordStart(text, start), matchStart);
  if (end < text.length) end = Math.max(wordEnd(text, end), matchEnd);
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '… ' : ''}${excerpt}${end < text.length ? ' …' : ''}`;
}

function wordStart(text: string, at: number): number {
  const space = text.slice(at).search(/\s/);
  return space >= 0 ? at + space : at;
}

function wordEnd(text: string, at: number): number {
  const before = text.slice(0, at);
  const m = /\s\S*$/.exec(before);
  return m ? m.index : at;
}
