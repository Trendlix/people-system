import type { ClientAccountStatus } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import { departmentName } from '../contracts/views.js';
import type { Prisma } from '../generated/prisma/client.js';

// Client accounts as the API sends them (owner, 25 October 2026; packages/shared client-accounts.ts). The amounts (an
// account's default, a tier's, an assignment's) are null for anyone who doesn't see salaries (HR, Finance and the CEO;
// an Admin or a Super Admin only with one of them; never a developer). A C-level person's assignments are left out for
// anyone they are hidden from, the account saying how many (`hidden`).

/** Where an assignment stands today: held now, ended, or yet to start. */
export type AssignmentStanding = 'current' | 'past' | 'upcoming';

export const standingOf = (fromDate: string, toDate: string | null, today: string): AssignmentStanding =>
  fromDate > today ? 'upcoming' : toDate !== null && toDate < today ? 'past' : 'current';

export const ASSIGNMENT_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
} satisfies Prisma.ClientAccountAssignmentInclude;

export const ACCOUNT_INCLUDE = {
  tier: { select: { id: true, nameEn: true } },
  department: { select: { id: true, nameEn: true, parent: { select: { nameEn: true } } } },
  assignments: { include: ASSIGNMENT_INCLUDE, orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }] },
} satisfies Prisma.ClientAccountInclude;

export type AccountRow = Prisma.ClientAccountGetPayload<{ include: typeof ACCOUNT_INCLUDE }>;
export type AssignmentRow = Prisma.ClientAccountAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

export interface AssignmentView {
  id: string;
  accountId: string;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employmentId: string;
  fromDate: string;
  toDate: string | null;
  /** EGP a month; null for anyone who doesn't see salaries. */
  amount: number | null;
  note: string | null;
  standing: AssignmentStanding;
}

export interface ClientAccountView {
  id: string;
  nameEn: string;
  nameAr: string | null;
  code: string | null;
  status: ClientAccountStatus;
  endedOn: string | null;
  notes: string | null;
  tier: { id: string; nameEn: string } | null;
  department: { id: string; name: string } | null;
  /** The default amount a month for the people assigned; null for anyone who doesn't see salaries. */
  defaultAmount: number | null;
  /** Its people, current first (by name), then those yet to start, then the past ones (latest first). */
  assignments: AssignmentView[];
  /** The C-level people's assignments left out for the caller. */
  hidden: number;
}

const ORDER: Record<AssignmentStanding, number> = { current: 0, upcoming: 1, past: 2 };

export function assignmentView(a: AssignmentRow, seesAmounts: boolean, today: string): AssignmentView {
  const fromDate = fromDateOnly(a.fromDate);
  const toDate = fromDateOnly(a.toDate);
  return {
    id: a.id,
    accountId: a.accountId,
    employee: a.employee,
    employmentId: a.employmentId,
    fromDate,
    toDate,
    amount: seesAmounts ? a.amount.toNumber() : null,
    note: a.note,
    standing: standingOf(fromDate, toDate, today),
  };
}

/** Current first by name, then upcoming by start, then past by end, latest first. */
export function byStanding(a: AssignmentView, b: AssignmentView): number {
  return (
    ORDER[a.standing] - ORDER[b.standing] ||
    (a.standing === 'past' ? (b.toDate ?? '').localeCompare(a.toDate ?? '') : a.standing === 'upcoming' ? a.fromDate.localeCompare(b.fromDate) : 0) ||
    a.employee.fullNameEn.localeCompare(b.employee.fullNameEn)
  );
}

export function accountView(a: AccountRow, seesAmounts: boolean, hidden: ReadonlySet<string>, today: string): ClientAccountView {
  const shown = a.assignments.filter((x) => !hidden.has(x.employeeId));
  return {
    id: a.id,
    nameEn: a.nameEn,
    nameAr: a.nameAr,
    code: a.code,
    status: a.status as ClientAccountStatus,
    endedOn: fromDateOnly(a.endedOn),
    notes: a.notes,
    tier: a.tier,
    department: a.department ? { id: a.department.id, name: departmentName(a.department)! } : null,
    defaultAmount: seesAmounts ? a.defaultAmount.toNumber() : null,
    assignments: shown.map((x) => assignmentView(x, seesAmounts, today)).sort(byStanding),
    hidden: a.assignments.length - shown.length,
  };
}
