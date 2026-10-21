import { isNotificationKind, NOTIFICATION_KIND_LABELS, notificationSection, PUSH_TOKEN_MAX, REMINDER_KINDS, safeNotificationLink } from '@trendlix/shared';
import { formatDateTime } from './format';
import type { PushRegistration } from './native';
import { APP_PATHS, appAttendanceHref, toAppHref } from './surface';

// Notifications on the web's side (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for
// someone, a check-in reminder)"; apps/mobile/README.md, Phase 4): where a notification opens on the site and on the
// phone pages, the bell's count, the inbox's pages and times, Home's offer of notifications on the phone (put off with
// Not now), the phone's push token kept for signing out, and turning push on. Pure code (no "@/" imports, the steps
// given): tested.

/** Where the inbox is shown: the site (with the sidebar), or the phone pages (/app). */
export type InboxSurface = 'site' | 'app';

/** The inbox on each. */
export const INBOX_PATHS: Record<InboxSurface, string> = { site: '/notifications', app: '/app/notifications' };

const isReminder = (kind: string) => (REMINDER_KINDS as readonly string[]).includes(kind);

/** The path of an address, without its ?query and #part. */
const pathOf = (href: string) => href.split(/[?#]/, 1)[0];

/** Whether an address is under `base` ("/app" itself, "/app/…", "/app?…", "/app#…"), not "/appendix". */
const isUnder = (href: string, base: string) => {
  const path = pathOf(href);
  return path === base || path.startsWith(`${base}/`);
};

/**
 * Where a notification opens. The site: its link as it is. The phone pages: a link already under /app as it is (a
 * payslip's, "/app/payslips/<lineId>"); the two reminders on Home (its check-in); My Attendance as the phone's
 * Attendance (its month kept); a request's page as the same request's in To Approve (what waits for the person) or in
 * their own requests (lib/surface.ts toAppHref), any other page as that section's list. A link that isn't one address on
 * this site (not starting with a single "/") opens nothing: null, as for no link. Custody (Assets step 3, 21 October
 * 2026): My custody ("/my-custody") as the phone's My Custody, and a custody record ("/assets/custody/CUS-0042") as the
 * same record in the phone layout.
 */
export function notificationHref(link: string | null | undefined, kind: string, surface: InboxSurface): string | null {
  if (surface === 'app' && isReminder(kind)) return APP_PATHS.home;
  const safe = safeNotificationLink(link);
  if (!safe) return null;
  if (surface === 'site' || isUnder(safe, APP_PATHS.home)) return safe;
  if (isUnder(safe, '/my-custody')) return '/app/custody';
  const custody = /^\/assets\/custody\/(CUS-\d{4,})(?:[?#]|$)/i.exec(safe);
  if (custody) return `/app/assets/custody/${custody[1].toUpperCase()}`;
  if (isUnder(safe, '/my-attendance')) {
    const at = safe.indexOf('?');
    const month = at < 0 ? null : new URLSearchParams(safe.slice(at + 1).split('#', 1)[0]).get('month');
    return appAttendanceHref(month);
  }
  return toAppHref(safe, notificationSection(kind));
}

/** Where a notification tapped on the phone opens (its data: { link, kind, id }): its page, else the inbox. */
export function pushHref(data: Record<string, string> | null | undefined): string {
  return notificationHref(data?.link ?? null, data?.kind ?? '', 'app') ?? INBOX_PATHS.app;
}

/** What a kind is about, as the inbox labels it ("Leave", "Reminder"); a kind from a newer API: "Notification". */
export const kindLabel = (kind: string): string => (isNotificationKind(kind) ? NOTIFICATION_KIND_LABELS[kind] : 'Notification');

// ---------- the bell ----------

/** The unread count as the bell's badge says it: none at 0 (or unknown), "99+" above 99. */
export function badgeText(unread: number | null | undefined): string | null {
  if (typeof unread !== 'number' || !Number.isFinite(unread) || unread < 1) return null;
  return unread > 99 ? '99+' : String(Math.floor(unread));
}

/** The bell's name for screen readers: "Notifications, 3 unread"; "Notifications" with none (or unknown). */
export function bellLabel(unread: number | null | undefined): string {
  const badge = badgeText(unread);
  return badge ? `Notifications, ${badge} unread` : 'Notifications';
}

/** The API's { unread } as a count; anything else (an older API, a failure) none known: null. */
export function unreadOf(answer: unknown): number | null {
  const unread = answer && typeof answer === 'object' ? (answer as { unread?: unknown }).unread : undefined;
  return typeof unread === 'number' && Number.isFinite(unread) && unread >= 0 ? Math.floor(unread) : null;
}

// ---------- the inbox ----------

/** The furthest page asked for. */
const MAX_PAGE = 10_000;

/** The inbox's ?page= as a page: a whole number from 1 (the newest); anything else the first. */
export function inboxPage(value: string | string[] | null | undefined): number {
  const one = Array.isArray(value) ? value[0] : value;
  if (typeof one !== 'string' || !/^\d{1,6}$/.test(one.trim())) return 1;
  const page = Number(one.trim());
  return page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

/** The inbox's address on a page: "/notifications", "/app/notifications?page=2". */
export const inboxHref = (surface: InboxSurface, page = 1): string => (page > 1 ? `${INBOX_PATHS[surface]}?page=${page}` : INBOX_PATHS[surface]);

/** How many pages the inbox has (at least one, for "nothing yet"). */
export const pageCount = (total: number, pageSize: number): number => (total > 0 && pageSize > 0 ? Math.ceil(total / pageSize) : 1);

/**
 * What the inbox says in place of what it couldn't load (`what`: the notifications, or the reminder settings): an API
 * from before them (404), a refusal, or what went wrong.
 */
export function notLoadedText(loaded: { kind: 'unavailable' } | { kind: 'forbidden' } | { kind: 'failed'; messages: string[] }, what: 'notifications' | 'reminders'): string {
  const words = what === 'notifications' ? { name: 'Notifications', the: 'Your notifications' } : { name: 'Reminder settings', the: 'Your reminder settings' };
  if (loaded.kind === 'unavailable') return `${words.name} aren’t on the server yet. Please try again after its next update.`;
  if (loaded.kind === 'forbidden') return `${words.the} can’t be shown here.`;
  return `${words.the} couldn’t be loaded. ${loaded.messages.join(' ')}`.trim();
}

/** "3 unread", "1 unread"; "All read" with none unread. */
export const unreadText = (unread: number): string => (unread > 0 ? `${unread.toLocaleString('en-US')} unread` : 'All read');

/**
 * When a notification came: "Just now" within the minute, "12 min ago" within the hour, else the day and time in Cairo,
 * "20/10/2026, 9:05 AM" (lib/format.ts: dates DD/MM/YYYY, times 12-hour).
 */
export function notificationTime(createdAt: string, now: Date = new Date()): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes >= 0 && minutes < 1) return 'Just now';
  if (minutes >= 1 && minutes < 60) return `${minutes} min ago`;
  return formatDateTime(at);
}

// ---------- the phone: Home's offer, the token kept, turning push on ----------

/** The words of notifications on the phone. */
export const PUSH_TEXT = {
  offer: 'Get notified on this phone?',
  offerHint: 'Requests waiting for you, decisions on yours, your payslip and the check-in reminders.',
  on: 'Notifications are on.',
  denied: 'Notifications are off for Trendlix People. To allow them: Settings → Apps → Trendlix People → Notifications.',
  failed: 'Notifications couldn’t be turned on. Please try again.',
  timeout: 'The phone didn’t answer in time. Check the internet connection and try again.',
} as const;

/** Where the phone remembers Home's offer was put off, and the push token the website registered for it. */
export const PUSH_OFFER_KEY = 'trendlix-people:push-offer';
export const PUSH_TOKEN_KEY = 'trendlix-people:push-token';
const NOT_NOW = 'not-now';

/** The browser's storage as used here; null when there is none (a private window, storage blocked). */
export type PushStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;

/** Whether "Not now" was pressed on this phone. Nothing remembered (or storage blocked): not put off. */
export function pushOfferDismissed(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(PUSH_OFFER_KEY) === NOT_NOW;
  } catch {
    return false;
  }
}

/** Remembers "Not now" on this phone; with storage blocked it isn't remembered, which is all. */
export function dismissPushOffer(storage: Pick<Storage, 'setItem'> | null | undefined): void {
  try {
    storage?.setItem(PUSH_OFFER_KEY, NOT_NOW);
  } catch {
    // a private window, or storage blocked: the offer comes back next time
  }
}

/** A push token as one taken: a string, trimmed, not empty, within PUSH_TOKEN_MAX; else null. */
export function pushTokenOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return token && token.length <= PUSH_TOKEN_MAX ? token : null;
}

/** The push token this phone registered, kept for signing out (it is unregistered then); null when none. */
export function readPushToken(storage: Pick<Storage, 'getItem'> | null | undefined): string | null {
  try {
    return pushTokenOf(storage?.getItem(PUSH_TOKEN_KEY));
  } catch {
    return null;
  }
}

/** Keeps the push token registered for this phone; with storage blocked it isn't kept (signing out can't unregister it). */
export function writePushToken(storage: Pick<Storage, 'setItem'> | null | undefined, token: string): void {
  const value = pushTokenOf(token);
  if (!value) return;
  try {
    storage?.setItem(PUSH_TOKEN_KEY, value);
  } catch {
    // storage blocked: the API stops sending to a token Firebase says is gone
  }
}

/** Forgets the push token kept (signing out). */
export function clearPushToken(storage: Pick<Storage, 'removeItem'> | null | undefined): void {
  try {
    storage?.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // storage blocked: nothing kept anyway
  }
}

/** What turning push on came to: on; refused on the phone (how to allow it said); the app can't; or in words. */
export type PushTurnOnOutcome = { kind: 'on' } | { kind: 'denied' } | { kind: 'unavailable' } | { kind: 'error'; message: string };

/** The steps of turning push on: the phone's registration, the server action registering it, keeping its token. */
export interface PushTurnOnSteps {
  register(): Promise<PushRegistration>;
  save(input: { token: string; platform: 'android' | 'ios' }): Promise<{ error?: string }>;
  keep(token: string): void;
}

/**
 * Turns push on for this phone (Home's Turn on; the app's silent registration on each open goes the same way, its
 * outcome ignored): the phone's token, registered with the API by the website, then kept on the phone for signing out.
 */
export async function turnOnPushFlow(steps: PushTurnOnSteps): Promise<PushTurnOnOutcome> {
  let registered: PushRegistration;
  try {
    registered = await steps.register();
  } catch {
    registered = { reason: 'failed' };
  }
  if ('reason' in registered) {
    if (registered.reason === 'denied' || registered.reason === 'not_asked') return { kind: 'denied' };
    if (registered.reason === 'unavailable') return { kind: 'unavailable' };
    return { kind: 'error', message: registered.reason === 'timeout' ? PUSH_TEXT.timeout : PUSH_TEXT.failed };
  }
  let saved: { error?: string };
  try {
    saved = await steps.save({ token: registered.token, platform: registered.platform });
  } catch {
    saved = { error: PUSH_TEXT.failed };
  }
  if (saved?.error) return { kind: 'error', message: saved.error };
  steps.keep(registered.token);
  return { kind: 'on' };
}
