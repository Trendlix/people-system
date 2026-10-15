// Sidebar items. Kept out of the 'use client' file so server components can read them.
import type { Role } from '@trendlix/shared';

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

export const COMING_SOON = ['Attendance', 'Leave', 'Payroll'];
