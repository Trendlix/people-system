import 'server-only';
import type { MyWhatsAppView, NotificationPage, NotificationSettings } from '@trendlix/shared';
import { cache } from 'react';
import { unreadOf } from '@/lib/notifications';
import { getOrNull } from '../approvals/data';
import { loadJson, type Loaded } from '../payroll/load';

// Reading the notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)"; apps/mobile/README.md, Phase 4): the bell's unread count, a page of the inbox and the person's
// reminder switches, each the caller's own (the one viewed as, while a Super Admin views as someone). An API from before
// the notifications answers 404: the bell then shows no count and the inbox says so, the page never fails for it.

/**
 * How many are unread, for the bell on the site and the phone pages; null when it can't be read (signed out, an older
 * API, the server unreachable). A background request (lib/api.ts): the bell is read on every page, so it doesn't count
 * as activity for HR's 15 minutes (owner, 20 October 2026). Read once a request.
 */
export const unreadCount = cache(async (): Promise<number | null> => unreadOf(await getOrNull<unknown>('/me/notifications/unread-count', { background: true })));

/** A page of the inbox, newest first (1 is the newest). */
export const loadInbox = (page: number): Promise<Loaded<NotificationPage>> => loadJson<NotificationPage>(`/me/notifications?page=${page}`);

/** The person's reminder switches. */
export const loadReminderSettings = (): Promise<Loaded<NotificationSettings>> => loadJson<NotificationSettings>('/me/notification-settings');

/** The person's own WhatsApp messages (owner, 24 October 2026: "how to make whatsapp notifications?"): on or off, and their choices. */
export const loadMyWhatsApp = (): Promise<Loaded<MyWhatsAppView>> => loadJson<MyWhatsAppView>('/me/whatsapp');
