import { CONFIRM_FIELDS, LABELS, REQUESTABLE_FIELD_KEYS, type ConfirmField } from '@trendlix/shared';
import { formatDate, parseDate } from '../../../lib/format';
import type { ChangeRequest, ChangeRequestChange, EmployeeProfile, ProfileConfirmation } from '../../../lib/types';
import { monthFrom, monthShown, studyYearShown } from './student';

// The employee's own check of their details, and their requests to change them (owner's decision, 15 October 2026):
// the words the banner, the profile header and Approvals use, the values as the profile shows them, and which fields
// the change request form changed. Pure, so it is unit tested (confirmation.test.ts).

const FIELD = new Map<string, (typeof CONFIRM_FIELDS)[number]>(CONFIRM_FIELDS.map((f) => [f.key, f]));

/** A field's name in a list of fields, e.g. "Mobile, City": the emergency contact's fields say whose they are. */
export function fieldName(key: string): string {
  const f = FIELD.get(key);
  if (!f) return key;
  return f.section === 'emergency' ? `Emergency contact ${f.label.toLowerCase()}` : f.label;
}

/** "Mobile, City" */
export function fieldNames(keys: readonly string[]): string {
  return keys.map(fieldName).join(', ');
}

/** The fields kept in Arabic, shown right to left. */
export const ARABIC_FIELDS: ReadonlySet<string> = new Set(['fullNameAr', 'city', 'addressAr', 'qualificationAr']);

/** The fields kept as a value from a list, shown by its label. */
const LISTS: Partial<Record<string, Record<string, string>>> = {
  gender: LABELS.gender,
  maritalStatus: LABELS.maritalStatus,
  militaryStatus: LABELS.militaryStatus,
  degree: LABELS.degree,
  educationGrade: LABELS.educationGrade,
};

/**
 * A field's value as the profile shows it: the label of a list's value (Female, Bachelor's…), a date as DD/MM/YYYY,
 * mobiles as kept (+201012345678), a number as text; '' for nothing recorded. A student's (25 October 2026): still
 * studying Yes or No, the year by its label, the expected graduation as its month ("June 2027").
 */
export function shownValue(key: string, value: string | number | boolean | null | undefined): string {
  if (key === 'stillStudying') return value === true ? 'Yes' : value === false ? 'No' : '';
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (key === 'dateOfBirth' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (key === 'studyYear') return studyYearShown(value);
  if (key === 'expectedGraduation') return monthShown(value) || value;
  return LISTS[key]?.[value] ?? value;
}

/** A profile's field as the Basic Data and Education tabs show it: a woman's military status is always Not applicable. */
export function profileValue(p: Pick<EmployeeProfile, ConfirmField>, key: ConfirmField): string {
  if (key === 'militaryStatus' && p.gender === 'female') return LABELS.militaryStatus.not_applicable;
  return shownValue(key, p[key]);
}

// ---------- the confirmation's state, in words ----------

/** The banner for the employee, on every page; null when their confirmation is up to date (or the API has none yet). */
export function bannerMessage(c: ProfileConfirmation | undefined): string | null {
  if (!c || c.upToDate) return null;
  if (!c.confirmedAt) return 'Please review and confirm your details.';
  if (c.changedFields.length === 0) return 'Please review and confirm your details again.';
  return `Your details changed since you confirmed them (${fieldNames(c.changedFields)}). Please review and confirm again.`;
}

/** The line in the profile header, for everyone who sees the profile: confirmed (`ok`), never confirmed (`none`) or changed since. */
export function confirmationStatus(c: ProfileConfirmation | undefined): { tone: 'ok' | 'none' | 'changed'; text: string } | null {
  if (!c) return null;
  if (!c.confirmedAt) return { tone: 'none', text: 'Not confirmed by the employee yet' };
  if (c.upToDate) return { tone: 'ok', text: `Confirmed by the employee on ${formatDate(c.confirmedAt)}` };
  if (c.changedFields.length === 0) return { tone: 'changed', text: `To be confirmed again: last confirmed by the employee on ${formatDate(c.confirmedAt)}` };
  return { tone: 'changed', text: `Changed since the employee confirmed: ${fieldNames(c.changedFields)}` };
}

/** The request waiting for HR, if any (the API allows one at a time). */
export function pendingRequest(requests: readonly ChangeRequest[] | undefined): ChangeRequest | undefined {
  return requests?.find((r) => r.status === 'pending');
}

/** One asked-for change as shown: the field's name, and what it was and what is asked for, as the profile shows them. */
export function changeShown(c: ChangeRequestChange): { name: string; from: string; to: string; ar: boolean } {
  return {
    name: FIELD.has(c.field) ? fieldName(c.field) : c.label || c.field,
    from: shownValue(c.field, c.from),
    to: shownValue(c.field, c.to),
    ar: ARABIC_FIELDS.has(c.field),
  };
}

// ---------- the change request form ----------

/** What the form's fields hold, as typed (dates as DD/MM/YYYY), by field. */
export type FieldTexts = Partial<Record<ConfirmField, string>>;

/**
 * The fields an employee may ask to change that a submitted form has, as text. Others are left out: the employee code,
 * and the work email, which the company sets with the sign-in account (REQUESTABLE_FIELD_KEYS).
 */
export function fieldTexts(fd: FormData): FieldTexts {
  const out: FieldTexts = {};
  for (const key of REQUESTABLE_FIELD_KEYS) {
    const v = fd.get(key);
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

/** The fields as the form started, sent with it as JSON; null when missing or not a set of texts. */
export function parseFieldTexts(raw: unknown): FieldTexts | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: FieldTexts = {};
  for (const key of REQUESTABLE_FIELD_KEYS) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

/**
 * The fields the form has whose text differs from how it started (spaces around it aside), in the order of
 * CONFIRM_FIELDS. Only fields an employee may ask to change: never the work email.
 */
export function changedKeys(start: FieldTexts, now: FieldTexts): ConfirmField[] {
  return REQUESTABLE_FIELD_KEYS.filter((k) => {
    const text = now[k];
    return text !== undefined && text.trim() !== (start[k] ?? '').trim();
  });
}

/**
 * A field's text as the API takes it: null when emptied, a date as YYYY-MM-DD, the graduation year as a number; still
 * studying as true or false, the expected graduation's month as YYYY-MM-01. Mistakes go to `errors`.
 */
export function apiValue(key: ConfirmField, text: string, errors: string[]): string | number | boolean | null {
  const v = text.trim();
  if (key === 'stillStudying') return v === 'true';
  if (v === '') return null;
  if (key === 'expectedGraduation') {
    const month = monthFrom(v);
    if (month) return month;
    errors.push('Enter the expected graduation as a month, e.g. 06/2027.');
    return v;
  }
  if (key === 'dateOfBirth') {
    const date = parseDate(v);
    if (date) return date;
    errors.push('Enter the date of birth as DD/MM/YYYY, e.g. 14/10/2026.');
    return v;
  }
  if (key === 'graduationYear') {
    if (/^\d{4}$/.test(v)) return Number(v);
    errors.push('Enter the graduation year as four digits, e.g. 2016.');
    return v;
  }
  return v;
}

/** What a change request sends: only the fields changed from how the form started, as the API takes them. */
export function requestedChanges(start: FieldTexts, now: FieldTexts): { changes: Partial<Record<ConfirmField, string | number | boolean | null>>; errors: string[] } {
  const errors: string[] = [];
  const changes: Partial<Record<ConfirmField, string | number | boolean | null>> = {};
  for (const key of changedKeys(start, now)) changes[key] = apiValue(key, now[key] ?? '', errors);
  return { changes, errors };
}
