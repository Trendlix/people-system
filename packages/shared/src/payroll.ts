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
// Additions and deductions (owner, 17 October 2026: Additions / Deductions under Payroll, one-off amounts per employee
// and month): the month's pending ones are taken with the line's terms when the run is made or refreshed (and whenever
// one changes while the run is a draft); the taxed additions are in the pay earned, so in the gross and the taxed pay,
// the untaxed ones are added after tax, and the deductions are taken after tax with the others. Lines worked out before
// then have none, and never change.
// The bonus and penalty days, the commission and the settlements (owner, 17 October 2026, on the inputs grid: "instead
// of there, i think earnings and deductions will be enough"; he chose "Yes, as proposed"): no longer typed on the run,
// but entered on Additions / Deductions with a type and a reason. A Bonus (days) is pay earned, taxed, a day of the
// fixed part ÷ the day divisor; a Penalty (days) is taken after tax, a day of the contract's net ÷ the day divisor;
// each line's days summed, so the same days pay what the grid's did (the bonus and the penalty cut), the amount shared
// out between the items by their days. A commission and a Correction are additions or deductions like the others.
// Lines saved before then with the grid's figures (a draft's were made additions and deductions) keep them, read and
// worked out again with EarlierPayrollInputs.
// The attendance deduction waived (owner, 17 October 2026: "if there is an attendance deduction, allow the CEO to wave
// the deduction by ticking a box"): while the run is with the CEO, the CEO may waive a line's attendance cut; the line
// is worked out with none, the cut it would have been kept as attendanceWaived. The no-show and KPI cuts stay as they
// are worked out, and the attendance still counts in the KPI average where the rules average it in
// (kpiAveragesAttendance): the CEO waives the money, not the measure.
// Leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): the month's approved leave from the
// Leave module fills in the Leave days (paid leave: nothing cut) and a new Unpaid leave days (unpaid leave, and the
// unpaid share of a partly paid one such as sick leave below 100%: a day of the gross ÷ the day divisor cut for each),
// both taken out of the shift's expected hours like a no-show day's; what HR types still wins (leaveDaysOf).
// Permission (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours per
// day", asked "In the system, like leave"; permissions.ts): the month's approved permission hours, within the Leave
// Setup's hours a month, count as worked: the attendance is the worked hours and the permission hours together, so
// they are never cut as short hours. The run takes them with the line's terms (PayrollTerms.permissionHours) and the
// grid shows them; what HR types (or an attendance import fills) instead wins (permissionHoursOf). None for pay by the
// hour, which pays only the hours worked.
// Deductions before tax (owner, 20 October 2026, asked whether the employee's medical share, a recurring deduction, is
// taken before or after tax: "Before Tax i think"): a Recurring deduction whose recurring deduction HR ticked "Deducted
// before tax" (PayrollAdjustmentItem.beforeTax) lowers the taxable pay before the income tax is worked out: the taxable
// pay as it was less the month's deductions before tax, never below 0, and at most a twelfth of the year's before-tax
// health insurance limit when Payroll Setup has one (law-rates.ts; salary.ts monthlySalaryTax). It is then taken from
// the net as every deduction is; social insurance (on the insured wage) and the Martyrs' Fund (on the taxed pay) don't
// change. The line keeps both (PayrollResult.beforeTaxDeductions, taxableLowered). Lines without one, and every line
// worked out before then, are as they were.
// The expected hours locked (owner, 20 October 2026, on the inputs grid's Expected hours cell: "expected hours to be
// locked based on shifts and attendance data"): always worked out, never typed: the shift's hours for the month (its
// working days in the days paid less the holidays, × its hours a day) less a day of the shift for each no-show, leave
// and unpaid leave day (expectedHoursOf). The API refuses expected hours sent with a line's inputs
// (EXPECTED_HOURS_NOT_TYPED), and those HR typed on a draft's line before then are cleared when the API starts, or
// when the CEO returns a run to HR (apps/api expected-hours.service.ts); a line with the CEO, approved or paid keeps
// what was typed, and is worked out with it as it was. Without a shift there are none, so attendance isn't counted
// (NO_SHIFT_NO_EXPECTED_HOURS); pay by the hour has none either, as before.
// Make-up hours (owner, 20 October 2026, asked "if an employee failed to complete 9 hours in a da, can he work extra
// hours next day ? to raise his average?": "within the same month with no working hours to be counted after 8 PM even if
// the check out was 11 PM / record the checkout time but count till the checkout window limit"): on a shift that counts
// hours until a time (attendance.ts makesUpHours; PayrollTerms.makeUpHours) a day counts past its hours to work, so the
// month's worked hours, summed from its days, fill the short hours of its other days worked. While the rules don't pay
// overtime the hours counted are at most the expected hours (PayrollResult.hoursOverExpected keeps what was left out),
// so making up is never overtime; the no-show and leave days are out of the expected hours already, so it never covers
// them. With overtime paid, the hours are counted as worked, uncapped, and overtime is worked out from them as before.
// Lines worked out before then, and every other shift's, are as they were; a run with the CEO, approved or paid keeps
// its terms, so its figures never change.
// Attendance out of the KPI (owner, 25 October 2026, asked whether attendance is cut twice, on the fixed part and in
// the KPI: "Fixed cut only"; kpis.ts): the short hours cut the fixed part as before (below the attendance grace, the
// CEO's waiver too) and nothing else. The scorecards are performance only from then (the KPI setting Attendance in
// the KPI, off), and the KPI average of a line with KPI inputs typed (no scorecard: the KPIs module paragraph below)
// is of those inputs alone: the rules' kpiIncludesAttendance, copied from that setting when a run is made or
// refreshed, off. Rules copied before then don't have it and read as on, so a run with the CEO, approved or paid, and
// a draft until it is refreshed, are worked out as they were.

// The KPIs module (owner, 21 October 2026: "lets start with the KPI's First"; kpis.ts): the variable part follows the
// final % of last month's scorecard ("Last month's KPI, this pay"), taken with the line's terms (PayrollTerms.kpi): at
// or above the KPI grace percent (80) it is paid in full, below it in proportion ("As the sheet: full at 80%+"), and with
// no final scorecard it isn't cut. The scorecard has the month's attendance in it already (its Attendance metric), so it
// isn't averaged with the attendance again. Lines made before then keep their KPI inputs and are worked out as they were;
// pay by the hour has no KPI cut, as before.

import type { PayrollAccountShare } from './client-accounts.js';
import type { AllowanceTerms } from './contracts.js';
import { kpiPayScore, type PayrollKpi } from './kpis.js';
import { adjustmentSums, DAYS_TYPE_OF, isDaysType, mayBeBeforeTax, sumAmounts, type AdjustmentKind, type AdjustmentType } from './payroll-adjustments.js';
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
  /**
   * Whether social insurance is deducted, and the company's share counted, for everyone under the labour law, registered
   * with it or not (owner, 26 October 2026: "when calculating the payroll for now, calculate as if the employee is
   * insured, no matter he is registered or not"; "till i adjust my system dont connect them togeather"). Off: only those
   * registered (Employee.socialInsured), as before. Missing on the rules runs copied before then, which deducted for
   * those registered alone: read as off (insuresEveryone), so their figures never change.
   */
  insureEveryone?: boolean;
  /** Overtime is paid for attendance above this percent (the sheet: 110), when it is paid. */
  overtimeAbovePercent: number;
  /** Overtime is paid at this rate (the sheet: 1.5). */
  overtimeRate: number;
  /** A no-show day costs this many days' pay (the sheet: 2); its hours aren't counted again in attendance. */
  noShowDayMultiplier: number;
  /**
   * Whether the KPI average of a line with KPI inputs typed (no scorecard) takes the attendance score in, as the sheet
   * did (owner, 25 October 2026: "Fixed cut only"): copied from the KPI setting Attendance in the KPI when a run is
   * made or refreshed, off from then, so the average is of the KPI inputs alone and attendance is cut on the fixed part
   * only. Missing on the rules runs copied before then, which averaged it in: read as on (kpiAveragesAttendance), so
   * their figures never change. Not a Payroll Setup field: the KPI setting is its only source.
   */
  kpiIncludesAttendance?: boolean;
}

export const PAYROLL_RULE_DEFAULTS: Required<PayrollRules> = {
  dayDivisor: 30,
  attendanceGracePercent: 90,
  kpiGracePercent: 80,
  // off from 16 October 2026 ("No overtime for now")
  payOvertime: false,
  // on from 26 October 2026 ("calculate as if the employee is insured, no matter he is registered or not")
  insureEveryone: true,
  overtimeAbovePercent: 110,
  overtimeRate: 1.5,
  noShowDayMultiplier: 2,
  // off from 25 October 2026 ("Fixed cut only")
  kpiIncludesAttendance: false,
};

/**
 * Whether rules average the attendance score into the KPI inputs typed on a line: as their switch says; rules copied
 * onto a run before the switch existed (25 October 2026) did, so a missing switch reads as on.
 */
export const kpiAveragesAttendance = (rules: PayrollRules): boolean => rules.kpiIncludesAttendance !== false;

/** Whether rules insure everyone under the labour law: only as their switch says on; a missing one reads as off. */
export const insuresEveryone = (rules: Pick<PayrollRules, 'insureEveryone'>): boolean => rules.insureEveryone === true;

/**
 * Whether rules pay overtime: as their switch says; rules copied onto a run before the switch existed (16 October 2026)
 * paid it, so a missing switch reads as on and those runs' figures never change.
 */
export const paysOvertime = (rules: PayrollRules): boolean => rules.payOvertime !== false;

/** An allowance on a payroll line: the contract's, by name. */
export interface PayrollAllowance extends AllowanceTerms {
  name: string;
  /**
   * The accounts allowance (owner, 25 October 2026: a per-account allowance, "By days"): the month's client accounts it
   * was worked out from, its amount their sum already for the days held, so paid as it is, never for the days paid
   * again. Missing on every other allowance.
   */
  accounts?: PayrollAccountShare[];
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
  /**
   * Insured on the run: registered with social insurance (Employee.socialInsured), or counted as insured while the rules
   * insure everyone (insureEveryone), the line then saying so with notRegistered.
   */
  insured: boolean;
  /** Counted as insured though not registered yet (owner, 26 October 2026): set only when the rules insure everyone. */
  notRegistered?: boolean;
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
   * else its window: hoursPerDay). Less the no-show and leave days, they are the expected hours (expectedHoursOf):
   * always since 20 October 2026, when they stopped being typed; before then, when HR hadn't typed others. Null without
   * a shift, and for pay by the hour; missing on lines worked out before then.
   */
  expectedHours?: number | null;
  /** What the shift's hours were worked out from: its working days in the days paid, and the holidays on them. */
  expectedDays?: ShiftDays | null;
  /**
   * The shift counts hours until a time (owner, 20 October 2026: "within the same month with no working hours to be
   * counted after 8 PM"; attendance.ts makesUpHours): a day counts past its hours to work, filling short hours on the
   * month's other days, and while overtime isn't paid the hours counted are at most the expected hours. Monthly pay
   * only; missing on every other line, and on lines made before then.
   */
  makeUpHours?: boolean;
  /**
   * The month's additions and deductions on the line (owner, 17 October 2026: Additions / Deductions), as they were
   * when the run took them, in the order entered. Missing on lines without any, and on lines worked out before then.
   */
  adjustments?: PayrollAdjustmentItem[];
  /**
   * The month's approved leave (owner, 18 October 2026: "can you apply the leaves according to the law?"), within the
   * days paid, counted as each type counts them (leaves.ts monthLeaveDays): the paid days, and the unpaid days (unpaid
   * leave, and a partly paid leave's unpaid share). The Leave days and the Unpaid leave days the grid fills in when HR
   * hasn't typed others (leaveDaysOf). Missing on lines without leave, for pay by the hour, and on lines made before then.
   */
  leave?: PayrollLeaveDays | null;
  /**
   * The month's approved permission hours (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day",
   * counted as worked): those on days paid, at most the Leave Setup's hours a month (permissions.ts
   * monthPermissionHours). What the grid's Permission hours are filled in with when HR hasn't typed others
   * (permissionHoursOf). Missing on lines without any, for pay by the hour, and on lines made before then.
   */
  permissionHours?: number | null;
  /**
   * The KPI the variable part follows (owner, 21 October 2026: "Last month's KPI, this pay"; "As the sheet: full at
   * 80%+"): the final scorecard of the month before the payroll's (kpis.ts PayrollKpi), taken when the run is made or
   * refreshed; null: none is final, so the variable part isn't cut. Missing on lines made before the KPIs module, which
   * keep their KPI inputs (soft skills, performance, client satisfaction) as they were.
   */
  kpi?: PayrollKpi | null;
  /**
   * The client accounts held in the month while no contract of the month has a per-account allowance (owner's brief, 25
   * October 2026: "nothing otherwise, with a draft warning"): how many, nothing paid for them. Missing otherwise.
   */
  accountsWithoutAllowance?: number;
}

/** A month's approved leave as a line's terms keep it: the paid days and the unpaid days, whole, half or in shares. */
export interface PayrollLeaveDays {
  paidDays: number;
  unpaidDays: number;
}

/** An addition or deduction as a line keeps it: what it is, whether it is taxed, the amount (or the days) and why. */
export interface PayrollAdjustmentItem {
  /** The PayrollAdjustment's id: applied to the line when the CEO approves the run. */
  id: string;
  kind: AdjustmentKind;
  type: AdjustmentType;
  taxed: boolean;
  /**
   * EGP. Null for a Bonus (days) or a Penalty (days) (owner, 17 October 2026): the run works it out (payrollLine), and
   * the line keeps what it came to with its result (PayrollResult.adjustments).
   */
  amount: number | null;
  /** A Bonus (days) or a Penalty (days): its days, whole or half. Missing for the others. */
  days?: number;
  reason: string;
  /**
   * A Recurring deduction whose recurring deduction HR ticked "Deducted before tax" (owner, 20 October 2026: "Before
   * Tax i think"): true, and it lowers the taxable pay before the income tax. Missing on every other item, and on items
   * taken before then: after tax.
   */
  beforeTax?: boolean;
}

/** An addition or deduction as a line paid it: a Bonus (days)'s or a Penalty (days)'s amount worked out. */
export type PaidAdjustment = Omit<PayrollAdjustmentItem, 'amount'> & { amount: number };

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
   * The month's expected hours as HR typed them before 20 October 2026, taken as they are: already without the no-show
   * and leave days, which have their own fields (owner, 17 October 2026: "dont count abcent days or leave days, as they
   * already have their own deduction and fields"); until then a no-show day's hours came out of them. Never typed since
   * (owner, 20 October 2026: "expected hours to be locked based on shifts and attendance data"): null on every draft's
   * line, the API refusing any sent (EXPECTED_HOURS_NOT_TYPED), so the expected hours are the shift's less those days
   * (expectedHoursOf); kept only on the lines of runs with the CEO, approved or paid that were saved with them.
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
  /**
   * Unpaid leave taken this month (owner, 18 October 2026, the Leave module), and the unpaid share of a partly paid
   * leave (sick leave at 75%: a quarter of each day): each costs a day of the gross ÷ the day divisor, never more than
   * the salary left, and its hours (a day of the shift each) are taken out of the shift's expected hours, as a leave
   * day's are. Filled in from the approved leave unless HR types it (leaveDaysOf). Not for pay by the hour. Missing on
   * inputs saved before then: none.
   */
  unpaidLeaveDays?: number | null;
  /**
   * The month's permission hours (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day"): added to
   * the worked hours for the attendance, so they are never cut as short hours. Filled in from the approved permission
   * requests (PayrollTerms.permissionHours) unless HR types them, or an attendance import fills them; at most the Leave
   * Setup's hours a month (the API refuses more). Not for pay by the hour. Missing on inputs saved before then: none.
   */
  permissionHours?: number | null;
  /** Already paid out this month: not in the bank transfer. */
  released: number | null;
  /**
   * The CEO waived the attendance deduction (owner, 17 October 2026: "if there is an attendance deduction, allow the
   * CEO to wave the deduction by ticking a box"): ticked while the run is with the CEO, never typed by HR; the line is
   * worked out without the attendance cut. Missing on inputs saved before then: not waived.
   */
  attendanceWaived: boolean;
}

export const EMPTY_PAYROLL_INPUTS: PayrollInputs = {
  workedHours: null,
  expectedHours: null,
  softSkills: null,
  performance: null,
  clientSatisfaction: null,
  noShowDays: null,
  leaveDays: null,
  unpaidLeaveDays: null,
  permissionHours: null,
  released: null,
  attendanceWaived: false,
};

/**
 * The inputs typed on the grid until 17 October 2026, when they went to Additions / Deductions (owner: "instead of
 * there, i think earnings and deductions will be enough"): kept on the lines approved before then, which are read as
 * they were; a draft's were made pending additions and deductions (apps/api grid-inputs.service.ts).
 */
export interface EarlierPayrollInputs {
  penaltyDays?: number | null;
  bonusDays?: number | null;
  commission?: number | null;
  /** One-off amounts in the gross, such as last month's corrections; may be negative. */
  settlements?: number | null;
}

/** The inputs a line was saved with, those since taken off the grid included (EarlierPayrollInputs). */
export type SavedPayrollInputs = PayrollInputs & EarlierPayrollInputs;

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
   * The expected hours attendance is measured on, as the grid shows them (expectedHoursOf, 17 October 2026): the shift's
   * less the no-show and leave days (HR's, on a line saved with them before 20 October 2026, when they stopped being
   * typed); null without either, and for pay by the hour. Missing on lines worked out before 17 October 2026
   * (measuredExpectedHours).
   */
  expectedHours: number | null;
  /**
   * The permission hours counted as worked (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per
   * day"), added to the worked hours for the attendance ratio: missing without any, when attendance isn't tracked (no
   * worked hours given), for pay by the hour, and on lines worked out before then.
   */
  permissionHours?: number;
  /**
   * The worked hours (with the permission hours) above the expected hours that weren't counted (owner, 20 October 2026:
   * make-up hours): a shift that counts hours until a time, while the rules don't pay overtime, counts at most the
   * expected hours, so extra time only fills short hours. Missing otherwise, and on lines worked out before then.
   */
  hoursOverExpected?: number;
  /** Worked (with the permission hours) ÷ expected hours; null when attendance isn't tracked or can't be counted. */
  attendanceRatio: number | null;
  /** The attendance that counts (1 at or above the grace percent). */
  attendanceScore: number;
  /** The KPI average that counts (1 at or above the grace percent, and with no KPI given). */
  kpiScore: number;
  attendanceCut: number;
  kpiCut: number;
  noShowCut: number;
  /**
   * The unpaid leave days' cut (owner, 18 October 2026): a day of the gross ÷ the day divisor for each, never more than
   * the salary left after the other cuts. Missing on lines worked out before then: none.
   */
  unpaidLeaveCut?: number;
  /**
   * The attendance cut the CEO waived (owner, 17 October 2026: "if there is an attendance deduction, allow the CEO to
   * wave the deduction by ticking a box"): what attendanceCut would have been, now 0; 0 when not waived. Missing on lines
   * worked out before then: none waived.
   */
  attendanceWaived?: number;
  overtime: number;
  /**
   * The bonus days' pay, a day of the fixed part each: since 17 October 2026 the Bonus (days) additions' days summed,
   * before then the bonus days typed on the grid.
   */
  bonus: number;
  /**
   * The commission and the settlements typed on the grid, in the pay earned: on lines worked out before 17 October
   * 2026 only. Since then a commission is an addition and a settlement a Correction (additionsTaxed, adjustmentDeductions).
   */
  commission?: number;
  settlements?: number;
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
  /**
   * The penalty days' cut, after tax, a day of the contract's net each: since 17 October 2026 the Penalty (days)
   * deductions' days summed, before then the penalty days typed on the grid.
   */
  penaltyCut: number;
  /** All the employee's deductions: insurance, tax, Martyrs' Fund, penalties, the month's deductions (after tax). */
  deductions: number;
  net: number;
  released: number;
  /** What the bank pays: the net less what was already paid out. */
  transfer: number;
  /** What the employee costs the company this month: earned, allowances, untaxed additions and the company's insurance share. */
  companyCost: number;
  /**
   * The month's additions and deductions (owner, 17 October 2026): the taxed additions, in the pay earned; the untaxed
   * ones, added after tax; the deductions, in the deductions after tax. A Bonus (days) is in `bonus` and a Penalty
   * (days) in `penaltyCut` instead. Missing on lines worked out before then: none.
   */
  additionsTaxed?: number;
  additionsUntaxed?: number;
  adjustmentDeductions?: number;
  /**
   * The month's deductions before tax (owner, 20 October 2026, on the employee's medical share: "Before Tax i think"):
   * the Recurring deductions ticked "Deducted before tax", summed; they are in adjustmentDeductions too, as they are
   * taken from the net as every deduction is. Missing on a line without any, and on lines worked out before then.
   */
  beforeTaxDeductions?: number;
  /**
   * What they lowered the taxable pay by before the income tax was worked out: as much as they are, but never taking the
   * taxable pay below 0 and at most a twelfth of the year's before-tax health insurance limit when one is set; 0 for a
   * freelancer, who pays no tax. Missing with beforeTaxDeductions.
   */
  taxableLowered?: number;
  /**
   * The month's additions and deductions as paid, in the order entered, a Bonus (days)'s and a Penalty (days)'s amount
   * worked out (their days' share of `bonus` and `penaltyCut`): the line's record of what each came to. Missing on a
   * line without any, and on lines worked out before 17 October 2026, whose terms have every amount (paidAdjustments).
   */
  adjustments?: PaidAdjustment[];
  /** Plain-English notes for HR, e.g. "Paid for 19 of 30 days: employed or under contract for part of the month". */
  warnings: string[];
}

/** A result's additions and deductions, 0 on a line worked out before they existed (17 October 2026). */
export function resultAdjustments(r: Pick<PayrollResult, 'additionsTaxed' | 'additionsUntaxed' | 'adjustmentDeductions'>): {
  taxed: number;
  untaxed: number;
  deductions: number;
} {
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { taxed: n(r.additionsTaxed), untaxed: n(r.additionsUntaxed), deductions: n(r.adjustmentDeductions) };
}

/**
 * A result's deductions before tax (owner, 20 October 2026: "Before Tax i think") and what they lowered the taxable pay
 * by; 0 on a line without any, and on lines worked out before then.
 */
export function resultBeforeTax(r: Pick<PayrollResult, 'beforeTaxDeductions' | 'taxableLowered'>): { deductions: number; lowered: number } {
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { deductions: n(r.beforeTaxDeductions), lowered: n(r.taxableLowered) };
}

/** Whether an item is taken before tax: a Recurring deduction ticked so (20 October 2026). */
export const isBeforeTax = (a: Pick<PayrollAdjustmentItem, 'kind' | 'type' | 'beforeTax'>): boolean => a.beforeTax === true && mayBeBeforeTax(a.kind, a.type);

/**
 * A line's additions and deductions as paid (owner, 17 October 2026), in the order entered: its result's record since
 * the days types, else its terms' (every amount given then). None without any.
 */
export function paidAdjustments(line: { terms: Pick<PayrollTerms, 'adjustments'>; result: Pick<PayrollResult, 'adjustments'> }): PaidAdjustment[] {
  if (line.result.adjustments) return line.result.adjustments;
  return (line.terms.adjustments ?? []).map((a) => ({ ...a, amount: a.amount ?? 0 }));
}

/**
 * A line's bonus and penalty days: its Bonus (days) and Penalty (days)' days summed (owner, 17 October 2026), and on a
 * line approved before then, those typed on the grid.
 */
export function lineDays(line: { terms: Pick<PayrollTerms, 'adjustments'>; inputs: EarlierPayrollInputs }): { bonusDays: number; penaltyDays: number } {
  const items = line.terms.adjustments ?? [];
  return {
    bonusDays: fraction(daysOf(items, 'addition') + (line.inputs.bonusDays ?? 0)),
    penaltyDays: fraction(daysOf(items, 'deduction') + (line.inputs.penaltyDays ?? 0)),
  };
}

/** The days of a kind's days type among the items (Bonus (days) for the additions, Penalty (days) for the deductions). */
function daysOf(items: readonly Pick<PayrollAdjustmentItem, 'kind' | 'type' | 'days'>[], kind: AdjustmentKind): number {
  const type = DAYS_TYPE_OF[kind];
  return fraction(items.filter((a) => a.kind === kind && a.type === type).reduce((sum, a) => sum + (a.days ?? 0), 0));
}

/**
 * A total shared out between items by their days, to the piaster, the last taking what rounding leaves, so they add up
 * to it: a Bonus (days)'s share of the bonus, a Penalty (days)'s of the penalty cut.
 */
function byDays(total: number, days: readonly number[]): number[] {
  const all = days.reduce((sum, d) => sum + d, 0);
  let left = total;
  return days.map((d, n) => {
    if (n === days.length - 1) return piasters(left);
    const part = all > 0 ? piasters((total * d) / all) : 0;
    left = piasters(left - part);
    return part;
  });
}

/**
 * The items as a line pays them: each with its amount, a Bonus (days)'s and a Penalty (days)'s their share of the bonus
 * and the penalty cut by their days (with the grid's days of a line saved before 17 October 2026, which keep theirs).
 */
function paidItems(items: readonly PayrollAdjustmentItem[], totals: { bonus: number; penaltyCut: number }, earlier: EarlierFigures): PaidAdjustment[] {
  const shares = new Map<string, number>();
  for (const [kind, total, typed] of [
    ['addition', totals.bonus, earlier.bonusDays],
    ['deduction', totals.penaltyCut, earlier.penaltyDays],
  ] as const) {
    const inDays = items.filter((a) => a.kind === kind && a.type === DAYS_TYPE_OF[kind]);
    byDays(total, [...inDays.map((a) => a.days ?? 0), ...(typed > 0 ? [typed] : [])])
      .slice(0, inDays.length)
      .forEach((amount, n) => shares.set(inDays[n].id, amount));
  }
  return items.map((a) => ({ ...a, amount: shares.get(a.id) ?? piasters(a.amount ?? 0) }));
}

/** The grid's figures a line was saved with before 17 October 2026 (EarlierPayrollInputs), as numbers. */
interface EarlierFigures {
  /** Saved with them (every line saved before then has them, if only as not given). */
  saved: boolean;
  bonusDays: number;
  penaltyDays: number;
  commission: number;
  settlements: number;
}

function earlierFigures(inputs: PayrollInputs): EarlierFigures {
  const e = inputs as SavedPayrollInputs;
  const keys = ['bonusDays', 'penaltyDays', 'commission', 'settlements'] as const;
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { saved: keys.some((k) => k in e), bonusDays: n(e.bonusDays), penaltyDays: n(e.penaltyDays), commission: n(e.commission), settlements: n(e.settlements) };
}

/** Half-up to the piaster, as salary.ts rounds (+ 0 turns a −0 into 0). */
const piasters = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100 + 0;

/** A ratio without the noise of the division or the sum, so that 80% compares as 80% with the grace percent. */
const fraction = (v: number) => Math.round(v * 1e10) / 1e10;

/** An input not given counts as 0. */
const given = (v: number | null) => v ?? 0;

/** The salary part of a line before the month's additions and deductions. */
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
> & { attendanceWaived: number; unpaidLeaveCut: number; permissionHours?: number; hoursOverExpected?: number };

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
 * Why a line's expected hours can't be typed (owner, 20 October 2026: "expected hours to be locked based on shifts and
 * attendance data"): what the API answers expected hours sent with a line's inputs (400).
 */
export const EXPECTED_HOURS_NOT_TYPED = "Expected hours are worked out from the shift, the holidays, leave and absent days; they can't be typed.";

/**
 * Why a monthly-paid line with worked hours has no attendance when its employment has no shift (owner, 20 October 2026:
 * the expected hours are worked out from the shift, never typed): nothing to measure the hours on.
 */
export const NO_SHIFT_NO_EXPECTED_HOURS =
  "No shift on the employment, so there are no expected hours and attendance isn't counted: set the shift on the Employment tab, then refresh the run";

/**
 * The expected hours a line is worked out with, as the inputs grid shows them (owner, 17 October 2026: "prefill the
 * expected hours, and dont count abcent days or leave days, as they already have their own deduction and fields"): the
 * shift's hours for the month less a day of the shift for each no-show and leave day, never below 0; null without the
 * shift's hours. Never typed since 20 October 2026 (owner: "expected hours to be locked based on shifts and attendance
 * data"); a line saved before then with HR's figure (with the CEO, approved or paid) is worked out with it as it was,
 * taken as already without the no-show and leave days.
 */
export function expectedHoursOf(
  terms: Pick<PayrollTerms, 'expectedHours' | 'hoursPerDay' | 'leave'>,
  inputs: Pick<PayrollInputs, 'expectedHours' | 'noShowDays' | 'leaveDays' | 'unpaidLeaveDays'>,
): number | null {
  if (inputs.expectedHours !== null && inputs.expectedHours !== undefined) return inputs.expectedHours;
  const shift = terms.expectedHours;
  if (shift === null || shift === undefined) return null;
  const leave = leaveDaysOf(terms, inputs);
  const off =
    shiftDaysHours(inputs.noShowDays, terms.hoursPerDay) + shiftDaysHours(leave.leaveDays, terms.hoursPerDay) + shiftDaysHours(leave.unpaidLeaveDays, terms.hoursPerDay);
  return Math.max(0, fraction(shift - off));
}

/**
 * The leave days a line is worked out with (owner, 18 October 2026: the Leave module fills in the leave days): as HR
 * typed them, else the month's approved leave the terms took (paid, and unpaid with a partly paid leave's unpaid
 * share); null when neither. What HR types is never overwritten.
 */
export function leaveDaysOf(
  terms: Pick<PayrollTerms, 'leave'>,
  inputs: Pick<PayrollInputs, 'leaveDays' | 'unpaidLeaveDays'>,
): { leaveDays: number | null; unpaidLeaveDays: number | null } {
  const typed = (v: number | null | undefined) => (v === null || v === undefined ? null : v);
  const leave = terms.leave ?? null;
  return {
    leaveDays: typed(inputs.leaveDays) ?? (leave && leave.paidDays > 0 ? leave.paidDays : null),
    unpaidLeaveDays: typed(inputs.unpaidLeaveDays) ?? (leave && leave.unpaidDays > 0 ? leave.unpaidDays : null),
  };
}

/**
 * The permission hours a line is worked out with (owner, 19 October 2026: counted as worked): as HR typed them (or an
 * attendance import filled them), else the month's approved permission hours the terms took; null when neither. What
 * HR types is never overwritten.
 */
export function permissionHoursOf(terms: Pick<PayrollTerms, 'permissionHours'>, inputs: Pick<PayrollInputs, 'permissionHours'>): number | null {
  const typed = inputs.permissionHours;
  if (typed !== null && typed !== undefined) return typed;
  const taken = terms.permissionHours;
  return typeof taken === 'number' && taken > 0 ? taken : null;
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
 * not at all with no KPI given; the attendance cut is 0 when the CEO waived it (17 October 2026). By the hour: the hours
 * worked at the contract's rate. Then for both: the month's additions and deductions (17 October 2026), a Bonus (days)
 * at a day of the fixed part and the other taxed additions in the pay earned; the allowances for the days paid; social
 * insurance on the insured wage, whole for a part month; the salary tax and the Martyrs' Fund on the actual pay; a
 * Penalty (days) at a day of the contract's net and the other deductions after the tax, the untaxed additions after
 * them; a Recurring deduction ticked before tax (20 October 2026) lowers the taxable pay first, within the year's
 * limit, and is taken with them. The insurance shares, the tax and the Fund follow `law`, the rates set by law the run
 * keeps (owner's request, 16 October 2026); without them, the built-in ones of the run's year.
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
  // client accounts held without a per-account allowance on the month's contracts (25 October 2026): nothing paid for them
  const unpaid = terms.accountsWithoutAllowance ?? 0;
  if (unpaid > 0) {
    warnings.push(`Holds ${unpaid} client ${unpaid === 1 ? 'account' : 'accounts'} this month, but the contract has no per-account allowance: nothing is paid for ${unpaid === 1 ? 'it' : 'them'}`);
  }

  // the contract at the month's end: its gross for the no-show and bonus days and the penalty days' net
  const gross = piasters(terms.gross);
  const fixedFull = piasters((gross * terms.basicPercent) / 100);
  // a penalty day costs a day of the contract's net (the sheet's "Original Net"), a freelancer's a day of the gross,
  // which is their net
  const contractNet = terms.statutory ? grossToNet(gross, law).net : gross;
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
    // the contract's allowances for its days, never below 0 (as salary.ts counts them); the accounts allowance (25
    // October 2026) as it is, already for the days each account was held
    const allowances = s.allowances.map((a) => ({ taxable: a.taxable, amount: a.accounts ? piasters(Math.max(0, a.amount)) : forDays(Math.max(0, a.amount), s.days) }));
    return {
      contractId: s.contractId,
      fixed: forDays(f, s.days),
      variable: forDays(piasters(g - f), s.days),
      allowances: piasters(allowances.reduce((sum, a) => sum + a.amount, 0)),
      taxable: piasters(allowances.reduce((sum, a) => sum + (a.taxable ? a.amount : 0), 0)),
    };
  });
  const sum = (pick: (p: (typeof parts)[number]) => number) => piasters(parts.reduce((total, p) => total + pick(p), 0));

  // the leave days as the grid shows them (owner, 18 October 2026): HR's, else the month's approved leave's
  const leave = leaveDaysOf(terms, i);
  const salary =
    terms.payBasis === 'hourly'
      ? hourlyPart(terms, i, warnings)
      : // terms saved before the hours a day (or the expected hours) existed read as without a shift
        monthlyPart(
          { ...i, ...leave },
          rules,
          {
            gross,
            fixed: sum((p) => p.fixed),
            variable: sum((p) => p.variable),
            hoursPerDay: terms.hoursPerDay ?? null,
            shiftExpectedHours: terms.expectedHours ?? null,
            expectedDays: terms.expectedDays ?? null,
            // the month's permission hours, counted as worked (owner, 19 October 2026)
            permissionHours: permissionHoursOf(terms, i),
            // a long day fills the month's short hours (owner, 20 October 2026)
            makeUpHours: terms.makeUpHours === true,
            // last month's final scorecard (owner, 21 October 2026); missing on lines made before the KPIs module
            ...(terms.kpi !== undefined && { kpi: terms.kpi }),
          },
          warnings,
        );
  // the month's additions and deductions (owner, 17 October 2026), in days or amounts: a line's days summed, so the
  // same days pay what the grid's did. A bonus day is a day of the fixed part, also for pay by the hour (its monthly
  // estimate's); a penalty day a day of the contract's net, taken after the tax. A line saved before then with the
  // grid's figures (with the CEO then, approved or paid: a draft's were made additions and deductions) is worked out
  // with them as it was, so working it out again (the CEO's waiver) pays what it did
  const earlier = earlierFigures(inputs);
  const items = terms.adjustments ?? [];
  const bonusDays = fraction(daysOf(items, 'addition') + earlier.bonusDays);
  const penaltyDays = fraction(daysOf(items, 'deduction') + earlier.penaltyDays);
  const bonus = piasters((bonusDays * fixedFull) / days);
  const penaltyCut = penaltyDays ? piasters((penaltyDays * contractNet) / days) : 0;
  const commission = piasters(earlier.commission);
  const settlements = piasters(earlier.settlements);
  const paid = paidItems(items, { bonus, penaltyCut }, earlier);
  // the others by their amounts: the taxed additions are pay earned
  const adjustments = adjustmentSums(paid.filter((a) => !isDaysType(a.type)).map((a) => ({ ...a, status: 'pending' as const })));
  const additionsTaxed = adjustments.taxedAdditions;
  const earned = piasters(
    salary.fixed -
      salary.attendanceCut +
      salary.variable -
      salary.kpiCut -
      salary.noShowCut -
      salary.unpaidLeaveCut +
      salary.overtime +
      bonus +
      commission +
      settlements +
      additionsTaxed,
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
  // 2026: the sheet's method, without its bracket errors); none for a freelancer. The month's deductions before tax
  // (owner, 20 October 2026, on the employee's medical share: "Before Tax i think") lower the taxable pay first, never
  // below 0 and within the year's before-tax health insurance limit when set (monthlySalaryTax)
  const taxedPay = piasters(earned + taxableAllowances);
  const beforeTaxDeductions = sumAmounts(paid.filter((a) => isBeforeTax(a) && !isDaysType(a.type)).map((a) => a.amount));
  const beforeTax = beforeTaxDeductions > 0 ? { beforeTax: beforeTaxDeductions } : {};
  const tax: ReturnType<typeof monthlySalaryTax> = terms.statutory
    ? monthlySalaryTax({ taxedPay, employeeInsurance, ...beforeTax }, law)
    : { healthInsurance: 0, monthlyTaxable: 0, annualNetIncome: 0, annualTax: 0, monthlyTax: 0, martyrsFund: 0 };

  // comprehensive health insurance is 0 while it doesn't apply in Cairo; it is in the deductions so the net stays right;
  // the month's deductions (17 October 2026) are taken after tax with the others, its untaxed additions added after it;
  // those before tax (20 October 2026) are taken from the net with them, having lowered the tax
  const adjustmentDeductions = adjustments.deductions;
  const additionsUntaxed = adjustments.untaxedAdditions;
  const deductions = piasters(employeeInsurance + tax.healthInsurance + tax.monthlyTax + tax.martyrsFund + penaltyCut + adjustmentDeductions);
  const net = piasters(earned + allowancesTotal + additionsUntaxed - deductions);
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
    // the grid's, on a line saved with them (before 17 October 2026)
    ...(earlier.saved ? { commission, settlements } : {}),
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
    // what the employee costs the company: their untaxed additions too
    companyCost: piasters(earned + allowancesTotal + additionsUntaxed + employerInsurance),
    additionsTaxed,
    additionsUntaxed,
    adjustmentDeductions,
    // only on a line with deductions before tax (20 October 2026), so every other line reads as it did
    ...(beforeTaxDeductions > 0 ? { beforeTaxDeductions, taxableLowered: tax.beforeTax ?? 0 } : {}),
    ...(paid.length ? { adjustments: paid } : {}),
    warnings,
  };
}

/**
 * A monthly salary for the days paid, with the cuts and the overtime the owner's sheet works out (its formula errors
 * fixed), and its no-show days charged once (owner's decisions, 16 October 2026). Attendance is the worked hours, with
 * the month's permission hours (owner, 19 October 2026: counted as worked), ÷ the expected hours, counted as full at or
 * above the grace percent (90). The expected hours (expectedHoursOf, owner,
 * 17 October 2026: "dont count abcent days or leave days, as they already have their own deduction and fields") are
 * the shift's working days less the holidays (owner's request, 16 October 2026) less the no-show and leave days, a day
 * of the shift each; never typed since 20 October 2026 (owner: "expected hours to be locked based on shifts and
 * attendance data"), so without a shift there are none and attendance isn't counted, with a warning saying so. A line
 * saved before then with HR's figure is worked out with it, taken as it is (without a shift, with a warning when there
 * are days off to leave out of it). With a KPI given, the KPI average is that attendance score and the KPIs given (the
 * KPIs given alone where the rules don't average attendance in: 25 October 2026, "Fixed cut only"), counted as full at
 * or above its grace percent (80); with none, the variable part isn't cut ("fixed only"). Overtime,
 * while the rules pay it (off from 16 October 2026: "No overtime for now"), is paid on the fixed part for the days paid
 * (the expected hours are the part month's) for attendance above the overtime percent (110), at the overtime rate
 * (1.5). Worked hours above the most attendance counts (the shift's hours to work a day on its days: mostCountedHours)
 * are warned about, not cut. On a shift that counts hours until a time (owner, 20 October 2026: "within the same month";
 * makeUpHours) a day counts past its hours, so there is no such warning: a long day fills the month's short hours, and
 * while overtime isn't paid the hours counted are at most the expected hours (the rest kept as hoursOverExpected); paid,
 * they count uncapped. A no-show day costs the no-show multiplier (2) days of the gross (the sheet used the
 * declared insurance salary, empty for most), never more than the salary left for the days paid after the other cuts.
 * A paid leave day costs nothing; an unpaid leave day (owner, 18 October 2026) a day of the gross, never more than the
 * salary the no-show cut leaves. The attendance cut the CEO waived (owner, 17 October 2026) is 0, kept as attendanceWaived;
 * the other cuts are as without the waiver.
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
    /** The month's permission hours (permissionHoursOf): counted as worked (owner, 19 October 2026). */
    permissionHours?: number | null;
    /** The shift counts hours until a time (PayrollTerms.makeUpHours, 20 October 2026). */
    makeUpHours?: boolean;
    /**
     * Last month's final scorecard (PayrollTerms.kpi, 21 October 2026): null when none is final (not cut); missing on a
     * line made before the KPIs module, worked out with its KPI inputs.
     */
    kpi?: PayrollKpi | null;
  },
  warnings: string[],
): SalaryPart {
  const { fixed, variable } = pay;

  // the no-show and leave days' hours come out of the shift's hours: the no-show cut alone charges a no-show day, and
  // a leave day is paid; HR's own figure is taken as already without them
  const noShowDays = given(i.noShowDays);
  const leaveDays = given(i.leaveDays);
  // unpaid leave and the unpaid share of a partly paid one (owner, 18 October 2026): days off like the paid leave's
  const unpaidLeaveDays = given(i.unpaidLeaveDays ?? null);
  const daysOff = daysOffName(noShowDays, leaveDays + unpaidLeaveDays);
  // the permission hours count as worked (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day"),
  // so they are never cut as short hours; only once there are worked hours to add them to (attendance tracked)
  const permission = i.workedHours !== null && typeof pay.permissionHours === 'number' && pay.permissionHours > 0 ? pay.permissionHours : 0;
  const workedAll = i.workedHours === null ? null : fraction(i.workedHours + permission);
  const shift = pay.shiftExpectedHours;
  const fromShift = i.expectedHours === null && shift !== null && shift > 0;
  const absentHours = fromShift ? shiftDaysHours(i.noShowDays, pay.hoursPerDay) : 0;
  const leaveHours = fromShift ? fraction(shiftDaysHours(i.leaveDays, pay.hoursPerDay) + shiftDaysHours(i.unpaidLeaveDays, pay.hoursPerDay)) : 0;
  /** The expected hours attendance is measured on, as the grid shows them. */
  const expected = expectedHoursOf({ expectedHours: shift, hoursPerDay: pay.hoursPerDay }, i);
  // make-up hours (owner, 20 October 2026: "within the same month"): a long day's hours fill the month's short ones, at
  // most up to the expected hours (without the no-show and leave days) while overtime isn't paid; paid, uncapped
  const capped = pay.makeUpHours === true && !paysOvertime(rules) && workedAll !== null && expected !== null && expected > 0 && workedAll > expected;
  const worked = capped ? expected : workedAll;
  const hoursOverExpected = capped ? fraction(workedAll - expected) : 0;
  const attendanceRatio = worked !== null && expected !== null && expected > 0 ? fraction(worked / expected) : null;
  // without a shift (no hours a day) there are none to measure the hours on, as they are never typed (owner, 20 October
  // 2026): the warning says what to do
  if (worked !== null && expected === null) {
    warnings.push(pay.hoursPerDay === null ? NO_SHIFT_NO_EXPECTED_HOURS : "Worked hours are given without the expected hours: attendance isn't counted");
  }
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

  // the KPI (owner, 21 October 2026: "Last month's KPI, this pay"; "As the sheet: full at 80%+"): last month's final
  // scorecard's final % (performance only since 25 October 2026: "Fixed cut only"); none final, not cut. A line made
  // before the KPIs module: the KPI inputs given, averaged with the attendance score as the sheet did while the rules
  // average it in (kpiAveragesAttendance), else the KPI inputs alone
  const kpis = [i.softSkills, i.performance, i.clientSatisfaction].filter((v): v is number => v !== null).map((v) => v / 100);
  const averaged = kpiAveragesAttendance(rules) ? [attendanceScore, ...kpis] : kpis;
  const kpiAverage = averaged.length ? fraction(averaged.reduce((sum, v) => sum + v, 0) / averaged.length) : 1;
  const kpiScore =
    pay.kpi !== undefined ? kpiPayScore(pay.kpi, rules.kpiGracePercent) : kpis.length === 0 || kpiAverage >= rules.kpiGracePercent / 100 ? 1 : kpiAverage;

  const workedOut = piasters(fixed * Math.max(0, 1 - attendanceScore));
  const kpiCut = piasters(variable * Math.max(0, 1 - kpiScore));
  // never more than the salary left for the days paid, so absences alone can't take the pay below 0
  const noShowFull = piasters((noShowDays * rules.noShowDayMultiplier * pay.gross) / rules.dayDivisor);
  const salaryLeft = Math.max(0, piasters(fixed - workedOut + variable - kpiCut));
  const noShowCut = Math.min(noShowFull, salaryLeft);
  if (noShowFull > noShowCut) warnings.push('The no-show days cost more than the salary left for the days paid: the cut is capped there');
  // unpaid leave (owner, 18 October 2026): a day of the gross ÷ the day divisor for each, never more than the salary the
  // no-show cut leaves
  const unpaidLeaveFull = piasters((unpaidLeaveDays * pay.gross) / rules.dayDivisor);
  const unpaidLeaveCut = Math.min(unpaidLeaveFull, Math.max(0, piasters(salaryLeft - noShowCut)));
  if (unpaidLeaveFull > unpaidLeaveCut) warnings.push('The unpaid leave days cost more than the salary left for the days paid: the cut is capped there');
  // the CEO waived the attendance deduction (owner, 17 October 2026: "if there is an attendance deduction, allow the CEO
  // to wave the deduction by ticking a box"): none taken, what it was kept; the no-show cut stays as worked out with it,
  // and the attendance score still counts in the KPI average where the rules average it in
  const waived = i.attendanceWaived === true ? workedOut : 0;
  const attendanceCut = piasters(workedOut - waived);

  // the most attendance will count (owner, 16 October 2026: "maximum working hours to be recorded per day is 9 hours
  // between checkin and check out"): the shift's hours to work a day on its working days in the days paid, less the
  // holidays and the no-show and leave days; the total typed isn't cut, only warned about
  // the worked hours as typed, without the permission hours: what attendance counted
  // (a shift that counts hours until a time counts past them a day, 20 October 2026: no such warning)
  const most = mostCountedHours(pay.expectedDays, pay.hoursPerDay, noShowDays, leaveDays + unpaidLeaveDays);
  if (pay.makeUpHours !== true && i.workedHours !== null && most !== null && pay.hoursPerDay !== null && i.workedHours > most) {
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
    ...(permission > 0 && { permissionHours: permission }),
    ...(hoursOverExpected > 0 && { hoursOverExpected }),
    attendanceRatio,
    attendanceScore,
    kpiScore,
    attendanceCut,
    attendanceWaived: waived,
    kpiCut,
    noShowCut,
    unpaidLeaveCut,
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
  if ([i.expectedHours, i.softSkills, i.performance, i.clientSatisfaction, i.noShowDays, i.leaveDays, i.unpaidLeaveDays ?? null].some((v) => v !== null)) {
    warnings.push("Paid by the hour: the expected hours, KPIs, no-show days and leave days don't change the pay");
  }
  // permission (owner, 19 October 2026) is time not worked: by the hour, only the hours worked are paid
  if (i.permissionHours !== null && i.permissionHours !== undefined && i.permissionHours > 0) {
    warnings.push("Paid by the hour: the permission hours aren't paid, only the hours worked");
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
    attendanceWaived: 0,
    kpiCut: 0,
    noShowCut: 0,
    unpaidLeaveCut: 0,
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
