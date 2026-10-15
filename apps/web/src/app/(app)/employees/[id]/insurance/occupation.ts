// An employee's social insurance occupation (Form 1's كود المهنة; owner, 15 October 2026), set on the profile's Social
// Insurance tab (owner's decision, 16 October 2026: no longer the job title's): how it is written, and what the
// occupation picker lists and how its keys move through the list. Pure code, tested; no "@/" imports, and not the
// occupation table itself (packages/shared occupations.ts): the search is passed in, so the table is only loaded with
// the picker.

/** An occupation of the table: its six-digit code and its Arabic name. */
export type Occupation = readonly [code: string, name: string];

/** Searches the table: the best matches for what was typed, at most `limit` (packages/shared searchOccupations). */
export type OccupationSearch = (query: string, limit: number) => readonly Occupation[];

/** The most the list shows at a time: typing more narrows it down. */
export const OPTIONS_MAX = 30;

/** How far Page Up and Page Down move in the list. */
const PAGE = 10;

/** An occupation as written: "212300 · مدير مبيعات", or the code alone when its name isn't known; "" for none. */
export function occupationLabel(code: string | null | undefined, name?: string | null): string {
  if (!code) return '';
  return name ? `${code} · ${name}` : code;
}

/**
 * What the list shows for what was typed (`query`): the best matches, at most `limit`, and whether there are more.
 * With nothing typed, the chosen occupation first, then the table from the start, to browse.
 */
export function pickerOptions(
  query: string,
  chosen: Occupation | null,
  search: OccupationSearch,
  limit = OPTIONS_MAX,
): { options: Occupation[]; more: boolean } {
  if (query.trim() === '') {
    const rest = search('', limit + 1).filter((o) => o[0] !== chosen?.[0]);
    const all = chosen ? [chosen, ...rest] : rest;
    return { options: all.slice(0, limit), more: true };
  }
  const found = search(query, limit + 1);
  return { options: found.slice(0, limit), more: found.length > limit };
}

/**
 * What was typed in a box that showed the chosen occupation (`label`), now reading `value`: nothing when some of it was
 * deleted (`deleted`: Backspace starts afresh); what was typed before or after it, without it; else the whole of it, as
 * when it was selected and typed over.
 */
export function typedQuery(label: string, value: string, deleted = false): string {
  if (!label) return value;
  if (deleted) return '';
  if (value.startsWith(label)) return value.slice(label.length);
  if (value.endsWith(label)) return value.slice(0, value.length - label.length);
  return value;
}

/** The option to start on when the list opens: the chosen occupation where it is listed, else the first; -1 for none. */
export function startActive(options: readonly Occupation[], chosenCode: string): number {
  if (options.length === 0) return -1;
  return Math.max(0, options.findIndex((o) => o[0] === chosenCode));
}

/**
 * The option a key moves to from `active` (-1: none yet) in a list of `count`: Down and Up one at a time, stopping at
 * the ends (Up from none goes to the last); Page Down and Page Up ten at a time. Undefined for any other key, which is
 * the text box's (Home and End move in the typed text).
 */
export function moveActive(key: string, active: number, count: number): number | undefined {
  if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(key)) return undefined;
  if (count <= 0) return -1;
  const from = Math.min(active, count - 1);
  switch (key) {
    case 'ArrowDown':
      return Math.min(from + 1, count - 1);
    case 'ArrowUp':
      return from < 0 ? count - 1 : Math.max(from - 1, 0);
    case 'PageDown':
      return Math.min(Math.max(from, 0) + PAGE, count - 1);
    default:
      return from < 0 ? 0 : Math.max(from - PAGE, 0);
  }
}

/** What the foot of the list says (also read out): nothing found, the first matches only, or how many. */
export function listStatus(query: string, count: number, more: boolean): string {
  const q = query.trim();
  if (q === '') return 'Type part of the name, or the code.';
  if (count === 0) return `No occupation matches “${q}”. Try fewer letters, or the code.`;
  if (more) return `The first ${count} matches. Type more to narrow them down.`;
  return count === 1 ? '1 match.' : `${count} matches.`;
}
