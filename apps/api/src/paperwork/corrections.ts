// Learning from HR's corrections to ID card readings (owner's request, 14 October 2026). After a card is read, HR
// fixes misread words before saving; the words changed are remembered as "wrong → right" and applied to the next
// readings. Only the Arabic name and the address are learned: never national ID numbers or dates.

export const LEARNED_FIELDS = ['fullNameAr', 'addressAr'] as const;
export type LearnedField = (typeof LEARNED_FIELDS)[number];

/** A learned fix: whole words as read, and as HR corrected them. */
export interface Correction {
  field: string;
  wrong: string;
  right: string;
}

/** The longest phrase learned as one fix; a longer change is a different value, not a misreading. */
const MAX_WORDS = 4;
// words are separated by spaces and commas (the address joins its lines with "، ")
const SEPARATORS = /[\s،,]+/;

const wordsOf = (text: string) => text.normalize('NFC').trim().split(SEPARATORS).filter(Boolean);

/**
 * The phrases HR changed, as [wrong, right] pairs, from a word-by-word comparison (longest common subsequence).
 * Words only added or only removed teach nothing; neither do changes longer than a few words.
 */
export function changedPhrases(read: string, saved: string): [string, string][] {
  const a = wordsOf(read);
  const b = wordsOf(saved);
  if (!a.length || !b.length) return [];

  // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const pairs: [string, string][] = [];
  let wrong: string[] = [];
  let right: string[] = [];
  const close = () => {
    if (wrong.length && right.length && wrong.length <= MAX_WORDS && right.length <= MAX_WORDS) pairs.push([wrong.join(' '), right.join(' ')]);
    wrong = [];
    right = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      right.push(b[j++]);
    } else {
      wrong.push(a[i++]);
    }
  }
  close();
  return pairs;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text with the learned fixes of its field applied, whole words only, longest phrases first.
 * Returns null when nothing changed.
 */
export function applyCorrections(text: string, corrections: Correction[]): string | null {
  let out = text.normalize('NFC');
  const sorted = [...corrections].sort((x, y) => wordsOf(y.wrong).length - wordsOf(x.wrong).length || y.wrong.length - x.wrong.length);
  for (const { wrong, right } of sorted) {
    const phrase = wordsOf(wrong).map(escape).join('[\\s،,]+');
    if (!phrase) continue;
    out = out.replace(new RegExp(`(^|[\\s،,])${phrase}(?=$|[\\s،,])`, 'gu'), (_m, before: string) => `${before}${right}`);
  }
  return out === text.normalize('NFC') ? null : out;
}
