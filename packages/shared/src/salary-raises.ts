// The Salary Raises report (owner, 16 October 2026: asked to track the salary raises through the employment period, the
// owner chose both a Salary History on each profile and a company-wide report). For a period of months: every signed
// pay change that took effect in it (an amendment raise, a raise's new contract, a renewal with new pay; never a first
// contract nor a renewal with the same pay), the totals (how many, how many people, the average and median raise, and
// what they cost a month and a year more), the same by department, and who is due for a salary review: current
// employees whose last raise, or their join date when they have had none, is at least "Salary review due after"
// months ago (Payroll Setup → Your Rules; 12 to start with). Built from the same pay events as the Salary History
// (payEvents, salarySummary), so the figures always agree with each person's. Pure code: the API sends it (GET
// /reports/salary-raises) and makes its workbook from it; the screens word it.

import { payDifference, type PayChange, type PayStage, type RaiseReason, type RaiseRequestStatus } from './raises.js';
import { isSignedStage, monthsBetween, salarySummary, type PayEvent } from './salary-history.js';

/** A salary review is due this many months after the last raise (or the join date), to start with; HR and Admin set 1 to 60. */
export const SALARY_REVIEW_MONTHS_DEFAULT = 12;
export const SALARY_REVIEW_MONTHS_MIN = 1;
export const SALARY_REVIEW_MONTHS_MAX = 60;

/** What a raise on the report is to the version before it: an amendment, a new contract within its term, a renewal after it. */
export type RaiseKind = Exclude<PayChange, 'hired'>;
export const RAISE_KIND_LABELS: Record<RaiseKind, string> = { amendment: 'Amendment', new_contract: 'New contract', renewal: 'Renewal with new pay' };

// ---------- the period ----------

/** The months reported on, YYYY-MM, both included. */
export interface ReportPeriod {
  from: string;
  to: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month as the report takes it: "2026-01". */
export const isReportMonth = (value: string) => MONTH.test(value);

/** The calendar year of a day (YYYY-MM-DD): the period the report starts with, January to December. */
export const calendarYear = (today: string): ReportPeriod => ({ from: `${today.slice(0, 4)}-01`, to: `${today.slice(0, 4)}-12` });

/**
 * The period asked for (?from=&to=, months): this calendar year when neither is sent; with one of them only, that
 * month's year from January, or to December.
 */
export function requestedPeriod(query: { from?: string; to?: string }, today: string): ReportPeriod {
  const year = calendarYear(today);
  return {
    from: query.from ?? (query.to ? `${query.to.slice(0, 4)}-01` : year.from),
    to: query.to ?? (query.from ? `${query.from.slice(0, 4)}-12` : year.to),
  };
}

/** Why a period can't be reported on, or null. */
export function periodProblem(p: ReportPeriod): string | null {
  if (!isReportMonth(p.from) || !isReportMonth(p.to)) return 'Choose the months as YYYY-MM, e.g. 2026-01.';
  if (p.from > p.to) return 'The period ends before it starts: choose a "to" month on or after the "from" month.';
  return null;
}

/** The period's first and last day, YYYY-MM-DD: 2026-01 to 2026-02 → 2026-01-01 to 2026-02-28. */
export function periodDays(p: ReportPeriod): { start: string; end: string } {
  const [y, m] = p.to.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${p.from}-01`, end: `${p.to}-${String(last).padStart(2, '0')}` };
}

/** Whether a day (YYYY-MM-DD) is in the period. */
export const inPeriod = (ymd: string, p: ReportPeriod) => ymd.slice(0, 7) >= p.from && ymd.slice(0, 7) <= p.to;

// ---------- what the report reads ----------

/** Where someone works: a team (with its department as `parent`) or a department. */
export interface ReportDepartment {
  id: string;
  nameEn: string;
  parent: { id: string; nameEn: string } | null;
}

export interface ReportPerson {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
}

/** An employment as the report reads it: its person and place now, and its pay events (payEvents over its versions). */
export interface ReportEmployment {
  employee: ReportPerson;
  employmentId: string;
  department: ReportDepartment | null;
  /** Its job title now. */
  jobTitle: string | null;
  joinDate: string;
  /** Null while current. */
  endDate: string | null;
  /** An ending waiting for the CEO or approved: no raise is entered while it is, so no review is due. */
  ending: boolean;
  events: readonly PayEvent[];
  /** The job title each signed version was signed in (copied onto it when signed), by contract id. */
  signedJobTitles: Readonly<Record<string, string | null>>;
  /** The employee's raise request open now (one at a time), if any. */
  openRequest: { id: string; status: RaiseRequestStatus } | null;
}

// ---------- the raises ----------

/** One raise on the report. Money a month, to the piastre. */
export interface SalaryRaiseRow {
  contractId: string;
  number: string;
  employee: ReportPerson;
  employmentId: string;
  department: ReportDepartment | null;
  /** The job title it was given in: the version before's, as signed; the employment's now when that has none. */
  jobTitle: string | null;
  /** The promotion that came with it, if any. */
  promotion: { jobTitle: string | null; grade: string | null } | null;
  effectiveDate: string;
  /** Signed, but it takes effect after today. */
  upcoming: boolean;
  kind: RaiseKind;
  reason: RaiseReason | null;
  payBasis: string;
  gross: { from: number; to: number };
  allowances: { from: number; to: number };
  /** The gross's change and its percent (to one decimal), as the Salary History shows it. */
  change: { amount: number; percent: number | null };
  /** What it costs a month more: the change of the gross and the allowances together. */
  monthlyCost: number;
  approvedBy: string | null;
  approvedAt: string | null;
  signedOn: string | null;
}

/**
 * Whether a pay event is a raise the report counts: a change of pay the CEO approved (a raise, or a renewal with new
 * pay: the Salary History's `raise`), and signed (since replaced or ended too), as only a signed version is paid.
 */
export const isCountedRaise = (e: PayEvent) => e.raise && e.from !== null && e.change !== 'hired' && isSignedStage(e.stage);

const toCents = (n: number) => Math.round(n * 100);
const fromCents = (n: number) => n / 100;
/** A sum to the piastre, added in piastres so it never drifts. */
const sumMoney = (values: readonly number[]) => fromCents(values.reduce((s, v) => s + toCents(v), 0));
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * The raises that take effect in the period, oldest first (then by employee code): a signed raise still to come within
 * the period is listed too, marked `upcoming`, as it is decided and its cost falls in the period.
 */
export function periodRaises(employments: readonly ReportEmployment[], period: ReportPeriod, today: string): SalaryRaiseRow[] {
  const rows = employments.flatMap((emp) =>
    emp.events
      .filter((e) => isCountedRaise(e) && inPeriod(e.effectiveDate, period))
      .map((e): SalaryRaiseRow => {
        const before = emp.events.find((p) => p.version === e.version - 1);
        const from = e.from!;
        return {
          contractId: e.contractId,
          number: e.number,
          employee: emp.employee,
          employmentId: emp.employmentId,
          department: emp.department,
          jobTitle: (before && emp.signedJobTitles[before.contractId]) || emp.jobTitle,
          promotion: e.promotion,
          effectiveDate: e.effectiveDate,
          upcoming: e.effectiveDate > today,
          kind: e.change as RaiseKind,
          reason: e.reason,
          payBasis: e.payBasis,
          gross: { from: from.gross, to: e.to.gross },
          allowances: { from: from.allowances, to: e.to.allowances },
          change: e.difference ?? payDifference(from.gross, e.to.gross),
          monthlyCost: fromCents(toCents(e.to.total) - toCents(from.total)),
          approvedBy: e.approvedBy,
          approvedAt: e.approvedAt,
          signedOn: e.signedOn,
        };
      }),
  );
  return rows.sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.employee.employeeCode.localeCompare(b.employee.employeeCode) || a.number.localeCompare(b.number),
  );
}

// ---------- the totals ----------

/** The mean, to one decimal; null with nothing to average. */
export function averageOf(values: readonly number[]): number | null {
  return values.length ? oneDecimal(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

/** The middle value (the mean of the two middle ones for an even count), to one decimal; null with none. */
export function medianOf(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return oneDecimal(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

export interface RaiseTotals {
  count: number;
  /** The people who got them (someone with two raises counts once). */
  people: number;
  /** Of the raises' percents (a raise from a gross of 0 has none). */
  averagePercent: number | null;
  medianPercent: number | null;
  /** What they cost a month more: the change of the gross and the allowances, all raises together. */
  monthlyCostIncrease: number;
  /** The same over a year: × 12. */
  yearlyCostIncrease: number;
}

export function raiseTotals(rows: readonly SalaryRaiseRow[]): RaiseTotals {
  const percents = rows.map((r) => r.change.percent).filter((p): p is number => p !== null);
  const monthly = sumMoney(rows.map((r) => r.monthlyCost));
  return {
    count: rows.length,
    people: new Set(rows.map((r) => r.employee.id)).size,
    averagePercent: averageOf(percents),
    medianPercent: medianOf(percents),
    monthlyCostIncrease: monthly,
    yearlyCostIncrease: fromCents(toCents(monthly) * 12),
  };
}

/** A department's raises: the totals of the raises of the people in it and its teams. */
export interface DepartmentRaises extends RaiseTotals {
  /** The department (a team's own department); null for people not placed. */
  department: { id: string; nameEn: string } | null;
}

/** The department a place is in: a team's department, or the department itself. */
export const departmentOf = (d: ReportDepartment | null) => (d ? (d.parent ?? { id: d.id, nameEn: d.nameEn }) : null);

/** The raises by department (a team's under its department), by name, people not placed last. */
export function raisesByDepartment(rows: readonly SalaryRaiseRow[]): DepartmentRaises[] {
  const groups = new Map<string, { department: DepartmentRaises['department']; rows: SalaryRaiseRow[] }>();
  for (const r of rows) {
    const department = departmentOf(r.department);
    const key = department?.id ?? '';
    const group = groups.get(key) ?? { department, rows: [] };
    group.rows.push(r);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ department: g.department, ...raiseTotals(g.rows) }))
    .sort((a, b) => (a.department === null ? 1 : b.department === null ? -1 : a.department.nameEn.localeCompare(b.department.nameEn)));
}

// ---------- due for review ----------

export interface DueForReviewRow {
  employee: ReportPerson;
  employmentId: string;
  department: ReportDepartment | null;
  jobTitle: string | null;
  joinDate: string;
  /** The gross in force today. */
  currentGross: number;
  /** The last raise in force (its effective date); null when they have had none since joining. */
  lastRaise: string | null;
  /** Whole months since the last raise, or since joining. */
  monthsSince: number;
  /** A raise or renewal with new pay not signed yet: HR's draft (or returned), with the CEO, or approved to sign. */
  openRaise: { contractId: string; number: string; stage: PayStage; effectiveDate: string } | null;
  openRequest: { id: string; status: RaiseRequestStatus } | null;
}

/**
 * Who is due for a salary review on `today`: current employees with a signed contract whose last raise in force (the
 * Salary History's), or their join date when they have had none, is at least `months` months ago. Not someone with a
 * signed raise still to come (it is decided), nor someone whose employment is ending. Longest waiting first, then by
 * employee code. Each says whether a raise or a raise request is open for them now.
 */
export function dueForReview(employments: readonly ReportEmployment[], today: string, months: number): DueForReviewRow[] {
  const rows = employments
    .filter((emp) => emp.endDate === null && !emp.ending)
    .flatMap((emp): DueForReviewRow[] => {
      const summary = salarySummary(emp.events, today);
      if (!summary || summary.next) return [];
      const lastRaise = summary.lastRaise?.date ?? null;
      const monthsSince = monthsBetween(lastRaise ?? emp.joinDate, today);
      if (monthsSince < months) return [];
      const open = emp.events.find((e) => e.raise && !isSignedStage(e.stage)) ?? null;
      return [
        {
          employee: emp.employee,
          employmentId: emp.employmentId,
          department: emp.department,
          jobTitle: emp.jobTitle,
          joinDate: emp.joinDate,
          currentGross: summary.currentGross,
          lastRaise,
          monthsSince,
          openRaise: open && { contractId: open.contractId, number: open.number, stage: open.stage, effectiveDate: open.effectiveDate },
          openRequest: emp.openRequest,
        },
      ];
    });
  return rows.sort((a, b) => b.monthsSince - a.monthsSince || a.employee.employeeCode.localeCompare(b.employee.employeeCode));
}

// ---------- the report ----------

/** GET /reports/salary-raises (HR, Finance and the CEO), less the moment it was made. */
export interface SalaryRaisesReport {
  period: ReportPeriod;
  /** Salary review due after this many months (the setting). */
  reviewMonths: number;
  raises: SalaryRaiseRow[];
  totals: RaiseTotals;
  byDepartment: DepartmentRaises[];
  dueForReview: DueForReviewRow[];
}

/** The report for a period on `today`, with a review due after `reviewMonths` months. */
export function salaryRaisesReport(employments: readonly ReportEmployment[], period: ReportPeriod, today: string, reviewMonths: number): SalaryRaisesReport {
  const raises = periodRaises(employments, period, today);
  return {
    period,
    reviewMonths,
    raises,
    totals: raiseTotals(raises),
    byDepartment: raisesByDepartment(raises),
    dueForReview: dueForReview(employments, today, reviewMonths),
  };
}
