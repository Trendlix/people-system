import {
  HOURS_CHANGE_KINDS,
  HOURS_CHANGE_LABELS,
  interviewDefaultsProblems,
  noticeText,
  WEEKDAY_LABELS,
  windowText,
  type HoursChange,
  type HoursChangeKind,
  type InterviewDefaults,
  type InterviewHours,
} from '@trendlix/shared';
import { formatDate, formatTime, parseDate, parseTime } from './format';

// Interview hours on the website (owner, 25 October 2026: "is it better for each interviewer to add his available
// interviews timeslots?"; asked, "Hours + calendar": each interviewer sets weekly interview hours once, on their own
// Account page; HR, the CEO and a Super Admin can set anyone's). What the hours form shows and sends: the weekly ranges
// by weekday (the 12-hour time picker's "10:00 AM"), the day they count from (DD/MM/YYYY), the minimum notice and the
// buffer (the company's, or stricter), and the one-off changes (a day off from interviews, extra hours on a date); the
// company's defaults' form; and the words of the lists. Pure code (relative imports), tested in interview-hours.test.ts;
// the API checks everything again (packages/shared interviewHoursProblems).

/** The notice choices (hours) and the buffer choices (minutes) offered beside the company's own. */
export const NOTICE_CHOICES: readonly number[] = [0, 2, 4, 8, 12, 24, 48, 72, 96, 120, 168, 336];
export const BUFFER_CHOICES: readonly number[] = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

export interface Choice {
  value: string;
  label: string;
}

const minutesText = (m: number) => (m === 1 ? '1 minute' : `${m} minutes`);

/** The choices stricter than `company`, after "The company's (…)" (sent as empty), and the saved one if off the list. */
function stricter(choices: readonly number[], company: number, saved: number | null | undefined, text: (n: number) => string): Choice[] {
  const values = new Set(choices.filter((n) => n > company));
  if (typeof saved === 'number' && saved > company) values.add(saved);
  return [{ value: '', label: `The company’s (${text(company)})` }, ...[...values].sort((a, b) => a - b).map((n) => ({ value: String(n), label: text(n) }))];
}

/** "Minimum notice": the company's, or longer. */
export const noticeOptions = (defaults: InterviewDefaults, saved?: number | null): Choice[] => stricter(NOTICE_CHOICES, defaults.noticeHours, saved, noticeText);

/** "Buffer between interviews": the company's, or longer. */
export const bufferOptions = (defaults: InterviewDefaults, saved?: number | null): Choice[] => stricter(BUFFER_CHOICES, defaults.bufferMinutes, saved, minutesText);

/** The company's own choices: every notice and buffer offered, and the saved one. */
export function defaultChoices(saved: InterviewDefaults): { notice: Choice[]; buffer: Choice[] } {
  const all = (choices: readonly number[], value: number, text: (n: number) => string) =>
    [...new Set([...choices, value])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: text(n) }));
  return { notice: all(NOTICE_CHOICES, saved.noticeHours, noticeText), buffer: all(BUFFER_CHOICES, saved.bufferMinutes, minutesText) };
}

// ---------- the form's rows ----------

/** A weekly range as the form shows it: its weekday, and its times on the 12-hour clock ("10:00 AM"). */
export interface RangeRow {
  day: number;
  from: string;
  to: string;
}

/** A one-off change as the form shows it: its kind, its date (DD/MM/YYYY), extra hours' times ("" for a day off). */
export interface ChangeRow {
  kind: HoursChangeKind;
  date: string;
  from: string;
  to: string;
}

/** The form's rows from the saved hours (none: an empty week). */
export function rowsOf(hours: InterviewHours | null): { ranges: RangeRow[]; changes: ChangeRow[] } {
  return {
    ranges: (hours?.windows ?? []).map((w) => ({ day: w.day, from: formatTime(w.from), to: formatTime(w.to) })),
    changes: (hours?.changes ?? []).map((c) => ({ kind: c.kind, date: formatDate(c.date), from: formatTime(c.from), to: formatTime(c.to) })),
  };
}

const all = (fd: FormData, name: string): string[] => fd.getAll(name).map((v) => (typeof v === 'string' ? v.trim() : ''));
const text = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** A whole number from a select, '' (the company's) as null; NaN for anything else. */
const optionalNumber = (v: string): number | null => (v === '' ? null : /^\d+$/.test(v) ? Number(v) : Number.NaN);

/**
 * The hours form read: each weekly range (the rows' windowDay, windowFrom and windowTo in order; a row left empty is
 * dropped), each one-off change (changeKind, changeDate, changeFrom, changeTo), the day they count from, the notice and
 * the buffer. Every problem the form itself can see, in words; the API checks the rest.
 */
export function hoursFormBody(fd: FormData): { body: InterviewHours | null; errors: string[] } {
  const errors: string[] = [];
  const days = all(fd, 'windowDay');
  const froms = all(fd, 'windowFrom');
  const tos = all(fd, 'windowTo');
  const windows: InterviewHours['windows'] = [];
  days.forEach((d, i) => {
    const day = Number(d);
    const label = WEEKDAY_LABELS[day] ?? 'Each';
    const rawFrom = froms[i] ?? '';
    const rawTo = tos[i] ?? '';
    if (!rawFrom && !rawTo) return;
    const from = parseTime(rawFrom);
    const to = parseTime(rawTo);
    if (!Number.isInteger(day) || day < 0 || day > 6) errors.push('Each range needs its weekday.');
    else if (!from || !to) errors.push(`Give ${label}’s range a start and an end time.`);
    else windows.push({ day, from, to });
  });

  const kinds = all(fd, 'changeKind');
  const dates = all(fd, 'changeDate');
  const changeFroms = all(fd, 'changeFrom');
  const changeTos = all(fd, 'changeTo');
  const changes: HoursChange[] = [];
  kinds.forEach((k, i) => {
    if (!(HOURS_CHANGE_KINDS as readonly string[]).includes(k)) {
      errors.push('Say whether each one-off change is a day off or extra hours.');
      return;
    }
    const kind = k as HoursChangeKind;
    const date = parseDate(dates[i] ?? '');
    if (!date) {
      errors.push(`Give the ${kind === 'off' ? 'day off' : 'extra hours'} a date, as DD/MM/YYYY.`);
      return;
    }
    if (kind === 'off') {
      changes.push({ date, kind, from: null, to: null });
      return;
    }
    const from = parseTime(changeFroms[i] ?? '');
    const to = parseTime(changeTos[i] ?? '');
    if (!from || !to) errors.push(`Give the extra hours on ${formatDate(date)} a start and an end time.`);
    else changes.push({ date, kind, from, to });
  });

  const effectiveFrom = parseDate(text(fd, 'effectiveFrom'));
  if (!effectiveFrom) errors.push('Give the day the weekly hours count from, as DD/MM/YYYY.');
  const noticeHours = optionalNumber(text(fd, 'noticeHours'));
  const bufferMinutes = optionalNumber(text(fd, 'bufferMinutes'));
  if (Number.isNaN(noticeHours)) errors.push('Choose the minimum notice.');
  if (Number.isNaN(bufferMinutes)) errors.push('Choose the buffer between interviews.');
  const unique = [...new Set(errors)];
  if (unique.length) return { body: null, errors: unique };
  return { body: { windows, changes, effectiveFrom: effectiveFrom!, noticeHours, bufferMinutes }, errors: [] };
}

/** The company's defaults' form read, with the shared checks the API makes. */
export function defaultsFormBody(fd: FormData): { body: InterviewDefaults | null; errors: string[] } {
  const noticeHours = optionalNumber(text(fd, 'noticeHours'));
  const bufferMinutes = optionalNumber(text(fd, 'bufferMinutes'));
  const body = { noticeHours: noticeHours ?? Number.NaN, bufferMinutes: bufferMinutes ?? Number.NaN };
  const errors = interviewDefaultsProblems(body);
  return errors.length ? { body: null, errors } : { body, errors: [] };
}

// ---------- the words ----------

/** "Day off from interviews", or "Extra hours 10:00 AM–12:00 PM". */
export const changeText = (c: Pick<HoursChange, 'kind' | 'from' | 'to'>): string =>
  c.kind === 'extra' && c.from && c.to ? `${HOURS_CHANGE_LABELS.extra} ${windowText({ from: c.from, to: c.to })}` : HOURS_CHANGE_LABELS[c.kind];

/** What a saved form says: saved, or cleared when nothing was left in it. */
export const savedHoursText = (hours: InterviewHours | null): string =>
  hours ? 'Saved. HR sees you free in these hours, less your leave, interviews and busy calendar.' : 'Saved: you have no interview hours now.';

/** The notice and the buffer in effect, in words: "24 hours’ notice · 15 minutes between interviews". */
export function rulesText(hours: Pick<InterviewHours, 'noticeHours' | 'bufferMinutes'> | null, defaults: InterviewDefaults): string {
  const notice = Math.max(defaults.noticeHours, hours?.noticeHours ?? 0);
  const buffer = Math.max(defaults.bufferMinutes, hours?.bufferMinutes ?? 0);
  const n = noticeText(notice);
  return `${notice === 0 ? 'No minimum notice' : `${n}${n.endsWith('s') ? '’' : '’s'} notice`} · ${buffer === 0 ? 'no buffer' : minutesText(buffer)} between interviews`;
}

/** The address of someone's hours, for HR (Organization → Interview Hours). */
export const INTERVIEW_HOURS_SETUP_PATH = '/organization/interview-hours';
export const interviewHoursHref = (employeeId: string) => `${INTERVIEW_HOURS_SETUP_PATH}/${encodeURIComponent(employeeId)}`;
