import {
  ACCESS_PASSWORD_MIN,
  ACCESS_STANDING_LABELS,
  ACCESS_STANDINGS,
  ACCESS_STATE_LABELS,
  GRACE_DAYS,
  isAccessStanding,
  isAccessToken,
  NO_CONTRACT_DAYS,
  standingBadgeText,
  type AccessStanding,
  type AccessStandingView,
  type AccessState,
  type EmployeeAccessView,
  type RowAccessView,
} from '@trendlix/shared';

// Every active employee's access, as the screens show it (owner, 22 October 2026: "any active employee with active
// contract should have access"; packages/shared employee-access.ts): the badge of each state, the line under it, the
// Employees list's Access filter, and the set-password page's rules. Pure code, tested; no "@/" imports.
//
// Access follows the contract (owner, 23 October 2026: "No Access without active contract, Access should be on hold with
// a 7 days grace period one time granted by the hr", then "Active - Grace - Hold - No Access"): the standing is the
// badge (Active green, Grace amber with its last day, Hold red, No access grey), the account's state the line under it
// where it matters ("Active · Invited …"); the old "No active contract" and "Closed" are read into the four.

/** The badge's look for each state: done, waiting on HR, waiting on the person, or nothing to do. */
const STATE_BADGE: Record<AccessState, string> = {
  active: 'badge bg-ok-soft text-ok',
  invited: 'badge bg-accent-soft text-accent',
  not_invited: 'badge bg-warn-soft text-warn',
  pending: 'badge bg-warn-soft text-warn',
  clash: 'badge bg-danger-soft text-danger',
  no_email: 'badge bg-danger-soft text-danger',
  not_eligible: 'badge bg-line-soft text-muted',
  closed: 'badge bg-line-soft text-muted',
};

export const accessBadgeClass = (state: AccessState): string => STATE_BADGE[state];
export const accessLabel = (state: AccessState): string => ACCESS_STATE_LABELS[state];

/**
 * An Employees list row's access (HR, an Admin, a Super Admin get it; the API leaves it out for anyone else). An API from
 * before the standings (23 October 2026) sends no `standing`.
 */
export type RowAccess = Pick<RowAccessView, 'state'> & Partial<Omit<RowAccessView, 'state'>>;

// ---------- the standing (23 October 2026) ----------

/** The badge's look for each standing: Active green, Grace amber, Hold red, No access grey. */
const STANDING_BADGE: Record<AccessStanding, string> = {
  active: 'badge bg-ok-soft text-ok',
  grace: 'badge bg-warn-soft text-warn',
  hold: 'badge bg-danger-soft text-danger',
  no_access: 'badge bg-line-soft text-muted',
};

export const standingBadgeClass = (standing: AccessStanding): string => STANDING_BADGE[standing];

/** The badge's words: "Active", "Grace until 30 Oct", "Hold", "No access" (`today`: YYYY-MM-DD in Cairo). */
export const standingBadge = (standing: AccessStanding, graceUntil: string | null | undefined, today: string): string => standingBadgeText(standing, graceUntil, today);

/**
 * The account's state as the line under the standing, where it matters: how far its setting up has come (No email,
 * Being set up, Email in use, Not invited, Invited). Null when there is nothing to add: a password set (the Access tab
 * says when they last signed in), or the old "No active contract" and "Closed", which the standing says.
 */
export function setupLabel(state: AccessState): string | null {
  return state === 'active' || state === 'not_eligible' || state === 'closed' ? null : ACCESS_STATE_LABELS[state];
}

/** "Never on hold: Super Admin." for a Super Admin or the CEO; null for anyone else. */
export function exemptLine(s: Pick<AccessStandingView, 'exempt'>): string | null {
  return s.exempt ? `Never on hold: ${s.exempt === 'super_admin' ? 'Super Admin' : 'CEO'}.` : null;
}

/**
 * What the standing means for them now, under the badge: on Hold which contract ended and what still works; during
 * Grace until when, by whom and since when; after a grace used in this gap, when it ran. Null for Active and No access
 * (their lines are the account's: accessStatusLine).
 */
export function standingLine(s: AccessStandingView, date: DateText): string | null {
  const g = s.grace;
  if (s.standing === 'grace' && g) return `Grace until ${date(g.until)}, given by ${g.grantedBy?.name ?? 'HR'} on ${date(g.from)}. Full access until the end of that day.`;
  if (s.standing !== 'hold') return null;
  // no contract entered (owner, 23 October 2026: "Hold them after 7 days"): held since its 7 days ran out
  if (!s.gap && s.noContract) return 'No contract entered: only check-in and check-out work until a signed contract is entered.';
  const ended = s.gap ? (s.gap.endDate ? `Their contract ${s.gap.number} ended on ${date(s.gap.endDate)}` : `Their contract ${s.gap.number} has ended`) : 'Their contract isn’t in force';
  return `${ended}: only check-in and check-out work until it’s renewed.`;
}

/**
 * No contract entered, while it still works (owner, 23 October 2026: "Hold them after 7 days"): the Access tab's warning,
 * "No contract entered: on hold from 31/10/2026 unless HR enters a signed contract". Before the sweep records it (within
 * minutes) there is no day yet. Null for anyone else (once held, standingLine says it).
 */
export function noContractLine(s: Pick<AccessStandingView, 'standing' | 'noContract'>, date: DateText): string | null {
  if (s.standing !== 'no_access' || !s.noContract) return null;
  return s.noContract.holdFrom
    ? `No contract entered: on hold from ${date(s.noContract.holdFrom)} unless HR enters a signed contract.`
    : `No contract entered: on hold ${NO_CONTRACT_DAYS} days from now unless HR enters a signed contract.`;
}

/** An Employees list row's "No contract entered" under its badge: when it holds, or that it does; null for anyone else. */
export function rowNoContractLine(a: Pick<RowAccess, 'standing' | 'noContract'> | null | undefined, date: DateText): string | null {
  if (!a?.noContract) return null;
  if (a.standing !== 'no_access') return 'No contract entered';
  return a.noContract.holdFrom ? `No contract entered · on hold from ${date(a.noContract.holdFrom)}` : 'No contract entered';
}

/** How many of these rows have no contract entered (the filter's count). */
export const noContractCount = (rows: readonly { access?: RowAccess | null }[]): number => rows.filter((r) => !!r.access?.noContract).length;

/** After a grace used in this gap (on Hold again): "Grace already used in this gap (23/10/2026 to 30/10/2026)." */
export function usedGraceLine(s: AccessStandingView, date: DateText): string | null {
  return s.standing === 'hold' && s.grace && !s.grace.running ? `Grace already used in this gap (${date(s.grace.from)} to ${date(s.grace.until)}).` : null;
}

/**
 * An account that still signs in though they are No access: someone who left, whose account an Admin turned back on
 * (no contract entered is said apart: noContractLine). Said here so HR acts on it.
 */
export const STILL_SIGNS_IN_NOTE = 'Their account still signs in though their employment has ended: an Admin can turn it off.';

export function stillSignsIn(v: Pick<EmployeeAccessView, 'state' | 'account' | 'standing'>): boolean {
  return v.standing.standing === 'no_access' && !v.standing.exempt && !v.standing.noContract && !!v.account?.isActive && v.state !== 'closed';
}

/** Whether the Access tab offers "Give 7 days' grace": the API's word (on Hold, none in this gap, never to oneself). */
export const offersGrace = (v: Pick<EmployeeAccessView, 'standing'>): boolean => v.standing.canGiveGrace === true;

/** The question before giving grace, with its last day as the API sets it (today and 7 days after). */
export function graceQuestion(until: string, date: DateText): string {
  return `Give ${GRACE_DAYS} days’ grace, until ${date(until)}? Once in this gap; it can’t be extended.`;
}

// ---------- the Employees list's filter ----------

/** The account states the filter offers beside the standings: those of its setting up, and a password set. */
const SETUP_FILTER_STATES = ['no_email', 'pending', 'clash', 'not_invited', 'invited', 'active'] as const satisfies readonly AccessState[];
type SetupFilterState = (typeof SETUP_FILTER_STATES)[number];

/**
 * The Access filter on the Employees list: a standing, no contract entered (owner, 23 October 2026: "Hold them after 7
 * days"), an account's state ("setup:not_invited"), or none.
 */
export type AccessFilter = AccessStanding | 'no_contract' | `setup:${SetupFilterState}` | '';

/** No contract entered, as the filter names it. */
export const NO_CONTRACT_FILTER_LABEL = 'No contract entered';

/** The filter's choices, in the order the select lists them: the standings and no contract entered, then the accounts' states. */
export const ACCESS_FILTER_GROUPS: readonly { label: string; options: readonly { value: Exclude<AccessFilter, ''>; label: string }[] }[] = [
  {
    label: 'Standing',
    options: [...ACCESS_STANDINGS.map((s) => ({ value: s, label: ACCESS_STANDING_LABELS[s] })), { value: 'no_contract' as const, label: NO_CONTRACT_FILTER_LABEL }],
  },
  {
    label: 'Account',
    options: SETUP_FILTER_STATES.map((s) => ({ value: `setup:${s}` as const, label: s === 'active' ? 'Password set' : ACCESS_STATE_LABELS[s] })),
  },
];

/** Every choice of the filter, flat. */
export const ACCESS_FILTERS = ACCESS_FILTER_GROUPS.flatMap((g) => g.options);

const isSetupFilterState = (v: string): v is SetupFilterState => (SETUP_FILTER_STATES as readonly string[]).includes(v);

/**
 * ?access= as a filter; anything else is no filter. Links from before the standings still work: an account's state
 * alone ("not_invited") is that state; "Has access without an active contract" (without_contract) and "No active
 * contract" are Hold and No access now, "Closed" No access.
 */
export function readAccessFilter(v: string): AccessFilter {
  if (isAccessStanding(v) || v === 'no_contract') return v;
  if (v.startsWith('setup:') && isSetupFilterState(v.slice(6))) return v as AccessFilter;
  if (v === 'without_contract') return 'hold';
  if (v === 'not_eligible' || v === 'closed') return 'no_access';
  return isSetupFilterState(v) && v !== 'active' ? `setup:${v}` : '';
}

/** Whether a row passes the filter (a row without access, a C-level card, passes none but "no filter"). */
export function matchesAccess(access: RowAccess | null | undefined, filter: AccessFilter): boolean {
  if (!filter) return true;
  if (!access) return false;
  if (filter === 'no_contract') return !!access.noContract;
  return filter.startsWith('setup:') ? access.state === filter.slice(6) : access.standing === filter;
}

/** The people Send invitations would email from these rows: those with an account and no invitation yet. */
export function invitableIds(rows: readonly { id: string; access?: RowAccess | null }[]): string[] {
  return rows.filter((r) => r.access?.state === 'not_invited').map((r) => r.id);
}

/** "Send invitations to 3 people?" and the like, for the confirmation. */
export function inviteQuestion(count: number): string {
  return count === 1
    ? 'Email a set-password invitation to 1 person? The link works for 7 days.'
    : `Email a set-password invitation to ${count} people? Each link works for 7 days.`;
}

type DateText = (iso: string) => string;

/** The line under the status on the Access tab: what the state means for them now, and what to do. */
export function accessStatusLine(v: Pick<EmployeeAccessView, 'state' | 'account' | 'link' | 'notEligibleReason' | 'closedReason' | 'clash' | 'signInEmail'>, date: DateText): string {
  switch (v.state) {
    case 'active':
      return v.account?.lastSignInAt ? `Password set. Last signed in ${date(v.account.lastSignInAt)}.` : 'Password set. They haven’t signed in yet.';
    case 'invited':
      return v.link
        ? `Invitation ${v.link.emailed ? 'emailed' : 'link copied'} ${date(v.link.createdAt)}. It works until ${date(v.link.expiresAt)}.`
        : 'Invited.';
    case 'not_invited':
      return v.account ? `Account made ${date(v.account.createdAt)}. No invitation sent yet.` : 'No invitation sent yet.';
    case 'pending':
      return 'Their account is made within a few minutes, or now with Give access now. Nothing is sent to them.';
    case 'clash':
      return v.clash
        ? `Another account already signs in with ${v.clash.email}. An Admin can change that account, or choose their other email.`
        : 'Another account already uses their email.';
    case 'no_email':
      return 'Add an email to give access: a work or personal email on Basic Data.';
    case 'not_eligible':
      return v.notEligibleReason ?? 'They have no signed contract in force today.';
    case 'closed':
      return v.closedReason ?? 'Their access is turned off.';
  }
}

// ---------- the set-password page ----------

/** The token in a link's address, after the # (/set-password#<token>); null when it isn't one. */
export function tokenFromHash(hash: string): string | null {
  const t = hash.replace(/^#/, '').trim();
  return isAccessToken(t) ? t : null;
}

export const PASSWORD_MAX = 200;

/** What is wrong with a new password and its repeat, in words; null when it may be sent (the API checks it again). */
export function newPasswordProblem(password: string, repeat: string): string | null {
  if (password.length < ACCESS_PASSWORD_MIN) return `Choose a password of at least ${ACCESS_PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Choose a password of at most ${PASSWORD_MAX} characters.`;
  if (password !== repeat) return 'The two passwords aren’t the same.';
  return null;
}
