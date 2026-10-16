// Searching a drop-down list by typing (owner's request, 16 October 2026: "make any drop list searchable when typing
// anything in the field"). components/select.tsx shows the list; this is what it shows for what was typed. Pure code,
// tested.

/** One option of a drop-down list, as the list shows it. */
export interface ListOption {
  value: string;
  label: string;
  disabled: boolean;
  /** The <optgroup> it is in; null when it isn't in one. */
  group: string | null;
}

const ARABIC_MARKS = /[ً-ٰٟـ]/g; // diacritics, the superscript alef and the tatweel
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * Text as it is compared: lower case, without accents, Arabic diacritics or tatweel, every alef with a hamza or madda
 * as a bare alef, ة as ه and ى as ي, Arabic-Indic digits as 0–9, and runs of spaces as one. So "قاهرة" finds "القاهره",
 * "Cafe" finds "Café" and "٢٠٢٦" finds "2026".
 */
export function searchable(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d >= '۰' ? 0x06f0 : 0x0660)) % 10))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words of what was typed, as compared. */
const wordsOf = (query: string) => searchable(query).split(' ').filter(Boolean);

/** Whether a label has every word typed in it, in any order and anywhere: "sales eg" finds "Sales · Egypt". */
export function matches(label: string, query: string): boolean {
  const text = searchable(label);
  return wordsOf(query).every((w) => text.includes(w));
}

/** 0 when the label starts with what was typed, 1 when one of its words does, 2 otherwise: the better matches first. */
function rank(label: string, query: string): number {
  const text = searchable(label);
  const typed = searchable(query);
  if (text.startsWith(typed)) return 0;
  return text.split(/[\s\-–—·/(),.]+/).some((w) => w.startsWith(typed)) ? 1 : 2;
}

/**
 * The options shown for what was typed: every option when nothing is, else the ones that match, the better matches
 * first within each group and otherwise in the list's own order. Groups stay in their order, and a group with no match
 * is left out.
 */
export function shownOptions(options: readonly ListOption[], query: string): ListOption[] {
  if (!wordsOf(query).length) return [...options];
  const found = options.filter((o) => matches(o.label, query));
  const groups = [...new Set(found.map((o) => o.group))];
  return groups.flatMap((g) =>
    found
      .filter((o) => o.group === g)
      .map((o, i) => ({ o, i, r: rank(o.label, query) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ o }) => o),
  );
}

/**
 * The option to move to from `from` going `step` (1 down, −1 up), passing over the ones that can't be chosen; `from`
 * itself when there is none further. From −1 going down: the first that can be chosen; −1 when none can.
 */
export function nextChoosable(options: readonly ListOption[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i;
  return from >= 0 && from < options.length && !options[from].disabled ? from : -1;
}

/** Where the highlight starts: on the option chosen when it is shown, else on the first that can be chosen. */
export function startingOption(options: readonly ListOption[], chosen: string): number {
  const at = options.findIndex((o) => o.value === chosen && !o.disabled);
  return at >= 0 ? at : nextChoosable(options, -1, 1);
}
