// A developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a developer signin,
// give hin a switched to use the account as the main role assigned to him or as a developer, to not confuse him"):
// - "As yourself" ('self'): the Developer role left out entirely: their own roles (an Employee's), their own real data,
//   and every change any employee makes (checking in, leave, WFH, their KPI self-rating);
// - "As a developer" ('developer'): the developer view as it is (packages/shared developer.ts): the whole system read
//   only, names pseudonyms, money and personal data hidden.
// The choice is kept on the session (sessions.mode), asked at sign-in on the website and switched from the top bar;
// every choice and switch is audited. Someone with the Developer role alone has no choice (always a developer); in the
// TrendLIX People app it is always 'self' (the developer view isn't for the phone, and checking in must work); a
// Claude connector's session stays a developer's (read only, as before). Pure code: the API decides with it (auth/
// session-user.ts), the web shows the same words. Tested in apps/api/src/auth/session-modes.spec.ts.

import { DEVELOPER_ROLE, isDeveloperRole } from './developer.js';
import type { Role } from './index.js';
import type { SessionKind } from './sessions.js';

export const SESSION_MODES = ['self', 'developer'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const isSessionMode = (value: unknown): value is SessionMode => (SESSION_MODES as readonly unknown[]).includes(value);

/** Whether someone with these roles (as the database keeps them) chooses: the Developer role and another beside it. */
export const choosesMode = (roles: readonly string[]): boolean => isDeveloperRole(roles) && roles.some((r) => r !== DEVELOPER_ROLE);

/** Their own roles, the Developer role left out: what "As yourself" answers them with. */
export const ownRoles = <R extends string>(roles: readonly R[]): R[] => roles.filter((r) => r !== DEVELOPER_ROLE);

/**
 * The mode a session of `kind` is used in by someone who chooses (choosesMode), from what the session keeps (`stored`,
 * sessions.mode): in the app always 'self'; a Claude connector's always 'developer' (read only, as before); on the
 * website what they chose, or null until they have (they are shown nothing but the choice page, and the API answers them
 * as a developer meanwhile: read only, nothing real shown).
 */
export function modeOfSession(kind: SessionKind | string, stored: string | null | undefined): SessionMode | null {
  if (kind === 'app') return 'self';
  if (kind === 'connector') return 'developer';
  return isSessionMode(stored) ? stored : null;
}

/** The mode a sign-in of `kind` starts with, as the session keeps it: 'self' in the app for someone who chooses, else none. */
export const startingMode = (roles: readonly string[], kind: SessionKind): SessionMode | null => (choosesMode(roles) && kind === 'app' ? 'self' : null);

// ---------- words ----------

/** The choice page's heading. */
export const MODE_CHOICE_TITLE = 'How Do You Want to Use the System?';

/** Each mode as the top bar's switch names it: "Using as: Developer". */
export const MODE_LABELS: Record<SessionMode, string> = { self: 'Yourself', developer: 'Developer' };

/** The switch in the top bar: the mode in use. */
export const modeSwitchText = (mode: SessionMode): string => `Using as: ${MODE_LABELS[mode]}`;

/** The other mode: what one click on the switch turns to. */
export const otherMode = (mode: SessionMode): SessionMode => (mode === 'self' ? 'developer' : 'self');

/** The choice page's cards. `self`: their name and their own roles ("Hana Adel · Employee"). */
export const MODE_CHOICES: Record<SessionMode, { title: string; text: string }> = {
  self: { title: 'As yourself', text: 'Your profile, requests, attendance and payslips.' },
  developer: { title: 'As a developer', text: 'The whole system, read only; names are pseudonyms and personal data is hidden.' },
};

/** Under the Developer role on the Users page. */
export const DEVELOPER_CHOOSES_NOTE = 'They choose at sign-in whether to use the system as themselves or as a developer.';

/** Asked to choose by someone who has no choice. */
export const MODE_NOT_YOURS = 'Only a developer who holds another role chooses how to use the system.';

/** Asked to switch in the app. */
export const MODE_IN_APP = 'In the app you always use the system as yourself.';

/** Asked to switch while a Super Admin views as them: the banner's switch is the Super Admin's. */
export const MODE_WHILE_VIEWING = 'While viewing as someone, use the banner to see them as a developer or as themselves.';

/** Asked to see someone as a developer who isn't one with another role. */
export const VIEW_MODE_NOT_THEIRS = 'They don’t choose how to use the system: only a developer who holds another role does.';

/** What GET /auth/mode answers: whether they choose, and what to show on the choice page and the switch. */
export interface ModeChoice {
  /** Whether they choose at all: the Developer role and another beside it. */
  chooses: boolean;
  /** The mode in use: null until they choose (always 'self' in the app); null too for someone who doesn't choose. */
  mode: SessionMode | null;
  /** The mode they chose last on the website, pre-selected on the choice page; null before their first choice. */
  last: SessionMode | null;
  /** Their own employee profile's name, for "As yourself"; null without one. */
  name: string | null;
  /** Their own roles, the Developer role left out ("Employee"). */
  roles: Role[];
  /** Whether they switch here: a website session of their own (not the app, not while a Super Admin views as them). */
  switchable: boolean;
}
