// Sidebar items. Kept out of the 'use client' file so server components can read them.
import type { Role } from '@trendlix/shared';

export interface NavItem {
  href: string;
  label: string;
  /** Highlighted on every page under this path. */
  section?: string;
  /** Shown only to users with one of these roles. Hiding a link is a convenience: the API checks every request. */
  roles?: Role[];
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/organization/company', label: 'Organization', section: '/organization' },
  { href: '/employees', label: 'Employees', section: '/employees' },
  { href: '/users', label: 'Users', section: '/users', roles: ['admin'] },
];

export const COMING_SOON = ['Contracts', 'Attendance', 'Leave', 'Payroll'];
