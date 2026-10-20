import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  clippedText,
  DEFAULT_NOTIFICATION_SETTINGS,
  isNotificationKind,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  NOTIFICATIONS_PAGE_SIZE,
  safeNotificationLink,
  type NotificationKind,
  type NotificationPage,
  type NotificationSettings,
  type NotificationView,
  type PushPlatform,
} from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FcmSender } from './fcm-sender.service.js';

// Notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4). The emitter, notify(userIds, { kind, title, body, link }), keeps a row in
// each user's inbox (the bell) and pushes it to their phones when push is set up (FcmSender). Any flow calls it, after
// its own transaction has committed: it never throws into the flow, and the push goes on after it returns. The inbox
// (paged, unread count, mark read), the user's reminder switches, and the phones registered from the app.

/** What a flow sends: what it is about, its texts (short and general: names and dates only) and where it opens. */
export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  /** An address on the site ("/leave/<id>"); anything else is dropped. */
  link?: string | null;
}

/** A notification as kept, cleaned: its texts cut to their limits, a link only on the site. */
export function keptNotification(n: NotificationInput): { kind: NotificationKind; title: string; body: string; link: string | null } | null {
  if (!isNotificationKind(n.kind)) return null;
  const title = clippedText(n.title ?? '', NOTIFICATION_TITLE_MAX);
  if (!title) return null;
  return { kind: n.kind, title, body: clippedText(n.body ?? '', NOTIFICATION_BODY_MAX), link: safeNotificationLink(n.link) };
}

const VIEW = { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true } as const;

const viewOf = (r: { id: string; kind: string; title: string; body: string; link: string | null; readAt: Date | null; createdAt: Date }): NotificationView => ({
  id: r.id,
  kind: r.kind as NotificationKind,
  title: r.title,
  body: r.body,
  link: r.link,
  readAt: r.readAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

export const PUSH_APP_ONLY = 'Notifications on the phone are turned on in the Trendlix People app.';
export const PUSH_NOT_WHILE_VIEWING = 'You cannot turn on notifications on a phone while viewing as someone.';
const NOT_FOUND = 'Notification not found.';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  /** The pushes still being sent, so the tests (and a shutdown) can wait for them. */
  private readonly sending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmSender,
  ) {}

  // ---------- the emitter ----------

  /**
   * Keeps the notification in each user's inbox (active users only, each once) and pushes it to their phones. Called
   * after the flow's transaction has committed. Never throws: a failure is logged and the flow goes on. Returns once the
   * inbox rows are kept; the push goes on in the background.
   */
  async notify(userIds: readonly (string | null | undefined)[], input: NotificationInput): Promise<void> {
    try {
      const n = keptNotification(input);
      const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id !== ''))];
      if (!n) {
        this.logger.warn(`A notification of kind "${input.kind}" was not kept: it has no kind or title the inbox takes.`);
        return;
      }
      if (!ids.length) return;
      const users = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
      if (!users.length) return;
      const rows = await this.prisma.notification.createManyAndReturn({ data: users.map((u) => ({ userId: u.id, ...n })), select: { id: true, userId: true } });
      if (this.fcm.enabled) this.track(this.push(rows, n));
    } catch (err) {
      this.logger.error(`A notification of kind "${input.kind}" could not be kept: ${(err as Error).message}`);
    }
  }

  /**
   * A reminder sent again and again (owner, 20 October 2026: the check-in reminder "every 10 minutes"), without filling
   * the inbox: one row a day for it. `rowId`, the row of its earlier steps that day: moved to now and unread again, with
   * the texts sent now; none (or gone): a new row. Pushed to the user's phones with `tag`, so the phone shows the latest
   * in place of the last. Answers the row's id; null when nothing was kept (an inactive user, or a failure, logged).
   * Never throws.
   */
  async remind(userId: string, input: NotificationInput, options: { rowId?: string | null; tag: string }): Promise<string | null> {
    try {
      const n = keptNotification(input);
      if (!n) {
        this.logger.warn(`A reminder of kind "${input.kind}" was not kept: it has no kind or title the inbox takes.`);
        return null;
      }
      if (!(await this.prisma.user.count({ where: { id: userId, isActive: true } }))) return null;
      let id: string | null = null;
      if (options.rowId) {
        const { count } = await this.prisma.notification.updateMany({ where: { id: options.rowId, userId }, data: { ...n, readAt: null, createdAt: new Date() } });
        if (count) id = options.rowId;
      }
      id ??= (await this.prisma.notification.create({ data: { userId, ...n }, select: { id: true } })).id;
      if (this.fcm.enabled) this.track(this.push([{ id, userId }], { ...n, tag: options.tag }));
      return id;
    } catch (err) {
      this.logger.error(`A reminder of kind "${input.kind}" could not be kept: ${(err as Error).message}`);
      return null;
    }
  }

  /** Waits for the pushes still being sent (the tests; a graceful shutdown). */
  async flush(): Promise<void> {
    while (this.sending.size) await Promise.allSettled(this.sending);
  }

  private track(p: Promise<void>) {
    const done = p.catch((err: unknown) => this.logger.warn(`Push failed: ${(err as Error).message}`)).finally(() => this.sending.delete(done));
    this.sending.add(done);
  }

  /** Pushes each user's row to their phones (with a tag: in place of the one shown with it). */
  private async push(rows: readonly { id: string; userId: string }[], n: { kind: string; title: string; body: string; link: string | null; tag?: string | null }): Promise<void> {
    const devices = await this.prisma.pushDevice.findMany({ where: { userId: { in: rows.map((r) => r.userId) } }, select: { id: true, userId: true, token: true } });
    for (const row of rows) {
      const theirs = devices.filter((d) => d.userId === row.userId);
      if (theirs.length) await this.fcm.send(theirs, { id: row.id, ...n });
    }
  }

  // ---------- the inbox ----------

  /** A page of the user's inbox, newest first, with the total and how many are unread. */
  async list(userId: string, page = 1): Promise<NotificationPage> {
    const p = Number.isInteger(page) && page >= 1 ? page : 1;
    const where = { userId };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (p - 1) * NOTIFICATIONS_PAGE_SIZE, take: NOTIFICATIONS_PAGE_SIZE, select: VIEW }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items: items.map(viewOf), page: p, pageSize: NOTIFICATIONS_PAGE_SIZE, total, unread };
  }

  /** How many of the user's notifications are unread: the bell's count. */
  async unreadCount(userId: string): Promise<{ unread: number }> {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Marks one of the user's notifications read (already read: as it is); another's is not found. */
  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (!count && !(await this.prisma.notification.count({ where: { id, userId } }))) throw new NotFoundException(NOT_FOUND);
  }

  /** Marks all the user's notifications read; answers how many were unread. */
  async markAllRead(userId: string): Promise<{ marked: number }> {
    const { count } = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { marked: count };
  }

  // ---------- the reminder switches ----------

  /** The switches: "You haven't checked in" always on (owner, 20 October 2026: "No, always on"), "Still checked in?" as set. */
  async settings(userId: string): Promise<NotificationSettings> {
    const row = await this.prisma.notificationSettings.findUnique({ where: { userId }, select: { checkOutReminder: true } });
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...row, checkInReminder: true };
  }

  /**
   * Switches "Still checked in?" on or off; not sent, it stays as it is. "You haven't checked in" can't be switched off:
   * a change sent for it (by an older page or app) is left aside, and the answer says it is on.
   */
  async saveSettings(userId: string, change: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const data = typeof change.checkOutReminder === 'boolean' ? { checkOutReminder: change.checkOutReminder } : {};
    const row = await this.prisma.notificationSettings.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_NOTIFICATION_SETTINGS, ...data },
      update: data,
      select: { checkOutReminder: true },
    });
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...row, checkInReminder: true };
  }

  // ---------- the phones ----------

  /**
   * Registers (or refreshes) the phone the user is signed in on in the app: its token is theirs from now on, whoever had
   * it before (a shared phone gets the notifications of the last to sign in). From an app session only, never while
   * viewing as someone.
   */
  async registerDevice(user: SessionUser, session: Pick<ActiveSession, 'kind'>, phone: { token: string; platform: PushPlatform }): Promise<void> {
    if (user.viewAs) throw new ForbiddenException(PUSH_NOT_WHILE_VIEWING);
    if (session.kind !== 'app') throw new ForbiddenException(PUSH_APP_ONLY);
    const now = new Date();
    await this.prisma.pushDevice.upsert({
      where: { token: phone.token },
      create: { userId: user.id, platform: phone.platform, token: phone.token, createdAt: now, lastSeenAt: now },
      update: { userId: user.id, platform: phone.platform, lastSeenAt: now },
    });
  }

  /** Signing out in the app: the phone stops getting notifications, whoever's they were. Unknown: nothing to do. */
  async unregisterDevice(token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { token } });
  }
}
