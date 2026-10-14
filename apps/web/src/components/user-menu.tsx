import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { ApiError } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';

export async function UserMenu() {
  // The menu sits in the layout, so an API outage must not take the whole page down with it.
  // Only ApiError is caught: the redirect to /login on an expired session still happens.
  let user: SessionUser | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

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
      {user && (
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
