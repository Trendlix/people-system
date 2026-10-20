import { CHECK_IN_REMINDER_EVERY_MINUTES, safeNotificationLink, timeOfDayText, type CheckInReminderView } from '@trendlix/shared';
import { isPublicPath } from './public-paths';
import { APP_PATHS } from './surface';

// The check-in reminder as a popup (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave
// every 10 minutes. like a popup"; asked, from the "Shift start", stopping "After 2 hours", "No, always on"): on the site
// and the phone pages, asked of the API on load and every 10 minutes as a background request (it never keeps an idle
// session alive), shown while the API says it is due: "You haven't checked in yet", "Your shift started at 9:00 AM",
// with Check in (the check-in panel: My Attendance on the site, Home on the phone pages) and Remind me in 10 minutes.
// Never while viewing as someone (the layouts leave it out, and the API says not due), never on the sign-in or public
// pages. Pure code (no "@/" imports): tested.

/** Where the popup is shown: the site (with the sidebar), or the phone pages (/app). */
export type ReminderSurface = 'site' | 'app';

/** How often the popup asks again, and how long Remind me in 10 minutes puts it off: the reminder's 10 minutes. */
export const POPUP_EVERY_MS = CHECK_IN_REMINDER_EVERY_MINUTES * 60_000;

/** The popup's words: its heading (Title Case), its line, and the two buttons (sentence case). */
export const POPUP_TEXT = {
  title: 'You Haven’t Checked In Yet',
  checkIn: 'Check in',
  later: 'Remind me in 10 minutes',
} as const;

/** "Your shift started at 9:00 AM" (12-hour, as the shift's start says); without a time, "Your shift has started". */
export function popupLine(shiftStart: string | null | undefined): string {
  const time = typeof shiftStart === 'string' ? timeOfDayText(shiftStart) : '';
  return /\d/.test(time) && /[AP]M$/.test(time) ? `Your shift started at ${time}` : 'Your shift has started';
}

/** The API's answer as the popup reads it; anything else (an older API, a failure, signed out): null, so nothing shows. */
export function checkInReminderOf(answer: unknown): CheckInReminderView | null {
  if (!answer || typeof answer !== 'object') return null;
  const a = answer as Partial<Record<keyof CheckInReminderView, unknown>>;
  if (typeof a.due !== 'boolean') return null;
  return {
    due: a.due,
    shiftStart: typeof a.shiftStart === 'string' ? a.shiftStart : null,
    checkInPath: safeNotificationLink(a.checkInPath) ?? '/my-attendance',
  };
}

/** Where Check in goes: the site's check-in panel (the API's page, My Attendance), or the phone pages' Home. */
export function checkInHref(surface: ReminderSurface, reminder: Pick<CheckInReminderView, 'checkInPath'> | null): string {
  if (surface === 'app') return APP_PATHS.home;
  return safeNotificationLink(reminder?.checkInPath) ?? '/my-attendance';
}

// ---------- Remind me in 10 minutes: kept in the browser, for every tab of the site ----------

/** Where the browser keeps until when the popup is put off (a moment in ms). */
export const SNOOZE_KEY = 'trendlix-people:check-in-reminder-snoozed-until';

/** Until when the popup is put off (ms); 0 when it isn't, or storage is blocked. */
export function snoozedUntil(storage: Pick<Storage, 'getItem'> | null | undefined): number {
  try {
    const value = Number(storage?.getItem(SNOOZE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Puts the popup off for 10 minutes from `now`, answering until when; with storage blocked, this page only remembers it. */
export function snooze(storage: Pick<Storage, 'setItem'> | null | undefined, now: number): number {
  const until = now + POPUP_EVERY_MS;
  try {
    storage?.setItem(SNOOZE_KEY, String(until));
  } catch {
    // a private window, or storage blocked: the page keeps it itself
  }
  return until;
}

/**
 * Whether the popup shows: the API says it is due, it isn't put off (here, or in another tab), and the page isn't the
 * sign-in page or a public one (a candidate's offer). `until`: the latest moment it was put off till (this page's or the
 * browser's).
 */
export function popupShows(reminder: CheckInReminderView | null, input: { now: number; until: number; pathname: string | null }): boolean {
  if (!reminder?.due) return false;
  if (input.pathname && (isPublicPath(input.pathname) || input.pathname.startsWith('/login'))) return false;
  return input.now >= input.until;
}

/** When to ask again: in 10 minutes, or once the popup is no longer put off when that is later. */
export function nextAskIn(now: number, until: number): number {
  return Math.max(POPUP_EVERY_MS, until - now);
}

// ---------- the focus kept inside the popup ----------

/**
 * Where Tab moves the focus among the popup's `count` controls from the one at `current` (-1: none of them): the next,
 * or the one before with Shift, wrapping round, so it never leaves the popup.
 */
export function trappedFocus(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}
