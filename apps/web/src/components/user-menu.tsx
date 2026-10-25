import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { ApiError } from '@/lib/api';
import { interviewHoursInMenu, MY_INTERVIEW_HOURS_PATH } from '@/lib/calendars';
import { meetingsInMenu, MY_MEETINGS_PATH } from '@/lib/meetings';
import { ROLE_LABELS } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { modeSwitch } from '@/lib/session-mode';
import { canViewAs, type Session } from '@/lib/view-as';
import { ModeSwitch } from './mode-switch';
import { MY_ATTENDANCE, myAttendanceInMenu } from './nav';
import { PushTokenField } from './push-token-field';
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
  // session only (owner's decision, 17 October 2026). My attendance for HR, Finance, the CEO and Admins with an employee
  // profile, who check in on the system too (owner, 19 October 2026: "Check-in through the system … to replace Zoho") and
  // whose sidebar doesn't list it. A developer who is also an employee has the switch between using the system as
  // themselves and as a developer (owner, 22 October 2026: "give hin a switched to use the account as the main role
  // assigned to him or as a developer, to not confuse him"); in the developer view their roles read "Developer".
  const mode = user && modeSwitch(user);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {mode && <ModeSwitch text={mode.text} to={mode.to} hint={mode.hint} />}
      {user ? (
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-medium">{user.email}</p>
          <p className="truncate text-xs text-muted">{user.developer ? ROLE_LABELS.developer : user.roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ')}</p>
        </div>
      ) : (
        <p role="status" className="text-sm text-danger">
          Server unreachable
        </p>
      )}
      {user && canViewAs(user) && <ViewAsButton />}
      {user && myAttendanceInMenu(user) && (
        <Link href={MY_ATTENDANCE} className="text-sm whitespace-nowrap">
          My attendance
        </Link>
      )}
      {user && !user.viewAs && (
        <Link href="/account/password" className="text-sm whitespace-nowrap">
          Change password
        </Link>
      )}
      {/* one's own sessions, on the website and in the app (20 October 2026); not while viewing as someone, as above */}
      {user && !user.viewAs && (
        <Link href="/account/sessions" className="text-sm whitespace-nowrap">
          Sessions
        </Link>
      )}
      {/* one's own meetings account, for those who schedule interviews (owner, 24 October 2026: "make it both") */}
      {user && meetingsInMenu(user) && (
        <Link href={MY_MEETINGS_PATH} className="text-sm whitespace-nowrap">
          Meetings
        </Link>
      )}
      {/* one's own interview hours, for anyone HR can put on a panel (owner, 25 October 2026: "Hours + calendar") */}
      {user && interviewHoursInMenu(user) && (
        <Link href={MY_INTERVIEW_HOURS_PATH} className="text-sm whitespace-nowrap">
          Interview hours
        </Link>
      )}
      <form action={logout}>
        {/* in the Trendlix People app, the phone's push token, unregistered on signing out (Phase 4, 20 October 2026) */}
        <PushTokenField />
        <button type="submit" className="btn btn-secondary">
          Sign out
        </button>
      </form>
    </div>
  );
}
