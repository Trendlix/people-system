import type { Role } from '@trendlix/shared';

export const SESSION_COOKIE = 'ps_session';
export const SESSION_HOURS = 8;

// The signed-in user, attached to every authenticated request.
export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
}
