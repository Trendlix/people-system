import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { greetingName } from '../../(app)/dashboard/dashboard';
import { loadOwnProfile } from '../../(app)/own-profile';

// The phone pages' top bar (owner, 20 October 2026: the employee app; apps/mobile/README.md, Phase 1): the person's
// name and job, the bell (a placeholder: notifications come in Phase 4, with an inbox) and a menu with the full site,
// Change password and Sign out. An API outage must not take the page down: it says so in place of the name.

/** The bell, for now only a placeholder: the inbox and push notifications are Phase 4. */
function Bell() {
  return (
    <button
      type="button"
      disabled
      title="Notifications come in a later version of the app."
      className="inline-flex size-11 items-center justify-center rounded-full text-sidebar-text opacity-70"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </svg>
      <span className="sr-only">Notifications (coming in a later version)</span>
    </button>
  );
}

/** The menu: the full site, Change password (not while viewing as someone), Sign out. */
function Menu({ user }: { user: Session | null }) {
  return (
    <details className="relative">
      <summary className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full text-sidebar-text hover:bg-white/10 [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="currentColor">
          <circle cx="12" cy="5.5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="18.5" r="1.8" />
        </svg>
        <span className="sr-only">Menu</span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-card py-1 text-ink shadow-lg">
        <Link href="/" className="flex min-h-12 items-center px-4 text-sm font-medium text-ink no-underline hover:bg-canvas">
          Open the full site
        </Link>
        {user && !user.viewAs && (
          <Link href="/account/password" className="flex min-h-12 items-center px-4 text-sm font-medium text-ink no-underline hover:bg-canvas">
            Change password
          </Link>
        )}
        <form action={logout}>
          <button type="submit" className="flex min-h-12 w-full cursor-pointer items-center px-4 text-left text-sm font-medium text-danger hover:bg-canvas">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

export async function TopBar() {
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const profile = user ? await loadOwnProfile(user) : null;
  const name = profile ? greetingName(profile) : (user?.name?.trim() || user?.email);
  const line = profile?.employment?.jobTitle?.titleEn ?? (profile ? profile.fullNameEn : user?.email);
  return (
    <div className="flex w-full items-center gap-1">
      <div className="min-w-0 flex-1">
        {user ? (
          <>
            <p className="truncate font-semibold">{name}</p>
            {line && line !== name && <p className="truncate text-xs text-sidebar-text">{line}</p>}
          </>
        ) : (
          <p role="status" className="text-sm font-semibold">
            Server unreachable
          </p>
        )}
      </div>
      <Bell />
      <Menu user={user} />
    </div>
  );
}

/** Until the user is read: the bar's height, the bell and the menu. */
export function TopBarFallback() {
  return (
    <div className="flex w-full items-center gap-1">
      <span className="sr-only">Loading…</span>
      <span aria-hidden="true" className="block h-3 max-w-28 flex-1 rounded-full bg-white/10" />
      <Bell />
      <Menu user={null} />
    </div>
  );
}
