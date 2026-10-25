import { CLIENT_ACCOUNT_STATUS_LABELS, hiddenLinesLabel, type Role } from '@trendlix/shared';
import { formatDate, parseDate } from '../../../../lib/format';
import { joinShown } from '../../../../lib/hidden';
import { hasRole } from '../../../../lib/roles';
import { formatEgp, parseAmount } from '../../employees/[id]/contracts/salary';
import type { AssignmentStanding, AssignmentView, ClientAccountView, PersonOption, TierView } from './types';

// Clients → Client Accounts (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with
// it?"; asked, a "Client accounts list", the rate "variable", a part month "By days"): the company's client accounts,
// each with the people assigned to it from a day to a day at an amount a month (the account's default unless HR types
// another), paid by payroll as the accounts allowance to those whose contract has it. HR and the CEO add, change and end
// them; Finance and a Super Admin read them; the amounts only for those who see salaries. Pure code, tested: who sees
// the page, the forms read into what the API takes, and what the rows say. The API checks every value again. Relative
// imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };

/** Who opens the page: HR, the CEO, Finance (read only) and a Super Admin (read only, unless HR or the CEO too). */
export const seesClientAccounts = (user: WithRoles): boolean => hasRole(user, 'hr', 'ceo', 'finance', 'super_admin');

/** What the page says of payroll: drafts take a change when refreshed; a month with the CEO, approved or paid never changes. */
export const PAYROLL_NOTE =
  'Each month, payroll pays a person the sum of their accounts for the days held (calendar days held ÷ the month’s days), as the accounts allowance, when their contract has it. A draft payroll takes a change here when it is refreshed; a month whose payroll is with the CEO, approved or paid never changes: date the change after it, or add the difference in Additions.';

/** "Active" or "Ended", with the badge's colours. */
export function statusBadge(a: Pick<ClientAccountView, 'status' | 'endedOn'>): {
  label: string;
  tone: string;
} {
  return a.status === 'ended'
    ? {
        label: `${CLIENT_ACCOUNT_STATUS_LABELS.ended}${a.endedOn ? ` ${formatDate(a.endedOn)}` : ''}`,
        tone: 'bg-line-soft text-muted',
      }
    : {
        label: CLIENT_ACCOUNT_STATUS_LABELS.active,
        tone: 'bg-ok-soft text-ok',
      };
}

const STANDING_LABELS: Record<AssignmentStanding, string> = {
  current: 'Current',
  upcoming: 'From a day to come',
  past: 'Ended',
};

/** Where an assignment stands, as its badge. */
export function standingBadge(standing: AssignmentStanding): {
  label: string;
  tone: string;
} {
  const tone = standing === 'current' ? 'bg-ok-soft text-ok' : standing === 'upcoming' ? 'bg-accent-soft text-accent' : 'bg-line-soft text-muted';
  return { label: STANDING_LABELS[standing], tone };
}

/** The accounts as the page lists them: the active ones first, each part by name. */
export function sortedAccounts<A extends Pick<ClientAccountView, 'status' | 'nameEn'>>(accounts: readonly A[]): A[] {
  return [...accounts].sort((a, b) => (a.status === b.status ? a.nameEn.localeCompare(b.nameEn, 'en') : a.status === 'active' ? -1 : 1));
}

/** An account's people: those on it now, those from a day to come, and those who were on it. */
export function peopleOf<P extends Pick<AssignmentView, 'standing'>>(assignments: readonly P[]): { current: P[]; upcoming: P[]; past: P[] } {
  return {
    current: assignments.filter((a) => a.standing === 'current'),
    upcoming: assignments.filter((a) => a.standing === 'upcoming'),
    past: assignments.filter((a) => a.standing === 'past'),
  };
}

/** "From 01/10/2026", or "01/10/2026 to 31/12/2026". */
export const periodText = (a: Pick<AssignmentView, 'fromDate' | 'toDate'>): string =>
  a.toDate ? `${formatDate(a.fromDate)} to ${formatDate(a.toDate)}` : `From ${formatDate(a.fromDate)}`;

/** "EGP 1,500.00 a month"; null when the caller doesn't see it. */
export const amountText = (amount: number | null): string | null => (amount === null ? null : `${formatEgp(amount)} a month`);

/** The account's line under its name: its code, size and team. */
export const accountFacts = (a: Pick<ClientAccountView, 'code' | 'tier' | 'department'>): string =>
  joinShown([a.code, a.tier && `${a.tier.nameEn} size`, a.department?.name]);

/** "C-level (2 people) — hidden": the assignments left out for the caller; null without any. */
export const hiddenText = (count: number): string | null => (count > 0 ? hiddenLinesLabel(count) : null);

/** How many people are on an account now, for its heading: "2 people now", "No one now". */
export function peopleCount(assignments: readonly Pick<AssignmentView, 'standing'>[], hidden: number): string {
  const now = assignments.filter((a) => a.standing === 'current').length;
  const shown = now === 0 ? 'No one now' : now === 1 ? '1 person now' : `${now} people now`;
  return hidden > 0 ? `${shown}, and ${hiddenLinesLabel(hidden)}` : shown;
}

/** An amount for an amount field: 1500 → "1500.00"; none → "". */
export const amountField = (amount: number | null | undefined): string => (typeof amount === 'number' ? amount.toFixed(2) : '');

/** The default amount a size fills in, for the account's field; "" for none (or a size the caller doesn't see the amount of). */
export function tierDefault(tiers: readonly Pick<TierView, 'id' | 'defaultAmount'>[], tierId: string): string {
  return amountField(tiers.find((t) => t.id === tierId)?.defaultAmount ?? null);
}

/** `?account=<id>`: the account the Audit Log links to, to scroll to and mark; null without a valid one. */
export function focusedAccount(query: Record<string, string | string[] | undefined>): string | null {
  const v = query.account;
  const id = Array.isArray(v) ? v[0] : v;
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** An account's anchor on the page. */
export const accountAnchor = (id: string): string => `account-${id}`;

// ---------- the forms, as the API takes them ----------

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** An amount typed: a number more than 0, null when empty; a problem added when it can't be read. */
function amountOf(fd: FormData, key: string, label: string, problems: string[], required: boolean): number | null {
  const typed = text(fd, key);
  const amount = parseAmount(typed);
  if (amount === null) {
    if (required) problems.push(`Enter the ${label} in EGP a month, e.g. 1500 or 1500.50.`);
    return null;
  }
  if (Number.isNaN(amount) || !(amount > 0)) {
    problems.push(`Enter the ${label} in EGP a month, more than 0, e.g. 1500 or 1500.50.`);
    return null;
  }
  return amount;
}

/** A date typed as DD/MM/YYYY: YYYY-MM-DD, "" when empty; a problem added when it can't be read or is needed. */
function dateOf(fd: FormData, key: string, label: string, problems: string[], required: boolean): string {
  const parsed = parseDate(text(fd, key));
  if (parsed === null) {
    problems.push(`Enter the ${label} as DD/MM/YYYY, e.g. 01/11/2026.`);
    return '';
  }
  if (!parsed && required) problems.push(`Enter the ${label} as DD/MM/YYYY, e.g. 01/11/2026.`);
  return parsed;
}

export interface AccountBody {
  nameEn: string;
  nameAr?: string;
  code?: string;
  tierId?: string | null;
  defaultAmount?: number;
  departmentId?: string | null;
  notes?: string;
}

/**
 * The account form read into what the API takes (POST /client-accounts, PATCH /client-accounts/:id): the English name
 * (required, up to 150 characters), the Arabic name, the code (letters, digits and dashes, up to 30), the size, the
 * default amount (a new account's may be left to its size's), the team and the notes. A new one sends only what is
 * filled in; a change sends every field, an empty one clearing it.
 */
export function accountBody(fd: FormData, changing: boolean): { body: AccountBody | null; problems: string[] } {
  const problems: string[] = [];
  const nameEn = text(fd, 'nameEn');
  if (!nameEn || nameEn.length > 150) problems.push('Enter the account’s name in English (up to 150 characters), e.g. Acme Foods.');
  const nameAr = text(fd, 'nameAr');
  if (nameAr.length > 150) problems.push('Keep the Arabic name to 150 characters.');
  const code = text(fd, 'code');
  if (code && !/^[A-Za-z0-9][A-Za-z0-9-]{0,29}$/.test(code))
    problems.push('Enter the code in up to 30 letters, digits and dashes, e.g. ACME-01, or leave it empty.');
  const tierId = text(fd, 'tierId');
  const departmentId = text(fd, 'departmentId');
  const notes = text(fd, 'notes');
  if (notes.length > 500) problems.push('Keep the notes to 500 characters or fewer.');
  // a new account's default may come from its size; a change keeps one
  const defaultAmount = amountOf(fd, 'defaultAmount', 'default amount', problems, changing || !tierId);
  if (problems.length) return { body: null, problems };
  if (changing) {
    return {
      body: {
        nameEn,
        nameAr,
        code,
        tierId: tierId || null,
        ...(defaultAmount !== null && { defaultAmount }),
        departmentId: departmentId || null,
        notes,
      },
      problems,
    };
  }
  return {
    body: {
      nameEn,
      ...(nameAr && { nameAr }),
      ...(code && { code }),
      ...(tierId && { tierId }),
      ...(defaultAmount !== null && { defaultAmount }),
      ...(departmentId && { departmentId }),
      ...(notes && { notes }),
    },
    problems,
  };
}

/** Ending an account: the day it ends (POST /client-accounts/:id/end). */
export function endAccountBody(fd: FormData): {
  body: { endedOn: string } | null;
  problems: string[];
} {
  const problems: string[] = [];
  const endedOn = dateOf(fd, 'endedOn', 'day it ends', problems, true);
  return problems.length ? { body: null, problems } : { body: { endedOn }, problems };
}

export interface AssignmentBody {
  employeeId?: string;
  fromDate?: string;
  toDate?: string | null;
  amount?: number;
  note?: string;
}

/**
 * The assignment form read into what the API takes: a new one (POST /client-accounts/:id/assignments) its person, its
 * first day, its last day (empty: still held), its amount a month (empty: the account's default) and a note; a change
 * (PATCH /client-accounts/assignments/:id) every field it shows, an empty last day opening it again and an empty note
 * clearing it.
 */
export function assignmentBody(fd: FormData, changing: boolean): { body: AssignmentBody | null; problems: string[] } {
  const problems: string[] = [];
  const employeeId = text(fd, 'employeeId');
  if (!changing && !employeeId) problems.push('Choose the person to assign.');
  const fromDate = dateOf(fd, 'fromDate', 'first day', problems, true);
  const toDate = dateOf(fd, 'toDate', 'last day', problems, false);
  if (fromDate && toDate && toDate < fromDate) problems.push('The last day must be on or after the first.');
  // a change shows the amount only to those who see it; a new one's empty is the account's default
  const amount = fd.has('amount') ? amountOf(fd, 'amount', 'amount', problems, changing) : null;
  const note = text(fd, 'note');
  if (note.length > 500) problems.push('Keep the note to 500 characters or fewer.');
  if (problems.length) return { body: null, problems };
  if (changing)
    return {
      body: {
        fromDate,
        toDate: toDate || null,
        ...(amount !== null && { amount }),
        note,
      },
      problems,
    };
  return {
    body: {
      employeeId,
      fromDate,
      ...(toDate && { toDate }),
      ...(amount !== null && { amount }),
      ...(note && { note }),
    },
    problems,
  };
}

/** Ending an assignment: its last day (PATCH /client-accounts/assignments/:id { toDate }). */
export function endAssignmentBody(fd: FormData): {
  body: { toDate: string } | null;
  problems: string[];
} {
  const problems: string[] = [];
  const toDate = dateOf(fd, 'toDate', 'last day', problems, true);
  return problems.length ? { body: null, problems } : { body: { toDate }, problems };
}

/** A size's form (POST /client-accounts/tiers, PATCH /client-accounts/tiers/:id): its name and default amount a month. */
export function tierBody(fd: FormData): {
  body: { nameEn: string; defaultAmount: number } | null;
  problems: string[];
} {
  const problems: string[] = [];
  const nameEn = text(fd, 'nameEn');
  if (!nameEn || nameEn.length > 50) problems.push('Enter the size’s name (up to 50 characters), e.g. Small.');
  const defaultAmount = amountOf(fd, 'defaultAmount', 'default amount', problems, true);
  return problems.length || defaultAmount === null ? { body: null, problems } : { body: { nameEn, defaultAmount }, problems };
}

// ---------- who can be assigned ----------

/** A row of GET /employees as the Assign form reads it. */
export interface PersonRow {
  id: string;
  fullNameEn: string;
  employeeCode: string;
  restricted?: boolean;
  employment: {
    department?: { nameEn: string; parent?: { nameEn: string } | null } | null;
  } | null;
}

/**
 * Whom the Assign form offers for an account: those with a current employment the caller may act for (never a C-level
 * person's card), not on it now or from a day to come, by name. The API refuses anyone else, and someone whose contract
 * has no per-account allowance, saying why.
 */
export function assignable(people: readonly PersonRow[], account: Pick<ClientAccountView, 'assignments'>): PersonOption[] {
  const on = new Set(account.assignments.filter((a) => a.standing !== 'past').map((a) => a.employee.id));
  return people
    .filter((p) => p.restricted !== true && p.employment !== null && !on.has(p.id))
    .map((p) => {
      const d = p.employment?.department;
      return {
        value: p.id,
        label: joinShown([p.fullNameEn, p.employeeCode, d ? (d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn) : null]),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

// ---------- what the buttons ask and say ----------

/** What End account asks first. */
export const endAccountConfirm = (name: string): string =>
  `End ${name}? Its people's open assignments end on the day you give, and it takes no new ones. Payroll pays them up to that day.`;

/** What Delete asks first (a Super Admin only). */
export const deleteAssignmentConfirm = (person: string, account: string): string =>
  `Delete ${person}'s assignment to ${account}? Delete only one added by mistake: to stop it, end it instead.`;

export const deleteTierConfirm = (name: string): string => `Delete the size ${name}? Accounts of this size keep their default amounts, with no size.`;
