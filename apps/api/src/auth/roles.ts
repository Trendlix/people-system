import { ForbiddenException } from '@nestjs/common';
import type { Role } from '@trendlix/shared';

// Who holds which powers, in one place: the guard (@Roles) and the checks in the services both ask here.

/**
 * Whether someone with these roles may do what any of `allowed` may. A Super Admin can do everything an Admin can, but
 * none of what only HR, the CEO, Finance or a manager may (owner's decision, 15 October 2026): someone who needs those
 * holds those roles too.
 */
export function actsAs(held: readonly Role[], allowed: readonly Role[]): boolean {
  return held.some((r) => allowed.includes(r) || (r === 'super_admin' && allowed.includes('admin')));
}

export const isSuperAdmin = (user: { roles: readonly Role[] }) => user.roles.includes('super_admin');

/** Deleting any record is for a Super Admin only; nobody else has a delete option (owner's decision, 15 October 2026). */
export const ONLY_SUPER_ADMIN_DELETES = 'Only a Super Admin can delete records.';

/** Called by every service method that deletes a record, whichever route reaches it. */
export function assertDeletes(user: { roles: readonly Role[] }): void {
  if (!isSuperAdmin(user)) throw new ForbiddenException(ONLY_SUPER_ADMIN_DELETES);
}
