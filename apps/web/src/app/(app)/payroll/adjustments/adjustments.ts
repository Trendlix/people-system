import {
  ADJUSTMENT_KIND_LABELS,
  ADJUSTMENT_STATUS_LABELS,
  ADJUSTMENT_TYPES,
  ADVANCE_KIND_LABELS,
  ADDITION_TAXED,
  adjustmentSums,
  adjustmentTypeLabel,
  recoveredKind,
  type AdjustmentKind,
  type AdjustmentStatus,
  type AdjustmentSums,
  type AdjustmentType,
  type AdditionType,
  type AdvanceKind,
  type AdvanceStatus,
  type PayrollStatus,
  type Role,
} from '@trendlix/shared';
import { formatDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import { formatEgp, parseAmount } from '../../employees/[id]/contracts/salary';
import { addMonths, isMonth, monthName, monthOf } from '../list';
import { ADJUSTMENTS_PATH } from '../sections';

// Additions / Deductions (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Unsettled -
// Additions / Deductions"; asked, the owner chose one-off amounts per employee and month, not recurring). Plain helpers
// for the page (no server-only, so they are unit tested): the month in the address, the month's additions and deductions
// by employee with their totals, the form's types and what it sends, and each row in words. Relative imports: the tests
// run without the "@/" alias. Salary data: HR, Finance and the CEO see it; HR changes it; the API checks every request.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

export interface PersonRef {
  id: string;
  employeeCode: string;
  name: string;
}

export interface UserRef {
  id: string;
  name: string;
}

/** GET /payroll/adjustments: an addition or deduction. */
export interface AdjustmentRow {
  id: string;
  employee: PersonRef;
  month: string;
  kind: AdjustmentKind;
  type: AdjustmentType;
  taxed: boolean;
  amount: number;
  reason: string;
  advance: { id: string; kind: AdvanceKind; givenOn: string; amount: number } | null;
  status: AdjustmentStatus;
  lineId: string | null;
  appliedAt: string | null;
  createdBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
  cancelledBy: UserRef | null;
  cancelledAt: string | null;
}

/** GET /payroll/advances: an advance or a loan, with what was recovered, what is planned and what is outstanding. */
export interface AdvanceRow {
  id: string;
  employee: PersonRef;
  kind: AdvanceKind;
  amount: number;
  givenOn: string;
  reason: string;
  plan: string | null;
  status: AdvanceStatus;
  settledAt: string | null;
  settledBy: UserRef | null;
  settledNote: string | null;
  createdBy: UserRef | null;
  createdAt: string;
  recovered: number;
  planned: number;
  outstanding: number;
  unplanned: number;
  recoveries: { id: string; month: string; amount: number; status: AdjustmentStatus }[];
}

/** GET /payroll/adjustments/choices: the month's run, whether it is locked, its people and their open advances. */
export interface AdjustmentChoices {
  month: string;
  run: { id: string; status: PayrollStatus } | null;
  locked: string | null;
  people: (PersonRef & { department: string | null })[];
  advances: AdvanceRow[];
}

/** Who sees the page: HR, Finance and the CEO, as the payroll lines. */
export const canSeeAdjustments = (user: WithRoles) => hasRole(user, 'hr', 'finance', 'ceo');

/** HR enters, changes and cancels them. */
export const entersAdjustments = (user: WithRoles) => hasRole(user, 'hr');

// ---------- the month ----------

/** How far back and ahead the API takes them: back as far as a run can be made, a year ahead for a loan's installments. */
export const MONTHS_BACK = 12;
export const MONTHS_AHEAD = 12;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');

/** The month in the address (?month=YYYY-MM), this month in Cairo when there is none or it can't be read. */
export function readMonth(query: Query, today: string): string {
  const month = one(query.month);
  return isMonth(month) ? month : monthOf(today);
}

/** The page's address for a month: plain for this month. */
export const adjustmentsHref = (month: string, today: string) => (month === monthOf(today) ? ADJUSTMENTS_PATH : `${ADJUSTMENTS_PATH}?month=${month}`);

/** The months the picker offers, newest first: a year ahead back to a year ago, and the month shown if it is outside them. */
export function monthChoices(today: string, month: string): { value: string; label: string }[] {
  const now = monthOf(today);
  const months: string[] = [];
  for (let n = MONTHS_AHEAD; n >= -MONTHS_BACK; n--) months.push(addMonths(now, n));
  if (!months.includes(month)) months.push(month);
  return months.sort((a, b) => b.localeCompare(a)).map((value) => ({ value, label: monthName(value) }));
}

// ---------- the month's rows ----------

/** One person's additions and deductions in the month: the cancelled ones last, out of the sums. */
export interface PersonGroup {
  employee: PersonRef;
  rows: AdjustmentRow[];
  sums: AdjustmentSums;
}

const statusOrder = (s: AdjustmentStatus) => (s === 'cancelled' ? 1 : 0);

/** The month's rows by person, by name; in each, as entered with the cancelled ones last. */
export function byEmployee(rows: readonly AdjustmentRow[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const r of rows) {
    const g = groups.get(r.employee.id) ?? { employee: r.employee, rows: [], sums: adjustmentSums([]) };
    g.rows.push(r);
    groups.set(r.employee.id, g);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      rows: [...g.rows].sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.createdAt.localeCompare(b.createdAt)),
      sums: adjustmentSums(g.rows),
    }))
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}

/** The month's totals (the cancelled ones left out) and how many people have one. */
export function monthTotals(rows: readonly AdjustmentRow[]): AdjustmentSums & { people: number } {
  const counted = rows.filter((r) => r.status !== 'cancelled');
  return { ...adjustmentSums(rows), people: new Set(counted.map((r) => r.employee.id)).size };
}

/** A pending one HR may still change: while the month isn't locked. */
export const changeable = (row: Pick<AdjustmentRow, 'status'>, locked: string | null) => row.status === 'pending' && locked === null;

/** "Bonus", "Loan installment". */
export const typeText = (row: Pick<AdjustmentRow, 'kind' | 'type'>) => adjustmentTypeLabel(row.kind, row.type);

/** How it meets the tax: "Taxed" or "Not taxed" for an addition, "After tax" for every deduction. */
export function taxText(row: Pick<AdjustmentRow, 'kind' | 'taxed'>): string {
  if (row.kind === 'deduction') return 'After tax';
  return row.taxed ? 'Taxed' : 'Not taxed';
}

/** An addition as +EGP 1,500.00, a deduction as −EGP 250.00. */
export const signedAmount = (row: Pick<AdjustmentRow, 'kind' | 'amount'>) => `${row.kind === 'deduction' ? '−' : '+'}${formatEgp(row.amount)}`;

/** An amount with its sign, "EGP 0.00" for none: a person's or the month's net effect. */
export function netText(amount: number): string {
  if (Math.round(amount * 100) === 0) return formatEgp(0);
  return `${amount < 0 ? '−' : '+'}${formatEgp(Math.abs(amount))}`;
}

export const statusText = (status: AdjustmentStatus) => ADJUSTMENT_STATUS_LABELS[status] ?? status;

export const STATUS_BADGE: Record<AdjustmentStatus, string> = {
  pending: 'bg-warn-soft text-warn',
  applied: 'bg-ok-soft text-ok',
  cancelled: 'bg-line-soft text-muted',
};

/** Who entered it and when: "Mona Adel, 17/10/2026". */
export const enteredText = (row: Pick<AdjustmentRow, 'createdBy' | 'createdAt'>) => [row.createdBy?.name, formatDate(row.createdAt)].filter(Boolean).join(', ');

// ---------- the form ----------

export const KIND_CHOICES = (['addition', 'deduction'] as const).map((k) => ({ value: k, label: ADJUSTMENT_KIND_LABELS[k] }));

/** A kind's types for the form, each with whether it is taxed (null: HR chooses, Other). */
export function typeChoices(kind: AdjustmentKind): { value: string; label: string; taxed: boolean | null }[] {
  return ADJUSTMENT_TYPES[kind].map((t) => ({
    value: t,
    label: adjustmentTypeLabel(kind, t),
    taxed: kind === 'deduction' ? false : ADDITION_TAXED[t as AdditionType],
  }));
}

/** Whether the form asks if it is taxed: an Other addition only. */
export const asksTaxed = (kind: string, type: string) => kind === 'addition' && type === 'other';

/** The advance or loan the type recovers, or null: what the form asks to link. */
export const linksAdvance = (kind: string, type: string): AdvanceKind | null => recoveredKind(kind, type);

/** An advance or loan as the form offers it: "Loan of EGP 6,000.00, given 30/09/2026 · EGP 4,000.00 left to plan". */
export function advanceOption(a: Pick<AdvanceRow, 'kind' | 'amount' | 'givenOn' | 'unplanned'>): string {
  return `${ADVANCE_KIND_LABELS[a.kind] ?? a.kind} of ${formatEgp(a.amount)}, given ${formatDate(a.givenOn)} · ${formatEgp(a.unplanned)} left to plan`;
}

/** The person's open advances (or loans) the type recovers. */
export function advancesFor(advances: readonly AdvanceRow[], employeeId: string, kind: AdvanceKind | null): AdvanceRow[] {
  if (!kind) return [];
  return advances.filter((a) => a.employee.id === employeeId && a.kind === kind && a.status === 'open');
}

/** What the form sends to the API, or why it can't be sent. `entering`: a new one (the person and the kind too). */
export function adjustmentBody(fd: FormData, entering: boolean): { body: Record<string, unknown>; errors: string[] } {
  const text = (key: string) => String(fd.get(key) ?? '').trim();
  const errors: string[] = [];
  const body: Record<string, unknown> = {};
  const kind = entering ? text('kind') : text('currentKind');

  if (entering) {
    body.employeeId = text('employeeId');
    if (!body.employeeId) errors.push('Choose the employee.');
    if (kind !== 'addition' && kind !== 'deduction') errors.push('Choose addition or deduction.');
    body.kind = kind;
  }
  body.month = text('month');
  if (!isMonth(String(body.month))) errors.push('Choose the month.');
  const type = text('type');
  if (!type) errors.push('Choose the type.');
  body.type = type;
  if (asksTaxed(kind, type)) {
    const taxed = text('taxed');
    if (taxed !== 'yes' && taxed !== 'no') errors.push('Say whether this other addition is taxed.');
    else body.taxed = taxed === 'yes';
  }
  const amount = parseAmount(text('amount'));
  if (amount === null || Number.isNaN(amount) || amount <= 0) errors.push('Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.');
  else body.amount = amount;
  const reason = text('reason');
  if (!reason) errors.push('Say what it is for.');
  body.reason = reason;
  const advanceKind = linksAdvance(kind, type);
  if (advanceKind) {
    const advanceId = text('advanceId');
    if (!advanceId) errors.push(`Choose the ${ADVANCE_KIND_LABELS[advanceKind].toLowerCase()} it recovers.`);
    body.advanceId = advanceId || null;
  } else if (!entering) {
    body.advanceId = null;
  }
  return { body, errors };
}

/** The note on how they reach the pay (owner, 17 October 2026): the month's run adds them. */
export const RUN_NOTE =
  "Each is added to its month's payroll run when the run is made or refreshed: taxed additions into the gross, untaxed ones after tax, deductions after tax. Until runs take them (coming next), type them on the run as before.";
