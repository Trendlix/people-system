import { CalendarClock, CalendarDays, ChevronDown, KeyRound, LogOut, MonitorSmartphone, Video } from 'lucide-react';
import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { ApiError } from '@/lib/api';
import { interviewHoursInMenu, MY_INTERVIEW_HOURS_PATH } from '@/lib/calendars';
import { meetingsInMenu, MY_MEETINGS_PATH } from '@/lib/meetings';
import { ROLE_LABELS } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { modeSwitch } from '@/lib/session-mode';
import { canViewAs, type Session } from '@/lib/view-as';
import { MenuPopover } from './menu-popover';
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
  const role = user ? (user.developer ? ROLE_LABELS.developer : user.roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ')) : '';
  const item = 'flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-sm text-ink no-underline hover:bg-raised';
  return (
    <div className="flex min-w-0 items-center gap-2">
      {mode && <ModeSwitch text={mode.text} to={mode.to} hint={mode.hint} />}
      {/* View as… opens its own window, so it stays out of the drop-down */}
      {user && canViewAs(user) && <ViewAsButton />}
      {user ? (
        // the design's account button: the initials, the name and the role; the account's links in its drop-down
        <MenuPopover
          label="Your account"
          summary={
            <span className="flex h-11 min-w-0 cursor-pointer items-center gap-2.5 rounded-full border border-line bg-card py-1 pr-3 pl-1 hover:bg-raised">
              <span aria-hidden="true" className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-on-accent">
                {initialsOf(user.name ?? user.email)}
              </span>
              <span className="hidden min-w-0 text-left leading-tight sm:block">
                <span className="block max-w-[11rem] truncate text-xs">{user.name ?? user.email}</span>
                <span className="block max-w-[11rem] truncate text-[10px] text-muted">{role}</span>
              </span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" strokeWidth={1.6} />
            </span>
          }
        >
          <div className="border-b border-line-soft px-3 pt-2 pb-2.5">
            <p className="truncate text-sm">{user.name ?? user.email}</p>
            {user.name && <p className="truncate text-xs text-muted">{user.email}</p>}
            <p className="mt-0.5 truncate text-xs text-muted">{role}</p>
          </div>
          <div className="py-1">
            {myAttendanceInMenu(user) && (
              <Link href={MY_ATTENDANCE} className={item}>
                <CalendarDays aria-hidden="true" className="size-4 text-muted" strokeWidth={1.6} />
                My attendance
              </Link>
            )}
            {/* not while viewing as someone: theirs is not the Super Admin's to change */}
            {!user.viewAs && (
              <Link href="/account/password" className={item}>
                <KeyRound aria-hidden="true" className="size-4 text-muted" strokeWidth={1.6} />
                Change password
              </Link>
            )}
            {/* one's own sessions, on the website and in the app (20 October 2026); not while viewing as someone */}
            {!user.viewAs && (
              <Link href="/account/sessions" className={item}>
                <MonitorSmartphone aria-hidden="true" className="size-4 text-muted" strokeWidth={1.6} />
                Sessions
              </Link>
            )}
            {/* one's own meetings account, for those who schedule interviews (owner, 24 October 2026: "make it both");
                while a Super Admin views as them too, read only until Act as them (25 October 2026) */}
            {meetingsInMenu(user) && (
              <Link href={MY_MEETINGS_PATH} className={item}>
                <Video aria-hidden="true" className="size-4 text-muted" strokeWidth={1.6} />
                Meetings
              </Link>
            )}
            {/* one's own interview hours, for anyone HR can put on a panel (owner, 25 October 2026: "Hours + calendar") */}
            {interviewHoursInMenu(user) && (
              <Link href={MY_INTERVIEW_HOURS_PATH} className={item}>
                <CalendarClock aria-hidden="true" className="size-4 text-muted" strokeWidth={1.6} />
                Interview hours
              </Link>
            )}
          </div>
          <form action={logout} className="border-t border-line-soft pt-1">
            {/* in the Trendlix People app, the phone's push token, unregistered on signing out (Phase 4, 20 October 2026) */}
            <PushTokenField />
            <button type="submit" className={`${item} cursor-pointer`}>
              <LogOut aria-hidden="true" className="size-4 text-muted" strokeWidth={1.6} />
              Sign out
            </button>
          </form>
        </MenuPopover>
      ) : (
        <>
          <p role="status" className="text-sm text-danger">
            Server unreachable
          </p>
          <form action={logout}>
            <PushTokenField />
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/** The avatar's initials: HS for Hazem Soliman, H for an email. */
function initialsOf(name: string): string {
  const words = name.split('@')[0].trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  return (words.length === 1 ? first : first + ([...words[words.length - 1]][0] ?? '')).toUpperCase();
}
