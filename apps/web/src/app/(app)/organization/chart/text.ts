// Text on the org chart: the fonts it is drawn with, how wide a piece of text is, and how a name goes onto lines and is
// shortened with "…" when it doesn't fit. Pure but for `canvasMeasure`, which asks the browser; tested in text.test.ts.
//
// The chart is an SVG drawn as a picture (on screen, and on a canvas for the PNG and PDF), and a picture can't use the
// page's web fonts, so it uses fonts every computer has: Arial for English, Tahoma (which has Arabic letters on Windows
// and macOS) for Arabic, each with fallbacks. Widths are measured in the browser with those same fonts, and the text is
// fitted a little short of its box (FIT), so the SVG file still fits when opened where Helvetica stands in for Arial.

export type FontName =
  | 'company'
  | 'companyAr'
  | 'companyNote'
  | 'department'
  | 'departmentAr'
  | 'team'
  | 'teamAr'
  | 'title'
  | 'titleAr'
  | 'person'
  | 'personAr'
  | 'code'
  | 'count'
  | 'note'
  | 'heading';

export interface Font {
  /** In pixels (SVG user units). */
  size: number;
  weight: 400 | 600 | 700;
  /** The height of one line, in pixels. */
  lineHeight: number;
  arabic: boolean;
}

const font = (size: number, weight: Font['weight'], lineHeight: number, arabic = false): Font => ({ size, weight, lineHeight, arabic });

export const FONTS: Readonly<Record<FontName, Font>> = {
  company: font(18, 700, 22),
  companyAr: font(14, 400, 19, true),
  companyNote: font(11, 400, 15),
  department: font(14, 700, 18),
  departmentAr: font(12.5, 400, 17, true),
  team: font(13, 700, 17),
  teamAr: font(12, 400, 16, true),
  title: font(12, 600, 15),
  titleAr: font(11.5, 400, 16, true),
  person: font(11, 400, 14),
  personAr: font(11, 400, 15, true),
  code: font(10, 400, 14),
  count: font(11, 700, 14),
  note: font(11, 400, 15),
  heading: font(16, 700, 20),
};

export const LATIN_FAMILY = 'Arial, Helvetica, sans-serif';
export const ARABIC_FAMILY = "Tahoma, 'Segoe UI', 'Geeza Pro', 'Noto Sans Arabic', Arial, sans-serif";

export const familyOf = (name: FontName) => (FONTS[name].arabic ? ARABIC_FAMILY : LATIN_FAMILY);

/** The CSS font of a text, for a canvas: "700 14px Arial, Helvetica, sans-serif". */
export const cssFont = (name: FontName) => `${FONTS[name].weight} ${FONTS[name].size}px ${familyOf(name)}`;

/** How wide `text` is in `font`, in pixels. */
export type Measure = (text: string, font: FontName) => number;

/** The share of a box's width text is fitted to: room for a font a little wider than the one measured. */
export const FIT = 0.96;

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

/** Whether the text has Arabic letters. */
export const hasArabic = (text: string) => ARABIC.test(text);

/**
 * A width close to Arial's, without a browser: for the tests, and wherever no canvas can be had. Each character by its
 * kind: narrow (i, l, punctuation), wide (m, w, capitals), digits, Arabic letters, the rest; bold a little wider.
 */
export const estimateWidth: Measure = (text, name) => {
  const f = FONTS[name];
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.278;
    else if (ch === '…') em += 1;
    else if (/[\u064b-\u065f\u0670]/.test(ch)) em += 0; // Arabic vowel marks sit on the letters
    else if (ARABIC.test(ch)) em += 0.5;
    else if (/[iljtfI.,;:!'|()[\]]/.test(ch)) em += 0.28;
    else if (/[mwMW]/.test(ch)) em += 0.86;
    else if (/[0-9]/.test(ch)) em += 0.556;
    else if (/[A-Z]/.test(ch)) em += 0.68;
    else em += 0.53;
  }
  return em * f.size * (f.weight >= 600 ? 1.06 : 1);
};

/** Widths measured by the browser, on a canvas, with the chart's fonts; remembered, as the same names come back often. */
export function canvasMeasure(): Measure {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!ctx) return estimateWidth;
  const known = new Map<string, number>();
  return (text, name) => {
    const key = `${name}\u0000${text}`;
    let w = known.get(key);
    if (w === undefined) {
      ctx.font = cssFont(name);
      w = ctx.measureText(text).width;
      known.set(key, w);
    }
    return w;
  };
}

/** The text cut short, with "…", to fit `max` pixels; as it is when it fits. Never splits a character made of two. */
export function truncate(text: string, max: number, name: FontName, measure: Measure): string {
  const clean = text.trim();
  if (measure(clean, name) <= max) return clean;
  const chars = Array.from(clean);
  // the longest beginning that fits with the ellipsis: halving, as names can be long
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join('').trimEnd()}…`, name) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '…' : `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/**
 * The text on at most `maxLines` lines of at most `max` pixels each, broken between words; a word longer than a line is
 * broken where it must. What doesn't fit on the last line is cut short with "…". An empty text gives no lines.
 */
export function wrapText(text: string, max: number, name: FontName, measure: Measure, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined, name) <= max) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    // a word wider than a whole line: as much of it as fits on each line
    while (measure(line, name) > max && Array.from(line).length > 1) {
      const chars = Array.from(line);
      let take = chars.length - 1;
      while (take > 1 && measure(chars.slice(0, take).join(''), name) > max) take--;
      lines.push(chars.slice(0, take).join(''));
      line = chars.slice(take).join('');
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  // the last line kept, with as much of the rest as fits, then "…"
  kept[maxLines - 1] = truncate(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, max, name, measure);
  return kept;
}
