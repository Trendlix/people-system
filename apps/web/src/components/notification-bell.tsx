import Link from 'next/link';
import { unreadCount } from '@/app/(app)/notifications/data';
import { badgeText, bellLabel, INBOX_PATHS, type InboxSurface } from '@/lib/notifications';

// The bell (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4): in the site's header and the phone pages' top bar, opening the inbox, with
// how many are unread (none shown at 0, "99+" above 99). Read as a background request (it doesn't keep HR's 15 minutes
// alive); signed out, an older API or the server unreachable: the bell without a count, the page as ever.

const TONES = {
  // the site's header, on white
  site: 'size-10 text-ink hover:bg-canvas',
  // the phone pages' top bar, on the sidebar's dark blue: a 44 px target (Phase 5, 20 October 2026: accessibility)
  app: 'size-11 text-sidebar-text hover:bg-white/10',
} as const;

/** The count's badge, white on red (6.6:1), ringed in the bar's own colour so it stands off the bell. */
const BADGE_RING = { site: 'ring-white', app: 'ring-sidebar' } as const;

/** The bell as drawn: a link to the inbox with the count's badge; `unread` null while (or when it can't be) read. */
export function BellLink({ surface, unread }: { surface: InboxSurface; unread: number | null }) {
  const badge = badgeText(unread);
  return (
    <Link href={INBOX_PATHS[surface]} aria-label={bellLabel(unread)} title="Notifications" className={`relative inline-flex shrink-0 items-center justify-center rounded-full no-underline ${TONES[surface]}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </svg>
      {badge && (
        <span aria-hidden="true" className={`absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] leading-5 font-semibold text-white tabular-nums ring-2 ${BADGE_RING[surface]}`}>
          {badge}
        </span>
      )}
    </Link>
  );
}

/** The bell with the caller's unread count. */
export async function NotificationBell({ surface }: { surface: InboxSurface }) {
  return <BellLink surface={surface} unread={await unreadCount()} />;
}
