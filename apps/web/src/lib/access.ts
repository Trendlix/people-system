import {
  ACCESS_PASSWORD_MIN,
  ACCESS_STATE_LABELS,
  ACCESS_STATES,
  isAccessToken,
  type AccessState,
  type EmployeeAccessView,
} from '@trendlix/shared';

// Every active employee's access, as the screens show it (owner, 22 October 2026: "any active employee with active
// contract should have access"; packages/shared employee-access.ts): the badge of each state, the line under it, the
// Employees list's Access filter, and the set-password page's rules. Pure code, tested; no "@/" imports.

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

/** An Employees list row's access (HR, an Admin, a Super Admin get it; the API leaves it out for anyone else). */
export interface RowAccess {
  state: AccessState;
  withoutContract: boolean;
}

/** The Access filter on the Employees list: a state, or "Has access without an active contract". */
export type AccessFilter = AccessState | 'without_contract' | '';

export const WITHOUT_CONTRACT_LABEL = 'Has access without an active contract';

/** The filter's choices, in the order the select lists them. */
export const ACCESS_FILTERS: readonly { value: Exclude<AccessFilter, ''>; label: string }[] = [
  ...ACCESS_STATES.map((s) => ({ value: s, label: ACCESS_STATE_LABELS[s] })),
  { value: 'without_contract', label: WITHOUT_CONTRACT_LABEL },
];

/** ?access= as a filter; anything else is no filter. */
export function readAccessFilter(v: string): AccessFilter {
  return v === 'without_contract' || (ACCESS_STATES as readonly string[]).includes(v) ? (v as AccessFilter) : '';
}

/** Whether a row passes the filter (a row without access, a C-level card, passes none but "no filter"). */
export function matchesAccess(access: RowAccess | null | undefined, filter: AccessFilter): boolean {
  if (!filter) return true;
  if (!access) return false;
  return filter === 'without_contract' ? access.withoutContract : access.state === filter;
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
