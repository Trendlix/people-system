import {
  choosesMode,
  DEVELOPER_ACTS_AS,
  isDeveloperRole,
  modeOfSession,
  ownRoles,
  type AssetsAccessView,
  type Role,
  type SessionKind,
  type SessionMode,
} from '@trendlix/shared';

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
  /**
   * A developer's request (owner, 22 October 2026: "i want to create a role for develoeprs, not showing the real
   * numbers"): answered with DEVELOPER_ACTS_AS as `roles` (what a Super Admin sees), read only, the money and personal
   * IDs masked (auth.guard.ts, developer.interceptor.ts; packages/shared developer.ts). Left out for anyone else.
   */
  developer?: boolean;
  /**
   * How a developer who holds another role uses this session (owner, 22 October 2026: "give hin a switched to use the
   * account as the main role assigned to him or as a developer, to not confuse him"; packages/shared session-modes.ts):
   * 'self', answered with their own roles and nothing of the developer view; 'developer', the developer view; null until
   * they choose on the website (the developer view meanwhile, and the web shows only the choice page). Left out for
   * anyone else (someone with the Developer role alone too: always a developer).
   */
  mode?: SessionMode | null;
  /**
   * Their own employee profile (owner, 22 October 2026: "any active employee with active contract should have access"):
   * the account's link (users.employee_id), never its email; null for an account that isn't an employee's. Left out by a
   * session made before it was read (treated as none).
   */
  employeeId?: string | null;
}

/** A user as the database has them (with their roles), for a session. */
export const WITH_ROLES = { roles: { include: { role: true } } } as const;

export function sessionUserOf(user: { id: string; email: string; roles: { role: { key: string } }[]; employeeId?: string | null }): SessionUser {
  return { id: user.id, email: user.email, roles: user.roles.map((r) => r.role.key as Role), employeeId: user.employeeId ?? null };
}

/** The employee profile a request is answered for (its link): null for an account that isn't an employee's. */
export const ownEmployeeId = (user: Pick<SessionUser, 'employeeId'>): string | null => user.employeeId ?? null;

/**
 * The user a request is answered as: a developer (the Developer role in the database) with a Super Admin's sight
 * (DEVELOPER_ACTS_AS) and `developer` set, so every check that reads `roles` opens what it opens to the owner, and every
 * change is refused by the guard; anyone else as they are.
 */
export function answeredAs(user: SessionUser): SessionUser {
  return isDeveloperRole(user.roles) ? { ...user, roles: [...DEVELOPER_ACTS_AS], developer: true } : user;
}

/**
 * The user a request is answered as, in `mode` (owner, 22 October 2026: "when a developer signin, give hin a switched to
 * use the account as the main role assigned to him or as a developer, to not confuse him"). `user`: as the database has
 * them (sessionUserOf). Someone who chooses (the Developer role and another): in 'self', their own roles without the
 * Developer role and no `developer` (so every check, the guard's read-only rule, the masking and the 15 minutes treat
 * them as the employee they are); in 'developer', or before they choose (null), the developer view (answeredAs); `mode`
 * says which. Anyone else as answeredAs answers them, without `mode`.
 */
export function inMode(user: SessionUser, mode: SessionMode | null): SessionUser {
  if (!choosesMode(user.roles)) return answeredAs(user);
  if (mode === 'self') return { ...user, roles: ownRoles(user.roles), mode };
  return { ...answeredAs(user), mode };
}

/** The user a request with their own session is answered as: in the mode the session is used in (modeOfSession). */
export const sessionUserIn = (user: SessionUser, session: { kind: string; mode: string | null }): SessionUser => inMode(user, modeOfSession(session.kind, session.mode));

/**
 * The user a Super Admin views as: a developer who holds another role as themselves unless the Super Admin switched the
 * banner to see them as a developer (`viewMode`); anyone else as their own session would answer them.
 */
export const viewedAs = (user: SessionUser, viewMode?: SessionMode): SessionUser => inMode(user, viewMode ?? 'self');

/**
 * GET /auth/me: the signed-in user, with their own employee profile's id: the profile their account is linked to
 * (users.employee_id, 22 October 2026), or null. The web finds "my profile" with it. `name`: that
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
