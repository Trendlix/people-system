import 'server-only';
import { cache } from 'react';
import { ApiError, apiGet } from './api';
import { canDelete, hasRole, isAdmin, ONLY_SUPER_ADMIN_DELETES } from './roles';
import type { SessionUser } from './types';

/** The signed-in user, fetched once per request. Redirects to /login when the session is missing or expired. */
export const getCurrentUser = cache(() => apiGet<SessionUser>('/auth/me'));

/** HR and Admin (a Super Admin too) may change organization data; everyone else can only view it. */
export function canEditOrganisation(user: SessionUser): boolean {
  return hasRole(user, 'hr', 'admin');
}

/** Only Admin (a Super Admin too) may change the order departments, and each department's teams, are listed in. */
export function canReorderDepartments(user: SessionUser): boolean {
  return isAdmin(user);
}

/**
 * For server actions that delete: the reason to refuse when the signed-in user isn't a Super Admin, else null. Saves a
 * round trip; the API refuses them anyway. A sign-in that has expired goes to /login, as with any request.
 */
export async function deleteRefusal(): Promise<string[] | null> {
  try {
    return canDelete(await getCurrentUser()) ? null : [ONLY_SUPER_ADMIN_DELETES];
  } catch (err) {
    if (err instanceof ApiError) return err.messages;
    throw err;
  }
}
