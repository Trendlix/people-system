// Monthly payroll (owner's decisions, 16 October 2026): each employee's pay for a month, worked out the way the
// owner's payroll sheet ("Payroll - SEP 26") does it, with its formula errors fixed. The fixed part of the gross
// (the contract's basic percent, 80 by default) follows attendance, the variable part follows the KPIs; tax is on the
// actual pay (Law 7/2024, salary.ts) and social insurance on the insured wage the Social Insurance tab shows. Built
// before attendance: HR types the month's hours and days on the run, and attendance will fill the same inputs later.
// Absent days (owner's decisions, 16 October 2026): a no-show day costs 2 days' pay ("as the sheet"), and is never
// charged twice ("make sure it is not duplicated in the noshow deduction and the attendance percentage"): its hours, a
// day of the employee's shift, come out of the expected hours before attendance is worked out, so attendance measures
// only short hours on the days the employee came in; the cut is never more than the salary left for the days paid.
// The variable part follows the KPIs only ("No, fixed only" until the KPIs module): with no KPI given it isn't cut.

import type { AllowanceTerms } from './contracts.js';
import type { PayBasis } from './contracts.js';
import { grossToNet, monthlySalaryTax, SALARY_RULES } from './salary.js';

/** A run's way through: HR prepares it, the CEO approves it (owner: the CEO only), HR marks it paid. */
export const PAYROLL_STATUSES = ['draft', 'pending_ceo', 'approved', 'paid'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  draft: 'Draft',
  pending_ceo: 'With the CEO',
  approved: 'Approved',
  paid: 'Paid',
};

/** The rules a run is worked out with: kept in the payroll settings, copied onto each run. */
export interface PayrollRules {
  /** A month counts as this many days, for day rates and part months (the sheet: 30). */
  dayDivisor: number;
  /** Attendance at or above this percent counts as full: the fixed pay isn't cut (the sheet: 90). */
  attendanceGracePercent: number;
  /**
   * A KPI average at or above this percent counts as full: the variable pay isn't cut (the sheet: 80). With no KPI
   * given, it isn't cut at all.
   */
  kpiGracePercent: number;
  /** Overtime is paid for attendance above this percent (the sheet: 110). */
  overtimeAbovePercent: number;
  /** Overtime is paid at this rate (the sheet: 1.5). */
  overtimeRate: number;
  /** A no-show day costs this many days' pay (the sheet: 2); its hours aren't counted again in attendance. */
  noShowDayMultiplier: number;
}

export const PAYROLL_RULE_DEFAULTS: PayrollRules = {
  dayDivisor: 30,
  attendanceGracePercent: 90,
  kpiGracePercent: 80,
  overtimeAbovePercent: 110,
  overtimeRate: 1.5,
  noShowDayMultiplier: 2,
};

/** An allowance on a payroll line: the contract's, by name. */
export interface PayrollAllowance extends AllowanceTerms {
  name: string;
}

/** What a line is worked out from, taken from the contract in force and the profile when the run is made or refreshed. */
export interface PayrollTerms {
  /** The run's year: its insurable wage limits. */
  year: number;
  payBasis: PayBasis;
  /** The contract's monthly gross; for pay by the hour, its monthly estimate (used for day rates). */
  gross: number;
  /** The fixed part of the gross, in percent (the contract's basic percent, 80 by default); the rest is variable. */
  basicPercent: number;
  /** Pay by the hour only. */
  hourlyRate: number | null;
  allowances: PayrollAllowance[];
  /** The days paid in the month: the divisor for a whole month, fewer for someone who joined or left in it. */
  paidDays: number;
  /** False for freelancers: no social insurance, no tax, no Martyrs' Fund. */
  statutory: boolean;
  /** Registered with social insurance (Employee.socialInsured). */
  insured: boolean;
  /** The insured wage, as the Social Insurance tab and Form 1 show it. */
  insuredWage: number;
  /**
   * A working day's hours, from the employment's shift (its start to its end; an end before the start runs past
   * midnight): the hours a no-show day takes out of the expected hours (owner's decision, 16 October 2026). Null
   * without a shift, and missing on lines worked out before then: the expected hours are then taken as typed.
   */
  hoursPerDay: number | null;
}

/**
 * The month's figures HR types on the run (null: not given). Percents as 95 for 95%. There is no medical subscription
 * on the payroll any more (owner's decision, 16 October 2026): inputs saved before then may still have one, and it is
 * ignored.
 */
export interface PayrollInputs {
  workedHours: number | null;
  /** The month's working hours, the no-show days' too: their hours are taken out before attendance is worked out. */
  expectedHours: number | null;
  /**
   * The KPIs. Not typed on the inputs grid since 16 October 2026 (owner: "this is going to be from the KPI's module,
   * lets remove it till we work on it"): the KPIs module will fill them; any given still count.
   */
  softSkills: number | null;
  performance: number | null;
  clientSatisfaction: number | null;
  /**
   * Days absent without notice (owner's decisions, 16 October 2026): each costs the no-show multiplier's days of the
   * gross, and its hours (a day of the shift) are taken out of the expected hours, so attendance doesn't charge it
   * again. Not for pay by the hour.
   */
  noShowDays: number | null;
  penaltyDays: number | null;
  bonusDays: number | null;
  commission: number | null;
  /** One-off amounts in the gross, such as last month's corrections; may be negative. */
  settlements: number | null;
  /** Already paid out this month: not in the bank transfer. */
  released: number | null;
}

export const EMPTY_PAYROLL_INPUTS: PayrollInputs = {
  workedHours: null,
  expectedHours: null,
  softSkills: null,
  performance: null,
  clientSatisfaction: null,
  noShowDays: null,
  penaltyDays: null,
  bonusDays: null,
  commission: null,
  settlements: null,
  released: null,
};

/** A line worked out, step by step. Amounts in EGP to the piaster; ratios and scores as fractions (0.95). */
export interface PayrollResult {
  /** The fixed and variable parts of the gross for the days paid. By the hour: the hours' pay, and no variable part. */
  fixed: number;
  variable: number;
  /**
   * The no-show days' hours (a day of the shift each), taken out of the expected hours: 0 without no-show days, the
   * shift's hours or expected hours, and for pay by the hour. Missing on lines worked out before 16 October 2026, when
   * none were.
   */
  absentHours: number;
  /** Worked ÷ (expected less absent) hours; null when attendance isn't tracked or can't be counted. */
  attendanceRatio: number | null;
  /** The attendance that counts (1 at or above the grace percent). */
  attendanceScore: number;
  /** The KPI average that counts (1 at or above the grace percent, and with no KPI given). */
  kpiScore: number;
  attendanceCut: number;
  kpiCut: number;
  noShowCut: number;
  overtime: number;
  bonus: number;
  commission: number;
  settlements: number;
  /** The pay earned before allowances: the salary part, all of it taxed. */
  earned: number;
  allowances: number;
  taxableAllowances: number;
  /** The wage social insurance is paid on this month: 0 for someone not registered with it, or a freelancer. */
  insuredWage: number;
  employeeInsurance: number;
  employerInsurance: number;
  monthlyTaxable: number;
  annualNetIncome: number;
  monthlyTax: number;
  martyrsFund: number;
  penaltyCut: number;
  /** All the employee's deductions: insurance, tax, Martyrs' Fund, penalties. */
  deductions: number;
  net: number;
  released: number;
  /** What the bank pays: the net less what was already paid out. */
  transfer: number;
  /** What the employee costs the company this month: earned, allowances and the company's insurance share. */
  companyCost: number;
  /** Plain-English notes for HR, e.g. "Paid for 19 of 30 days: joined or left in the month". */
  warnings: string[];
}

/** Half-up to the piaster, as salary.ts rounds (+ 0 turns a −0 into 0). */
const piasters = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100 + 0;

/** A ratio without the noise of the division or the sum, so that 80% compares as 80% with the grace percent. */
const fraction = (v: number) => Math.round(v * 1e10) / 1e10;

/** An input not given counts as 0. */
const given = (v: number | null) => v ?? 0;

/** The salary part of a line before the bonus, the commission and the settlements. */
type SalaryPart = Pick<
  PayrollResult,
  'fixed' | 'variable' | 'absentHours' | 'attendanceRatio' | 'attendanceScore' | 'kpiScore' | 'attendanceCut' | 'kpiCut' | 'noShowCut' | 'overtime'
>;

/**
 * A working day's hours from a shift's start and end ("HH:mm"): an end before the start runs past midnight. Null when
 * they are the same, or not times.
 */
export function shiftHours(start: string, end: string): number | null {
  const minutes = (t: string) => {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const [from, to] = [minutes(start), minutes(end)];
  if (from === null || to === null || from === to) return null;
  return ((to - from + 1440) % 1440) / 60;
}

/**
 * The hours of the no-show days, a day of the shift each, that come out of the expected hours (owner's decision,
 * 16 October 2026): 0 without no-show days or the shift's hours.
 */
export function noShowHours(noShowDays: number | null, hoursPerDay: number | null | undefined): number {
  const n = given(noShowDays);
  return n > 0 && typeof hoursPerDay === 'number' && hoursPerDay > 0 ? fraction(n * hoursPerDay) : 0;
}

/**
 * A payroll line worked out from its terms and the month's inputs, with the run's rules, every amount rounded to the
 * piaster as it is worked out. Monthly pay: a no-show day costs days of the gross (two by default), never more than
 * the salary left for the days paid, and its hours (the shift's) come out of the expected hours; the fixed part of the
 * gross (its basic percent) is cut for attendance on those hours below the grace percent and paid overtime above the
 * overtime percent; the variable part is cut for a KPI average below its grace percent, and not at all with no KPI
 * given. By the hour: the hours worked at the contract's rate. Then for both: the bonus days, the commission and the
 * settlements; the allowances for the days paid; social insurance on the insured wage, whole for a part month; the
 * salary tax and the Martyrs' Fund on the actual pay; penalty days at the contract's net after the tax.
 */
export function payrollLine(terms: PayrollTerms, inputs: PayrollInputs, rules: PayrollRules = PAYROLL_RULE_DEFAULTS): PayrollResult {
  const days = rules.dayDivisor;
  if (!(days > 0)) throw new RangeError('payrollLine: the day divisor must be more than 0');
  // inputs saved before a field existed read as not given
  const i: PayrollInputs = { ...EMPTY_PAYROLL_INPUTS, ...inputs };
  const warnings: string[] = [];
  if (terms.paidDays < days) warnings.push(`Paid for ${terms.paidDays} of ${days} days: joined or left in the month`);

  const gross = piasters(terms.gross);
  const fixedFull = piasters((gross * terms.basicPercent) / 100);
  const variableFull = piasters(gross - fixedFull);
  /** An amount for the days paid. */
  const forDaysPaid = (amount: number) => piasters((amount * terms.paidDays) / days);

  const salary =
    terms.payBasis === 'hourly'
      ? hourlyPart(terms, i, warnings)
      : // terms saved before the hours a day existed read as without a shift
        monthlyPart(i, rules, { gross, fixedFull, variableFull, forDaysPaid, hoursPerDay: terms.hoursPerDay ?? null }, warnings);
  // a bonus day is a day of the fixed part, also for pay by the hour (its monthly estimate's)
  const bonus = piasters((given(i.bonusDays) * fixedFull) / days);
  const commission = piasters(given(i.commission));
  const settlements = piasters(given(i.settlements));
  const earned = piasters(
    salary.fixed - salary.attendanceCut + salary.variable - salary.kpiCut - salary.noShowCut + salary.overtime + bonus + commission + settlements,
  );

  // the contract's allowances for the days paid, never below 0 (as salary.ts counts them)
  const allowances = terms.allowances.map((a) => ({ ...a, amount: forDaysPaid(Math.max(0, a.amount)) }));
  const allowancesTotal = piasters(allowances.reduce((sum, a) => sum + a.amount, 0));
  const taxableAllowances = piasters(allowances.reduce((sum, a) => sum + (a.taxable ? a.amount : 0), 0));

  // social insurance (owner's decision, 16 October 2026): for those registered with it, on the insured wage the Social
  // Insurance tab shows, not prorated for a part month; none for a freelancer
  const insured = terms.statutory && terms.insured;
  const insuredWage = insured ? piasters(terms.insuredWage) : 0;
  if (insured && !(insuredWage > 0)) warnings.push('Registered with social insurance, but there is no insured wage: no insurance is deducted');
  const employeeInsurance = piasters(insuredWage * SALARY_RULES.employeeInsuranceRate);
  const employerInsurance = piasters(insuredWage * SALARY_RULES.employerInsuranceRate);

  // the salary tax and the Martyrs' Fund on the actual pay and the taxable allowances (owner's decision, 16 October
  // 2026: the sheet's method, without its bracket errors); none for a freelancer
  const taxedPay = piasters(earned + taxableAllowances);
  const tax = terms.statutory
    ? monthlySalaryTax({ taxedPay, employeeInsurance })
    : { healthInsurance: 0, monthlyTaxable: 0, annualNetIncome: 0, annualTax: 0, monthlyTax: 0, martyrsFund: 0 };

  // after the tax: a penalty day costs a day of the contract's net (the sheet's "Original Net"), a freelancer's a day of
  // the gross, which is their net
  const penaltyDays = given(i.penaltyDays);
  const contractNet = terms.statutory ? grossToNet(gross, terms.year).net : gross;
  const penaltyCut = penaltyDays ? piasters((penaltyDays * contractNet) / days) : 0;

  // comprehensive health insurance is 0 while it doesn't apply in Cairo; it is in the deductions so the net stays right
  const deductions = piasters(employeeInsurance + tax.healthInsurance + tax.monthlyTax + tax.martyrsFund + penaltyCut);
  const net = piasters(earned + allowancesTotal - deductions);
  const released = piasters(given(i.released));
  const transfer = piasters(net - released);
  if (net < 0) warnings.push('The net is below 0: the cuts and deductions are more than the pay');
  if (transfer < 0 && released > 0) warnings.push('More was released than the net: the transfer is below 0');

  return {
    ...salary,
    bonus,
    commission,
    settlements,
    earned,
    allowances: allowancesTotal,
    taxableAllowances,
    insuredWage,
    employeeInsurance,
    employerInsurance,
    monthlyTaxable: tax.monthlyTaxable,
    annualNetIncome: tax.annualNetIncome,
    monthlyTax: tax.monthlyTax,
    martyrsFund: tax.martyrsFund,
    penaltyCut,
    deductions,
    net,
    released,
    transfer,
    companyCost: piasters(earned + allowancesTotal + employerInsurance),
    warnings,
  };
}

/**
 * A monthly salary for the days paid, with the cuts and the overtime the owner's sheet works out (its formula errors
 * fixed), and its no-show days charged once (owner's decisions, 16 October 2026). Attendance is the worked hours ÷ the
 * expected hours less the no-show days' hours (a day of the shift each), counted as full at or above the grace percent
 * (90); without the shift's hours, the expected hours as typed, with a warning. With a KPI given, the KPI average is
 * that attendance score and the KPIs given, counted as full at or above its grace percent (80); with none, the variable
 * part isn't cut ("fixed only"). Overtime is paid on the fixed part for the days paid (the expected hours are the part
 * month's) for attendance above the overtime percent (110), at the overtime rate (1.5). A no-show day costs the no-show
 * multiplier (2) days of the gross (the sheet used the declared insurance salary, empty for most), never more than the
 * salary left for the days paid after the other cuts.
 */
function monthlyPart(
  i: PayrollInputs,
  rules: PayrollRules,
  pay: { gross: number; fixedFull: number; variableFull: number; forDaysPaid: (amount: number) => number; hoursPerDay: number | null },
  warnings: string[],
): SalaryPart {
  const fixed = pay.forDaysPaid(pay.fixedFull);
  const variable = pay.forDaysPaid(pay.variableFull);

  // a no-show day's hours come out of the expected hours: the no-show cut alone charges the day
  const noShowDays = given(i.noShowDays);
  const { workedHours: worked, expectedHours: expected } = i;
  const shiftDays = noShowHours(i.noShowDays, pay.hoursPerDay);
  const absentHours = expected !== null && expected > 0 ? shiftDays : 0;
  /** The expected hours attendance is measured on. */
  const counted = expected === null ? 0 : fraction(expected - absentHours);
  const attendanceRatio = worked !== null && expected !== null && expected > 0 && counted > 0 ? fraction(worked / counted) : null;
  if (worked !== null && expected === null) warnings.push("Worked hours are given without the expected hours: attendance isn't counted");
  if (worked === null && expected !== null) warnings.push("Expected hours are given without the worked hours: attendance isn't counted");
  if (worked !== null && expected !== null && !(expected > 0)) warnings.push("The expected hours are 0: attendance isn't counted");
  if (worked !== null && expected !== null && expected > 0 && !(counted > 0)) {
    warnings.push("The no-show days' hours are all the expected hours or more: attendance isn't counted, only the no-show cut");
  }
  if (noShowDays > 0 && expected !== null && shiftDays === 0) {
    warnings.push("No shift on the employment, so the no-show days' hours couldn't be taken out of the expected hours: type the expected hours without them");
  }
  const attendanceScore = attendanceRatio === null || attendanceRatio >= rules.attendanceGracePercent / 100 ? 1 : attendanceRatio;

  const kpis = [i.softSkills, i.performance, i.clientSatisfaction].filter((v): v is number => v !== null).map((v) => v / 100);
  const kpiAverage = fraction([attendanceScore, ...kpis].reduce((sum, v) => sum + v, 0) / (kpis.length + 1));
  const kpiScore = kpis.length === 0 || kpiAverage >= rules.kpiGracePercent / 100 ? 1 : kpiAverage;

  const attendanceCut = piasters(fixed * Math.max(0, 1 - attendanceScore));
  const kpiCut = piasters(variable * Math.max(0, 1 - kpiScore));
  // never more than the salary left for the days paid, so absences alone can't take the pay below 0
  const noShowFull = piasters((noShowDays * rules.noShowDayMultiplier * pay.gross) / rules.dayDivisor);
  const salaryLeft = Math.max(0, piasters(fixed - attendanceCut + variable - kpiCut));
  const noShowCut = Math.min(noShowFull, salaryLeft);
  if (noShowFull > noShowCut) warnings.push('The no-show days cost more than the salary left for the days paid: the cut is capped there');

  const above = rules.overtimeAbovePercent / 100;
  return {
    fixed,
    variable,
    absentHours,
    attendanceRatio,
    attendanceScore,
    kpiScore,
    attendanceCut,
    kpiCut,
    noShowCut,
    // the sheet's intent: its overtime column multiplied the money amount by the attendance again, not copied
    overtime: attendanceRatio !== null && attendanceRatio > above ? piasters(fixed * (attendanceRatio - above) * rules.overtimeRate) : 0,
  };
}

/**
 * Pay by the hour: the hours worked at the contract's rate, as one amount (in `fixed`). There is no split of the gross,
 * so no attendance or KPI cuts, no overtime on the attendance ratio and no no-show cut (nor absent hours).
 */
function hourlyPart(terms: PayrollTerms, i: PayrollInputs, warnings: string[]): SalaryPart {
  if (i.workedHours === null) warnings.push('Paid by the hour, but no worked hours are given: nothing is paid for hours');
  if (!(given(terms.hourlyRate) > 0)) warnings.push('Paid by the hour, but the contract has no hourly rate');
  if ([i.expectedHours, i.softSkills, i.performance, i.clientSatisfaction, i.noShowDays].some((v) => v !== null)) {
    warnings.push("Paid by the hour: the expected hours, KPIs and no-show days don't change the pay");
  }
  return {
    fixed: piasters(given(i.workedHours) * given(terms.hourlyRate)),
    variable: 0,
    absentHours: 0,
    attendanceRatio: null,
    attendanceScore: 1,
    kpiScore: 1,
    attendanceCut: 0,
    kpiCut: 0,
    noShowCut: 0,
    overtime: 0,
  };
}

/**
 * Hours as typed or exported from attendance: "270:00", "270:30" (hours and two-digit minutes), "270.5" or "270", with
 * spaces around; null when empty or not hours.
 */
export function parseHours(text: string | null | undefined): number | null {
  const t = (text ?? '').trim();
  const clock = /^(\d+):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  return /^(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : null;
}

/** Hours for display as attendance shows them, to the minute: 270.5 → "270:30". */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return '';
  const minutes = Math.round(Math.abs(hours) * 60);
  return `${hours < 0 && minutes > 0 ? '-' : ''}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A date's day number, for counting the days between two dates. */
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/**
 * The days paid in a month ('YYYY-MM') for an employment from `joinDate` to `endDate` (YYYY-MM-DD, null while
 * current): the divisor for the whole month, else the calendar days employed in it, at most the divisor; 0 when the
 * employment doesn't touch the month. So a whole February is 30 days, and in a 31-day month someone who joined on the
 * 2nd is paid for 30.
 */
export function paidDaysIn(month: string, joinDate: string, endDate: string | null, divisor: number): number {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RangeError(`paidDaysIn: "${month}" is not a month (YYYY-MM)`);
  for (const date of [joinDate, endDate]) {
    if (date !== null && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) throw new RangeError(`paidDaysIn: "${date}" is not a date (YYYY-MM-DD)`);
  }
  const first = `${month}-01`;
  const last = `${month}-${new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()}`;
  const from = joinDate > first ? joinDate : first;
  const to = endDate !== null && endDate < last ? endDate : last;
  if (from > to) return 0;
  if (from === first && to === last) return divisor;
  return Math.min(dayNumber(to) - dayNumber(from) + 1, divisor);
}
