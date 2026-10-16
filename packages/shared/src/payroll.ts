// Monthly payroll (owner's decisions, 16 October 2026): each employee's pay for a month, worked out the way the
// owner's payroll sheet ("Payroll - SEP 26") does it, with its formula errors fixed. The fixed part of the gross
// (the contract's basic percent, 80 by default) follows attendance, the variable part follows the KPIs; tax is on the
// actual pay (Law 7/2024, salary.ts) and social insurance on the insured wage the Social Insurance tab shows. Built
// before attendance: HR types the month's hours and days on the run, and attendance will fill the same inputs later.
// Absent days (owner's decisions, 16 October 2026): a no-show day costs 2 days' pay ("as the sheet"), and is never
// charged twice ("make sure it is not duplicated in the noshow deduction and the attendance percentage"), so attendance
// measures only short hours on the days the employee came in; the cut is never more than the salary left for the days
// paid. The variable part follows the KPIs only ("No, fixed only" until the KPIs module): with no KPI given it isn't cut.
// The expected hours (owner's request, 16 October 2026, the Payroll Setup page): a run works out each monthly-paid
// person's shift hours (its working days in the days they are paid, less the official holidays on them, × its hours a
// day) and keeps them with the line's terms. Since 17 October 2026 (owner, on the inputs grid: "prefill the expected
// hours, and dont count abcent days or leave days, as they already have their own deduction and fields") the expected
// hours are those shift hours less a day of the shift for each no-show day and each leave day (paid leave: no cut, and
// not short hours either), filled in on the grid as it shows them (expectedHoursOf); what HR types instead is taken as
// the expected hours already without the no-show and leave days, so nothing more comes out of it (until then a no-show
// day's hours came out of a figure HR typed too), and is never overwritten. Without a shift HR types them, as before.
// The contracts' dates (owner, 17 October 2026: "take into consideration the start and end date of the contract if it
// is in the middle of the billing period"): a month is paid for the days both employed and under a signed contract,
// days between two contracts or after one ends not paid, and a month under two contracts (a renewal mid-month) is split
// by days, each part's fixed and variable pay and allowances its own contract's (PayrollTerms.segments); the cuts work on
// their sums. The bonus and penalty days and the insured wage (a whole month's) go by the contract at the month's end.
// With one of the month's contracts paid by the hour, the latest alone is paid, for all the days: hours can't be split
// between contracts without attendance. A raise takes effect on the 1st (raises.ts), so it never splits a month.
// A shift's hours a day are its hours to work (owner, 16 October 2026, on the MORNING shift of 9:00 AM to 7:00 PM: "my
// company shift is to maintain 9 hours within the shift window, its like flexible shift"): set on the shift, they can
// be fewer than its window (start to end), worked anywhere within it; not set, the whole window (shiftWorkHours). They
// are also the most hours attendance counts a day (owner, 16 October 2026: "maximum working hours to be recorded per
// day is 9 hours between checkin and check out"; attendance.ts): worked hours typed above that on the shift's days get
// a warning, as attendance will never count them.
// Overtime (owner, 16 October 2026: "No overtime for now"): not paid while the rules' Pay overtime is off, as it is from
// then on; a run's rules copied before the switch existed read as on, so their figures never change.

import type { AllowanceTerms } from './contracts.js';
import type { PayBasis } from './contracts.js';
import { lawRatesFor, type LawRates } from './law-rates.js';
import { grossToNet, monthlySalaryTax } from './salary.js';

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
  /**
   * Whether overtime is paid at all (owner, 16 October 2026: "No overtime for now", as attendance counts at most the
   * shift's hours to work a day): off, a line's overtime is 0 whatever the attendance; on, it is paid above the overtime
   * percent at the overtime rate. Missing on the rules runs copied before then, which paid it: read as on, so their
   * figures never change (paysOvertime).
   */
  payOvertime?: boolean;
  /** Overtime is paid for attendance above this percent (the sheet: 110), when it is paid. */
  overtimeAbovePercent: number;
  /** Overtime is paid at this rate (the sheet: 1.5). */
  overtimeRate: number;
  /** A no-show day costs this many days' pay (the sheet: 2); its hours aren't counted again in attendance. */
  noShowDayMultiplier: number;
}

export const PAYROLL_RULE_DEFAULTS: Required<PayrollRules> = {
  dayDivisor: 30,
  attendanceGracePercent: 90,
  kpiGracePercent: 80,
  // off from 16 October 2026 ("No overtime for now")
  payOvertime: false,
  overtimeAbovePercent: 110,
  overtimeRate: 1.5,
  noShowDayMultiplier: 2,
};

/**
 * Whether rules pay overtime: as their switch says; rules copied onto a run before the switch existed (16 October 2026)
 * paid it, so a missing switch reads as on and those runs' figures never change.
 */
export const paysOvertime = (rules: PayrollRules): boolean => rules.payOvertime !== false;

/** An allowance on a payroll line: the contract's, by name. */
export interface PayrollAllowance extends AllowanceTerms {
  name: string;
}

/**
 * A part of the month under one signed contract (owner, 17 October 2026: "take into consideration the start and end
 * date of the contract if it is in the middle of the billing period"): its days, paid on its own pay.
 */
export interface PayrollSegment {
  contractId: string;
  /** As the contract is shown: its number (CON-2026-0007; an amendment's CON-2026-0007-A1) and its version. */
  number: string;
  version: number;
  /** Its first and last day in the month, YYYY-MM-DD. */
  from: string;
  to: string;
  /** The days paid for it (paidDaysOf): its calendar days, the last part what is left of the days paid. */
  days: number;
  payBasis: PayBasis;
  gross: number;
  basicPercent: number;
  /** Pay by the hour only. */
  hourlyRate: number | null;
  allowances: PayrollAllowance[];
}

/**
 * What a line is worked out from, taken from the contracts in force and the profile when the run is made or refreshed.
 * The pay (basis, gross, basic percent, rate, allowances) is the contract's at the month's end; with two contracts in
 * the month, `segments` has each one's for its days.
 */
export interface PayrollTerms {
  /** The run's year: the year whose rates set by law apply (law-rates.ts). */
  year: number;
  payBasis: PayBasis;
  /** The contract's monthly gross; for pay by the hour, its monthly estimate (used for day rates). */
  gross: number;
  /** The fixed part of the gross, in percent (the contract's basic percent, 80 by default); the rest is variable. */
  basicPercent: number;
  /** Pay by the hour only. */
  hourlyRate: number | null;
  allowances: PayrollAllowance[];
  /**
   * The days paid in the month: the divisor for a whole month, fewer for someone who joined or left in it or was under
   * a signed contract for only part of it (owner, 17 October 2026); the segments' days added up.
   */
  paidDays: number;
  /**
   * The month's parts under each signed contract, in date order (owner, 17 October 2026: "take into consideration the
   * start and end date of the contract if it is in the middle of the billing period"): one for a month under one
   * contract, two for a renewal mid-month, whose pay is then split by days; days under none aren't in any. Missing on
   * lines made before then: one part, of the terms above, for the days paid (paidSegments).
   */
  segments?: PayrollSegment[];
  /** False for freelancers: no social insurance, no tax, no Martyrs' Fund. */
  statutory: boolean;
  /** Registered with social insurance (Employee.socialInsured). */
  insured: boolean;
  /** The insured wage, as the Social Insurance tab and Form 1 show it. */
  insuredWage: number;
  /**
   * After a raise (owner's decision, 16 October 2026: "From the next January unless amended in Form 2"): the insured
   * wage is the one before the raise until this date (YYYY-MM-DD: the next 1 January, or the Form 2 date), so it says
   * why. Missing otherwise.
   */
  insuredWageAsBefore?: string | null;
  /**
   * A working day's hours, from the employment's shift: its hours to work a day, else its window (its start to its
   * end; an end before the start runs past midnight), as shiftWorkHours gives them (owner, 16 October 2026: "my company
   * shift is to maintain 9 hours within the shift window"). The hours a no-show or leave day takes out of the shift's
   * hours for the month (owner, 17 October 2026), and the most attendance counts a day. Null without a shift, and
   * missing on lines worked out before 16 October 2026: the expected hours are then taken as typed.
   */
  hoursPerDay: number | null;
  /**
   * The shift's hours for the month (owner's request, 16 October 2026): its working days within the days paid (employed
   * and under contract, 17 October 2026), less the official holidays on them, × its hours a day (its hours to work,
   * else its window: hoursPerDay). Less the no-show and leave days, they are the expected hours when HR hasn't typed
   * others (expectedHoursOf). Null without a shift, and for pay by the hour; missing on lines worked out before then.
   */
  expectedHours?: number | null;
  /** What the shift's hours were worked out from: its working days in the days paid, and the holidays on them. */
  expectedDays?: ShiftDays | null;
}

/** A shift's working days within the days someone is employed in a month, and the official holidays on them. */
export interface ShiftDays {
  /** The shift's working days in the days employed, the holidays on them included. */
  workingDays: number;
  /** The official holidays on those working days: not worked, so not expected. */
  holidays: number;
}

/**
 * The month's figures HR types on the run (null: not given). Percents as 95 for 95%. There is no medical subscription
 * on the payroll any more (owner's decision, 16 October 2026): inputs saved before then may still have one, and it is
 * ignored.
 */
export interface PayrollInputs {
  workedHours: number | null;
  /**
   * The month's expected hours as HR typed them, taken as they are: already without the no-show and leave days, which
   * have their own fields (owner, 17 October 2026: "dont count abcent days or leave days, as they already have their own
   * deduction and fields"); until then a no-show day's hours came out of them. Not typed: the shift's hours less those
   * days (expectedHoursOf), as the grid fills them in.
   */
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
   * gross, and its hours (a day of the shift) are taken out of the shift's expected hours, so attendance doesn't charge
   * it again. Not for pay by the hour.
   */
  noShowDays: number | null;
  /**
   * Approved paid leave taken this month, in whole or half days (owner, 17 October 2026: "dont count abcent days or
   * leave days, as they already have their own deduction and fields"): nothing is cut for them, and their hours (a day
   * of the shift each) are taken out of the shift's expected hours, so attendance doesn't count them as short. Typed by
   * HR until the Leave module, which will fill the same input. Not for pay by the hour. Missing on inputs saved before
   * then: none.
   */
  leaveDays: number | null;
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
  leaveDays: null,
  penaltyDays: null,
  bonusDays: null,
  commission: null,
  settlements: null,
  released: null,
};

/** A part of the month as paid: its contract's fixed and variable pay and allowances for its days. */
export interface PayrollPart {
  /** The segment's contract; null on a line whose terms have no segments (made before 17 October 2026). */
  contractId: string | null;
  fixed: number;
  variable: number;
  allowances: number;
}

/** A line worked out, step by step. Amounts in EGP to the piaster; ratios and scores as fractions (0.95). */
export interface PayrollResult {
  /**
   * The fixed and variable parts of the gross for the days paid, each contract's for its days added up. By the hour:
   * the hours' pay, and no variable part.
   */
  fixed: number;
  variable: number;
  /**
   * The month's parts as paid, in the order of paidSegments (owner, 17 October 2026): one for a month on one contract,
   * two for a renewal mid-month; their fixed, variable and allowances add up to the line's. Missing on lines worked out
   * before then.
   */
  parts: PayrollPart[];
  /**
   * The no-show days' hours (a day of the shift each), taken out of the shift's expected hours: 0 without no-show days
   * or the shift's hours, when HR typed the expected hours (already without them, 17 October 2026), and for pay by the
   * hour. Missing on lines worked out before 16 October 2026, when none were; until 17 October 2026 they came out of a
   * figure HR typed too.
   */
  absentHours: number;
  /**
   * The leave days' hours (a day of the shift each), taken out of the shift's expected hours as the no-show days' are
   * (owner, 17 October 2026). Missing on lines worked out before then, which had no leave days.
   */
  leaveHours: number;
  /**
   * The expected hours attendance is measured on, as the grid shows them (expectedHoursOf, 17 October 2026): HR's, else
   * the shift's less the no-show and leave days; null without either, and for pay by the hour. Missing on lines worked
   * out before then (measuredExpectedHours).
   */
  expectedHours: number | null;
  /** Worked ÷ expected hours; null when attendance isn't tracked or can't be counted. */
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
  /** Plain-English notes for HR, e.g. "Paid for 19 of 30 days: employed or under contract for part of the month". */
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
  | 'fixed'
  | 'variable'
  | 'absentHours'
  | 'leaveHours'
  | 'expectedHours'
  | 'attendanceRatio'
  | 'attendanceScore'
  | 'kpiScore'
  | 'attendanceCut'
  | 'kpiCut'
  | 'noShowCut'
  | 'overtime'
>;

/**
 * A shift's window in hours, from its start and end ("HH:mm"): an end before the start runs past midnight. Null when
 * they are the same, or not times. The hours to work a day may be fewer (shiftWorkHours).
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

/** A shift's times ("HH:mm") and its hours to work a day (null or missing: the whole window). */
export interface ShiftTimes {
  startTime: string;
  endTime: string;
  hoursPerDay?: number | null;
}

/**
 * A shift's hours to work a day (owner, 16 October 2026, on the MORNING shift of 9:00 AM to 7:00 PM: "my company shift
 * is to maintain 9 hours within the shift window, its like flexible shift"): the hours set on the shift, worked anywhere
 * within its window, never more than the window; not set, the whole window (start to end). What payroll counts a day
 * of the shift as (the expected hours, a no-show day's hours), and the most attendance counts a day (attendance.ts).
 * Null when neither can be told.
 */
export function shiftWorkHours(shift: ShiftTimes): number | null {
  const window = shiftHours(shift.startTime, shift.endTime);
  const set = shift.hoursPerDay;
  if (typeof set !== 'number' || !(set > 0)) return window;
  return window === null ? set : Math.min(set, window);
}

/** A flexible shift: fewer hours to work a day than its window, worked anywhere within it. */
export function isFlexibleShift(shift: ShiftTimes): boolean {
  const window = shiftHours(shift.startTime, shift.endTime);
  const work = shiftWorkHours(shift);
  return window !== null && work !== null && work < window;
}

/**
 * The hours of so many days of the shift, a day of its hours each, whole or half days: what no-show and leave days take
 * out of the shift's hours for the month (owner, 16 and 17 October 2026). 0 without days or the shift's hours.
 */
export function shiftDaysHours(days: number | null | undefined, hoursPerDay: number | null | undefined): number {
  const n = days ?? 0;
  return n > 0 && typeof hoursPerDay === 'number' && hoursPerDay > 0 ? fraction(n * hoursPerDay) : 0;
}

/** The hours of the no-show days, a day of the shift each (owner's decision, 16 October 2026): shiftDaysHours. */
export const noShowHours = (noShowDays: number | null, hoursPerDay: number | null | undefined): number => shiftDaysHours(noShowDays, hoursPerDay);

/**
 * The expected hours a line is worked out with, as the inputs grid fills them in (owner, 17 October 2026: "prefill the
 * expected hours, and dont count abcent days or leave days, as they already have their own deduction and fields"): as
 * HR typed them, taken as already without the no-show and leave days; else the shift's hours for the month less a day
 * of the shift for each no-show and leave day, never below 0; null when neither. What HR types is never overwritten.
 */
export function expectedHoursOf(
  terms: Pick<PayrollTerms, 'expectedHours' | 'hoursPerDay'>,
  inputs: Pick<PayrollInputs, 'expectedHours' | 'noShowDays' | 'leaveDays'>,
): number | null {
  if (inputs.expectedHours !== null && inputs.expectedHours !== undefined) return inputs.expectedHours;
  const shift = terms.expectedHours;
  if (shift === null || shift === undefined) return null;
  const off = shiftDaysHours(inputs.noShowDays, terms.hoursPerDay) + shiftDaysHours(inputs.leaveDays, terms.hoursPerDay);
  return Math.max(0, fraction(shift - off));
}

/**
 * The expected hours a line's attendance was measured on, as it was worked out, for showing it: its own record of them
 * since 17 October 2026 (PayrollResult.expectedHours); on a line worked out before then, the hours HR typed or the
 * shift's, less the no-show days' hours it took out of them. Null when there were none, and for pay by the hour.
 */
export function measuredExpectedHours(
  line: { payBasis: PayBasis; terms: Pick<PayrollTerms, 'expectedHours'>; inputs: Pick<PayrollInputs, 'expectedHours'>; result: Pick<PayrollResult, 'expectedHours' | 'absentHours'> },
): number | null {
  if (line.payBasis === 'hourly') return null;
  if (line.result.expectedHours !== undefined) return line.result.expectedHours;
  const before = line.inputs.expectedHours ?? line.terms.expectedHours ?? null;
  const absent = Number.isFinite(line.result.absentHours) && line.result.absentHours > 0 ? line.result.absentHours : 0;
  return before === null ? null : Math.max(0, fraction(before - absent));
}

/** A part of the month as payrollLine pays it: a contract's pay, for its days. */
type PaidSegment = Pick<PayrollSegment, 'days' | 'gross' | 'basicPercent' | 'allowances'> & { contractId: string | null };

/**
 * The parts of the month a line is paid on (owner, 17 October 2026): its terms' segments, each for its days; on a line
 * made before then, one of its terms for the days paid. With two or more and one of them by the hour, the latest alone
 * (`latestOnly`) for all the days paid: hours can't be split between contracts without attendance.
 */
export function paidSegments(terms: PayrollTerms): { segments: PaidSegment[]; latestOnly: PayrollSegment | null } {
  const all = terms.segments ?? [];
  if (all.length === 0) {
    return { segments: [{ contractId: null, days: terms.paidDays, gross: terms.gross, basicPercent: terms.basicPercent, allowances: terms.allowances }], latestOnly: null };
  }
  if (all.length > 1 && all.some((s) => s.payBasis === 'hourly')) {
    const latest = all[all.length - 1];
    return { segments: [{ ...latest, days: terms.paidDays }], latestOnly: latest };
  }
  return { segments: all, latestOnly: null };
}

/**
 * The contracts a month's pay is split between, in date order (owner, 17 October 2026): two or more, none of them by
 * the hour; null for a month paid on one (or, with one by the hour, on the latest alone), and for lines made before.
 */
export function splitSegments(terms: Pick<PayrollTerms, 'segments'>): PayrollSegment[] | null {
  const all = terms.segments ?? [];
  return all.length > 1 && !all.some((s) => s.payBasis === 'hourly') ? all : null;
}

/** "no-show days", "leave days" or "no-show and leave days": the days off a line has; null without any. */
function daysOffName(noShowDays: number, leaveDays: number): string | null {
  if (noShowDays > 0 && leaveDays > 0) return 'no-show and leave days';
  if (noShowDays > 0) return 'no-show days';
  return leaveDays > 0 ? 'leave days' : null;
}

/**
 * A payroll line worked out from its terms and the month's inputs, with the run's rules, every amount rounded to the
 * piaster as it is worked out. The month's parts under each contract (owner, 17 October 2026) are each paid their own
 * contract's fixed and variable pay and allowances for their days, added up; the rest goes by the contract at the
 * month's end. Monthly pay: a no-show day costs days of the gross (two by default), never more than the salary left for
 * the days paid; the fixed part of the gross (its basic percent) is cut for attendance on the expected hours (HR's, else
 * the shift's less the no-show and leave days: expectedHoursOf) below the grace percent and, while the rules pay it,
 * paid overtime above the overtime percent; the variable part is cut for a KPI average below its grace percent, and
 * not at all with no KPI given. By the hour: the hours worked at the contract's rate. Then for both: the bonus days,
 * the commission and the settlements; the allowances for the days paid; social insurance on the insured wage, whole
 * for a part month; the salary tax and the Martyrs' Fund on the actual pay; penalty days at the contract's net after
 * the tax. The insurance shares, the tax and the Fund follow `law`, the rates set by law the run keeps (owner's
 * request, 16 October 2026); without them, the built-in ones of the run's year.
 */
export function payrollLine(
  terms: PayrollTerms,
  inputs: PayrollInputs,
  rules: PayrollRules = PAYROLL_RULE_DEFAULTS,
  law: LawRates = lawRatesFor(terms.year),
): PayrollResult {
  const days = rules.dayDivisor;
  if (!(days > 0)) throw new RangeError('payrollLine: the day divisor must be more than 0');
  // inputs saved before a field existed read as not given
  const i: PayrollInputs = { ...EMPTY_PAYROLL_INPUTS, ...inputs };
  const warnings: string[] = [];
  if (terms.paidDays < days) warnings.push(`Paid for ${terms.paidDays} of ${days} days: employed or under contract for part of the month`);

  // the contract at the month's end: its gross for the no-show and bonus days and the penalty days' net
  const gross = piasters(terms.gross);
  const fixedFull = piasters((gross * terms.basicPercent) / 100);
  /** An amount for so many days. */
  const forDays = (amount: number, n: number) => piasters((amount * n) / days);

  // each part of the month on its own contract's pay, for its days (owner, 17 October 2026)
  const { segments, latestOnly } = paidSegments(terms);
  if (latestOnly) {
    const all = terms.segments!;
    const hourly = all.filter((s) => s.payBasis === 'hourly').length;
    const which = hourly === all.length ? (hourly === 2 ? 'both' : 'all') : hourly === 1 ? 'one' : String(hourly);
    warnings.push(
      `${all.length} contracts this month, ${which} paid by the hour: the whole month is paid on the latest, ${latestOnly.number} v${latestOnly.version}, as hours can't be split between contracts without attendance`,
    );
  }
  const parts = segments.map((s) => {
    const g = piasters(s.gross);
    const f = piasters((g * s.basicPercent) / 100);
    // the contract's allowances for its days, never below 0 (as salary.ts counts them)
    const allowances = s.allowances.map((a) => ({ taxable: a.taxable, amount: forDays(Math.max(0, a.amount), s.days) }));
    return {
      contractId: s.contractId,
      fixed: forDays(f, s.days),
      variable: forDays(piasters(g - f), s.days),
      allowances: piasters(allowances.reduce((sum, a) => sum + a.amount, 0)),
      taxable: piasters(allowances.reduce((sum, a) => sum + (a.taxable ? a.amount : 0), 0)),
    };
  });
  const sum = (pick: (p: (typeof parts)[number]) => number) => piasters(parts.reduce((total, p) => total + pick(p), 0));

  const salary =
    terms.payBasis === 'hourly'
      ? hourlyPart(terms, i, warnings)
      : // terms saved before the hours a day (or the expected hours) existed read as without a shift
        monthlyPart(
          i,
          rules,
          {
            gross,
            fixed: sum((p) => p.fixed),
            variable: sum((p) => p.variable),
            hoursPerDay: terms.hoursPerDay ?? null,
            shiftExpectedHours: terms.expectedHours ?? null,
            expectedDays: terms.expectedDays ?? null,
          },
          warnings,
        );
  // a bonus day is a day of the fixed part, also for pay by the hour (its monthly estimate's)
  const bonus = piasters((given(i.bonusDays) * fixedFull) / days);
  const commission = piasters(given(i.commission));
  const settlements = piasters(given(i.settlements));
  const earned = piasters(
    salary.fixed - salary.attendanceCut + salary.variable - salary.kpiCut - salary.noShowCut + salary.overtime + bonus + commission + settlements,
  );

  const allowancesTotal = sum((p) => p.allowances);
  const taxableAllowances = sum((p) => p.taxable);

  // social insurance (owner's decision, 16 October 2026): for those registered with it, on the insured wage the Social
  // Insurance tab shows, not prorated for a part month; none for a freelancer
  const insured = terms.statutory && terms.insured;
  const insuredWage = insured ? piasters(terms.insuredWage) : 0;
  if (insured && !(insuredWage > 0)) warnings.push('Registered with social insurance, but there is no insured wage: no insurance is deducted');
  const employeeInsurance = piasters(insuredWage * law.employeeInsuranceRate);
  const employerInsurance = piasters(insuredWage * law.employerInsuranceRate);

  // the salary tax and the Martyrs' Fund on the actual pay and the taxable allowances (owner's decision, 16 October
  // 2026: the sheet's method, without its bracket errors); none for a freelancer
  const taxedPay = piasters(earned + taxableAllowances);
  const tax = terms.statutory
    ? monthlySalaryTax({ taxedPay, employeeInsurance }, law)
    : { healthInsurance: 0, monthlyTaxable: 0, annualNetIncome: 0, annualTax: 0, monthlyTax: 0, martyrsFund: 0 };

  // after the tax: a penalty day costs a day of the contract's net (the sheet's "Original Net"), a freelancer's a day of
  // the gross, which is their net
  const penaltyDays = given(i.penaltyDays);
  const contractNet = terms.statutory ? grossToNet(gross, law).net : gross;
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
    // by the hour, the one part is the hours' pay
    parts: parts.map((p) =>
      terms.payBasis === 'hourly'
        ? { contractId: p.contractId, fixed: salary.fixed, variable: 0, allowances: p.allowances }
        : { contractId: p.contractId, fixed: p.fixed, variable: p.variable, allowances: p.allowances },
    ),
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
 * expected hours, counted as full at or above the grace percent (90). The expected hours (expectedHoursOf, owner,
 * 17 October 2026: "dont count abcent days or leave days, as they already have their own deduction and fields") are
 * HR's when typed, taken as they are, else the shift's working days less the holidays (owner's request, 16 October
 * 2026) less the no-show and leave days, a day of the shift each; without a shift, HR's figure, with a warning when
 * there are days off to leave out of it. With a KPI given, the KPI average is that attendance score and the KPIs given,
 * counted as full at or above its grace percent (80); with none, the variable part isn't cut ("fixed only"). Overtime,
 * while the rules pay it (off from 16 October 2026: "No overtime for now"), is paid on the fixed part for the days paid
 * (the expected hours are the part month's) for attendance above the overtime percent (110), at the overtime rate
 * (1.5). Worked hours above the most attendance counts (the shift's hours to work a day on its days: mostCountedHours)
 * are warned about, not cut. A no-show day costs the no-show multiplier (2) days of the gross (the sheet used the
 * declared insurance salary, empty for most), never more than the salary left for the days paid after the other cuts.
 * A leave day costs nothing.
 */
function monthlyPart(
  i: PayrollInputs,
  rules: PayrollRules,
  pay: {
    /** The gross at the month's end: what a no-show day costs days of. */
    gross: number;
    /** The fixed and variable parts for the days paid, each contract's for its days, added up. */
    fixed: number;
    variable: number;
    hoursPerDay: number | null;
    /** The shift's hours for the month, less the holidays: less the days off, the expected hours when HR typed none. */
    shiftExpectedHours: number | null;
    /** The shift's working days in the days paid, and the holidays on them: null without a shift, or by the hour. */
    expectedDays: ShiftDays | null;
  },
  warnings: string[],
): SalaryPart {
  const { fixed, variable } = pay;

  // the no-show and leave days' hours come out of the shift's hours: the no-show cut alone charges a no-show day, and
  // a leave day is paid; HR's own figure is taken as already without them
  const noShowDays = given(i.noShowDays);
  const leaveDays = given(i.leaveDays);
  const daysOff = daysOffName(noShowDays, leaveDays);
  const worked = i.workedHours;
  const shift = pay.shiftExpectedHours;
  const fromShift = i.expectedHours === null && shift !== null && shift > 0;
  const absentHours = fromShift ? shiftDaysHours(i.noShowDays, pay.hoursPerDay) : 0;
  const leaveHours = fromShift ? shiftDaysHours(i.leaveDays, pay.hoursPerDay) : 0;
  /** The expected hours attendance is measured on, as the grid shows them. */
  const expected = expectedHoursOf({ expectedHours: shift, hoursPerDay: pay.hoursPerDay }, i);
  const attendanceRatio = worked !== null && expected !== null && expected > 0 ? fraction(worked / expected) : null;
  if (worked !== null && expected === null) warnings.push("Worked hours are given without the expected hours: attendance isn't counted");
  // the shift's hours alone, without worked hours, are no reason to warn: attendance just isn't tracked yet
  if (worked === null && i.expectedHours !== null) warnings.push("Expected hours are given without the worked hours: attendance isn't counted");
  if (worked !== null && expected !== null && !(expected > 0)) {
    warnings.push(
      fromShift && daysOff
        ? `The ${daysOff}' hours are all the shift's hours this month or more: attendance isn't counted${noShowDays > 0 ? ', only the no-show cut' : ''}`
        : "The expected hours are 0: attendance isn't counted",
    );
  }
  if (daysOff && i.expectedHours !== null && shift === null) {
    warnings.push(`No shift on the employment, so the ${daysOff}' hours couldn't be taken out of the expected hours: type the expected hours without them`);
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

  // the most attendance will count (owner, 16 October 2026: "maximum working hours to be recorded per day is 9 hours
  // between checkin and check out"): the shift's hours to work a day on its working days in the days paid, less the
  // holidays and the no-show and leave days; the total typed isn't cut, only warned about
  const most = mostCountedHours(pay.expectedDays, pay.hoursPerDay, noShowDays, leaveDays);
  if (worked !== null && most !== null && pay.hoursPerDay !== null && worked > most) {
    const perDay = formatHours(pay.hoursPerDay);
    warnings.push(`Worked hours are more than ${perDay} a day on the shift's working days (${formatHours(most)} this month): attendance will count at most ${perDay} a day`);
  }

  const above = rules.overtimeAbovePercent / 100;
  return {
    fixed,
    variable,
    absentHours,
    leaveHours,
    expectedHours: expected,
    attendanceRatio,
    attendanceScore,
    kpiScore,
    attendanceCut,
    kpiCut,
    noShowCut,
    // none while the rules don't pay it (owner, 16 October 2026: "No overtime for now"); the sheet's intent: its overtime
    // column multiplied the money amount by the attendance again, not copied
    overtime:
      paysOvertime(rules) && attendanceRatio !== null && attendanceRatio > above ? piasters(fixed * (attendanceRatio - above) * rules.overtimeRate) : 0,
  };
}

/**
 * Pay by the hour: the hours worked at the contract's rate, as one amount (in `fixed`). There is no split of the gross,
 * so no attendance or KPI cuts, no overtime on the attendance ratio and no no-show cut (nor absent hours); leave days
 * don't apply either (owner, 17 October 2026): only the hours worked are paid.
 */
function hourlyPart(terms: PayrollTerms, i: PayrollInputs, warnings: string[]): SalaryPart {
  if (i.workedHours === null) warnings.push('Paid by the hour, but no worked hours are given: nothing is paid for hours');
  if (!(given(terms.hourlyRate) > 0)) warnings.push('Paid by the hour, but the contract has no hourly rate');
  if ([i.expectedHours, i.softSkills, i.performance, i.clientSatisfaction, i.noShowDays, i.leaveDays].some((v) => v !== null)) {
    warnings.push("Paid by the hour: the expected hours, KPIs, no-show days and leave days don't change the pay");
  }
  return {
    fixed: piasters(given(i.workedHours) * given(terms.hourlyRate)),
    variable: 0,
    absentHours: 0,
    leaveHours: 0,
    expectedHours: null,
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
 * The most worked hours attendance can count in a month (owner, 16 October 2026: "maximum working hours to be recorded
 * per day is 9 hours between checkin and check out"): the shift's working days in the days paid, less the holidays and
 * the no-show and leave days (none worked), × its hours to work a day. Null without the shift's days or hours (no
 * shift, pay by the hour, or a line worked out before 16 October 2026).
 */
export function mostCountedHours(
  days: ShiftDays | null | undefined,
  hoursPerDay: number | null | undefined,
  noShowDays: number | null,
  leaveDays: number | null = null,
): number | null {
  if (!days || typeof hoursPerDay !== 'number' || !(hoursPerDay > 0)) return null;
  return fraction(Math.max(0, days.workingDays - days.holidays - given(noShowDays) - given(leaveDays)) * hoursPerDay);
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
  const span = employedSpan('paidDaysIn', month, joinDate, endDate);
  return span ? paidDaysOf(month, [span], divisor)[0] : 0;
}

/**
 * The days paid for each part of a month ('YYYY-MM') under a signed contract (owner, 17 October 2026: "take into
 * consideration the start and end date of the contract if it is in the middle of the billing period"): the parts' first
 * and last days (YYYY-MM-DD) in the month, in date order and not overlapping; a day in none (between two contracts,
 * after one ends) isn't paid. The month wholly covered counts as the divisor, else its calendar days covered, at most
 * the divisor (as paidDaysIn); each part has its calendar days, in order, the last what is left: a renewal on 15
 * October is paid 14 days on the contract before it and 16 on the new one, 30 in all.
 */
export function paidDaysOf(month: string, parts: readonly { from: string; to: string }[], divisor: number): number[] {
  const span = employedSpan('paidDaysOf', month, `${month}-01`, null)!;
  let before = '';
  for (const p of parts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to) || p.from > p.to || p.from < span.first || p.to > span.last || p.from <= before) {
      throw new RangeError(`paidDaysOf: ${p.from} to ${p.to} is not a part of ${month} after the one before`);
    }
    before = p.to;
  }
  const calendar = parts.map((p) => dayNumber(p.to) - dayNumber(p.from) + 1);
  const covered = calendar.reduce((sum, n) => sum + n, 0);
  let left = covered === dayNumber(span.last) - dayNumber(span.first) + 1 ? divisor : Math.min(covered, divisor);
  return calendar.map((n, i) => {
    const paid = i === calendar.length - 1 ? left : Math.min(n, left);
    left -= paid;
    return paid;
  });
}

/**
 * The part of a month ('YYYY-MM') an employment from `joinDate` to `endDate` (YYYY-MM-DD, null while current) covers,
 * from its first to its last day employed, with the month's own first and last days; null when it doesn't touch the
 * month. Throws, naming `caller`, for a month or a date not written as one.
 */
function employedSpan(caller: string, month: string, joinDate: string, endDate: string | null): { first: string; last: string; from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RangeError(`${caller}: "${month}" is not a month (YYYY-MM)`);
  for (const date of [joinDate, endDate]) {
    if (date !== null && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) throw new RangeError(`${caller}: "${date}" is not a date (YYYY-MM-DD)`);
  }
  const first = `${month}-01`;
  const last = `${month}-${new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()}`;
  const from = joinDate > first ? joinDate : first;
  const to = endDate !== null && endDate < last ? endDate : last;
  return from > to ? null : { first, last, from, to };
}

/**
 * A shift's working days in a month ('YYYY-MM') for an employment from `joinDate` to `endDate` (YYYY-MM-DD, null while
 * current), and the official holidays (YYYY-MM-DD) that fall on them: what the month's expected hours are worked out
 * from (owner's request, 16 October 2026). `weekdays` are the shift's working days, 0 = Sunday … 6 = Saturday. Calendar
 * days, as the employment ran: someone who joined on the 12th has the shift's days from the 12th on. A holiday on a day
 * off isn't counted: it takes no hours away.
 */
export function shiftDaysIn(month: string, joinDate: string, endDate: string | null, weekdays: readonly number[], holidays: readonly string[]): ShiftDays {
  const span = employedSpan('shiftDaysIn', month, joinDate, endDate);
  if (!span) return { workingDays: 0, holidays: 0 };
  const working = new Set(weekdays);
  const off = new Set(holidays);
  const days: ShiftDays = { workingDays: 0, holidays: 0 };
  for (let n = dayNumber(span.from); n <= dayNumber(span.to); n++) {
    const day = new Date(n * 86_400_000);
    if (!working.has(day.getUTCDay())) continue;
    days.workingDays++;
    if (off.has(day.toISOString().slice(0, 10))) days.holidays++;
  }
  return days;
}

/**
 * The expected hours of a shift's days in a month: its working days less the holidays on them, × its hours a day (its
 * hours to work, else its window: shiftWorkHours).
 */
export function shiftExpectedHours(days: ShiftDays, hoursPerDay: number): number {
  return fraction(Math.max(0, days.workingDays - days.holidays) * hoursPerDay);
}
