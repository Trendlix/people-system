import 'server-only';
import { cache } from 'react';
import { ApiError, apiGet } from './api';
import { hasRole, isAdmin, isSuperAdmin, ONLY_SUPER_ADMIN_DELETES } from './roles';
import type { SessionUser } from './types';
import { isViewOnly, viewOnlyMessage, type Session } from './view-as';

/**
 * The signed-in user, fetched once per request. Redirects to /login when the session is missing or expired. While a
 * Super Admin views as someone, it is that user, as the API answers for them, with `viewAs` saying who is viewing.
 */
export const getCurrentUser = cache(() => apiGet<Session>('/auth/me'));

/** HR and Admin (a Super Admin too) may change organization data; everyone else can only view it. */
export function canEditOrganisation(user: SessionUser): boolean {
  return hasRole(user, 'hr', 'admin');
}

/** Only Admin (a Super Admin too) may change the order departments, and each department's teams, are listed in. */
export function canReorderDepartments(user: SessionUser): boolean {
  return isAdmin(user);
}

/**
 * For server actions that delete: the reason to refuse when the signed-in user isn't a Super Admin, or is one viewing as
 * someone view only, else null. Saves a round trip; the API refuses them anyway. A sign-in that has expired goes to
 * /login, as with any request.
 */
export async function deleteRefusal(): Promise<string[] | null> {
  try {
    // in the API's order: the role first, then viewing only
    const user = await getCurrentUser();
    if (!isSuperAdmin(user)) return [ONLY_SUPER_ADMIN_DELETES];
    return isViewOnly(user) ? [viewOnlyMessage(user.name ?? user.email)] : null;
  } catch (err) {
    if (err instanceof ApiError) return err.messages;
    throw err;
  }
}
