import { ADVANCE_KIND_LABELS, HOLD_RELEASE_METHOD_LABELS, HOLD_RELEASE_METHODS, type PayrollStatus, type Role } from '@trendlix/shared';
import { formatDate, parseDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import { formatEgp, parseAmount } from '../../employees/[id]/contracts/salary';
import type { AdvanceRow, PersonRef, UserRef } from '../adjustments/adjustments';

// Unsettled (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Unsettled - Additions /
// Deductions"; asked, the owner chose what it lists): the runs not yet paid, the lines on hold not paid out since, the
// final settlements of people who left, and the advances and loans still being recovered. Plain helpers for the page (no
// server-only, so they are unit tested): what GET /payroll/unsettled answers, each part in words, and what the forms
// send. Relative imports: the tests run without the "@/" alias. Salary data: HR, Finance and the CEO; HR settles.

type WithRoles = { roles: readonly Role[] };

export interface RunNotPaid {
  id: string;
  month: string;
  status: PayrollStatus;
  employees: number;
  held: number;
  transfer: number;
  net: number;
  companyCost: number;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
}

export interface HeldLine {
  lineId: string;
  runId: string;
  month: string;
  runStatus: PayrollStatus;
  employee: PersonRef;
  department: string | null;
  amount: number;
  net: number;
  comments: string | null;
}

export interface ClearanceDocument {
  id: string;
  fileName: string;
  generatedAt: string;
  status: string;
}

export interface FinalSettlement {
  employmentId: string;
  employee: PersonRef;
  department: string | null;
  jobTitle: string | null;
  joinDate: string;
  endDate: string;
  endReason: string | null;
  reasonText: string | null;
  status: 'open' | 'settled';
  daysOpen: number;
  reopened: boolean;
  settledOn: string | null;
  amountPaid: number | null;
  note: string | null;
  document: ClearanceDocument | null;
  settledBy: UserRef | null;
  settledAt: string | null;
  clearances: ClearanceDocument[];
}

export interface UnsettledView {
  generatedAt: string;
  today: string;
  runs: { count: number; transfer: number; rows: RunNotPaid[] };
  held: { count: number; amount: number; rows: HeldLine[] };
  settlements: { count: number; rows: FinalSettlement[]; recentlySettled: FinalSettlement[] };
  advances: { count: number; amount: number; outstanding: number; rows: AdvanceRow[] };
}

/** Who sees the page: HR, Finance and the CEO, as the payroll lines. */
export const canSeeUnsettled = (user: WithRoles) => hasRole(user, 'hr', 'finance', 'ceo');

/** HR settles, reopens, records payouts and advances. */
export const settlesPayroll = (user: WithRoles) => hasRole(user, 'hr');

/** "1 run", "3 runs" and the like. */
export const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The four parts, as the summary at the top lists them, each linking to its section. */
export function summaryTiles(u: UnsettledView): { key: string; href: string; label: string; count: string; note: string }[] {
  return [
    { key: 'runs', href: '#runs', label: 'Runs not yet paid', count: String(u.runs.count), note: `${formatEgp(u.runs.transfer)} to transfer` },
    { key: 'held', href: '#held', label: 'Lines on hold', count: String(u.held.count), note: `${formatEgp(u.held.amount)} held` },
    { key: 'settlements', href: '#settlements', label: 'Final settlements', count: String(u.settlements.count), note: oldestText(u.settlements.rows) },
    { key: 'advances', href: '#advances', label: 'Advances and loans', count: String(u.advances.count), note: `${formatEgp(u.advances.outstanding)} outstanding` },
  ];
}

/** "The oldest open for 45 days", or "None open". */
function oldestText(rows: readonly Pick<FinalSettlement, 'daysOpen'>[]): string {
  if (!rows.length) return 'None open';
  const days = Math.max(...rows.map((r) => r.daysOpen));
  return days <= 0 ? 'Open since today' : `The oldest open for ${counted(days, 'day', 'days')}`;
}

/** How long one has been open: "Since today", "1 day", "12 days". */
export const daysText = (days: number) => (days <= 0 ? 'Since today' : counted(days, 'day', 'days'));

/** The total of everything the page counts, for the Overview: how many things are unsettled. */
export const unsettledCount = (u: Pick<UnsettledView, 'runs' | 'held' | 'settlements' | 'advances'>) => u.runs.count + u.held.count + u.settlements.count + u.advances.count;

/** The ending's reason as the list shows it: the rule's name or the end reason, else a dash. */
export const reasonText = (s: Pick<FinalSettlement, 'reasonText'>) => s.reasonText ?? '—';

/** A clearance document as the form offers it: "Clearance and dues, 17/10/2026 (signed)". */
export const clearanceOption = (d: ClearanceDocument) => `${d.fileName}, ${formatDate(d.generatedAt)}${d.status !== 'generated' ? ` (${d.status})` : ''}`;

/** Where a generated document opens: its file, through the web server. */
export const documentHref = (employeeId: string, documentId: string) => `/employees/${employeeId}/documents/${documentId}/file`;

/** "Loan", "Advance". */
export const advanceKindText = (kind: string) => ADVANCE_KIND_LABELS[kind as keyof typeof ADVANCE_KIND_LABELS] ?? kind;

export const METHOD_CHOICES = HOLD_RELEASE_METHODS.map((m) => ({ value: m, label: HOLD_RELEASE_METHOD_LABELS[m] }));

// ---------- what the forms send ----------

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** A day typed as DD/MM/YYYY, as YYYY-MM-DD, or a message. */
function day(fd: FormData, key: string, what: string, errors: string[]): string {
  const parsed = parseDate(text(fd, key));
  if (!parsed) errors.push(`Enter the ${what} as DD/MM/YYYY, e.g. 17/10/2026.`);
  return parsed ?? '';
}

/** Marking a final settlement settled: the day, the amount paid (0 or more), a note, the clearance document if chosen. */
export function settleBody(fd: FormData): { body: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const settledOn = day(fd, 'settledOn', 'day the final dues were settled', errors);
  const amount = parseAmount(text(fd, 'amountPaid'));
  if (amount === null || Number.isNaN(amount)) errors.push('Enter the amount paid in EGP, 0 or more, e.g. 18500.50.');
  return { body: { settledOn, amountPaid: amount, note: text(fd, 'note') || null, documentId: text(fd, 'documentId') || null }, errors };
}

/** Recording held pay as paid out: the day, how, a note. */
export function paidOutBody(fd: FormData): { body: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const paidOn = day(fd, 'paidOn', 'day it was paid out', errors);
  const method = text(fd, 'method');
  if (!(HOLD_RELEASE_METHODS as readonly string[]).includes(method)) errors.push('Choose how it was paid out.');
  return { body: { paidOn, method, note: text(fd, 'note') || null }, errors };
}

/** A new advance or loan (`entering`), or an open one's changes: the amount, the day it was given, the reason, the plan. */
export function advanceBody(fd: FormData, entering: boolean): { body: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const body: Record<string, unknown> = {};
  if (entering) {
    body.employeeId = text(fd, 'employeeId');
    if (!body.employeeId) errors.push('Choose the employee.');
    body.kind = text(fd, 'kind');
    if (body.kind !== 'advance' && body.kind !== 'loan') errors.push('Choose advance or loan.');
  }
  const amount = parseAmount(text(fd, 'amount'));
  if (amount === null || Number.isNaN(amount) || amount <= 0) errors.push('Enter the amount given in EGP, more than 0, e.g. 6000.');
  body.amount = amount;
  body.givenOn = day(fd, 'givenOn', 'day it was given', errors);
  body.reason = text(fd, 'reason');
  if (!body.reason) errors.push('Say what it was given for.');
  body.plan = text(fd, 'plan') || null;
  return { body, errors };
}
