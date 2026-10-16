import { formatHours, type PayrollRules } from '@trendlix/shared';
import type { PayrollLineView } from '../../../../lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';

// One employee's pay, step by step, as the run's results table opens it (owner's decisions, 16 October 2026): from the
// gross split into its fixed and variable parts, through the attendance and KPI cuts and what is added, to the pay
// earned, then the insurance, tax and other deductions, the net, what the bank transfers, and what the employee costs
// the company. Each step as payrollLine (@trendlix/shared) worked it out; nothing is worked out again here. Pure code,
// tested; relative imports, as vitest doesn't know the @/ paths.

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

type Line = Pick<PayrollLineView, 'payBasis' | 'terms' | 'inputs' | 'result'>;

/** The steps of a line on monthly pay: the gross's parts, the cuts and what is added. */
function monthlySteps({ terms: t, inputs: i, result: r }: Line, rules: PayrollRules): BreakdownRow[] {
  const variablePercent = Math.round((100 - t.basicPercent) * 100) / 100;
  const part = t.paidDays < rules.dayDivisor ? `, for ${t.paidDays} of ${rules.dayDivisor} days` : '';
  return [
    { key: 'fixed', label: 'Fixed', value: formatEgp(r.fixed), kind: 'add', note: `${t.basicPercent}% of the gross${part}` },
    { key: 'variable', label: 'Variable', value: formatEgp(r.variable), kind: 'add', note: `${variablePercent}% of the gross${part}` },
    {
      key: 'attendance',
      label: 'Attendance',
      value: r.attendanceRatio === null ? 'Not tracked' : percentText(r.attendanceRatio),
      kind: 'info',
      note:
        r.attendanceRatio === null
          ? 'No hours typed: counts in full'
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
      note: `The average of attendance and the KPIs given; at or above ${rules.kpiGracePercent}% counts in full`,
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
export function breakdown(line: Line, rules: PayrollRules): BreakdownRow[] {
  const { terms: t, inputs: i, result: r } = line;
  const insuranceNote = !t.statutory
    ? 'Freelance: no social insurance, tax or Martyrs’ fund'
    : !t.insured
      ? 'Not registered with social insurance: nothing deducted'
      : '11% of the insured wage';
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
