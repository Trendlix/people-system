import type { ClientAccountStatus } from '@trendlix/shared';
// relative, not "@/": the unit tests run without the alias
import { formatDate } from '../../../../../lib/format';

// A person's client accounts on their profile's Employment tab (owner, 25 October 2026: "if an employee has an
// allowance per account, how can we deal with it?"; an accounts allowance per client account assigned, "By days"), as
// GET /employees/:id/client-accounts sends them: every assignment, current, to come and ended, with its amount a month
// for those who see salaries, for HR, the CEO, Finance and a Super Admin (`full`); the current ones' names and dates
// alone for the person themself and their direct manager (the amount is on the payslip). Pure code, tested.

/** Where an assignment stands today. */
export type AssignmentStanding = 'current' | 'past' | 'upcoming';

export interface EmployeeClientAccount {
  id: string;
  accountId: string;
  fromDate: string;
  toDate: string | null;
  /** EGP a month; null for anyone who doesn't see salaries. */
  amount: number | null;
  /** Their contract's amount per account, paid in place of `amount` (27 October 2026); null or missing: none, or not seen. */
  contractAmount?: number | null;
  /** HR's note; null for the person and their manager. */
  note: string | null;
  standing: AssignmentStanding;
  account: { id: string; nameEn: string; nameAr: string | null; code: string | null; status: ClientAccountStatus };
}

export interface EmployeeClientAccounts {
  assignments: EmployeeClientAccount[];
  seesAmounts: boolean;
  /** Everything (HR, the CEO, Finance, a Super Admin), or the current ones only (the person, their manager). */
  full: boolean;
}

export const STANDING_LABELS: Record<AssignmentStanding, string> = { current: 'Current', upcoming: 'To come', past: 'Ended' };

export const STANDING_TONES: Record<AssignmentStanding, string> = {
  current: 'bg-ok-soft text-ok',
  upcoming: 'bg-accent-soft text-accent',
  past: 'bg-line-soft text-muted',
};

/** "From 01/10/2026", "01/10/2026 to 31/12/2026". */
export function periodText(a: Pick<EmployeeClientAccount, 'fromDate' | 'toDate'>): string {
  return a.toDate ? `${formatDate(a.fromDate)} to ${formatDate(a.toDate)}` : `From ${formatDate(a.fromDate)}`;
}

/** Whether the section shows: with any assignment, or always for those who see everything (to say there are none). */
export const showsClientAccounts = (view: EmployeeClientAccounts): boolean => view.full || view.assignments.length > 0;

/** The section's note: "2 current, 1 ended"; nothing without any. */
export function clientAccountsNote(view: Pick<EmployeeClientAccounts, 'assignments'>): string | undefined {
  const count = (s: AssignmentStanding) => view.assignments.filter((a) => a.standing === s).length;
  const parts = (['current', 'upcoming', 'past'] as const).flatMap((s) => (count(s) ? [`${count(s)} ${STANDING_LABELS[s].toLowerCase()}`] : []));
  return parts.length ? parts.join(', ') : undefined;
}

/** Where an account opens: the Client Accounts page, at the account, for those who see everything. */
export const accountHref = (accountId: string) => `/clients/accounts?account=${encodeURIComponent(accountId)}`;
