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
  /** An active account without a signed contract in force (a renewal on its way, or a contract to sign). */
  withoutContract: boolean;
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
