'use server';

// The inbox's actions (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)"; apps/mobile/README.md, Phase 4), on the site and the phone pages alike: opening a notification
// marks it read and opens its page there (lib/notifications.ts, notificationHref), Mark all as read, and the person's two
// reminder switches. Each is the caller's own; the API decides. While a Super Admin views as someone view only, the API
// refuses every change: opening still opens the page, the rest says the API's words.
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '@trendlix/shared';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { notificationHref, type InboxSurface } from '@/lib/notifications';

/** The longest id taken from the page (the API's are UUIDs). */
const MAX_ID = 100;

const field = (fd: FormData, name: string): string => {
  const value = fd.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/**
 * A notification pressed in the inbox: marked read when it was unread (refused, not theirs or the server unreachable:
 * it opens all the same), then its page, on the site or the phone pages as the form says. With nowhere to open (no link,
 * or one that isn't an address on this site), the inbox shows it read.
 */
export async function openNotification(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  const surface: InboxSurface = field(formData, 'surface') === 'app' ? 'app' : 'site';
  if (id && id.length <= MAX_ID && field(formData, 'unread') === '1') {
    try {
      await apiSend('POST', `/me/notifications/${encodeURIComponent(id)}/read`);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  // the link is checked again here: only an address on this site is opened, whatever the form sent
  const href = notificationHref(field(formData, 'link') || null, field(formData, 'kind'), surface);
  if (href) redirect(href);
  refresh();
}

/** Mark all as read: the inbox and the bell show none unread (refused while viewing only: nothing changes). */
export async function markAllNotificationsRead(): Promise<void> {
  try {
    await apiSend('POST', '/me/notifications/read-all');
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  refresh();
}

/** What saving the reminder switches came to, with the switches as they now stand (or as sent, when refused). */
export interface ReminderSettingsState {
  saved?: boolean;
  error?: string;
  values?: NotificationSettings;
}

/** The API's answer as the switches; anything else: those sent. */
function settingsOf(answer: unknown, sent: NotificationSettings): NotificationSettings {
  const a = (answer ?? {}) as Partial<Record<keyof NotificationSettings, unknown>>;
  return {
    checkInReminder: typeof a.checkInReminder === 'boolean' ? a.checkInReminder : sent.checkInReminder,
    checkOutReminder: typeof a.checkOutReminder === 'boolean' ? a.checkOutReminder : sent.checkOutReminder,
  };
}

/** The reminders' Save: both switches as ticked (PUT /me/notification-settings). */
export async function saveReminderSettings(_prev: ReminderSettingsState, formData: FormData): Promise<ReminderSettingsState> {
  const values: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  for (const key of Object.keys(DEFAULT_NOTIFICATION_SETTINGS) as (keyof NotificationSettings)[]) values[key] = formData.get(key) !== null;
  try {
    const answer = await apiSend<NotificationSettings>('PUT', '/me/notification-settings', values);
    return { saved: true, values: settingsOf(answer, values) };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    const error = err.status === 404 ? 'Reminder settings aren’t on the server yet. Please try again after its next update.' : err.messages.join(' ');
    return { error, values };
  }
}
