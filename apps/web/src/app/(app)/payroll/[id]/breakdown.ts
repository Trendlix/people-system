import {
  adjustmentTypeLabel,
  EMPTY_PAYROLL_INPUTS,
  formatHours,
  lawRatesFor,
  measuredExpectedHours,
  paysOvertime,
  resultAdjustments,
  splitSegments,
  type LawRates,
  type PayrollAllowance,
  type PayrollInputs,
  type PayrollPart,
  type PayrollResult,
  type PayrollRules,
  type PayrollSegment,
  type PayrollTerms,
} from '@trendlix/shared';
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
// the pay earned, the deductions after tax with the others, the untaxed additions after them, before the net. Pure
// code, tested; relative imports, as vitest doesn't know the @/ paths.

export interface BreakdownRow {
  key: string;
  label: string;
  value: string;
  /** How it reads: an amount added, taken off, a subtotal, or a figure that explains the next step. */
  kind: 'add' | 'cut' | 'total' | 'info';
  note?: string;
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
  t: Pick<PayrollTerms, 'expectedHours' | 'expectedDays' | 'hoursPerDay'>,
  i: Pick<PayrollInputs, 'noShowDays' | 'leaveDays'>,
): string {
  const d = t.expectedDays;
  const from = d ? ` (${plural(d.workingDays, 'working day')} of the shift${d.holidays ? ` less ${plural(d.holidays, 'holiday')}` : ''})` : '';
  const scheduled = `Scheduled ${formatHours(t.expectedHours ?? 0)}${from}`;
  const perDay = typeof t.hoursPerDay === 'number' && t.hoursPerDay > 0 ? formatHours(t.hoursPerDay) : null;
  if (!perDay) return scheduled;
  const dayKinds: [number | null, string][] = [
    [i.noShowDays, 'no-show day'],
    [i.leaveDays ?? null, 'leave day'],
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

/** The steps of a line on monthly pay: the gross's parts, the hours, the cuts and what is added. */
function monthlySteps(line: Line, rules: PayrollRules, split: SplitPart[] | null): BreakdownRow[] {
  const { inputs: i, result: r } = line;
  const typed = i.workedHours !== null || i.expectedHours !== null;
  // the expected hours attendance was measured on: as recorded since 17 October 2026, else as they were worked out
  const expected = measuredExpectedHours(line);
  const hours: BreakdownRow[] = [];
  if (expected !== null) hours.push({ key: 'expected', label: 'Expected hours', value: formatHours(expected), kind: 'info', note: expectedNote(line) });
  if (i.workedHours !== null) {
    hours.push({
      key: 'hours',
      label: 'Hours worked',
      value: expected !== null ? `${formatHours(i.workedHours)} of ${formatHours(expected)}` : formatHours(i.workedHours),
      kind: 'info',
    });
  }
  // paid leave (owner, 17 October 2026): nothing cut, its hours out of the shift's
  const leave = i.leaveDays ?? 0;
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
            : `Below ${rules.attendanceGracePercent}%: the fixed part follows it`,
    },
    { key: 'attendanceCut', label: 'Attendance cut', value: cutText(r.attendanceCut), kind: 'cut' },
    {
      key: 'kpi',
      label: 'KPI score',
      value: percentText(r.kpiScore),
      kind: 'info',
      note: kpis.length
        ? `The average of ${listed([...kpis, `attendance ${percentText(r.attendanceScore)}`])}; at or above ${rules.kpiGracePercent}% counts in full`
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
      ? [{ key: 'leave', label: 'Leave days', value: days(leave), kind: 'info' as const, note: 'Paid leave: nothing cut, and not counted in attendance' }]
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
  const forHours = Math.round((r.earned - r.bonus - r.commission - r.settlements - resultAdjustments(r).taxed) * 100) / 100;
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

/** The line's additions or deductions of a kind (owner, 17 October 2026), each a row by its type with its reason. */
function adjustmentRows(t: PayrollTerms, kind: 'addition' | 'deduction', taxed: boolean | null): BreakdownRow[] {
  return (t.adjustments ?? [])
    .filter((a) => a.kind === kind && (taxed === null || a.taxed === taxed))
    .map((a) => ({
      key: `adjustment-${a.id}`,
      label: adjustmentTypeLabel(a.kind, a.type),
      value: kind === 'deduction' ? cutText(a.amount) : formatEgp(a.amount),
      kind: kind === 'deduction' ? ('cut' as const) : ('add' as const),
      note: kind === 'deduction' ? `${a.reason} · after tax` : a.taxed ? `${a.reason} · taxed` : `${a.reason} · not taxed, added after tax`,
    }));
}

/** Every step of a line, in order, as its row in the results table opens it. */
export function breakdown(given: Line, rules: PayrollRules, law?: LawRates): BreakdownRow[] {
  // inputs saved before a field existed (the leave days, 17 October 2026) read as not given
  const line: Line = { ...given, inputs: { ...EMPTY_PAYROLL_INPUTS, ...given.inputs } };
  const { terms: t, inputs: i, result: r } = line;
  // the employee's share as the run's copy of the rates set by law has it (owner's request, 16 October 2026); a run from
  // an API before them: the built-in rates of its year
  const share = (law ?? lawRatesFor(t.year)).employeeInsuranceRate;
  const insuranceNote = !t.statutory
    ? 'Freelance: no social insurance, tax or Martyrs’ fund'
    : !t.insured
      ? 'Not registered with social insurance: nothing deducted'
      : `${formatPercent(share)} of the insured wage`;
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
    ...(line.payBasis === 'hourly' ? hourlySteps(line) : monthlySteps(line, rules, split)),
    { key: 'bonus', label: 'Bonus', value: formatEgp(r.bonus), kind: 'add', note: i.bonusDays ? days(i.bonusDays) : undefined },
    { key: 'commission', label: 'Commission', value: formatEgp(r.commission), kind: 'add' },
    { key: 'settlements', label: 'Settlements', value: r.settlements < 0 ? cutText(r.settlements) : formatEgp(r.settlements), kind: r.settlements < 0 ? 'cut' : 'add' },
    ...adjustmentRows(t, 'addition', true),
    { key: 'earned', label: 'Earned', value: formatEgp(r.earned), kind: 'total' },
    ...allowances,
    {
      key: 'insuredWage',
      label: 'Insured wage',
      value: formatEgp(r.insuredWage),
      kind: 'info',
      // after a raise, as before it until the next January or the Form 2 date (owner's decision, 16 October 2026)
      note: t.insuredWageAsBefore ? `As before the raise until ${monthName(t.insuredWageAsBefore.slice(0, 7))}` : undefined,
    },
    { key: 'employeeInsurance', label: 'Social insurance', value: cutText(r.employeeInsurance), kind: 'cut', note: insuranceNote },
    {
      key: 'taxable',
      label: 'Taxable pay',
      value: formatEgp(r.monthlyTaxable),
      kind: 'info',
      note: t.statutory ? `A year's net income for tax: ${formatEgp(r.annualNetIncome)}` : undefined,
    },
    { key: 'tax', label: 'Income tax', value: cutText(r.monthlyTax), kind: 'cut' },
    { key: 'martyrsFund', label: 'Martyrs’ fund', value: cutText(r.martyrsFund), kind: 'cut' },
    { key: 'penalties', label: 'Penalties', value: cutText(r.penaltyCut), kind: 'cut', note: i.penaltyDays ? `${days(i.penaltyDays)} of the contract's net` : undefined },
    ...adjustmentRows(t, 'deduction', null),
    { key: 'deductions', label: 'Deductions', value: cutText(r.deductions), kind: 'total' },
    ...adjustmentRows(t, 'addition', false),
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
