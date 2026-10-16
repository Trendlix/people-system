// Sidebar items. Kept out of the 'use client' file so server components can read them. Relative imports: the tests run
// without the "@/" alias.
import type { Role } from '@trendlix/shared';
import { PAYROLL_SECTIONS } from '../app/(app)/payroll/sections';
import { hasRole, isSelfService } from '../lib/roles';

export interface NavItem {
  href: string;
  label: string;
  /** Highlighted on every page under this path. */
  section?: string;
  /**
   * Shown only to users with one of these roles (a Super Admin counts as an Admin: `hasRole`). Hiding a link is a
   * convenience: the API checks every request.
   */
  roles?: Role[];
  /** Links shown under this one (indented, smaller), for whoever sees it. */
  items?: NavSubItem[];
}

export interface NavSubItem {
  href: string;
  label: string;
  /** Highlighted on every page under this path; when several match, the one with the longest path. */
  section: string;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/organization/company', label: 'Organization', section: '/organization' },
  { href: '/employees', label: 'Employees', section: '/employees' },
  { href: '/contracts', label: 'Contracts', section: '/contracts', roles: ['hr', 'ceo', 'finance'] },
  // the month's pay: HR prepares a run, the CEO approves it, HR marks it paid (owner's decisions, 16 October 2026); a
  // heading with its pages under it (owner, 17 October 2026: "make the Payroll in the side tab a main title below it -
  // Overview - Unsettled - Additions / Deductions - Reports (Statistics)"), the runs under Overview
  {
    href: '/payroll',
    label: 'Payroll',
    section: '/payroll',
    roles: ['hr', 'finance', 'ceo'],
    items: PAYROLL_SECTIONS.map((s) => ({ href: s.href, label: s.label, section: s.href })),
  },
  // raises asked for by the employee, their manager or HR, through HR and the CEO (owner's decisions, 16 October 2026);
  // Finance may view them
  { href: '/raise-requests', label: 'Raise Requests', section: '/raise-requests', roles: ['hr', 'ceo', 'finance'] },
  // job offers: the offer stage, before someone is an employee (owner's request, 15 October 2026)
  { href: '/offers', label: 'Offers', section: '/offers', roles: ['hr', 'ceo'] },
  { href: '/approvals', label: 'Approvals', section: '/approvals', roles: ['hr', 'ceo', 'admin'] },
  {
    href: '/templates',
    label: 'Templates',
    section: '/templates',
    roles: ['hr', 'admin', 'ceo'],
    // the library, and the guide to the fields a template can use (owner's request, 15 October 2026)
    items: [
      { href: '/templates', label: 'Library', section: '/templates' },
      { href: '/templates/tags', label: 'Fields Guide', section: '/templates/tags' },
    ],
  },
  { href: '/users', label: 'Users', section: '/users', roles: ['admin'] },
];

// ---------- the employee's own side (owner's decisions, 17 October 2026) ----------

/** The employee's own requests: the changes to their details and the raises they asked for (app/(app)/my-requests). */
export const MY_REQUESTS = '/my-requests';

/** A direct manager's direct reports (app/(app)/my-team). */
export const MY_TEAM = '/my-team';

/** Who the sidebar is for: their roles, and their own employee profile (none: null; an API from before it: left out). */
type NavUser = { roles: readonly Role[]; employeeId?: string | null };

/**
 * The sidebar of someone who is only an employee and/or a direct manager (isSelfService), as the owner suggested it (17
 * October 2026: "my suggestion for the employee side bar is 1- Dashboard 2- My Profile 3- My Requests"): their
 * dashboard (the home page), their own profile (when they have one) and their requests; a manager also My Team, their
 * direct reports, so they can reach their profiles. Nothing else: not Organization (the owner: "dont show him the
 * organization tab"), nor the Employees list or any HR page.
 */
function selfServiceNav(user: NavUser): NavItem[] {
  const profile = user.employeeId ? `/employees/${user.employeeId}` : null;
  return [
    { href: '/', label: 'Dashboard' },
    ...(profile ? [{ href: profile, label: 'My Profile', section: profile }] : []),
    { href: MY_REQUESTS, label: 'My Requests', section: MY_REQUESTS },
    ...(hasRole(user, 'manager') ? [{ href: MY_TEAM, label: 'My Team', section: MY_TEAM }] : []),
  ];
}

/**
 * The sidebar's items for this user: an employee's or a manager's own (above); for HR, Finance, the CEO and Admins (a
 * Super Admin counts as an Admin) NAV as before, each item for the roles it names. Null (who it is couldn't be read,
 * e.g. the API is down): Home alone, which everyone has. Hiding a link is a convenience: the API checks every request.
 */
export function navFor(user: NavUser | null): NavItem[] {
  if (!user) return NAV.filter((item) => item.href === '/');
  if (isSelfService(user)) return selfServiceNav(user);
  return NAV.filter((item) => !item.roles || hasRole(user, ...item.roles));
}

/**
 * Where a profile's back link goes: the Employees list for those who have it; for an employee or a manager, none on
 * their own profile (My Profile is in their sidebar) and My Team on a direct report's.
 */
export function profileBack(user: NavUser, profile: { id: string; isSelf?: boolean }): { href: string; label: string } | null {
  if (!isSelfService(user)) return { href: '/employees', label: 'Employees' };
  return profile.isSelf || profile.id === user.employeeId ? null : { href: MY_TEAM, label: 'My Team' };
}

/** Whether `pathname` is `section` or a page under it ("/templates/tags" is under "/templates"; "/templatesx" isn't). */
export function isUnder(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

/** The sub-item highlighted on this page: the one whose section matches most closely; null when none does. */
export function activeSubItem(item: Pick<NavItem, 'items'>, pathname: string): NavSubItem | null {
  let best: NavSubItem | null = null;
  for (const sub of item.items ?? []) {
    if (isUnder(pathname, sub.section) && (!best || sub.section.length > best.section.length)) best = sub;
  }
  return best;
}

export const COMING_SOON = ['Attendance', 'Leave'];
