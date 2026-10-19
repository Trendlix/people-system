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
  /**
   * Links shown under this one (indented, smaller), each for whoever sees the item or for the roles it names. An item
   * with them links to the first one the user sees (navFor).
   */
  items?: NavSubItem[];
}

export interface NavSubItem {
  href: string;
  label: string;
  /** Highlighted on every page under this path; when several match, the one with the longest path. */
  section: string;
  /**
   * Shown only to users with one of these roles, as an item's `roles`; none: to whoever sees its item. An item whose
   * sub-items all have roles is shown to whoever sees at least one of them, and links to the first they see.
   */
  roles?: Role[];
}

/** The Raise Requests page (app/(app)/raise-requests), under Requests. */
export const RAISE_REQUESTS_PATH = '/raise-requests';

/** The employees' requests to change their details (app/(app)/requests/details-changes), under Requests. */
export const DETAILS_CHANGES_PATH = '/requests/details-changes';

/** The employees' reimbursement claims (app/(app)/reimbursements), under Requests. */
export const REIMBURSEMENTS_PATH = '/reimbursements';

/** The employees' leave requests and the month's calendar of who is off (app/(app)/leave), under Requests. */
export const LEAVE_PATH = '/leave';

export const NAV: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/organization/company', label: 'Organization', section: '/organization' },
  // the people the company employs, under one heading (owner, 17 October 2026: "i think employees, contracts and offers
  // need to be grouped from the side bar", with the Missing Details report; Search Documents and Card Reading Fixes left
  // it on 18 October 2026, as not used every day: the first is a button on the Employees page, the second a link in the
  // ID card scan); each page for its own roles, the heading for whoever sees one of them, linking to the first they see
  {
    href: '/employees',
    label: 'People',
    items: [
      { href: '/employees', label: 'Employees', section: '/employees' },
      { href: '/contracts', label: 'Contracts', section: '/contracts', roles: ['hr', 'ceo', 'finance'] },
      // job offers: the offer stage, before someone is an employee (owner's request, 15 October 2026)
      { href: '/offers', label: 'Offers', section: '/offers', roles: ['hr', 'ceo'] },
      // what each profile still lacks
      { href: '/employees/missing', label: 'Missing Details', section: '/employees/missing', roles: ['hr', 'ceo'] },
    ],
  },
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
  // the requests HR and the others decide, under one heading (owner, 17 October 2026: asked whether raise requests are
  // about money or requests like the others, the owner chose "A Requests heading"); each page for its own roles, the
  // heading for whoever sees one of them, with no page of its own: it links to the first page they see (navFor), Raise
  // Requests for HR, Finance and the CEO, Details Changes for an Admin; Reimbursements since 18 October 2026. Approvals
  // stays the inbox of what waits for the user, and an employee's own requests stay on My Requests.
  {
    href: RAISE_REQUESTS_PATH,
    label: 'Requests',
    items: [
      // raises asked for by the employee, their manager or HR, through HR and the CEO (owner's decisions, 16 October
      // 2026); Finance may view them
      { href: RAISE_REQUESTS_PATH, label: 'Raise Requests', section: RAISE_REQUESTS_PATH, roles: ['hr', 'ceo', 'finance'] },
      // the employees' requests to change their details, which HR and Admin (a Super Admin too) decide (owner's decision,
      // 15 October 2026)
      { href: DETAILS_CHANGES_PATH, label: 'Details Changes', section: DETAILS_CHANGES_PATH, roles: ['hr', 'admin'] },
      // the employees' reimbursement claims, through their direct manager, HR and Finance (owner, 18 October 2026: "allow
      // the employee to add reimbursement request … for specific preset up conditions"); the CEO may view them
      { href: REIMBURSEMENTS_PATH, label: 'Reimbursements', section: REIMBURSEMENTS_PATH, roles: ['hr', 'finance', 'ceo'] },
      // the employees' leave, through their direct manager, then HR (owner, 18 October 2026: "if we will work on the
      // attendance and leaves, how will we build it?", leaves first, then "can you apply the leaves according to the
      // law?"), with the month's calendar of who is off; HR decides and records leave, the CEO may view them; a direct
      // manager decides their team's from My Team, an employee asks from My Requests
      { href: LEAVE_PATH, label: 'Leave Requests', section: LEAVE_PATH, roles: ['hr', 'ceo'] },
    ],
  },
  { href: '/approvals', label: 'Approvals', section: '/approvals', roles: ['hr', 'ceo', 'admin'] },
  {
    href: '/templates',
    label: 'Templates',
    section: '/templates',
    // a Super Admin's only (owner, 19 October 2026: "enable templates sidebar to super admin only")
    roles: ['super_admin'],
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
 * Super Admin counts as an Admin) NAV, each item and sub-item for the roles it names, and an item with sub-items only
 * when the user sees one of them, linking to the first. Null (who it is couldn't be read, e.g. the API is down): Home
 * alone, which everyone has. Hiding a link is a convenience: the API checks every request.
 */
export function navFor(user: NavUser | null): NavItem[] {
  if (!user) return NAV.filter((item) => item.href === '/');
  if (isSelfService(user)) return selfServiceNav(user);
  const sees = (entry: { roles?: Role[] }) => !entry.roles || hasRole(user, ...entry.roles);
  return NAV.filter(sees).flatMap((item) => {
    if (!item.items) return [item];
    const items = item.items.filter(sees);
    if (!items.length) return [];
    // links to the first of its pages the user sees: Payroll's, Templates' and People's first is their own page; Requests has none
    return [{ ...item, href: items[0].href, items }];
  });
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

/**
 * Whether an item is the section this page is in: under its section (its own page alone when it has none), or on a
 * page of one of its sub-items (Requests, whose pages aren't under one path).
 */
export function isActive(item: Pick<NavItem, 'href' | 'section' | 'items'>, pathname: string): boolean {
  return (item.section ? pathname.startsWith(item.section) : pathname === item.href) || activeSubItem(item, pathname) !== null;
}

/** The sub-item highlighted on this page: the one whose section matches most closely; null when none does. */
export function activeSubItem(item: Pick<NavItem, 'items'>, pathname: string): NavSubItem | null {
  let best: NavSubItem | null = null;
  for (const sub of item.items ?? []) {
    if (isUnder(pathname, sub.section) && (!best || sub.section.length > best.section.length)) best = sub;
  }
  return best;
}

/** What is coming next, under the sidebar: Leave went live on 18 October 2026 (Requests → Leave Requests, My Requests). */
export const COMING_SOON = ['Attendance'];
