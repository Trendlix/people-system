import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { ApiError } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { canViewAs, type Session } from '@/lib/view-as';
import { ViewAsButton } from './view-as';

export async function UserMenu() {
  // The menu sits in the layout, so an API outage must not take the whole page down with it.
  // Only ApiError is caught: the redirect to /login on an expired session still happens.
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  // While a Super Admin views as someone, the menu is that user's, as they see it (the banner says who is viewing),
  // without Change password: theirs is not the Super Admin's to change. View as… is for a Super Admin in their own
  // session only (owner's decision, 17 October 2026).
  return (
    <div className="flex min-w-0 items-center gap-3">
      {user ? (
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-medium">{user.email}</p>
          <p className="truncate text-xs text-muted">{user.roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ')}</p>
        </div>
      ) : (
        <p role="status" className="text-sm text-danger">
          Server unreachable
        </p>
      )}
      {user && canViewAs(user) && <ViewAsButton />}
      {user && !user.viewAs && (
        <Link href="/account/password" className="text-sm whitespace-nowrap">
          Change password
        </Link>
      )}
      <form action={logout}>
        <button type="submit" className="btn btn-secondary">
          Sign out
        </button>
      </form>
    </div>
  );
}
