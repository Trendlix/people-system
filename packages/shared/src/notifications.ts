// Notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4). Each one is kept in the person's inbox (the bell, on the site and the
// phone pages) and, when the server's push is set up and the person has the app with notifications allowed, sent to
// their phone too. Its texts are short and general: names and dates, never a salary, an amount, a reason or a comment
// (they can show on a locked phone). Two reminders: "You haven't checked in", from the shift's start every 10 minutes
// for 2 hours until they check in, always on (owner, 20 October 2026: "a reminder for people that didn't checkin and not
// on a leave every 10 minutes. like a popup"; asked, "No, always on"), also a popup on the site and the phone pages; and
// "Still checked in?", which the person can switch off. Pure: the API keeps and sends them with these, the web shows
// them with the same words.

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
  // KPIs (owner, 21 October 2026: "Self, manager, HR, sign-off"; kpis.ts): the employee's scorecard open for their
  // self-rating (and its reminder), a scorecard waiting for its manager's scoring, HR's calibration or the manager's
  // sign-off (and their reminders), and the employee's ready to sign (and its reminder); never a score
  'kpi_self_rating',
  'kpi_waiting',
  'kpi_ready_to_sign',
  // working from home (owner, 21 October 2026: "Manager, then HR"; wfh.ts): a request waiting for its approver's step,
  // and the employee's own decided (or cancelled by HR)
  'wfh_waiting',
  'wfh_decided',
  // custody (Assets, step 3, 21 October 2026: custody.ts): the employee's handover and returns, a shoot's return
  // overdue (the employee and the custodians, once a day), a record still not signed after 3 days (the custodians)
  'custody_handover',
  'custody_return',
  'custody_overdue',
  'custody_unsigned',
  // offboarding (owner, 22 October 2026: the full module; offboarding.ts): the clearance items waiting for someone when a
  // case opens, HR told when every item is cleared, and the leaver asked for their exit interview
  'offboarding_items',
  'offboarding_cleared',
  'exit_interview',
  // recruitment (owner, 22 October 2026: "where will we include the ATS?"; recruitment.ts): a vacancy waiting for the
  // CEO's approval, the CEO's decision for HR, and new applications for HR (once a day a vacancy)
  'vacancy_waiting',
  'vacancy_decided',
  'applications_new',
  // recruitment, Phase 2 (owner, 22 October 2026; recruitment-hiring.ts, onboarding.ts): an interview scheduled, moved or
  // cancelled for its interviewers, the reminder of a scorecard not given the day after, the hiring manager's suggestion
  // for HR, and the onboarding items waiting for someone when a checklist opens
  'interview_scheduled',
  'interview_feedback',
  'hiring_suggestion',
  'onboarding_items',
  // access follows the contract (owner, 23 October 2026: "Active - Grace - Hold - No Access"; employee-access.ts): the
  // employee told their access is on hold (check-in and check-out only), that HR gave them 7 days' grace, and the day
  // before it ends; HR (the CEO for a C-level person) told once someone goes on hold
  'access_hold',
  'access_grace',
  'access_grace_ending',
  'access_held',
  // official duty (owner, 23 October 2026: "Manager, then HR"; official-duty.ts): a request waiting for its approver's
  // step, and the employee's own decided (or cancelled by HR)
  'od_waiting',
  'od_decided',
  // no contract entered (owner, 23 October 2026: "Hold them after 7 days"; employee-access.ts): the employee told once
  // that their access is on hold from a date unless their contract is entered
  'access_no_contract',
  // online interview meetings (owner, 24 October 2026: "make it both"; meetings.ts): a meetings connection that needs
  // connecting again, for its owner (the company's: the Super Admins)
  'meeting_connection',
  // screening comments (owner, 24 October 2026: "HR + hiring manager & interviewers"; screening.ts): a colleague
  // @mentioned in a comment they may read; the comment itself is never in it
  'screening_mention',
  // requested check-in locations (owner, 24 October 2026: "allow the HR to add an end date"; home-locations.ts): the
  // employee and HR told 7 days before a home's, a remote site's or a client location's end that is a date
  'check_in_location_ending',
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
  'kpi_waiting',
  'wfh_waiting',
  'od_waiting',
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
  kpi_self_rating: 'KPI',
  kpi_waiting: 'KPI',
  kpi_ready_to_sign: 'KPI',
  wfh_waiting: 'Work from home',
  wfh_decided: 'Work from home',
  custody_handover: 'Custody',
  custody_return: 'Custody',
  custody_overdue: 'Custody',
  custody_unsigned: 'Custody',
  offboarding_items: 'Offboarding',
  offboarding_cleared: 'Offboarding',
  exit_interview: 'Exit interview',
  vacancy_waiting: 'Vacancy',
  vacancy_decided: 'Vacancy',
  applications_new: 'Applicants',
  interview_scheduled: 'Interview',
  interview_feedback: 'Interview',
  hiring_suggestion: 'Applicants',
  onboarding_items: 'Onboarding',
  access_hold: 'Access',
  access_grace: 'Access',
  access_grace_ending: 'Access',
  access_held: 'Access',
  od_waiting: 'Official duty',
  od_decided: 'Official duty',
  access_no_contract: 'Access',
  meeting_connection: 'Meetings',
  screening_mention: 'Screening comment',
  check_in_location_ending: 'Check-in location',
};

// ---------- the reminders and the person's switches ----------

/** The two reminders: "You haven't checked in" every 10 minutes for 2 hours, "Still checked in?" once a working day. */
export const REMINDER_KINDS = ['check_in_reminder', 'check_out_reminder'] as const satisfies readonly NotificationKind[];
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/**
 * The reminders nobody can switch off (owner, 20 October 2026, asked whether people may switch the check-in reminder
 * off: "No, always on"): sent whatever their switch says.
 */
export const ALWAYS_ON_REMINDERS = ['check_in_reminder'] as const satisfies readonly ReminderKind[];

/** The person's switches, both on until they switch one off. */
export interface NotificationSettings {
  /**
   * "You haven't checked in": always on (ALWAYS_ON_REMINDERS). The API answers true and leaves a change aside; the field
   * stays so an older page (or app) that sends it isn't refused.
   */
  checkInReminder: boolean;
  /** "Still checked in?": checked in and not out by the time the day's hours stop counting. */
  checkOutReminder: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { checkInReminder: true, checkOutReminder: true };

/** The switches as the settings show them: a label and what it does; `alwaysOn`: why it can't be switched off. */
export const NOTIFICATION_SETTING_LABELS: Record<keyof NotificationSettings, { label: string; hint: string; alwaysOn?: string }> = {
  checkInReminder: {
    label: 'Remind me when I haven’t checked in',
    hint: 'On a working day of your shift, from its start, every 10 minutes for 2 hours, until you check in.',
    alwaysOn: 'Everyone on a shift gets it, so it can’t be switched off. It stops as soon as you check in, and never comes on leave, a holiday or a day off.',
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

/** Whether a reminder goes to someone with these switches: always for one nobody can switch off, else as switched. */
export function reminderSwitchedOn(settings: NotificationSettings, kind: ReminderKind): boolean {
  return (ALWAYS_ON_REMINDERS as readonly ReminderKind[]).includes(kind) || settings[REMINDER_SETTING[kind]] !== false;
}

/**
 * "You haven't checked in" (owner, 20 October 2026: "every 10 minutes"; asked, from the "Shift start", stopping "After 2
 * hours"): at the shift's start, then every 10 minutes, the last no later than 2 hours on: 12 at most.
 */
export const CHECK_IN_REMINDER_EVERY_MINUTES = 10;
export const CHECK_IN_REMINDER_FOR_MINUTES = 120;
export const CHECK_IN_REMINDER_MAX = CHECK_IN_REMINDER_FOR_MINUTES / CHECK_IN_REMINDER_EVERY_MINUTES;

/**
 * The Android notification tag the check-in reminder is pushed with: each new one takes the place of the last on the
 * phone instead of piling up (and still sounds).
 */
export const CHECK_IN_REMINDER_TAG = 'check_in_reminder';

/** How often the API looks for reminders to send, in minutes: every minute, so a 10-minute step is never late. */
export const REMINDER_TICK_MINUTES = 1;

/**
 * GET /me/check-in-reminder: whether the popup "You haven't checked in yet" is due for the signed-in person now (the same
 * rule as the push: a working day of their shift, not checked in, within the 2 hours from its start), the shift's start
 * ("HH:mm"; null when not due), and the page with the check-in panel on the site (the phone pages show theirs on Home).
 * Never due while a Super Admin views as someone.
 */
export interface CheckInReminderView {
  due: boolean;
  shiftStart: string | null;
  checkInPath: string;
}

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
