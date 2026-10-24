import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATIONS_PAGE_SIZE, type NotificationSettings, type NotificationView } from '@trendlix/shared';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import { inboxHref, kindLabel, notificationHref, notificationTime, notLoadedText, pageCount, unreadText, type InboxSurface } from '@/lib/notifications';
import { getCurrentUser } from '@/lib/session';
import { isViewOnly } from '@/lib/view-as';
import { markAllNotificationsRead, openNotification } from './actions';
import { loadInbox, loadMyWhatsApp, loadReminderSettings } from './data';
import { ReminderSettingsForm } from './reminder-settings';
import { WhatsAppSettingsForm } from './whatsapp-settings';

// The inbox (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4: "the bell + inbox page, notification settings (which reminders)"): the
// same notifications the phone is sent, kept here, so nothing is lost while push is off or the phone is away. One body
// for the site (/notifications) and the phone pages (/app/notifications), `surface` saying which: newest first, the
// unread ones marked; pressing one marks it read and opens its page there; Mark all as read; Newer and Older; and the
// two reminders' switches. Each is the caller's own (the one viewed as, while a Super Admin views as someone).

const small = 'btn btn-secondary min-h-10 px-3';

/** One notification, a whole row to press: unread ones marked (a dot, in bold) and opened through the action. */
function Item({ n, surface, now }: { n: NotificationView; surface: InboxSurface; now: Date }) {
  const unread = !n.readAt;
  const href = notificationHref(n.link, n.kind, surface);
  const content = (
    <>
      <span aria-hidden="true" className={`mt-2 size-2.5 shrink-0 rounded-full ${unread ? 'bg-accent' : ''}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-xs font-semibold text-muted">{kindLabel(n.kind)}</span>
          <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="text-xs text-muted tabular-nums">
            {notificationTime(n.createdAt, now)}
          </time>
        </span>
        <span className={`mt-0.5 block break-words ${unread ? 'font-semibold' : 'font-medium'}`}>
          {n.title}
          {unread && <span className="sr-only"> (unread)</span>}
        </span>
        {n.body && <span className="mt-0.5 block text-sm break-words text-muted">{n.body}</span>}
      </span>
      {href && (
        <span aria-hidden="true" className="shrink-0 self-center text-lg text-muted">
          ›
        </span>
      )}
    </>
  );
  const row = `flex w-full items-start gap-3 px-4 py-3 text-left text-ink no-underline ${surface === 'app' ? 'min-h-16' : 'min-h-14'} ${unread ? 'bg-accent-soft/40' : ''}`;
  const press = 'cursor-pointer hover:bg-canvas active:bg-canvas';
  // read, and nowhere to open: nothing to press
  if (!unread && !href) {
    return (
      <li>
        <div className={row}>{content}</div>
      </li>
    );
  }
  // read: its page straight away
  if (!unread && href) {
    return (
      <li>
        <Link href={href} className={`${row} ${press}`}>
          {content}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <form action={openNotification}>
        <input type="hidden" name="id" value={n.id} />
        <input type="hidden" name="kind" value={n.kind} />
        <input type="hidden" name="link" value={n.link ?? ''} />
        <input type="hidden" name="surface" value={surface} />
        <input type="hidden" name="unread" value="1" />
        <button type="submit" className={`${row} ${press}`}>
          {content}
        </button>
      </form>
    </li>
  );
}

/** Newer and Older, with where the page is. */
function Pager({ surface, page, pages }: { surface: InboxSurface; page: number; pages: number }) {
  if (pages <= 1 && page <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted tabular-nums">
        Page {page.toLocaleString('en-US')} of {pages.toLocaleString('en-US')}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={inboxHref(surface, Math.min(page - 1, pages))} className={small}>
            ← Newer
          </Link>
        )}
        {page < pages && (
          <Link href={inboxHref(surface, page + 1)} className={small}>
            Older →
          </Link>
        )}
      </div>
    </nav>
  );
}

/** A page of the inbox, newest first, with Mark all as read when any are unread. */
export async function Inbox({ surface, page }: { surface: InboxSurface; page: number }) {
  const [user, loaded] = await Promise.all([getCurrentUser(), loadInbox(page)]);
  if (loaded.kind !== 'ok') return <div className="card px-4 py-8 text-center text-sm text-muted">{notLoadedText(loaded, 'notifications')}</div>;
  const p = loaded.value;
  const items = Array.isArray(p.items) ? p.items : [];
  const total = Number.isFinite(p.total) ? p.total : items.length;
  const unread = Number.isFinite(p.unread) ? p.unread : 0;
  const pages = pageCount(total, p.pageSize || NOTIFICATIONS_PAGE_SIZE);
  const now = new Date();
  return (
    <section aria-label="Your notifications" className="card overflow-hidden">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2">
        <p className="text-sm text-muted">{total === 0 ? 'Nothing yet' : unreadText(unread)}</p>
        {/* not while viewing as someone view only: the API would refuse it */}
        {unread > 0 && !isViewOnly(user) && (
          <form action={markAllNotificationsRead}>
            <button type="submit" className={small}>
              Mark all as read
            </button>
          </form>
        )}
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted">
          {total === 0 ? (
            'No notifications yet.'
          ) : (
            <>
              Nothing on this page. <Link href={inboxHref(surface)}>See the newest</Link>
            </>
          )}
        </div>
      ) : (
        <ul aria-label="Notifications, newest first" className="divide-y divide-line-soft">
          {items.map((n) => (
            <Item key={n.id} n={n} surface={surface} now={now} />
          ))}
        </ul>
      )}
      <Pager surface={surface} page={p.page || page} pages={pages} />
    </section>
  );
}

/** The API's switches as the form takes them: each one it didn't give on, as by default. */
function switchesOf(value: Partial<NotificationSettings> | null | undefined): NotificationSettings {
  return {
    checkInReminder: typeof value?.checkInReminder === 'boolean' ? value.checkInReminder : DEFAULT_NOTIFICATION_SETTINGS.checkInReminder,
    checkOutReminder: typeof value?.checkOutReminder === 'boolean' ? value.checkOutReminder : DEFAULT_NOTIFICATION_SETTINGS.checkOutReminder,
  };
}

/**
 * The two reminders' switches, for those with an employee profile (the reminders are about checking in): "You haven't
 * checked in" and "Still checked in?", each one on until they switch it off.
 */
export async function Reminders({ surface }: { surface: InboxSurface }) {
  const user = await getCurrentUser();
  if (!user.employeeId) return null;
  const loaded = await loadReminderSettings();
  return (
    <section aria-labelledby="reminders-heading" className={`card space-y-3 ${surface === 'app' ? 'p-4' : 'p-6'}`}>
      <div>
        <h2 id="reminders-heading" className="font-semibold">
          Reminders
        </h2>
        <p className="mt-1 text-sm text-muted">Kept here, and sent to your phone when notifications are on in the Trendlix People app.</p>
      </div>
      {loaded.kind === 'ok' ? (
        <ReminderSettingsForm initial={switchesOf(loaded.value)} big={surface === 'app'} />
      ) : (
        <p className="text-sm text-muted">{notLoadedText(loaded, 'reminders')}</p>
      )}
    </section>
  );
}

/**
 * The person's own WhatsApp messages (owner, 24 October 2026: "how to make whatsapp notifications?"; employees who opt
 * in), under the reminders, for those with an employee profile (the messages go to its mobile): on or off, the language
 * and the groups. Left out by an API from before it (404).
 */
export async function WhatsAppMessages({ surface }: { surface: InboxSurface }) {
  const user = await getCurrentUser();
  if (!user.employeeId) return null;
  const loaded = await loadMyWhatsApp();
  if (loaded.kind === 'unavailable') return null;
  return (
    <section id="whatsapp" aria-labelledby="whatsapp-heading" className={`card scroll-mt-20 space-y-3 ${surface === 'app' ? 'p-4' : 'p-6'}`}>
      <div>
        <h2 id="whatsapp-heading" className="font-semibold">
          WhatsApp Messages
        </h2>
        <p className="mt-1 text-sm text-muted">Get what waits for you, decisions on your requests, the check-in reminders and your interviews on WhatsApp too, if you like.</p>
      </div>
      {loaded.kind === 'ok' ? (
        <WhatsAppSettingsForm initial={loaded.value} viewingAs={!!user.viewAs} big={surface === 'app'} />
      ) : (
        <p className="text-sm text-muted">
          {loaded.kind === 'forbidden' ? 'Your WhatsApp messages can’t be shown here.' : `Your WhatsApp messages couldn’t be loaded. ${loaded.messages.join(' ')}`}
        </p>
      )}
    </section>
  );
}
