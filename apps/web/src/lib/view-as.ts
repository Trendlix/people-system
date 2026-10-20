import type { Role, SessionKind } from '@trendlix/shared';
import { ROLE_LABELS } from './roles';
import { matches } from './select-search';
import type { SessionUser, UserAccount } from './types';

// Viewing as another user (owner's decisions, 17 October 2026): "a super admin can view any other user profile from a
// switcher, only the super admin"; "view only with a button to act but by default not checked". While switched, the
// API answers as the user viewed and refuses every change until Act as them is on; the web only shows it. Pure code
// (no server-only), so client components and tests can use it too.

/** Who is behind a switched session: the Super Admin signed in, and whether they act in the user's name. */
export interface ViewAs {
  by: { id: string; email: string };
  act: boolean;
}

/**
 * GET /auth/me: the user the API answers as, with their employee profile's name, and, while a Super Admin views as
 * them, who is viewing. An API from before 17 October 2026 sends neither, hence optional.
 */
export interface Session extends SessionUser {
  name?: string | null;
  viewAs?: ViewAs | null;
  /**
   * The request's session, kept on the server (owner, 20 October 2026): its id, where it was signed in, and the 15
   * minutes without activity in milliseconds when they are for the person signed in (HR, Admin, Super Admin: the Super
   * Admin's own while they view as someone), else null. An API from before sends none, hence optional.
   */
  session?: { id: string; kind: SessionKind; idleTimeoutMs: number | null } | null;
}

type Viewer = { roles: readonly Role[]; viewAs?: ViewAs | null };

/** A Super Admin in their own session: the user menu offers View as… (no switching while switched). */
export function canViewAs(user: Viewer): boolean {
  return user.roles.includes('super_admin') && !user.viewAs;
}

/** Viewing as someone without Act as them: every change is refused. */
export function isViewOnly(user: { viewAs?: ViewAs | null }): boolean {
  return !!user.viewAs && !user.viewAs.act;
}

/** What the API answers a change while viewing only; `who`: the user's name, or their email. */
export const viewOnlyMessage = (who: string) => `Viewing as ${who}: view only. Switch on Act as them to make changes.`;

/** Roles as the banner and the list name them: "HR, Direct manager". */
export const rolesText = (roles: readonly Role[]) => roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');

/** The banner's line: "Viewing as Nour Adel (nour@trendlix.com) · Employee", or the email alone without a profile. */
export function viewingAsText(user: Pick<Session, 'name' | 'email' | 'roles'>): string {
  const who = user.name ? `${user.name} (${user.email})` : user.email;
  return `Viewing as ${who} · ${rolesText(user.roles)}`;
}

/** Someone the Super Admin can switch to, as the View As list shows them. */
export interface ViewAsChoice {
  id: string;
  /** Their employee profile's name; null without one. */
  name: string | null;
  email: string;
  roles: Role[];
}

/** Every active user but the Super Admin themself, by name (those without a profile by email, after them). */
export function viewAsChoices(users: readonly UserAccount[], selfId: string): ViewAsChoice[] {
  return users
    .filter((u) => u.isActive && u.id !== selfId)
    .map((u) => ({ id: u.id, name: u.employee?.fullNameEn ?? null, email: u.email, roles: u.roles }))
    .sort((a, b) => Number(!a.name) - Number(!b.name) || (a.name ?? a.email).localeCompare(b.name ?? b.email) || a.email.localeCompare(b.email));
}

/** The choices that have every word typed in their name, email or roles (as the searchable lists match). */
export function filterChoices(choices: readonly ViewAsChoice[], query: string): ViewAsChoice[] {
  return choices.filter((c) => matches(`${c.name ?? ''} ${c.email} ${rolesText(c.roles)}`, query));
}

/**
 * The session cookie an API response sets (signing in, switching, Act as them, going back): its token and how many
 * seconds it lasts (Max-Age, the session's time left); null when there is none.
 */
export function sessionCookieFrom(setCookies: readonly string[], name: string): { token: string; maxAge: number | null } | null {
  for (const header of setCookies) {
    const [pair, ...attributes] = header.split(';');
    const at = pair.indexOf('=');
    if (at < 0 || pair.slice(0, at).trim() !== name) continue;
    const token = pair.slice(at + 1).trim();
    if (!token) return null;
    const age = attributes.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
    const seconds = age ? Number(age.slice('max-age='.length)) : NaN;
    return { token, maxAge: Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : null };
  }
  return null;
}
