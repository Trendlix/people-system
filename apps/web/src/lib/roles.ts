import type { Role } from '@trendlix/shared';

/** Role names as the database seed gives them (apps/api/prisma/seed.ts). */
export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Employee',
  manager: 'Direct manager',
  hr: 'HR',
  finance: 'Finance',
  ceo: 'CEO',
  admin: 'Admin',
};

/** Admins manage sign-in accounts (Users). */
export function isAdmin(user: { roles: Role[] }): boolean {
  return user.roles.includes('admin');
}
