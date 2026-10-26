import {
  accountShareText,
  accountsAllowanceLabel,
  adjustmentTypeLabel,
  BEFORE_TAX_LABEL,
  daysText,
  EMPTY_PAYROLL_INPUTS,
  formatHours,
  isBeforeTax,
  KPI_PAY_TIMING_NOTE,
  KPI_PERFORMANCE_ONLY_NOTE,
  kpiAveragesAttendance,
  kpiMonthForPayroll,
  kpiMonthName,
  kpiPayText,
  kpiPercentText,
  kpiPerformanceOnly,
  lawRatesFor,
  leaveDaysOf,
  leaveDaysOff,
  measuredExpectedHours,
  paidAdjustments,
  paysOvertime,
  resultAdjustments,
  resultBeforeTax,
  splitSegments,
  type LawRates,
  type PayrollAllowance,
  type PayrollInputs,
  type PayrollKpi,
  type PayrollPart,
  type PayrollResult,
  type PayrollRules,
  type PayrollSegment,
  type PayrollTerms,
} from '@trendlix/shared';
import { KPI_PATHS } from '../../../../lib/kpi-paths';
import type { PayrollLineView } from '../../../../lib/types';
import { formatEgp, formatPercent } from '../../employees/[id]/contracts/salary';
import { monthName } from '../list';
import { contractLabel, dayRange } from './grid';

// One employee's pay, step by step, as the run's results table opens it (owner's decisions, 16 October 2026): from the
// gross split into its fixed and variable parts, through the attendance and KPI cuts and what is added, to the pay
// earned, then the insurance, tax and other deductions, the net, what the bank transfers, and what the employee costs
// the company. Each step as payrollLine (@trendlix/shared) worked it out; nothing is worked out again here. With no KPI
// given the variable part isn't cut (owner's decisions, 16 October 2026). The KPIs a line has are listed with its KPI
// score, as the inputs grid doesn't show them (the KPIs module will fill them). The expected hours attendance was
// measured on say where they came from (owner, 17 October 2026: "prefill the expected hours, and dont count abcent days
// or leave days, as they already have their own deduction and fields"): as HR typed them, already without the no-show
// and leave days, or the shift's working days less the holidays (owner's request, 16 October 2026, Payroll Setup) less
// those days, at the shift's hours to work a day (owner, 16 October 2026: "my company shift is to maintain 9 hours
// within the shift window"); a line worked out before then says it as it was, the no-show days' hours taken out of
// the figure. Leave days are listed, nothing cut for them. A month split between two contracts (owner, 17 October 2026:
// "take into consideration the start and end date of the contract if it is in the middle of the billing period") lists
// them, and each part's fixed and variable pay and allowances for its days. Overtime says "not paid" while the run's
// rules don't pay it (owner, 16 October 2026: "No overtime for now"). The month's additions and deductions (owner, 17
// October 2026: Additions / Deductions) are rows of their own, each by its type with its reason: the taxed additions in
// the pay earned, the deductions after tax with the others, the untaxed additions after them, before the net. A Bonus
// (days) or a Penalty (days) (owner, 17 October 2026: the grid's bonus and penalty days, commission and settlements
// moved to Additions / Deductions) says its days with what the run worked it out to; a line saved before then has its
// Bonus, Commission, Settlements and Penalties rows as typed on the grid. An attendance deduction the CEO waived (owner,
// 17 October 2026: "allow the CEO to wave the deduction by ticking a box") says so on the attendance cut. The month's
// permission hours (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day") count as worked: where
// the hours explain the attendance, "Permission: 4:00" as the line counted them (PayrollResult.permissionHours), from
// the permission approved or as typed, and the hours worked with them. A Recurring deduction ticked before tax (owner,
// 20 October 2026, on the employee's medical share: "Before Tax i think") is a row before the taxable pay, "Before tax:
// lowers the taxable pay", and the taxable pay says what it was lowered by (less when the year's limit or the pay held
// it back). Make-up hours (owner, 20 October 2026: "within the same month with no working hours to be counted after 8 PM
// even if the check out was 11 PM"): a line on a shift that counts hours until a time counts at most the expected hours
// while overtime isn't paid, and Hours worked says what above them wasn't counted. The KPIs module (owner, 21 October
// 2026: "Last month's KPI, this pay", "As the sheet: full at 80%+"): a line made since takes the final % of last
// month's scorecard (PayrollTerms.kpi), and its KPI step says it, "KPI (September 2026): 86% · Needs improvement · paid
// in full (80%+)", with the scorecard's link and that last month's KPI counts in this month's pay; with no final
// scorecard, "no final scorecard · not cut". A line made before then keeps its KPI inputs, averaged with attendance,
// as it was worked out. Attendance out of the KPI (owner, 25 October 2026: "Fixed cut only"): a scorecard that is
// performance only says so, "The KPI is performance only: attendance is cut on the fixed part."; and the KPI inputs of
// a line whose run's rules don't average attendance in (kpiIncludesAttendance off) are averaged alone, said so. Pure
// code, tested; relative imports, as vitest doesn't know the @/ paths.

export interface BreakdownRow {
  key: string;
  label: string;
  value: string;
  /** How it reads: an amount added, taken off, a subtotal, or a figure that explains the next step. */
  kind: 'add' | 'cut' | 'total' | 'info';
  note?: string;
  /** A page that explains it further: the KPI's scorecard (21 October 2026). */
  link?: { href: string; label: string };
}

const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A fraction as a percent: 0.963 → "96.3%". */
export const percentText = (fraction: number) => `${percent.format(fraction * 100)}%`;

/** An amount taken off: "−EGP 1,200.00" (nothing taken off: "EGP 0.00"). */
export const cutText = (amount: number) => (amount === 0 ? formatEgp(0) : `−${formatEgp(Math.abs(amount))}`);

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** "a", "a and b", "a, b and c". */
const listed = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''));

type Line = Pick<PayrollLineView, 'payBasis' | 'terms' | 'inputs' | 'result'>;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The variable part of a gross, in percent: what its basic percent leaves. */
const variablePercent = (basicPercent: number) => Math.round((100 - basicPercent) * 100) / 100;

/** The allowances' names, for the note: none, nothing to say. */
const allowanceNames = (allowances: readonly PayrollAllowance[]) => allowances.map((a) => a.name).join(', ') || undefined;

/**
 * The accounts allowance (owner, 25 October 2026: an allowance per client account, "By days"), already in the
 * allowances above: "Accounts allowance (2 accounts)" with each account and what it came to, "Acme EGP 1,500.00 · Beta
 * EGP 232.26 (8 of 31 days)". Null on a line without one.
 */
export function accountsRow(t: Pick<PayrollTerms, 'allowances' | 'segments'>): BreakdownRow | null {
  const a = t.allowances.find((x) => x.accounts?.length) ?? t.segments?.at(-1)?.allowances.find((x) => x.accounts?.length);
  if (!a?.accounts) return null;
  return {
    key: 'accountsAllowance',
    label: accountsAllowanceLabel(a.name, a.accounts.length),
    value: formatEgp(a.amount),
    kind: 'info',
    note: a.accounts.map((s) => accountShareText(s, formatEgp(s.amount))).join(' · '),
  };
}

/**
 * Where a line's expected hours came from on a line worked out before 17 October 2026, and what came out of them: as
 * HR typed them, or the shift's working days in the days employed less the holidays, at its hours to work a day
 * (owner's request, 16 October 2026); less the no-show days' hours, which then came out of a figure HR typed too.
 * Nothing to say without either.
 */
export function expectedHoursNote(t: PayrollTerms, i: PayrollInputs, absent: number): string | undefined {
  const less = absent > 0 ? `less ${formatHours(absent)} for the no-show ${i.noShowDays === 1 ? 'day' : 'days'}` : null;
  if (i.expectedHours !== null) return less ? `${formatHours(i.expectedHours)} expected as typed, ${less}` : 'Expected hours as typed';
  if (t.expectedHours === null || t.expectedHours === undefined) return undefined;
  const d = t.expectedDays;
  const from =
    d && t.hoursPerDay
      ? `${plural(d.workingDays, 'working day')} of the shift${d.holidays ? ` less ${plural(d.holidays, 'holiday')}` : ''}, at its ${formatHours(t.hoursPerDay)} hours to work a day`
      : 'the shift';
  return `${formatHours(t.expectedHours)} expected from ${from}${less ? `; ${less}` : ''}`;
}

/**
 * How the shift's hours became a line's expected hours (owner, 17 October 2026: "prefill the expected hours, and dont
 * count abcent days or leave days, as they already have their own deduction and fields"): "Scheduled 168:00 (22
 * working days of the shift less 1 holiday), less 2 no-show days and 1 leave day, 8:00 a day"; without days off,
 * "Scheduled 168:00 (21 working days of the shift), at 8:00 a day". The days off come out only at a day of the shift's
 * hours each, so without its hours a day none are listed.
 */
export function shiftHoursNote(
  t: Pick<PayrollTerms, 'expectedHours' | 'expectedDays' | 'hoursPerDay'> & Partial<Pick<PayrollTerms, 'leave'>>,
  i: Pick<PayrollInputs, 'noShowDays' | 'leaveDays'> & Partial<Pick<PayrollInputs, 'unpaidLeaveDays'>>,
): string {
  const d = t.expectedDays;
  const from = d ? ` (${plural(d.workingDays, 'working day')} of the shift${d.holidays ? ` less ${plural(d.holidays, 'holiday')}` : ''})` : '';
  const scheduled = `Scheduled ${formatHours(t.expectedHours ?? 0)}${from}`;
  const perDay = typeof t.hoursPerDay === 'number' && t.hoursPerDay > 0 ? formatHours(t.hoursPerDay) : null;
  if (!perDay) return scheduled;
  // the leave days as the line took them out of the hours: HR's, else the month's approved leave's on the shift's working
  // days (owner, 18 October 2026; leaveDaysOff, 27 October 2026)
  const leave = leaveDaysOff({ leave: t.leave ?? null }, { leaveDays: i.leaveDays ?? null, unpaidLeaveDays: i.unpaidLeaveDays ?? null });
  const dayKinds: [number | null, string][] = [
    [i.noShowDays, 'no-show day'],
    [leave.leaveDays, 'leave day'],
    [leave.unpaidLeaveDays, 'unpaid leave day'],
  ];
  const off = dayKinds.filter((k): k is [number, string] => k[0] !== null && k[0] > 0).map(([n, name]) => plural(n, name));
  return off.length ? `${scheduled}, less ${listed(off)}, ${perDay} a day` : `${scheduled}, at ${perDay} a day`;
}

/** Where the expected hours a line was measured on came from: HR, the shift less the days off, or the old way. */
function expectedNote({ terms: t, inputs: i, result: r }: Line): string | undefined {
  // a line worked out before 17 October 2026 has no record of them: the no-show days' hours came out of HR's or the
  // shift's (none before 16 October 2026)
  if (r.expectedHours === undefined) return expectedHoursNote(t, i, r.absentHours > 0 ? r.absentHours : 0);
  if (i.expectedHours !== null) return 'As typed by HR: already without the no-show and leave days';
  return t.expectedHours === null || t.expectedHours === undefined ? undefined : shiftHoursNote(t, i);
}

/** A month's parts under each contract, with what each was paid: a contract and its days, its fixed, variable and allowances. */
type SplitPart = { segment: PayrollSegment; part: PayrollPart };

/**
 * A month split between two contracts or more (owner, 17 October 2026), each with its part as paid; null for a month
 * paid on one contract (or, with one by the hour, on the latest alone), and for lines worked out before then.
 */
function splitParts(t: PayrollTerms, r: PayrollResult): SplitPart[] | null {
  const segments = splitSegments(t);
  // missing on lines worked out before 17 October 2026
  const parts: PayrollPart[] | undefined = r.parts;
  if (!segments || !Array.isArray(parts) || parts.length !== segments.length) return null;
  return segments.map((segment, n) => ({ segment, part: parts[n] }));
}

/**
 * The gross's fixed and variable parts: one row each; for a month split between contracts, the contracts first, then a
 * row each per contract, for its days on its own gross.
 */
function grossSteps({ terms: t, result: r }: Line, rules: PayrollRules, split: SplitPart[] | null): BreakdownRow[] {
  if (!split) {
    const part = t.paidDays < rules.dayDivisor ? `, for ${t.paidDays} of ${rules.dayDivisor} days` : '';
    return [
      { key: 'fixed', label: 'Fixed', value: formatEgp(r.fixed), kind: 'add', note: `${t.basicPercent}% of the gross${part}` },
      { key: 'variable', label: 'Variable', value: formatEgp(r.variable), kind: 'add', note: `${variablePercent(t.basicPercent)}% of the gross${part}` },
    ];
  }
  const of = (s: PayrollSegment, p: number) => `${p}% of the ${formatEgp(s.gross)} gross, for ${s.days} of ${rules.dayDivisor} days`;
  return [
    {
      key: 'contracts',
      label: 'Contracts',
      value: `${split.length} this month`,
      kind: 'info',
      note: split.map(({ segment: s }) => `${contractLabel(s)}, ${dayRange(s.from, s.to)}: ${days(s.days)}`).join(' · '),
    },
    ...split.map(({ segment: s, part: p }, n): BreakdownRow => ({
      key: `fixed-${n + 1}`,
      label: `Fixed · ${dayRange(s.from, s.to)}`,
      value: formatEgp(p.fixed),
      kind: 'add',
      note: of(s, s.basicPercent),
    })),
    ...split.map(({ segment: s, part: p }, n): BreakdownRow => ({
      key: `variable-${n + 1}`,
      label: `Variable · ${dayRange(s.from, s.to)}`,
      value: formatEgp(p.variable),
      kind: 'add',
      note: of(s, variablePercent(s.basicPercent)),
    })),
  ];
}

/**
 * The KPI step of a line made since the KPIs module (`terms.kpi` set; owner, 21 October 2026: "Last month's KPI, this
 * pay"): the final % of the scorecard of the month before the run's (`month`, YYYY-MM), what it does to the variable
 * part, and the scorecard's link; with no final scorecard, not cut.
 */
export function kpiStep(kpi: PayrollKpi | null, rules: Pick<PayrollRules, 'kpiGracePercent'>, month?: string | null): BreakdownRow {
  // the month before the run's: the scorecard's own month too
  const scored = month ? kpiMonthForPayroll(month) : (kpi?.month ?? null);
  const text = scored ? kpiPayText(scored, kpi, rules.kpiGracePercent) : 'KPI: no final scorecard · not cut';
  return {
    key: 'kpi',
    label: 'KPI score',
    value: kpi ? kpiPercentText(kpi.finalPercent) : 'None',
    kind: 'info',
    // a scorecard that is performance only (25 October 2026: "Fixed cut only") says so
    note: `${text}. ${KPI_PAY_TIMING_NOTE}${kpiPerformanceOnly(kpi) ? ` ${KPI_PERFORMANCE_ONLY_NOTE}` : ''}`,
    ...(kpi && { link: { href: KPI_PATHS.scorecard(kpi.scorecardId), label: `Open the ${kpiMonthName(kpi.month)} scorecard` } }),
  };
}

/** The steps of a line on monthly pay: the gross's parts, the hours, the cuts and what is added. */
function monthlySteps(line: Line, rules: PayrollRules, split: SplitPart[] | null, month?: string | null): BreakdownRow[] {
  const { inputs: i, result: r } = line;
  // the attendance deduction the CEO waived (17 October 2026): none on a line worked out before then
  const waived = typeof r.attendanceWaived === 'number' && r.attendanceWaived > 0 ? r.attendanceWaived : 0;
  const typed = i.workedHours !== null || i.expectedHours !== null;
  // the expected hours attendance was measured on: as recorded since 17 October 2026, else as they were worked out
  const expected = measuredExpectedHours(line);
  const hours: BreakdownRow[] = [];
  if (expected !== null) hours.push({ key: 'expected', label: 'Expected hours', value: formatHours(expected), kind: 'info', note: expectedNote(line) });
  // the permission hours counted as worked (owner, 19 October 2026): as the line counted them, only once hours are worked
  const permission = typeof r.permissionHours === 'number' && r.permissionHours > 0 ? r.permissionHours : 0;
  // make-up hours (owner, 20 October 2026): what above the expected hours wasn't counted, while overtime isn't paid
  const over = typeof r.hoursOverExpected === 'number' && r.hoursOverExpected > 0 ? r.hoursOverExpected : 0;
  if (i.workedHours !== null) {
    const notes = [
      permission > 0 ? `${formatHours(i.workedHours + permission)} with the permission hours, as attendance counts them` : null,
      over > 0 ? `${formatHours(over)} above the expected hours not counted: extra time fills short hours, never overtime` : null,
    ].filter((n): n is string => n !== null);
    hours.push({
      key: 'hours',
      label: 'Hours worked',
      value: expected !== null ? `${formatHours(i.workedHours)} of ${formatHours(expected)}` : formatHours(i.workedHours),
      kind: 'info',
      ...(notes.length > 0 && { note: notes.join('; ') }),
    });
  }
  if (permission > 0) {
    const typedPermission = i.permissionHours !== null && i.permissionHours !== undefined;
    hours.push({
      key: 'permission',
      label: 'Permission',
      value: formatHours(permission),
      kind: 'info',
      note: `Counted as worked${typedPermission ? ', as typed by HR' : ', from the permission approved this month'}`,
    });
  }
  // paid leave (owner, 17 October 2026): nothing cut, its hours out of the shift's; unpaid leave (18 October 2026): a
  // day's pay cut for each; as HR typed them, else the month's approved leave (leaveDaysOf)
  const leaveDays = leaveDaysOf(line.terms, i);
  const leave = leaveDays.leaveDays ?? 0;
  const unpaid = leaveDays.unpaidLeaveDays ?? 0;
  const unpaidCut = r.unpaidLeaveCut ?? 0;
  const fromLeave = (typed: number | null | undefined) => (typed === null || typed === undefined ? ', from the leave approved this month' : ', as typed by HR');
  const typedKpis: [string, number | null][] = [
    ['soft skills', i.softSkills],
    ['performance', i.performance],
    ['client satisfaction', i.clientSatisfaction],
  ];
  const kpis = typedKpis.filter((k): k is [string, number] => k[1] !== null).map(([name, v]) => `${name} ${percent.format(v)}%`);
  return [
    ...grossSteps(line, rules, split),
    ...hours,
    {
      key: 'attendance',
      label: 'Attendance',
      // hours typed but not counted: the line's warnings say why
      value: r.attendanceRatio !== null ? percentText(r.attendanceRatio) : typed ? 'Not counted' : 'Not tracked',
      kind: 'info',
      note:
        r.attendanceRatio === null
          ? typed
            ? 'See the warnings: counts in full'
            : 'No hours typed: counts in full'
          : r.attendanceScore >= 1
            ? `At or above ${rules.attendanceGracePercent}%: counts in full`
            : waived > 0
              ? `Below ${rules.attendanceGracePercent}%: its deduction waived by the CEO`
              : `Below ${rules.attendanceGracePercent}%: the fixed part follows it`,
    },
    {
      key: 'attendanceCut',
      label: 'Attendance cut',
      value: cutText(r.attendanceCut),
      kind: 'cut',
      ...(waived > 0 && { note: `Attendance deduction of ${formatEgp(waived)} waived by the CEO` }),
    },
    // last month's final scorecard on a line made since the KPIs module (21 October 2026); before it, the KPIs given
    line.terms.kpi !== undefined
      ? kpiStep(line.terms.kpi, rules, month)
      : {
          key: 'kpi',
          label: 'KPI score',
          value: percentText(r.kpiScore),
          kind: 'info',
          // the attendance in the average only while the run's rules take it in (25 October 2026: "Fixed cut only")
          note: kpis.length
            ? kpiAveragesAttendance(rules)
              ? `The average of ${listed([...kpis, `attendance ${percentText(r.attendanceScore)}`])}; at or above ${rules.kpiGracePercent}% counts in full`
              : `The average of ${listed(kpis)}; at or above ${rules.kpiGracePercent}% counts in full. ${KPI_PERFORMANCE_ONLY_NOTE}`
            : // a line worked out before 16 October 2026 took the attendance alone
              r.kpiScore < 1
              ? 'No KPIs given: the attendance alone'
              : "No KPIs given: the variable part isn't cut",
        },
    { key: 'kpiCut', label: 'KPI cut', value: cutText(r.kpiCut), kind: 'cut' },
    {
      key: 'noShowCut',
      label: 'No-show cut',
      value: cutText(r.noShowCut),
      kind: 'cut',
      note: i.noShowDays ? `${days(i.noShowDays)}, each costing ${rules.noShowDayMultiplier} days' pay` : undefined,
    },
    ...(leave > 0
      ? [{ key: 'leave', label: 'Leave days', value: days(leave), kind: 'info' as const, note: `Paid leave: nothing cut, and not counted in attendance${fromLeave(i.leaveDays)}` }]
      : []),
    ...(unpaid > 0 || unpaidCut > 0
      ? [
          {
            key: 'unpaidLeaveCut',
            label: 'Unpaid leave cut',
            value: cutText(unpaidCut),
            kind: 'cut' as const,
            note: `${days(unpaid)} of unpaid leave, each a day's pay (the gross ÷ ${rules.dayDivisor})${fromLeave(i.unpaidLeaveDays)}`,
          },
        ]
      : []),
    {
      key: 'overtime',
      label: 'Overtime',
      value: formatEgp(r.overtime),
      kind: 'add',
      note: paysOvertime(rules) ? `For attendance above ${rules.overtimeAbovePercent}%, at ${rules.overtimeRate}×` : 'Overtime: not paid',
    },
  ];
}

/** The steps of a line paid by the hour: the hours at the rate (no split, no attendance or KPI cuts). */
function hourlySteps({ terms: t, inputs: i, result: r }: Line): BreakdownRow[] {
  const forHours = Math.round((r.earned - r.bonus - (r.commission ?? 0) - (r.settlements ?? 0) - resultAdjustments(r).taxed) * 100) / 100;
  const rate = t.hourlyRate === null ? null : formatEgp(t.hourlyRate);
  return [
    {
      key: 'hours',
      label: 'Pay for the hours',
      value: formatEgp(forHours),
      kind: 'add',
      note: i.workedHours === null ? 'No hours typed' : `${formatHours(i.workedHours)} hours${rate ? ` at ${rate} an hour` : ''}`,
    },
  ];
}

/**
 * The line's additions or deductions of a kind (owner, 17 October 2026), each a row by its type with its reason, as the
 * line paid them: a Bonus (days) or a Penalty (days) with its days and what the run worked it out to. Additions taxed
 * or not (`taxed`, null: both); deductions before tax or after (`taxed` true: those before tax, 20 October 2026; false:
 * those after; null: both).
 */
function adjustmentRows(line: Line, kind: 'addition' | 'deduction', taxed: boolean | null): BreakdownRow[] {
  return paidAdjustments(line)
    .filter((a) => a.kind === kind && (taxed === null || (kind === 'deduction' ? isBeforeTax(a) : a.taxed) === taxed))
    .map((a) => {
      const inDays = a.days ? `${daysText(a.days)} of ${kind === 'addition' ? 'the fixed part' : "the contract's net"}` : null;
      const tax = kind === 'deduction' ? (isBeforeTax(a) ? `${BEFORE_TAX_LABEL.toLowerCase()}: lowers the taxable pay` : 'after tax') : a.taxed ? 'taxed' : 'not taxed, added after tax';
      return {
        key: `adjustment-${a.id}`,
        label: adjustmentTypeLabel(a.kind, a.type),
        value: kind === 'deduction' ? cutText(a.amount) : formatEgp(a.amount),
        kind: kind === 'deduction' ? ('cut' as const) : ('add' as const),
        note: [inDays, a.reason, tax].filter(Boolean).join(' · '),
      };
    });
}

/**
 * What a line saved before 17 October 2026 had typed on the grid: its bonus, commission, settlements and penalty
 * rows, as they were (the bonus and the penalty cut less what any Bonus (days) and Penalty (days) came to); none on a
 * line since, whose are rows of their own by type.
 */
function gridRows(line: Line): { additions: BreakdownRow[]; penalties: BreakdownRow[] } {
  const { inputs: i, result: r } = line;
  if (r.commission === undefined && r.settlements === undefined) return { additions: [], penalties: [] };
  const paid = paidAdjustments(line);
  const ofType = (type: string) => paid.filter((a) => a.type === type).reduce((c, a) => c + Math.round(a.amount * 100), 0);
  const bonus = (Math.round(r.bonus * 100) - ofType('bonus_days')) / 100;
  const penalty = (Math.round(r.penaltyCut * 100) - ofType('penalty_days')) / 100;
  const settlements = r.settlements ?? 0;
  return {
    additions: [
      { key: 'bonus', label: 'Bonus', value: formatEgp(bonus), kind: 'add', note: i.bonusDays ? days(i.bonusDays) : undefined },
      { key: 'commission', label: 'Commission', value: formatEgp(r.commission ?? 0), kind: 'add' },
      { key: 'settlements', label: 'Settlements', value: settlements < 0 ? cutText(settlements) : formatEgp(settlements), kind: settlements < 0 ? 'cut' : 'add' },
    ],
    penalties: [{ key: 'penalties', label: 'Penalties', value: cutText(penalty), kind: 'cut', note: i.penaltyDays ? `${days(i.penaltyDays)} of the contract's net` : undefined }],
  };
}

/**
 * What the CEO may waive on a line while the run is with the CEO (owner, 17 October 2026: "if there is an attendance
 * deduction, allow the CEO to wave the deduction by ticking a box"): its attendance cut, or the one waived already
 * (to take the waiver back); null when there is none, as for pay by the hour.
 */
export function waiverOf(line: Pick<Line, 'inputs' | 'result'>): { amount: number; waived: boolean } | null {
  const waived = line.inputs.attendanceWaived === true;
  const amount = waived ? (line.result.attendanceWaived ?? 0) : line.result.attendanceCut;
  if (!(amount > 0) && !waived) return null;
  return { amount, waived };
}

/** A line whose attendance deduction the CEO waived: "Waived by the CEO" on it for HR and Finance. */
export const waivedByCeo = (line: Pick<Line, 'inputs' | 'result'>) => line.inputs.attendanceWaived === true && (line.result.attendanceWaived ?? 0) > 0;

/**
 * The taxable pay's note: a year's net income for tax, and on a line with deductions before tax (owner, 20 October
 * 2026: "Before Tax i think") what they lowered it by: "After EGP 350.00 deducted before tax; a year's net income for
 * tax: …", saying when the year's limit or the pay held some of them back.
 */
export function taxableNote(r: Pick<PayrollResult, 'annualNetIncome' | 'beforeTaxDeductions' | 'taxableLowered'>): string {
  const year = `year's net income for tax: ${formatEgp(r.annualNetIncome)}`;
  const before = resultBeforeTax(r);
  if (!(before.deductions > 0)) return `A ${year}`;
  const held = Math.round(before.lowered * 100) < Math.round(before.deductions * 100);
  const lowered = held
    ? `After ${formatEgp(before.lowered)} of the ${formatEgp(before.deductions)} deducted before tax (the before-tax limit, or the pay, holds back the rest)`
    : `After ${formatEgp(before.lowered)} deducted before tax`;
  return `${lowered}; a ${year}`;
}

/**
 * Every step of a line, in order, as its row in the results table opens it. `month`: the run's (YYYY-MM), whose month
 * before is the KPI's (21 October 2026).
 */
export function breakdown(given: Line, rules: PayrollRules, law?: LawRates, month?: string | null): BreakdownRow[] {
  // inputs saved before a field existed (the leave days, 17 October 2026) read as not given
  const line: Line = { ...given, inputs: { ...EMPTY_PAYROLL_INPUTS, ...given.inputs } };
  const { terms: t, result: r } = line;
  const typed = gridRows(line);
  // the employee's share as the run's copy of the rates set by law has it (owner's request, 16 October 2026); a run from
  // an API before them: the built-in rates of its year
  const share = (law ?? lawRatesFor(t.year)).employeeInsuranceRate;
  // whether the person is registered with social insurance is hidden from a developer (owner, 22 October 2026: "and the
  // social insurance"): null
  const insuranceNote = !t.statutory
    ? 'Freelance: no social insurance, tax or Martyrs’ fund'
    : (t.insured as boolean | null) === null
      ? 'Whether registered with social insurance is hidden'
      : !t.insured
      ? 'Not registered with social insurance: nothing deducted'
      : // counted as insured though not registered yet, while Payroll Setup insures everyone (owner, 26 October 2026)
        `${formatPercent(share)} of the insured wage${t.notRegistered === true ? ' · not registered yet: counted as insured (Payroll Setup)' : ''}`;
  // a month split between contracts: each one's part (owner, 17 October 2026); never by the hour
  const split = line.payBasis === 'hourly' ? null : splitParts(t, r);
  const allowances: BreakdownRow[] = split
    ? split.map(({ segment: s, part: p }, n): BreakdownRow => ({
        key: `allowances-${n + 1}`,
        label: `Allowances · ${dayRange(s.from, s.to)}`,
        value: formatEgp(p.allowances),
        kind: 'add',
        note: allowanceNames(s.allowances),
      }))
    : [{ key: 'allowances', label: 'Allowances', value: formatEgp(r.allowances), kind: 'add', note: allowanceNames(t.allowances) }];
  return [
    ...(line.payBasis === 'hourly' ? hourlySteps(line) : monthlySteps(line, rules, split, month)),
    ...typed.additions,
    ...adjustmentRows(line, 'addition', true),
    { key: 'earned', label: 'Earned', value: formatEgp(r.earned), kind: 'total' },
    ...allowances,
    // the accounts allowance's accounts (25 October 2026)
    ...[accountsRow(t)].filter((x): x is BreakdownRow => x !== null),
    {
      key: 'insuredWage',
      label: 'Insured wage',
      value: formatEgp(r.insuredWage),
      kind: 'info',
      // after a raise, as before it until the next January or the Form 2 date (owner's decision, 16 October 2026)
      note: t.insuredWageAsBefore ? `As before the raise until ${monthName(t.insuredWageAsBefore.slice(0, 7))}` : undefined,
    },
    { key: 'employeeInsurance', label: 'Social insurance', value: cutText(r.employeeInsurance), kind: 'cut', note: insuranceNote },
    // the deductions before tax (20 October 2026), which lowered the taxable pay
    ...adjustmentRows(line, 'deduction', true),
    { key: 'taxable', label: 'Taxable pay', value: formatEgp(r.monthlyTaxable), kind: 'info', note: t.statutory ? taxableNote(r) : undefined },
    { key: 'tax', label: 'Income tax', value: cutText(r.monthlyTax), kind: 'cut' },
    { key: 'martyrsFund', label: 'Martyrs’ fund', value: cutText(r.martyrsFund), kind: 'cut' },
    ...typed.penalties,
    ...adjustmentRows(line, 'deduction', false),
    { key: 'deductions', label: 'Deductions', value: cutText(r.deductions), kind: 'total' },
    ...adjustmentRows(line, 'addition', false),
    { key: 'net', label: 'Net', value: formatEgp(r.net), kind: 'total' },
    { key: 'released', label: 'Released', value: cutText(r.released), kind: 'cut', note: r.released ? 'Already paid out this month' : undefined },
    { key: 'transfer', label: 'Transfer', value: formatEgp(r.transfer), kind: 'total', note: 'What the bank pays' },
    {
      key: 'companyCost',
      label: 'Company cost',
      value: formatEgp(r.companyCost),
      kind: 'total',
      note:
        resultAdjustments(r).untaxed > 0
          ? `Earned, allowances, the untaxed additions and the company's social insurance (${formatEgp(r.employerInsurance)})`
          : `Earned, allowances and the company's social insurance (${formatEgp(r.employerInsurance)})`,
    },
  ];
}
