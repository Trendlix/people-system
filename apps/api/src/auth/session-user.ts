import type { Role } from '@trendlix/shared';

export const SESSION_COOKIE = 'ps_session';
export const SESSION_HOURS = 8;

// The signed-in user, attached to every authenticated request.
export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
}

/**
 * GET /auth/me: the signed-in user, with their own employee profile's id: the profile whose work email is their email,
 * the same match as everywhere else (see employees/access.ts), or null. The web finds "my profile" with it.
 */
export interface Me extends SessionUser {
  employeeId: string | null;
}
