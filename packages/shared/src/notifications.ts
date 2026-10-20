// Notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4). Each one is kept in the person's inbox (the bell, on the site and the
// phone pages) and, when the server's push is set up and the person has the app with notifications allowed, sent to
// their phone too. Its texts are short and general: names and dates, never a salary, an amount, a reason or a comment
// (they can show on a locked phone). Two reminders, each one the person can switch off: "You haven't checked in" and
// "Still checked in?". Pure: the API keeps and sends them with these, the web shows them with the same words.

import { DEVICE_PLATFORMS, type DevicePlatform } from './device-credentials.js';

/**
 * What a notification is about. `_waiting`: something waits for the person's decision (the approver of the step it is
 * at); `_decided`, `_paid`, `_issued`: news of their own; the two reminders. Home locations (asked for by anyone,
 * decided by HR then the CEO, 20 October 2026) are listed for that flow to call the emitter with.
 */
export const NOTIFICATION_KINDS = [
  'leave_waiting',
  'leave_decided',
  'permission_waiting',
  'permission_decided',
  'reimbursement_waiting',
  'reimbursement_decided',
  'reimbursement_paid',
  'correction_waiting',
  'correction_decided',
  'raise_request_waiting',
  'pay_raise_waiting',
  'pay_raise_decided',
  'payslip_issued',
  'home_location_waiting',
  'home_location_decided',
  'check_in_reminder',
  'check_out_reminder',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const isNotificationKind = (value: unknown): value is NotificationKind => (NOTIFICATION_KINDS as readonly unknown[]).includes(value);

/** The kinds that wait for the person's decision: the phone pages open them under To approve. */
export const WAITING_KINDS = [
  'leave_waiting',
  'permission_waiting',
  'reimbursement_waiting',
  'correction_waiting',
  'raise_request_waiting',
  'pay_raise_waiting',
  'pay_raise_decided',
  'home_location_waiting',
] as const satisfies readonly NotificationKind[];

/** Where the phone pages open a notification's request: To approve for what the person decides, else their own requests. */
export const notificationSection = (kind: string): 'approve' | 'requests' => ((WAITING_KINDS as readonly string[]).includes(kind) ? 'approve' : 'requests');

/** What each kind is about, as the inbox labels it. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  leave_waiting: 'Leave',
  leave_decided: 'Leave',
  permission_waiting: 'Permission',
  permission_decided: 'Permission',
  reimbursement_waiting: 'Reimbursement',
  reimbursement_decided: 'Reimbursement',
  reimbursement_paid: 'Reimbursement',
  correction_waiting: 'Attendance correction',
  correction_decided: 'Attendance correction',
  raise_request_waiting: 'Raise request',
  pay_raise_waiting: 'Raise',
  pay_raise_decided: 'Raise',
  payslip_issued: 'Payslip',
  home_location_waiting: 'Home location',
  home_location_decided: 'Home location',
  check_in_reminder: 'Reminder',
  check_out_reminder: 'Reminder',
};

// ---------- the reminders and the person's switches ----------

/** The two reminders, sent once a person a working day each. */
export const REMINDER_KINDS = ['check_in_reminder', 'check_out_reminder'] as const satisfies readonly NotificationKind[];
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** The person's switches, both on until they switch one off. */
export interface NotificationSettings {
  /** "You haven't checked in": on a working day, no check-in by the shift's start, its grace and 30 minutes. */
  checkInReminder: boolean;
  /** "Still checked in?": checked in and not out by the time the day's hours stop counting. */
  checkOutReminder: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { checkInReminder: true, checkOutReminder: true };

/** The switches as the settings show them: a label and what it does. */
export const NOTIFICATION_SETTING_LABELS: Record<keyof NotificationSettings, { label: string; hint: string }> = {
  checkInReminder: {
    label: 'Remind me when I haven’t checked in',
    hint: 'On a working day of your shift, 30 minutes after its start and grace, if you haven’t checked in.',
  },
  checkOutReminder: {
    label: 'Remind me when I’m still checked in',
    hint: 'When your hours stop counting for the day, if you checked in and haven’t checked out.',
  },
};

/** The reminder a setting switches. */
export const REMINDER_SETTING: Record<ReminderKind, keyof NotificationSettings> = {
  check_in_reminder: 'checkInReminder',
  check_out_reminder: 'checkOutReminder',
};

/** Minutes after a shift's start and grace before "You haven't checked in" is sent. */
export const CHECK_IN_REMINDER_AFTER_MINUTES = 30;

/** How often the API looks for reminders to send, in minutes. */
export const REMINDER_TICK_MINUTES = 5;

// ---------- the inbox and the phones ----------

/** The longest title and text kept (short and general: they may show on a locked phone). */
export const NOTIFICATION_TITLE_MAX = 100;
export const NOTIFICATION_BODY_MAX = 200;
/** The longest link kept: an address on the site ("/leave/<id>"), never another site's. */
export const NOTIFICATION_LINK_MAX = 300;

/** How many the inbox shows a page. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** A notification as the inbox shows it. Moments are ISO strings. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where it opens on the site ("/leave/<id>"); the phone pages open their own page for it. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** A page of the inbox, newest first, with how many are unread in all. */
export interface NotificationPage {
  items: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  unread: number;
}

/** The phones push notifications go to: the same as fingerprint sign-in's (iPhone with Phase 6). */
export const PUSH_PLATFORMS = DEVICE_PLATFORMS;
export type PushPlatform = DevicePlatform;

/** The longest push token kept (an FCM token is about 160 characters). */
export const PUSH_TOKEN_MAX = 4096;

/** The Android notification channel the app makes and the API sends to (its name is what the phone's settings show). */
export const PUSH_CHANNEL = { id: 'general', name: 'General', description: 'Requests, decisions, payslips and reminders' } as const;

/**
 * A link a notification may carry: an address on the site, starting with one "/" (never "//", which is another site),
 * within NOTIFICATION_LINK_MAX. Anything else is dropped (null).
 */
export function safeNotificationLink(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  const value = link.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > NOTIFICATION_LINK_MAX) return null;
  // no control characters (a line break, a tab)
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  return value;
}

/** A text cut to `max` characters, with "…" when it was longer; spaces tidied. */
export function clippedText(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
