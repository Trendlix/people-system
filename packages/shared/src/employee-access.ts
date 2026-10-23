import type { AssetsAccess } from './assets.js';
import type { Role } from './index.js';

// Every active employee gets access (owner, 22 October 2026: "i dont thint that the users and employees needs to be
// divided, any active employee with active contract should have access. how can we make it?"). Asked, they chose:
// - the first password by a set-password link ("Set-password link"), valid 7 days, emailed or copied by HR;
// - for the staff without an account, "Create now, HR sends when ready": the accounts are made, nothing is sent until HR
//   presses Send invitations;
// - the sign-in email "let the HR Choose which mail to use": the work email or the personal one, per employee;
// - access managed "On the employee profile": an Access tab; the Users page keeps the accounts that aren't employees'.
// An account is an employee's by a link (users.employee_id), never by its email. The rules here are pure: the API
// enforces them (apps/api/src/employee-access), the web shows them.

/** The email an employee signs in with, as HR chose it. */
export const SIGN_IN_EMAIL_CHOICES = ['work', 'personal'] as const;
export type SignInEmailChoice = (typeof SIGN_IN_EMAIL_CHOICES)[number];

export const SIGN_IN_EMAIL_LABELS: Record<SignInEmailChoice, string> = {
  work: 'Work email',
  personal: 'Personal email',
};

export const isSignInEmailChoice = (v: unknown): v is SignInEmailChoice => SIGN_IN_EMAIL_CHOICES.includes(v as SignInEmailChoice);

/** An email as accounts keep and compare it: trimmed and in lower case; null when empty. */
export const accountEmail = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return t || null;
};

/**
 * The email an employee signs in with: the one HR chose when the profile has it, else the other one; with no choice, the
 * work email, else the personal one. Null when the profile has neither (no account can be made: "Add an email to give
 * access").
 */
export function signInEmailOf(e: { workEmail: string | null; personalEmail: string | null; signInEmail?: string | null }): { choice: SignInEmailChoice; email: string } | null {
  const work = accountEmail(e.workEmail);
  const personal = accountEmail(e.personalEmail);
  const wanted: SignInEmailChoice = e.signInEmail === 'personal' ? 'personal' : 'work';
  if (wanted === 'personal' && personal) return { choice: 'personal', email: personal };
  if (work) return { choice: 'work', email: work };
  if (personal) return { choice: 'personal', email: personal };
  return null;
}

/**
 * Where an employee stands for access:
 * - no_email: neither a work nor a personal email (no account can be made);
 * - not_eligible: no current employment with a signed contract in force today (and no account);
 * - pending: should have an account and hasn't one yet (made within minutes, or now from the profile);
 * - clash: should have an account, but another account (another employee's, or one of the Users page) has the email;
 * - not_invited: an account without a password and no link waiting;
 * - invited: a set-password link sent or copied, not used yet and not expired;
 * - active: an account with a password;
 * - closed: the account turned off (their employment ended, or by an Admin).
 */
export const ACCESS_STATES = ['no_email', 'not_eligible', 'pending', 'clash', 'not_invited', 'invited', 'active', 'closed'] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

export const ACCESS_STATE_LABELS: Record<AccessState, string> = {
  no_email: 'No email',
  not_eligible: 'No active contract',
  pending: 'Being set up',
  clash: 'Email in use',
  not_invited: 'Not invited',
  invited: 'Invited',
  active: 'Active',
  closed: 'Closed',
};

export const isAccessState = (v: unknown): v is AccessState => ACCESS_STATES.includes(v as AccessState);

/** What the access state is read from. */
export interface AccessStateInput {
  account: { isActive: boolean; passwordSet: boolean } | null;
  /** The newest set-password link waiting (not used, not cancelled), with its expiry; null without one. */
  link: { expiresAt: string } | null;
  /** A current employment with a signed contract in force today. */
  eligible: boolean;
  /** The sign-in email it would have (signInEmailOf); null without one. */
  email: string | null;
  /** Another account has that email. */
  clash: boolean;
}

/** An employee's access state now (an ISO timestamp, to compare a link's expiry with). */
export function accessStateOf(input: AccessStateInput, now: string = new Date().toISOString()): AccessState {
  const a = input.account;
  if (a) {
    if (!a.isActive) return 'closed';
    if (a.passwordSet) return 'active';
    return input.link && input.link.expiresAt > now ? 'invited' : 'not_invited';
  }
  if (!input.email) return 'no_email';
  if (!input.eligible) return 'not_eligible';
  return input.clash ? 'clash' : 'pending';
}

// ---------- access follows the contract: Active, Grace, Hold, No Access ----------

// The owner, 23 October 2026, on the Access tab showing "Active · Has access without an active contract": "No Access
// without active contract, Access should be on hold with a 7 days grace period one time granted by the hr", then
// "Active - Grace - Hold - No Access". Asked, they chose: on Hold "Check-in/out only" (web and app: everything else is
// closed, so attendance and pay stay right); Grace "Once per contract gap" (7 days each time a contract runs out without
// a new one, never extended; a later gap allows another); at go-live "Hold them immediately" (everyone without a contract
// in force on Hold at once, HR granting grace one by one). Never held: a Super Admin, the CEO, and an account that isn't
// an employee's (the Users page's). The API reads each request's standing from the contract (so a signed contract or a
// grace takes effect at once, and an expired grace drops to Hold on the next request); the rules here are pure.

/**
 * An employee's access standing, from their contract:
 * - active: a current employment with a signed contract in force today (or never held: a Super Admin, the CEO);
 * - grace: no contract in force, but HR gave 7 days in this gap: full access to the end of the 7th day (Cairo time);
 * - hold: no contract in force and no grace running, their employment current and a signed contract of it in force
 *   before (a renewal due, a fixed term run past its end: "open-ended" by Art. 88): only check-in and check-out work;
 * - no_access: everything else: no current employment (they left), no signed contract in force yet in this employment
 *   (a new hire's draft, a contract starting later), or the account turned off.
 * An account switched on whose person never had a signed contract in force ("No contract entered": a draft only, no
 * contract, or never employed) works for 7 days from when the system first records it (No access, with the day it holds
 * from), then is on Hold as the others are (owner, 23 October 2026: "Hold them after 7 days").
 */
export const ACCESS_STANDINGS = ['active', 'grace', 'hold', 'no_access'] as const;
export type AccessStanding = (typeof ACCESS_STANDINGS)[number];

export const isAccessStanding = (v: unknown): v is AccessStanding => ACCESS_STANDINGS.includes(v as AccessStanding);

/** The standings as the screens name them (the owner's "Active - Grace - Hold - No Access", labels in sentence case). */
export const ACCESS_STANDING_LABELS: Record<AccessStanding, string> = {
  active: 'Active',
  grace: 'Grace',
  hold: 'Hold',
  no_access: 'No access',
};

/** How long a grace runs (owner: "a 7 days grace period"): the day HR gives it, then to the end of the 7th day after. */
export const GRACE_DAYS = 7;

/**
 * How long an account switched on with no contract entered keeps working (owner, 23 October 2026: "Hold them after 7
 * days"): the day the system first records it, then to the end of the 7th day after, as a grace runs; on Hold from the
 * day after.
 */
export const NO_CONTRACT_DAYS = 7;

/** The roles never held (owner, 23 October 2026: a Super Admin and the CEO), as the account itself holds them. */
export const NEVER_HELD_ROLES = ['super_admin', 'ceo'] as const satisfies readonly Role[];
export type NeverHeldRole = (typeof NEVER_HELD_ROLES)[number];

/** What an account on Hold is told: on the Hold page, and in every refusal (403) of anything but checking in and out. */
export const ACCESS_HOLD_MESSAGE = 'Your access is on hold until your contract is renewed. You can still check in and out.';

/** The `reason` of the API's 403 to an account on Hold, so the website knows it from any other refusal. */
export const ACCESS_HOLD_REASON = 'access_hold';

/** The page an account on Hold sees, on the website and in the app (every other page sends them there). */
export const HOLD_PATH = '/hold';

/** The contract versions that were signed: draft is the only one that never was (superseded and ended were in force). */
export const SIGNED_CONTRACT_STATUSES = ['active', 'superseded', 'ended'] as const;

/** A version of the current employment's contract, as the standing reads it (dates YYYY-MM-DD). */
export interface StandingContract {
  id: string;
  /** CONTRACT_STATUSES: draft, active, superseded, ended. */
  status: string;
  startDate: string;
  /** None: open-ended, or a specific job without an end. */
  endDate: string | null;
  version: number;
}

/**
 * A grace given (access_graces), tied to its gap: the contract version whose end opened it; or, with no contract entered
 * (23 October 2026: "Hold them after 7 days"), no contract and the employment it is about (none: never employed).
 */
export interface StandingGrace {
  contractId: string | null;
  employmentId?: string | null;
  /** Its last day (YYYY-MM-DD): full access to its end, Cairo time. */
  until: string;
  /** When HR gave it (ISO). */
  grantedAt: string;
}

/** What the standing is read from. */
export interface AccessStandingInput {
  /** The account: on or off, and its own roles (as the database holds them, never a developer's sight); null without one. */
  account: { isActive: boolean; roles: readonly string[] } | null;
  /** The current employment (not ended, or ending today or later) and its contract versions; null when there is none. */
  employment: { id?: string; contracts: readonly StandingContract[] } | null;
  /** The graces given in it. */
  graces: readonly StandingGrace[];
  /** Whether they were ever employed (an employment, current or ended): with none current, they left. */
  everEmployed?: boolean;
  /** The day "No contract entered" was first recorded for them (YYYY-MM-DD, Cairo); null when not recorded (yet). */
  noContractSince?: string | null;
}

/** An employee's standing, with why and the gap they are in. */
export interface AccessStandingResult {
  standing: AccessStanding;
  /** Never held: their role; null for anyone else. */
  exempt: NeverHeldRole | null;
  /** The signed version whose end opened the gap they are in (Grace and Hold); null otherwise. */
  gap: StandingContract | null;
  /** The grace of this gap: running (Grace) or used and over (Hold); null without one. */
  grace: StandingGrace | null;
  /**
   * No contract entered (23 October 2026: "Hold them after 7 days"): an account switched on whose person never had a
   * signed contract in force. The employment it is about (null: never employed), the day first recorded (null: not yet),
   * the last day of full access and the day it holds from (null until recorded); null for anyone else.
   */
  noContract: { employmentId: string | null; since: string | null; until: string | null; holdFrom: string | null } | null;
}

const isSigned = (c: StandingContract) => (SIGNED_CONTRACT_STATUSES as readonly string[]).includes(c.status);

/** The role an account is never held for (Super Admin first), or null. */
export function neverHeldRole(roles: readonly string[]): NeverHeldRole | null {
  return NEVER_HELD_ROLES.find((r) => roles.includes(r)) ?? null;
}

/**
 * An employee's access standing on `today` (YYYY-MM-DD, Cairo):
 * - an account turned off: No Access;
 * - a Super Admin or the CEO (the account's own roles): Active, whatever the contract;
 * - no current employment: No Access when they left; never employed, as with no contract entered (below);
 * - a signed version in force today (signed, started, not past its end): Active;
 * - no signed version started yet in this employment (a draft, a contract starting later): No Access; with an account
 *   switched on, "No contract entered": No Access for 7 days from the day first recorded (to the end of its 7th day),
 *   then Hold, or Grace while the one grace of it runs (its gap: this employment, none when never employed);
 * - else they are in a gap, opened by the end of the signed version that ended last (the latest end; a later version
 *   when two end the same day): Grace while this gap's grace runs (to the end of its last day), else Hold. A renewal
 *   signed to start later leaves them on Hold until it starts.
 */
export function accessStandingOf(input: AccessStandingInput, today: string): AccessStandingResult {
  const a = input.account;
  const none = (standing: AccessStanding, exempt: NeverHeldRole | null = null): AccessStandingResult => ({ standing, exempt, gap: null, grace: null, noContract: null });
  if (a && !a.isActive) return none('no_access');
  const exempt = a ? neverHeldRole(a.roles) : null;
  if (exempt) return none('active', exempt);
  // no contract entered (owner, 23 October 2026: "Hold them after 7 days"): only an account switched on is concerned
  const noContract = (employmentId: string | null): AccessStandingResult => {
    if (!a) return none('no_access');
    const since = input.noContractSince ?? null;
    const until = since ? addDaysTo(since, NO_CONTRACT_DAYS) : null;
    const info = { employmentId, since, until, holdFrom: until ? addDaysTo(until, 1) : null };
    if (!until || today <= until) return { ...none('no_access'), noContract: info };
    const grace = input.graces.find((g) => g.contractId === null && (g.employmentId ?? null) === employmentId) ?? null;
    return { standing: grace && grace.until >= today ? 'grace' : 'hold', exempt: null, gap: null, grace, noContract: info };
  };
  const e = input.employment;
  if (!e) return input.everEmployed ? none('no_access') : noContract(null);
  const started = e.contracts.filter((c) => isSigned(c) && c.startDate <= today);
  if (started.some((c) => c.endDate === null || c.endDate >= today)) return none('active');
  if (!started.length) return noContract(e.id ?? null);
  // every one started has ended (an end of null is in force): the one that ended last opened the gap
  const gap = [...started].sort((x, y) => (y.endDate! < x.endDate! ? -1 : y.endDate! > x.endDate! ? 1 : y.version - x.version))[0];
  const grace = input.graces.find((g) => g.contractId === gap.id) ?? null;
  return { standing: grace && grace.until >= today ? 'grace' : 'hold', exempt: null, gap, grace, noContract: null };
}

/**
 * Whether HR may give 7 days' grace now: on Hold, in a gap (a contract's end, or no contract entered), and none given in
 * this gap yet ("Once per contract gap").
 */
export function graceAllowed(s: Pick<AccessStandingResult, 'standing' | 'gap' | 'grace'> & { noContract?: AccessStandingResult['noContract'] }): boolean {
  return s.standing === 'hold' && (s.gap !== null || !!s.noContract) && s.grace === null;
}

/**
 * Why grace can't be given now, in words; null when it can. `self`: the one giving it is the person themself (never for
 * oneself). `date`: how a day is shown (DD/MM/YYYY on the website).
 */
export function graceRefusal(
  s: Pick<AccessStandingResult, 'standing' | 'gap' | 'grace' | 'exempt'> & { noContract?: AccessStandingResult['noContract'] },
  opts: { self: boolean; date?: (ymd: string) => string },
): string | null {
  const date = opts.date ?? shownDay;
  if (opts.self) return 'You can’t give yourself grace: another HR person, an Admin or a Super Admin can.';
  if (s.standing === 'active') return s.exempt ? 'They are never on hold, so they need no grace.' : 'Their contract is in force: they have full access.';
  if (s.standing === 'grace') return `They are on grace already, until ${date(s.grace!.until)}. It can’t be extended.`;
  if (s.standing === 'no_access' && s.noContract) {
    return s.noContract.holdFrom
      ? `They aren’t on hold yet: no contract entered, their access is on hold from ${date(s.noContract.holdFrom)} unless a signed contract is entered.`
      : 'They aren’t on hold yet: no contract entered.';
  }
  if (s.standing === 'no_access') return 'Grace is for someone on hold, while their contract is renewed. They have no signed contract in force to renew, or no current employment.';
  if (s.grace) return `Grace was used already in this gap (${date(graceFromOf(s.grace))} to ${date(s.grace.until)}). It’s given once a gap and can’t be extended.`;
  return null;
}

/** The last day of a grace given on `today` (YYYY-MM-DD): the end of the 7th day after (given on 23 October: 30 October). */
export const graceUntilOf = (today: string): string => addDaysTo(today, GRACE_DAYS);

/** The day a grace was given, in Cairo (YYYY-MM-DD). */
export const graceFromOf = (g: Pick<StandingGrace, 'grantedAt'>): string => CAIRO_DAY_OF.format(new Date(g.grantedAt));

/** "30 Oct" (and the year when it isn't this one's): a grace's last day as a badge says it, "Grace until 30 Oct". */
export function shortDay(ymd: string, today: string): string {
  if (!YMD.test(ymd)) return ymd;
  const month = SHORT_MONTHS[Number(ymd.slice(5, 7)) - 1] ?? ymd.slice(5, 7);
  const day = String(Number(ymd.slice(8, 10)));
  return ymd.slice(0, 4) === today.slice(0, 4) ? `${day} ${month}` : `${day} ${month} ${ymd.slice(0, 4)}`;
}

/** The badge of a standing: "Active", "Grace until 30 Oct", "Hold", "No access". */
export function standingBadgeText(standing: AccessStanding, graceUntil: string | null | undefined, today: string): string {
  return standing === 'grace' && graceUntil ? `Grace until ${shortDay(graceUntil, today)}` : ACCESS_STANDING_LABELS[standing];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CAIRO_DAY_OF = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const shownDay = (ymd: string) => (YMD.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd);

function addDaysTo(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** An employee's standing as the API answers it: on the Access tab, and the Users page's account of an employee. */
export interface AccessStandingView {
  standing: AccessStanding;
  /** Never held: their role (Super Admin, CEO); null for anyone else. */
  exempt: NeverHeldRole | null;
  /** The gap they are in (Grace, Hold): the contract whose end opened it, its number and last day; null when in none. */
  gap: { contractId: string; number: string; endDate: string } | null;
  /**
   * This gap's grace: from the day given to its last day, when and by whom it was given, and whether it still runs; null
   * without one. Once over (Hold), the Access tab says "Grace already used in this gap (… to …)".
   */
  grace: { from: string; until: string; grantedAt: string; grantedBy: { id: string; name: string } | null; running: boolean } | null;
  /** Whether the one asking may give 7 days' grace now (graceAllowed, never to oneself); false for anyone else. */
  canGiveGrace: boolean;
  /**
   * No contract entered (23 October 2026: "Hold them after 7 days"): the day first recorded and the day their access is
   * on hold from (both null until the sweep records it, within minutes); null for anyone else. The Access tab warns "No
   * contract entered: on hold from … unless HR enters a signed contract".
   */
  noContract: { since: string | null; holdFrom: string | null } | null;
}

/** An Employees list row's access (HR, an Admin, a Super Admin): the account's state, the standing, a grace's last day. */
export interface RowAccessView {
  state: AccessState;
  standing: AccessStanding;
  /** While on Grace: its last day (YYYY-MM-DD); null otherwise. */
  graceUntil: string | null;
  /** No contract entered: the day first recorded and the day on hold from (null until recorded); null for anyone else. */
  noContract: { since: string | null; holdFrom: string | null } | null;
}

/**
 * GET /employees/access/counts: how many people are on Hold and on Grace now, and how many have an account switched on
 * with no contract entered (whether still working, on Hold or on Grace), of those the caller sees (HR's sidebar and the
 * Employees list's "No contract entered").
 */
export interface AccessCounts {
  hold: number;
  grace: number;
  noContract: number;
}

// ---------- set-password links ----------

/** A set-password link's purpose: the first password (an invitation), or a new one (a reset). */
export const ACCESS_LINK_PURPOSES = ['invite', 'reset'] as const;
export type AccessLinkPurpose = (typeof ACCESS_LINK_PURPOSES)[number];

/** How long a set-password link works (owner, 22 October 2026: "valid 7 days"). */
export const ACCESS_LINK_DAYS = 7;

/** The token in a link: 32 random bytes as base64url (43 characters). The database keeps only its SHA-256. */
export const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const isAccessToken = (v: unknown): v is string => typeof v === 'string' && ACCESS_TOKEN_PATTERN.test(v);

/**
 * The website's page a link opens, the token after a # (/set-password#<token>): a browser never sends what follows a #,
 * so the token stays out of the website's and the server's request logs (the brief: "the token never appears in
 * logs"); the page reads it and posts it.
 */
export const SET_PASSWORD_PAGE = '/set-password';
export const setPasswordPath = (token: string): string => `${SET_PASSWORD_PAGE}#${token}`;

/** What a set-password link is, as its page asks before showing the form. */
export type AccessLinkState = 'ok' | 'expired' | 'used' | 'unknown';

export interface AccessLinkCheck {
  state: AccessLinkState;
  /** The sign-in email it sets the password of; only for a link that works. */
  email?: string;
  purpose?: AccessLinkPurpose;
  /** When it stops working (ISO); only for a link that works. */
  expiresAt?: string;
}

/** What each state of a link that doesn't work says, on its page. */
export const ACCESS_LINK_STATE_TEXT: Record<Exclude<AccessLinkState, 'ok'>, string> = {
  expired: 'This link has expired. Ask HR for a new one.',
  used: 'This link has been used already. Sign in with your password, or ask HR for a new link.',
  unknown: 'This link doesn’t work. Check you copied all of it, or ask HR for a new one.',
};

/** The one answer to Forgot password, whatever the email: it never tells whether an account has it. */
export const FORGOT_PASSWORD_ANSWER = `If that email has an account, a link to set a new password is on its way. It works for ${ACCESS_LINK_DAYS} days.`;

/** The limits of Forgot password: links an hour for one email, and requests an hour from one address. */
export const FORGOT_PASSWORD_LIMITS = { perEmailHour: 3, perIpHour: 20 } as const;

/** Failed tries of a link an hour from one address, then refused. */
export const SET_PASSWORD_FAILED_PER_HOUR = 20;

/** What signing a Forgot password request with WEB_KEY binds the address to (as a check-in's is to its session). */
export const ACCESS_IP_TOKEN = 'access-links';

/** The fewest characters a password may have (the API's PASSWORD_MIN_LENGTH). */
export const ACCESS_PASSWORD_MIN = 10;

// ---------- the API's answers ----------


/** GET /employees/:id/access: an employee's access, for their profile's Access tab. */
export interface EmployeeAccessView {
  employeeId: string;
  state: AccessState;
  /** The sign-in email as HR chose it, with both addresses (null when the profile has none). */
  signInEmail: { choice: SignInEmailChoice | null; work: string | null; personal: string | null; email: string | null };
  /** Whether they should have access now: a current employment with a signed contract in force today. */
  eligible: boolean;
  /** Why not, in words, when not eligible. */
  notEligibleReason: string | null;
  /** The account (null without one). Its roles and the rest are the Users page's, now on the profile. */
  account: {
    id: string;
    email: string;
    isActive: boolean;
    passwordSet: boolean;
    createdAt: string;
    lastSignInAt: string | null;
    /** Shown to HR read only; an Admin changes them (the Users page's rules). Empty for the person themself. */
    roles: Role[];
    assetsAccess: AssetsAccess;
  } | null;
  /** Why a closed account is closed, in words (their employment ended, or turned off); null unless closed. */
  closedReason: string | null;
  /** The newest set-password link waiting (null without one). */
  link: { purpose: AccessLinkPurpose; createdAt: string; expiresAt: string; emailed: boolean } | null;
  /** Another account has the sign-in email: its email and whether it is another employee's. */
  clash: { email: string; otherEmployee: { id: string; fullNameEn: string } | null } | null;
  /**
   * Their access standing (owner, 23 October 2026: "Active - Grace - Hold - No Access"), which replaced "Has access
   * without an active contract": the badge, with the account's state (`state`) as the line under it.
   */
  standing: AccessStandingView;
  /** Whether email can be sent (SMTP set up): without it, links are copied and sent by hand. */
  emailReady: boolean;
  can: {
    /** HR, Admin, Super Admin: the sign-in email, invitations, resets, giving access now. */
    invite: boolean;
    /** Admin, Super Admin: roles, Assets access, turning it off, sessions (the Users page's tools). */
    manageAccount: boolean;
  };
}

/** POST …/access/invite and …/access/reset: the link made, emailed or to copy (`link` only when asked to copy). */
export interface AccessLinkResult {
  emailed: boolean;
  expiresAt: string;
  /** The whole link, shown once to copy and send by hand; never kept. */
  link?: string;
}

/** POST /employees/access/invitations: how many were sent, and those that couldn't be. */
export interface BulkInviteResult {
  sent: number;
  skipped: { employeeId: string; fullNameEn: string; reason: string }[];
}
