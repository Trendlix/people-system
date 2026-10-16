import { expectedHoursOf, formatHours, lawRatesFor, type LawRates, type PayrollInputs, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import type { PayrollLineView } from '../../../../lib/types';
import { formatEgp, formatPercent } from '../../employees/[id]/contracts/salary';

// One employee's pay, step by step, as the run's results table opens it (owner's decisions, 16 October 2026): from the
// gross split into its fixed and variable parts, through the attendance and KPI cuts and what is added, to the pay
// earned, then the insurance, tax and other deductions, the net, what the bank transfers, and what the employee costs
// the company. Each step as payrollLine (@trendlix/shared) worked it out; nothing is worked out again here. The hours
// attendance is measured on are the expected hours less the no-show days' hours, so a day off is charged once, and
// with no KPI given the variable part isn't cut (owner's decisions, 16 October 2026). The KPIs a line has are listed
// with its KPI score, as the inputs grid doesn't show them (the KPIs module will fill them). The expected hours say
// where they came from: as HR typed them, or the shift's working days less the holidays (owner's request, 16 October
// 2026, Payroll Setup). Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

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

/**
 * Where a line's expected hours came from, and what came out of them: as HR typed them, or the shift's working days in
 * the days employed less the holidays, at its hours a day (owner's request, 16 October 2026); less the no-show days'
 * hours. Nothing to say without either.
 */
export function expectedHoursNote(t: PayrollTerms, i: PayrollInputs, absent: number): string | undefined {
  const less = absent > 0 ? `less ${formatHours(absent)} for the no-show ${i.noShowDays === 1 ? 'day' : 'days'}` : null;
  if (i.expectedHours !== null) return less ? `${formatHours(i.expectedHours)} expected as typed, ${less}` : 'Expected hours as typed';
  if (t.expectedHours === null || t.expectedHours === undefined) return undefined;
  const d = t.expectedDays;
  const from =
    d && t.hoursPerDay ? `${plural(d.workingDays, 'working day')} of the shift${d.holidays ? ` less ${plural(d.holidays, 'holiday')}` : ''}, at ${formatHours(t.hoursPerDay)} a day` : 'the shift';
  return `${formatHours(t.expectedHours)} expected from ${from}${less ? `; ${less}` : ''}`;
}

/** The steps of a line on monthly pay: the gross's parts, the cuts and what is added. */
function monthlySteps({ terms: t, inputs: i, result: r }: Line, rules: PayrollRules): BreakdownRow[] {
  const variablePercent = Math.round((100 - t.basicPercent) * 100) / 100;
  const part = t.paidDays < rules.dayDivisor ? `, for ${t.paidDays} of ${rules.dayDivisor} days` : '';
  // the no-show days' hours out of the expected hours: none on a line worked out before 16 October 2026
  const absent = r.absentHours > 0 ? r.absentHours : 0;
  const typed = i.workedHours !== null || i.expectedHours !== null;
  // as HR typed them, else the shift's less the holidays
  const expected = expectedHoursOf(t, i);
  const hours: BreakdownRow[] =
    i.workedHours !== null && expected !== null
      ? [
          {
            key: 'hours',
            label: 'Hours worked',
            value: `${formatHours(i.workedHours)} of ${formatHours(Math.max(0, expected - absent))}`,
            kind: 'info',
            note: expectedHoursNote(t, i, absent),
          },
        ]
      : [];
  const typedKpis: [string, number | null][] = [
    ['soft skills', i.softSkills],
    ['performance', i.performance],
    ['client satisfaction', i.clientSatisfaction],
  ];
  const kpis = typedKpis.filter((k): k is [string, number] => k[1] !== null).map(([name, v]) => `${name} ${percent.format(v)}%`);
  return [
    { key: 'fixed', label: 'Fixed', value: formatEgp(r.fixed), kind: 'add', note: `${t.basicPercent}% of the gross${part}` },
    { key: 'variable', label: 'Variable', value: formatEgp(r.variable), kind: 'add', note: `${variablePercent}% of the gross${part}` },
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
    {
      key: 'overtime',
      label: 'Overtime',
      value: formatEgp(r.overtime),
      kind: 'add',
      note: `For attendance above ${rules.overtimeAbovePercent}%, at ${rules.overtimeRate}×`,
    },
  ];
}

/** The steps of a line paid by the hour: the hours at the rate (no split, no attendance or KPI cuts). */
function hourlySteps({ terms: t, inputs: i, result: r }: Line): BreakdownRow[] {
  const forHours = Math.round((r.earned - r.bonus - r.commission - r.settlements) * 100) / 100;
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

/** Every step of a line, in order, as its row in the results table opens it. */
export function breakdown(line: Line, rules: PayrollRules, law?: LawRates): BreakdownRow[] {
  const { terms: t, inputs: i, result: r } = line;
  // the employee's share as the run's copy of the rates set by law has it (owner's request, 16 October 2026); a run from
  // an API before them: the built-in rates of its year
  const share = (law ?? lawRatesFor(t.year)).employeeInsuranceRate;
  const insuranceNote = !t.statutory
    ? 'Freelance: no social insurance, tax or Martyrs’ fund'
    : !t.insured
      ? 'Not registered with social insurance: nothing deducted'
      : `${formatPercent(share)} of the insured wage`;
  const allowanceNames = t.allowances.map((a) => a.name).join(', ');
  return [
    ...(line.payBasis === 'hourly' ? hourlySteps(line) : monthlySteps(line, rules)),
    { key: 'bonus', label: 'Bonus', value: formatEgp(r.bonus), kind: 'add', note: i.bonusDays ? days(i.bonusDays) : undefined },
    { key: 'commission', label: 'Commission', value: formatEgp(r.commission), kind: 'add' },
    { key: 'settlements', label: 'Settlements', value: r.settlements < 0 ? cutText(r.settlements) : formatEgp(r.settlements), kind: r.settlements < 0 ? 'cut' : 'add' },
    { key: 'earned', label: 'Earned', value: formatEgp(r.earned), kind: 'total' },
    { key: 'allowances', label: 'Allowances', value: formatEgp(r.allowances), kind: 'add', note: allowanceNames || undefined },
    { key: 'insuredWage', label: 'Insured wage', value: formatEgp(r.insuredWage), kind: 'info' },
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
    { key: 'deductions', label: 'Deductions', value: cutText(r.deductions), kind: 'total' },
    { key: 'net', label: 'Net', value: formatEgp(r.net), kind: 'total' },
    { key: 'released', label: 'Released', value: cutText(r.released), kind: 'cut', note: r.released ? 'Already paid out this month' : undefined },
    { key: 'transfer', label: 'Transfer', value: formatEgp(r.transfer), kind: 'total', note: 'What the bank pays' },
    {
      key: 'companyCost',
      label: 'Company cost',
      value: formatEgp(r.companyCost),
      kind: 'total',
      note: `Earned, allowances and the company's social insurance (${formatEgp(r.employerInsurance)})`,
    },
  ];
}
