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
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/organization/company', label: 'Organization', section: '/organization' },
  { href: '/employees', label: 'Employees', section: '/employees' },
  { href: '/contracts', label: 'Contracts', section: '/contracts', roles: ['hr', 'ceo', 'finance'] },
  { href: '/approvals', label: 'Approvals', section: '/approvals', roles: ['hr', 'ceo', 'admin'] },
  { href: '/templates', label: 'Templates', section: '/templates', roles: ['hr', 'admin', 'ceo'] },
  { href: '/users', label: 'Users', section: '/users', roles: ['admin'] },
];

export const COMING_SOON = ['Attendance', 'Leave', 'Payroll'];
