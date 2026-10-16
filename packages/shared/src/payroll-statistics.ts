import type { PayrollStatus } from './payroll.js';
import type { ReportPeriod } from './salary-raises.js';

// Payroll statistics (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Overview -
// Unsettled - Additions / Deductions - Reports (Statistics)"): what the payroll paid and cost, from the runs the CEO
// approved (approved or paid; a draft or a run with the CEO may still change), for a period of months: each month's
// headcount, gross (earned and allowances), net, transfer, salary tax, the employee's and the company's social
// insurance, the Martyrs' Fund and the company cost; the same by department and team; the average and median gross; and
// this year to date. Figures to the piaster, summed in piasters. A line on hold counts: its pay is owed and costs the
// company all the same; how many were held is said beside the headcount.

/** A payroll line as the statistics read it: its totals, and the department it was in (a team as "Department › Team"). */
export interface StatisticsLine {
  employeeId: string;
  department: string | null;
  onHold: boolean;
  earned: number;
  allowances: number;
  net: number;
  transfer: number;
  monthlyTax: number;
  employeeInsurance: number;
  employerInsurance: number;
  martyrsFund: number;
  companyCost: number;
}

export interface StatisticsRun {
  id: string;
  /** YYYY-MM. */
  month: string;
  status: PayrollStatus;
  lines: StatisticsLine[];
}

/** The money a set of lines comes to. */
export interface PayrollFigures {
  /** Earned and allowances: the pay before deductions. */
  gross: number;
  net: number;
  transfer: number;
  salaryTax: number;
  employeeInsurance: number;
  companyInsurance: number;
  martyrsFund: number;
  companyCost: number;
}

export const PAYROLL_FIGURE_KEYS = [
  'gross',
  'net',
  'transfer',
  'salaryTax',
  'employeeInsurance',
  'companyInsurance',
  'martyrsFund',
  'companyCost',
] as const satisfies readonly (keyof PayrollFigures)[];

export const PAYROLL_FIGURE_LABELS: Record<keyof PayrollFigures, string> = {
  gross: 'Gross',
  net: 'Net',
  transfer: 'Transfer',
  salaryTax: 'Salary tax',
  employeeInsurance: 'Employee insurance',
  companyInsurance: 'Company insurance',
  martyrsFund: "Martyrs' Fund",
  companyCost: 'Company cost',
};

/** A month with an approved or paid run. */
export interface MonthStatistics extends PayrollFigures {
  month: string;
  runId: string;
  status: PayrollStatus;
  /** The people on the run. */
  employees: number;
  /** Of them, held (not paid by the bank files that month). */
  held: number;
  averageGross: number | null;
  medianGross: number | null;
}

/** A department's or a team's figures over the period. */
export interface GroupStatistics extends PayrollFigures {
  name: string;
  /** Different people paid in the period. */
  employees: number;
  /** Lines: a person paid in three months counts three times. */
  personMonths: number;
  averageGross: number | null;
}

export interface DepartmentStatistics extends GroupStatistics {
  /** Its teams, each also counted in the department. */
  teams: GroupStatistics[];
}

export interface PeriodStatistics extends PayrollFigures {
  /** Months with an approved or paid run. */
  months: number;
  employees: number;
  personMonths: number;
  /** Of every line's gross in the period. */
  averageGross: number | null;
  medianGross: number | null;
}

export interface YearToDate extends PeriodStatistics {
  year: number;
  /** January of the year to the current month, YYYY-MM. */
  from: string;
  to: string;
}

/** A month of the period, up to the current one, with no approved run: none made yet, or one still being prepared. */
export interface MonthWithout {
  month: string;
  status: PayrollStatus | null;
}

export interface PayrollStatistics {
  period: ReportPeriod;
  months: MonthStatistics[];
  without: MonthWithout[];
  totals: PeriodStatistics;
  byDepartment: DepartmentStatistics[];
  yearToDate: YearToDate;
}

/** The name the statistics give people with no department on their line. */
export const NO_DEPARTMENT = 'No department';

/** The runs the statistics count: those the CEO approved. */
export const isCountedRun = (status: PayrollStatus | string) => status === 'approved' || status === 'paid';

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100 + 0;

/** A line's gross: what it earned and its allowances. */
export const lineGross = (l: Pick<StatisticsLine, 'earned' | 'allowances'>) => money(cents(l.earned) + cents(l.allowances));

/** Lines' money, summed in piasters. */
export function figuresOf(lines: readonly StatisticsLine[]): PayrollFigures {
  const sum = (pick: (l: StatisticsLine) => number) => money(lines.reduce((s, l) => s + cents(pick(l)), 0));
  return {
    gross: sum(lineGross),
    net: sum((l) => l.net),
    transfer: sum((l) => l.transfer),
    salaryTax: sum((l) => l.monthlyTax),
    employeeInsurance: sum((l) => l.employeeInsurance),
    companyInsurance: sum((l) => l.employerInsurance),
    martyrsFund: sum((l) => l.martyrsFund),
    companyCost: sum((l) => l.companyCost),
  };
}

/** The mean, to the piaster; null with none. */
export function averageMoney(values: readonly number[]): number | null {
  return values.length ? money(Math.round(values.reduce((s, v) => s + cents(v), 0) / values.length)) : null;
}

/** The middle value (the mean of the two middle ones for an even count), to the piaster; null with none. */
export function medianMoney(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = values.map(cents).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return money(sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2));
}

/** The months from `from` to `to` (YYYY-MM), oldest first. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

function periodOf(runs: readonly StatisticsRun[]): PeriodStatistics {
  const lines = runs.flatMap((r) => r.lines);
  const gross = lines.map(lineGross);
  return {
    ...figuresOf(lines),
    months: runs.length,
    employees: new Set(lines.map((l) => l.employeeId)).size,
    personMonths: lines.length,
    averageGross: averageMoney(gross),
    medianGross: medianMoney(gross),
  };
}

function groupOf(name: string, lines: readonly StatisticsLine[]): GroupStatistics {
  return {
    name,
    ...figuresOf(lines),
    employees: new Set(lines.map((l) => l.employeeId)).size,
    personMonths: lines.length,
    averageGross: averageMoney(lines.map(lineGross)),
  };
}

/** A line's department and team, from "Department › Team" as the line keeps it. */
export function departmentParts(department: string | null): { department: string; team: string | null } {
  if (!department?.trim()) return { department: NO_DEPARTMENT, team: null };
  const [top, ...rest] = department.split(' › ');
  return { department: top.trim(), team: rest.length ? rest.join(' › ').trim() : null };
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name === NO_DEPARTMENT ? 1 : b.name === NO_DEPARTMENT ? -1 : a.name.localeCompare(b.name);

/** The period's lines by department (each with its teams), by name, those with no department last. */
export function statisticsByDepartment(lines: readonly StatisticsLine[]): DepartmentStatistics[] {
  type Group = { lines: StatisticsLine[]; teams: Map<string, StatisticsLine[]> };
  const departments = new Map<string, Group>();
  for (const l of lines) {
    const { department, team } = departmentParts(l.department);
    const d: Group = departments.get(department) ?? { lines: [], teams: new Map() };
    d.lines.push(l);
    if (team) d.teams.set(team, [...(d.teams.get(team) ?? []), l]);
    departments.set(department, d);
  }
  return [...departments.entries()]
    .map(([name, d]) => ({ ...groupOf(name, d.lines), teams: [...d.teams.entries()].map(([team, ls]) => groupOf(team, ls)).sort(byName) }))
    .sort(byName);
}

/**
 * The statistics of a period on `today` (YYYY-MM-DD, Cairo), from the runs given (those of the period and of this year,
 * any status): the months with an approved or paid run, oldest first; the months up to now without one; the period's
 * totals, by department and team; and this year to date, January to this month.
 */
export function payrollStatistics(runs: readonly StatisticsRun[], period: ReportPeriod, today: string): PayrollStatistics {
  const current = today.slice(0, 7);
  const byMonth = new Map(runs.map((r) => [r.month, r]));
  const inPeriod = (m: string) => m >= period.from && m <= period.to;
  const counted = runs.filter((r) => isCountedRun(r.status) && inPeriod(r.month)).sort((a, b) => a.month.localeCompare(b.month));

  const months: MonthStatistics[] = counted.map((r) => {
    const gross = r.lines.map(lineGross);
    return {
      month: r.month,
      runId: r.id,
      status: r.status,
      ...figuresOf(r.lines),
      employees: r.lines.length,
      held: r.lines.filter((l) => l.onHold).length,
      averageGross: averageMoney(gross),
      medianGross: medianMoney(gross),
    };
  });
  const without = monthRange(period.from, period.to <= current ? period.to : current)
    .filter((m) => !isCountedRun(byMonth.get(m)?.status ?? 'none'))
    .map((m) => ({ month: m, status: byMonth.get(m)?.status ?? null }));

  const year = Number(current.slice(0, 4));
  const ytdFrom = `${year}-01`;
  const ytdRuns = runs.filter((r) => isCountedRun(r.status) && r.month >= ytdFrom && r.month <= current);
  return {
    period,
    months,
    without,
    totals: periodOf(counted),
    byDepartment: statisticsByDepartment(counted.flatMap((r) => r.lines)),
    yearToDate: { year, from: ytdFrom, to: current, ...periodOf(ytdRuns) },
  };
}
