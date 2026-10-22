import type { AssetsAccessView, Role, SessionKind } from '@trendlix/shared';

export const SESSION_COOKIE = 'ps_session';
export const SESSION_HOURS = 8;

/**
 * Who is behind a session switched to another user (owner's decision, 17 October 2026: "a super admin can view any
 * other user profile from a switcher, only the super admin"): the Super Admin signed in, and whether they act in the
 * user's name. View only (`act: false`) until they switch on Act as them.
 */
export interface ViewAs {
  by: { id: string; email: string };
  act: boolean;
}

// The signed-in user, attached to every authenticated request. While a Super Admin views as someone, it is that user
// (their id, email and roles: the API answers as for them), with `viewAs` naming the Super Admin; null or left out
// for anyone's own session.
export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
  viewAs?: ViewAs | null;
}

/** A user as the database has them (with their roles), for a session. */
export const WITH_ROLES = { roles: { include: { role: true } } } as const;

export function sessionUserOf(user: { id: string; email: string; roles: { role: { key: string } }[] }): SessionUser {
  return { id: user.id, email: user.email, roles: user.roles.map((r) => r.role.key as Role) };
}

/**
 * GET /auth/me: the signed-in user, with their own employee profile's id: the profile whose work email is their email,
 * the same match as everywhere else (see employees/access.ts), or null. The web finds "my profile" with it. `name`: that
 * profile's name in English, or null; while switched, the banner says whom the Super Admin is viewing as with it.
 * `leads`: whether that profile is in charge of a department or team (owner, 19 October 2026: "i want to add department
 * lead person, the person in charge"), its head or its lead: the web shows them My Team without the manager role, for
 * the leave and reimbursements of those without a direct manager that wait for them.
 */
export interface Me extends SessionUser {
  employeeId: string | null;
  name: string | null;
  leads: boolean;
  /**
   * Their Assets access in effect, whether they see the asset values, and whether the Assets AI is set up (owner, 21
   * October 2026: "3 levels per user"; "CEO and Finance"): the web shows the Assets pages with it.
   */
  assets: AssetsAccessView;
  /**
   * Whether they hire for an open vacancy (its hiring manager) or sit on an interview to come or of the last 60 days
   * (recruitment, Phase 2, 22 October 2026: "Show it only to people who are a hiring manager or interviewer on something
   * open"): the web shows them My Hiring with it.
   */
  hiring: boolean;
  viewAs: ViewAs | null;
  session: MeSession;
}

/**
 * The request's session (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes inactive"):
 * its id, where it was signed in, and the 15 minutes in milliseconds when they are for the person signed in (HR, Admin,
 * Super Admin: the Super Admin's own while they view as someone), else null. The web shows its idle warning with it.
 */
export interface MeSession {
  id: string;
  kind: SessionKind;
  idleTimeoutMs: number | null;
}
