import {
  AVAILABILITY_DAYS,
  AVAILABILITY_LENGTHS,
  isInterviewKind,
  panelNames,
  type AvailabilityDayView,
  type AvailabilityInput,
  type AvailabilityPerson,
  type AvailabilitySlotView,
  type AvailabilityView,
  type InterviewKind,
  type SlotStatus,
  type TimeCheckInput,
} from '@trendlix/shared';
import { addDays, MONTH_NAMES, todayInCairo, WEEKDAY_NAMES } from '../../../lib/date-picker';
import { formatDate, formatTime, parseDate, parseTime } from '../../../lib/format';

// "Find a time" in the interview form (owner, 25 October 2026: "is it better for each interviewer to add his available
// interviews timeslots?"; asked, "Hours + calendar" and, for booking, "HR only"): HR chooses the interviewers, the length
// (30, 45, 60 or 90 minutes), how it is held and the days (the next 14 unless chosen), and sees the times all of them are
// free, grouped by day; each time says who is free, and is marked where someone is only "maybe" (a request still being
// decided, or a calendar that couldn't be checked) or has no interview hours. Picking one fills the form's day and time.
// A time typed by hand is checked too, and saved all the same: its conflicts are warnings, never a refusal. Someone's
// leave is only ever "unavailable" (the API's words), never its type. Pure code (relative imports), tested in
// availability.test.ts; the API works the times out and checks everything again.

/** The length "Find a time" starts on when the form's isn't one it offers. */
export const STANDARD_FIND_LENGTH = 45;

/** "Find a time"'s days to start with: today in Cairo and the 13 after it (the next 14 days). */
export function defaultRange(today: string = todayInCairo()): { from: string; to: string } {
  return { from: today, to: addDays(today, AVAILABILITY_DAYS.standard - 1) };
}

/** The length "Find a time" starts on: the form's own when it offers it (30, 45, 60, 90), else 45 minutes. */
export const findLength = (minutes: number): number => ((AVAILABILITY_LENGTHS as readonly number[]).includes(minutes) ? minutes : STANDARD_FIND_LENGTH);

/** "30 minutes", "1 hour", "1.5 hours": a length as the lists write it. */
export const lengthText = (m: number): string => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);

const text = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** The interview form's panel as it stands: the interviewers ticked, how it is held, its length. */
export function panelOf(fd: FormData): { interviewerIds: string[]; kind: InterviewKind | null; minutes: number | null } {
  const interviewerIds = fd.getAll('interviewerIds').filter((v): v is string => typeof v === 'string' && v !== '');
  const kind = text(fd, 'kind');
  const minutes = Number(text(fd, 'minutes'));
  return { interviewerIds: [...new Set(interviewerIds)], kind: isInterviewKind(kind) ? kind : null, minutes: Number.isInteger(minutes) && minutes > 0 ? minutes : null };
}

/**
 * "Find a time"'s question from the interview form (its interviewers and how it is held) and the panel's own fields:
 * `findMinutes`, and the days `findFrom` and `findTo` as typed (DD/MM/YYYY). Every problem the page can see, in words.
 */
export function availabilityQuestion(fd: FormData, interviewId?: string | null): { input: AvailabilityInput | null; errors: string[] } {
  const panel = panelOf(fd);
  const errors: string[] = [];
  if (!panel.interviewerIds.length) errors.push('Choose who interviews them first.');
  if (!panel.kind) errors.push('Choose how it is held.');
  const minutes = Number(text(fd, 'findMinutes'));
  if (!(AVAILABILITY_LENGTHS as readonly number[]).includes(minutes)) errors.push('Choose the length: 30, 45, 60 or 90 minutes.');
  const from = parseDate(text(fd, 'findFrom'));
  const to = parseDate(text(fd, 'findTo'));
  if (!from || !to) errors.push('Give the days to look in, as DD/MM/YYYY.');
  else if (to < from) errors.push('The last day comes after the first.');
  if (errors.length) return { input: null, errors };
  return { input: { interviewerIds: panel.interviewerIds, minutes, kind: panel.kind!, from: from!, to: to!, ...(interviewId && { interviewId }) }, errors: [] };
}

/** "Check this time"'s question: the form's day (DD/MM/YYYY), time ("10:30 AM"), length, how it is held and interviewers. */
export function timeCheckQuestion(fd: FormData, interviewId?: string | null): { input: TimeCheckInput | null; errors: string[] } {
  const panel = panelOf(fd);
  const errors: string[] = [];
  const date = parseDate(text(fd, 'date'));
  const time = parseTime(text(fd, 'time'));
  if (!date) errors.push('Choose the day of the interview, as DD/MM/YYYY.');
  if (!time) errors.push('Choose the time of the interview.');
  if (!panel.minutes) errors.push('Choose how long it takes.');
  if (!panel.kind) errors.push('Choose how it is held.');
  if (!panel.interviewerIds.length) errors.push('Choose who interviews them.');
  if (errors.length) return { input: null, errors };
  return { input: { interviewerIds: panel.interviewerIds, date: date!, time: time!, minutes: panel.minutes!, kind: panel.kind!, ...(interviewId && { interviewId }) }, errors: [] };
}

// ---------- the list ----------

const partsOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) });

/** A day's heading in Title Case: "Sunday 1 November", its year too when it isn't this year's. */
export function dayHeading(date: string, today: string = todayInCairo()): string {
  const { year, month, day } = partsOf(date);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTH_NAMES[month - 1]}${year === partsOf(today).year ? '' : ` ${year}`}`;
}

const STATUS_WORDS: Readonly<Record<SlotStatus, string>> = { free: 'free', maybe: 'maybe', no_hours: 'no interview hours set' };

/** A time as the list shows it. */
export interface SlotItem {
  start: string;
  /** "10:30": the time as the API gives it, which picking it fills. */
  hhmm: string;
  /** "10:30 AM". */
  time: string;
  /** Who is free: "Free", "Ahmed and Sara free", or "Ahmed free · Sara: maybe". */
  who: string;
  /** Each one not plainly free, in words: "Sara: maybe". */
  why: string[];
  marked: boolean;
  /** The time's words for a screen reader: "10:30 AM, Ahmed free · Sara: maybe". */
  label: string;
}

/** A day of the list: its heading, a public holiday's name, and its times. */
export interface SlotGroup {
  date: string;
  heading: string;
  holiday: string | null;
  slots: SlotItem[];
}

/** "Ahmed", "Ahmed and Sara", "Ahmed, Sara and Omar". */
const and = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Who a time suits, in words, with the panel's first names (the full name where two share one). */
export function slotItem(slot: AvailabilitySlotView, people: readonly Pick<AvailabilityPerson, 'employeeId' | 'name'>[]): SlotItem {
  const names = panelNames(people.map((p) => ({ id: p.employeeId, name: p.name })));
  const nameOf = (id: string) => names.get(id) ?? 'Someone';
  const free = slot.people.filter((p) => p.status === 'free').map((p) => nameOf(p.employeeId));
  const why = slot.people.filter((p) => p.status !== 'free').map((p) => `${nameOf(p.employeeId)}: ${STATUS_WORDS[p.status]}`);
  const alone = slot.people.length === 1;
  const freeText = free.length ? (alone ? 'Free' : free.length === slot.people.length ? 'All free' : `${and(free)} free`) : '';
  const who = [freeText, ...why].filter(Boolean).join(' · ');
  const time = formatTime(slot.time);
  return { start: slot.start, hhmm: slot.time, time, who, why, marked: slot.marked, label: `${time}, ${who}` };
}

/** The list grouped by day, in order: the days with times, and a holiday without any said as one. */
export function slotGroups(view: Pick<AvailabilityView, 'days' | 'people'>, today: string = todayInCairo()): SlotGroup[] {
  return view.days
    .filter((d: AvailabilityDayView) => d.slots.length > 0 || d.holiday)
    .map((d) => ({ date: d.date, heading: dayHeading(d.date, today), holiday: d.holiday, slots: d.slots.map((s) => slotItem(s, view.people)) }));
}

/** How many times the list has: "12 free times", "1 free time". */
export function slotCountText(view: Pick<AvailabilityView, 'days'>): string {
  const n = view.days.reduce((sum, d) => sum + d.slots.length, 0);
  return n === 1 ? '1 free time' : `${n} free times`;
}

/** How each one's calendar was read, in words, for the line under the list; null when nothing is worth saying. */
export function calendarText(p: Pick<AvailabilityPerson, 'name' | 'calendar' | 'sources' | 'reconnect'>, name: string = p.name): string | null {
  if (p.calendar === 'failed') return `Couldn’t check ${name}’s calendar.`;
  if (p.calendar === 'checked' && p.sources.length) return `${name}: ${and(p.sources)} checked.`;
  if (p.reconnect) return `${name}: reconnect their Google account to share busy times.`;
  return null;
}

/** What picking a time fills in the form: the day as DD/MM/YYYY, the time on the 12-hour clock ("10:30 AM"), the length. */
export function pickedFields(date: string, slot: Pick<AvailabilitySlotView, 'time'>, minutes: number): { date: string; time: string; minutes: string } {
  return { date: formatDate(date), time: formatTime(slot.time), minutes: String(minutes) };
}

// ---------- the warnings ----------

/** What starts the warnings in a save's message (meetings.ts interviewSavedText). */
export const SAVED_WITH_WARNINGS = 'Saved with warnings:';

/** A save's message with the time's warnings after it: "… Saved with warnings: Sara has another interview at 2:30 PM." */
export function withWarnings(message: string, warnings: readonly string[] | null | undefined): string {
  const list = (warnings ?? []).map((w) => w.trim()).filter(Boolean);
  return list.length ? `${message} ${SAVED_WITH_WARNINGS} ${list.join(' ')}` : message;
}

/** A save's message split back into its words and the warnings after them (shown apart, as warnings). */
export function savedWarnings(message: string | undefined): { text: string; warnings: string[] } {
  if (!message) return { text: '', warnings: [] };
  const at = message.indexOf(SAVED_WITH_WARNINGS);
  if (at < 0) return { text: message, warnings: [] };
  const rest = message.slice(at + SAVED_WITH_WARNINGS.length).trim();
  return {
    text: message.slice(0, at).trim(),
    warnings: rest
      .split(/(?<=[.!?])\s+(?=[A-Z“"])/)
      .map((w) => w.trim())
      .filter(Boolean),
  };
}

/** "Check this time"'s answer in words: its warnings, or that it suits them all. */
export const checkSummary = (warnings: readonly string[]): string => (warnings.length ? (warnings.length === 1 ? '1 thing to know about this time:' : `${warnings.length} things to know about this time:`) : 'No conflicts: the time suits them all.');
