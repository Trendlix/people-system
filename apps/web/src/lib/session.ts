import 'server-only';
import { cache } from 'react';
import { apiGet } from './api';
import type { SessionUser } from './types';

/** The signed-in user, fetched once per request. Redirects to /login when the session is missing or expired. */
export const getCurrentUser = cache(() => apiGet<SessionUser>('/auth/me'));

/** HR and Admin may change organization data; everyone else can only view it. */
export function canEditOrganisation(user: SessionUser): boolean {
  return user.roles.includes('hr') || user.roles.includes('admin');
}

/** Only Admin may change the order departments, and each department's teams, are listed in. */
export function canReorderDepartments(user: SessionUser): boolean {
  return user.roles.includes('admin');
}
