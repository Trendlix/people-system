import type { Role } from '@trendlix/shared';
import type { ViewAs } from './view-as';

// Who holds which powers, for showing and hiding things on screen. Hiding is a convenience: the API checks every
// request. Pure code (no server-only), so client components and tests can use it too.

/** Role names as the database seed gives them (apps/api/prisma/seed.ts). */
export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Employee',
  manager: 'Direct manager',
  hr: 'HR',
  finance: 'Finance',
  ceo: 'CEO',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

type WithRoles = { roles: readonly Role[] };

/**
 * The roles someone acts with: their own, plus Admin for a Super Admin, who can do everything an Admin can (users, the
 * organisation) and delete (owner's decision, 15 October 2026). A Super Admin does not get the HR, CEO or Finance powers:
 * someone who needs those holds those roles too.
 */
export function effectiveRoles(roles: readonly Role[]): Role[] {
  return roles.includes('super_admin') && !roles.includes('admin') ? [...roles, 'admin'] : [...roles];
}

/** Whether the user acts with any of these roles (a Super Admin counts as an Admin). */
export function hasRole(user: WithRoles, ...wanted: Role[]): boolean {
  const roles = effectiveRoles(user.roles);
  return wanted.some((r) => roles.includes(r));
}

/**
 * Someone who is only an employee, a direct manager, or both: no HR, Finance, CEO or Admin role (a Super Admin counts as
 * an Admin). They get their own side of the system (owner, 17 October 2026: "create a dashboard for the employee
 * relevant to his role, and dont show him the organization tab", then "my suggestion for the employee side bar is 1-
 * Dashboard 2- My Profile 3- My Requests"): their dashboard as the home page and a sidebar of their own, and the
 * Organization and Employees pages send them to the dashboard. Everyone else keeps the sidebar and home page as before.
 */
export function isSelfService(user: WithRoles): boolean {
  return !hasRole(user, 'hr', 'finance', 'ceo', 'admin');
}

/** Admins, and Super Admins, manage sign-in accounts (Users) and, with HR, the organisation. */
export function isAdmin(user: WithRoles): boolean {
  return hasRole(user, 'admin');
}

/** The role above Admin. Only a Super Admin grants or removes it, or changes a Super Admin's account. */
export function isSuperAdmin(user: WithRoles): boolean {
  return user.roles.includes('super_admin');
}

/**
 * Only a Super Admin deletes records, any record; nobody else gets a delete option at all, nor a way to ask for one
 * (owner's decision, 15 October 2026). Cancel, withdraw, reject and deactivate stay with whoever has them. Viewing as a
 * Super Admin view only, there is none either (owner's decision, 17 October 2026): the API refuses every change then.
 */
export function canDelete(user: WithRoles & { viewAs?: ViewAs | null }): boolean {
  return isSuperAdmin(user) && (!user.viewAs || user.viewAs.act);
}

/** What the API answers a delete from anyone else; server actions refuse with it before asking. */
export const ONLY_SUPER_ADMIN_DELETES = 'Only a Super Admin can delete records.';

/** The roles this user may tick on someone's account: every one for a Super Admin, all but Super Admin for an Admin. */
export function assignableRoles<R extends Role>(user: WithRoles, roles: readonly R[]): R[] {
  return isSuperAdmin(user) ? [...roles] : roles.filter((r) => r !== 'super_admin');
}

/**
 * Whether this user may change this account's roles, active flag and password: always for a Super Admin; for an Admin,
 * any account but a Super Admin's (the API refuses that with 403).
 */
export function canChangeAccount(user: WithRoles, account: WithRoles): boolean {
  return isSuperAdmin(user) || !isSuperAdmin(account);
}
