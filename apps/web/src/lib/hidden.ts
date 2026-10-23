import { HIDDEN } from '@trendlix/shared';

// What a developer is not shown (owner, 22 October 2026: "why is the employment data can be viewed by developer access";
// they chose "Hide per-person details", then "and the social insurance"). The API sends a person's job title,
// department, team, grade, employment type, work arrangement and social insurance texts as "••••" (HIDDEN), their
// employment's and social insurance dates as null, and on the company's pages cuts the people off (no id, "••••" for the
// name). The screens say "Hidden", in muted text, rather than "••••", an empty date, or a label they can't find; and a
// list a developer filters by department or grade isn't narrowed by it (the ids are hidden too). Pure code, tested in
// hidden.test.ts; components/hidden.tsx shows it.

/** What a hidden value reads as on the screens. */
export const HIDDEN_LABEL = 'Hidden';

/**
 * Whether a value is one the API hid from a developer: "••••", or a text made of hidden parts only, as the screens join
 * them ("•••• › ••••" for a team in its department, "•••• · ••••" for a grade).
 */
export function isHidden(value: unknown): boolean {
  return typeof value === 'string' && value.includes(HIDDEN) && value.replace(/[•›·\-–,/\s]/g, '') === '';
}

/** Whether a text is hidden, as the API sent it ("••••") or as a label here put it ("Hidden"). */
export const readsHidden = (value: unknown): boolean => isHidden(value) || value === HIDDEN_LABEL;

/** A text as shown: "Hidden" for a hidden one, else as it is. */
export function shownText<T extends string | null | undefined>(value: T): T | typeof HIDDEN_LABEL {
  return isHidden(value) ? HIDDEN_LABEL : value;
}

/**
 * A value's label from a list (an employment type, a work arrangement): "Hidden" for a hidden value, undefined for one the
 * list doesn't have, so a page never reads a label that isn't there.
 */
export function labelOf(labels: Readonly<Record<string, string>>, value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (isHidden(value)) return HIDDEN_LABEL;
  return Object.hasOwn(labels, value) ? labels[value] : undefined;
}

/**
 * Whether an employment's details came hidden: its employment type is always sent, and for a developer it is "••••";
 * then its join date, probation end and the like are null though it has them.
 */
export const employmentHidden = (e: { employmentType?: string | null } | null | undefined): boolean => isHidden(e?.employmentType);

/**
 * A person the company's pages cut off for a developer: the API sends them without an id (and "••••" for the name), so
 * they are neither named nor linked.
 */
export const personCutOff = (p: { id?: string | null } | null | undefined): boolean => !!p && (p.id === null || p.id === undefined);

/** Whether a developer's filter by department, team or grade applies: never, as those details are hidden. */
export const filtersByJob = (user: { developer?: boolean }): boolean => user.developer !== true;

// ---------- a person's code (owner, 23 October 2026: "in developer view use **** instead of IDs") ----------
// A developer gets every person code as "••••" (an employee's EMP-, an applicant's or general CV's APP-, a candidate's
// CAN-, an offer's OFF-, a contract's CON-) and each name as a tag that isn't the code ("Employee 7K3Q"). Beside a name
// the code part is left out, rather than a dangling "Employee 7K3Q · ••••"; links go by id, so they still work.

/** A person's code as shown: null when the API hid it ("••••") or there is none. */
export function shownCode(code: string | null | undefined): string | null {
  return code && !isHidden(code) ? code : null;
}

/** A name with its code after it ("Omar Khaled · EMP-0182"); the name alone when the code is hidden or missing. */
export function withCode(name: string, code: string | null | undefined, sep = ' · '): string {
  const shown = shownCode(code);
  return shown ? `${name}${sep}${shown}` : name;
}

/** A name with its code in brackets ("Omar Khaled (EMP-0182)"); the name alone when the code is hidden or missing. */
export function withCodeInBrackets(name: string, code: string | null | undefined): string {
  const shown = shownCode(code);
  return shown ? `${name} (${shown})` : name;
}

/**
 * Parts of a line joined (" · "), leaving out the empty and the hidden ones: "EMP-0182 · Editor", or "" when none shows
 * (a developer's line of code, job title and department, all hidden).
 */
export function joinShown(parts: readonly (string | null | undefined | false)[], sep = ' · '): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '' && !isHidden(p)).join(sep);
}
