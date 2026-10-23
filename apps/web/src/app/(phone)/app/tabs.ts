import { HOLD_PATH, type Role } from '@trendlix/shared';
import { decidesForTeam } from '../../../components/nav';
import { hasRole } from '../../../lib/roles';
import { APP_PATHS } from '../../../lib/surface';

// The phone pages' tab bar (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to enable
// them to check in and out, and apply for their requests"; apps/mobile/README.md, Phase 1): Home, Requests, Attendance,
// Payslips, and To Approve for those who decide something there. Hiding a tab is a convenience: the API checks every
// request, as on the site. Pure code, tested; relative imports, as vitest doesn't know the "@/" paths.

export type AppTabKey = 'home' | 'requests' | 'attendance' | 'payslips' | 'approve' | 'check_in';

export interface AppTab {
  key: AppTabKey;
  href: string;
  /** As the sidebar's links are: a page's name, in Title Case. */
  label: string;
}

export const APP_TABS: readonly AppTab[] = [
  { key: 'home', href: APP_PATHS.home, label: 'Home' },
  { key: 'requests', href: APP_PATHS.requests, label: 'Requests' },
  { key: 'attendance', href: APP_PATHS.attendance, label: 'Attendance' },
  { key: 'payslips', href: APP_PATHS.payslips, label: 'Payslips' },
  { key: 'approve', href: APP_PATHS.approve, label: 'To Approve' },
];

/**
 * The one tab of someone whose access is on hold (owner, 23 October 2026: on Hold "Check-in/out only", web and app): the
 * tabs collapse to it, the Hold page with the check-in panel.
 */
export const CHECK_IN_TAB: AppTab = { key: 'check_in', href: HOLD_PATH, label: 'Check-in' };

type TabUser = { roles: readonly Role[]; leads?: boolean; hold?: boolean };

/**
 * Whether someone decides others' requests on the phone (To Approve): a direct manager, a department's head or a team's
 * lead (decidesForTeam: leave, permission, claims and corrections first), HR (their stage of each, and raise requests),
 * the CEO (a C-level person's HR stage, and the raises) and Finance (claims). A Super Admin counts as an Admin, who
 * decides only the site's details changes: not on the phone.
 */
export const decidesSomething = (user: TabUser): boolean => decidesForTeam(user) || hasRole(user, 'hr', 'ceo', 'finance');

/** The tabs this user gets; who it is couldn't be read (null): the four everyone has; on Hold, Check-in alone. */
export function tabsFor(user: TabUser | null): AppTab[] {
  if (user?.hold) return [CHECK_IN_TAB];
  return APP_TABS.filter((t) => t.key !== 'approve' || (!!user && decidesSomething(user)));
}

/** The tab a page is under: Home on /app alone, each other on its path and the pages under it; null for none. */
export function activeTab(pathname: string): AppTabKey | null {
  if (pathname === HOLD_PATH) return 'check_in';
  if (pathname === APP_PATHS.home || pathname === `${APP_PATHS.home}/`) return 'home';
  const tab = APP_TABS.find((t) => t.key !== 'home' && (pathname === t.href || pathname.startsWith(`${t.href}/`)));
  return tab?.key ?? null;
}

/** A tab's count, as said beside it: "9+" past nine; none for nothing waiting. */
export const countText = (n: number | null | undefined): string | null => (!n || n < 1 ? null : n > 9 ? '9+' : String(n));

/**
 * A tab's name for a screen reader (Phase 5, 20 October 2026: "the bell's and tabs' aria-labels"): its name, then how
 * many wait ("To Approve, 3 waiting", "To Approve, more than 9 waiting"), the badge itself left unread.
 */
export function tabLabel(label: string, n: number | null | undefined): string {
  const count = countText(n);
  if (!count) return label;
  return `${label}, ${count === '9+' ? 'more than 9' : count} waiting`;
}
