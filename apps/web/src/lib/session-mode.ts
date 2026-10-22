import { MODE_CHOICES, modeSwitchText, otherMode, type ModeChoice, type Role, type SessionKind, type SessionMode } from '@trendlix/shared';
import { ROLE_LABELS } from './roles';

// A developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a developer signin,
// give hin a switched to use the account as the main role assigned to him or as a developer, to not confuse him"): the
// choice page after the password, the switch in the top bar, the view-as banner's switch, and the Users page's words.
// The API keeps the mode on the session and decides with it; the web only shows it. Pure code (no server-only), so client
// components and tests can use it too.

/** The signed-in user as GET /auth/me says, as much as these need. */
type WithMode = {
  mode?: SessionMode | null;
  viewAs?: unknown;
  session?: { kind: SessionKind } | null;
};

/** A developer who holds another role, in a website session that hasn't chosen yet: only the choice page opens. */
export const mustChoose = (user: WithMode): boolean => user.mode === null && !user.viewAs;

/** The choice page's address. */
export const CHOOSE_MODE_PATH = '/choose-mode';

/**
 * The top bar's switch: the mode in use ("Using as: Developer") and the one a click turns to; null when there is none to
 * show (someone who doesn't choose, not chosen yet, in the app, or while a Super Admin views as them: the banner has its
 * own).
 */
export function modeSwitch(user: WithMode): { mode: SessionMode; text: string; to: SessionMode; hint: string } | null {
  if (user.mode !== 'self' && user.mode !== 'developer') return null;
  if (user.viewAs || (user.session && user.session.kind !== 'web')) return null;
  const to = otherMode(user.mode);
  return { mode: user.mode, text: modeSwitchText(user.mode), to, hint: to === 'self' ? 'Switch to using it as yourself' : 'Switch to using it as a developer' };
}

/** Their own roles as the choice page names them: "Employee", "Employee · Direct manager". */
export const ownRolesText = (roles: readonly Role[]): string => roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ');

/** A card on the choice page. */
export interface ModeCard {
  mode: SessionMode;
  title: string;
  /** Whose: "Hana Adel · Employee" for As yourself; null for As a developer. */
  who: string | null;
  text: string;
}

/**
 * The choice page's two cards, As yourself first ("As yourself: Hana Adel · Employee: your profile, requests, attendance
 * and payslips"), and the one pre-selected: the last chosen, else the one in use, else As yourself (their main role).
 */
export function modeCards(choice: Pick<ModeChoice, 'name' | 'roles' | 'last' | 'mode'>): { cards: ModeCard[]; selected: SessionMode } {
  const who = [choice.name, ownRolesText(choice.roles)].filter(Boolean).join(' · ') || null;
  return {
    cards: [
      { mode: 'self', title: MODE_CHOICES.self.title, who, text: MODE_CHOICES.self.text },
      { mode: 'developer', title: MODE_CHOICES.developer.title, who: null, text: MODE_CHOICES.developer.text },
    ],
    selected: choice.last ?? choice.mode ?? 'self',
  };
}

/** A mode a form sent: 'self' or 'developer', else null. */
export function modeFrom(value: unknown): SessionMode | null {
  return value === 'self' || value === 'developer' ? value : null;
}

/**
 * Roles as badges on the Users page and the profile's Access tab: a developer who holds another role as one,
 * "Developer + Employee", the rest as they are.
 */
export function roleBadgeLabels(roles: readonly Role[]): { key: string; label: string }[] {
  const others = roles.filter((r) => r !== 'developer');
  if (!roles.includes('developer') || !others.length) return roles.map((r) => ({ key: r, label: ROLE_LABELS[r] ?? r }));
  return [{ key: 'developer', label: ['developer' as const, ...others].map((r) => ROLE_LABELS[r] ?? r).join(' + ') }];
}
