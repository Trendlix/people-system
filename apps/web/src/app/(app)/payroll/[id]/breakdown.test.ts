import {
  EMPTY_PAYROLL_INPUTS,
  lawRatesFor,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  type PayrollAdjustmentItem,
  type PayrollInputs,
  type PayrollResult,
  type PayrollSegment,
  type PayrollTerms,
  type SavedPayrollInputs,
} from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { breakdown, cutText, expectedHoursNote, kpiStep, percentText, shiftHoursNote, waivedByCeo, waiverOf } from './breakdown';

// An invented employee's month, worked out by hand. The shift: 22 working days in the month less 1 holiday, at 8:00 to
// work a day, 168:00 scheduled; a no-show day and a leave day come out of them, a day of the shift each (owner,
// 17 October 2026): 168 − 2 × 8 = 152 expected. 133 worked of 152 is 87.5%, below the 90% grace: 1,000 off the fixed
// 8,000. A performance of 65%: (87.5 + 65) ÷ 2 = 76.25%, below 80%: 475 off the variable 2,000. The no-show day 2 ×
// 10,000 ÷ 30 = 666.67; the leave day costs nothing. On Additions / Deductions (17 October 2026): a commission of 1,000,
// taxed, and a correction of 100 taken after tax. Earned 8,000 − 1,000 + 2,000 − 475 − 666.67 + 1,000 = 8,858.33.
// Taxable 8,858.33 + 500 − 1,100 = 8,258.33; × 12 − 20,000 = 79,099.96, 79,090 a year (to the 10 below); tax 1,500 +
// 2,250 + 20% of 9,090 = 5,568, 464 a month. Martyrs' Fund 9,358.33 × 0.05% = 4.68. Deductions 1,100 + 464 + 4.68 +
// the correction's 100 = 1,668.68; net 8,858.33 + 500 − 1,668.68 = 7,689.65; 1,000 released. No warnings: the most
// attendance counts, (22 − 1 holiday − 2 days off) × 8 = 152, is not less than the 133 worked.
const COMMISSION = { id: 'c1', kind: 'addition', type: 'commission', taxed: true, amount: 1000, reason: 'September sales' } satisfies PayrollAdjustmentItem;
const CORRECTION = { id: 'c2', kind: 'deduction', type: 'correction', taxed: false, amount: 100, reason: 'Overpaid in September' } satisfies PayrollAdjustmentItem;
const terms: PayrollTerms = {
  year: 2026,
  payBasis: 'monthly',
  gross: 10_000,
  basicPercent: 80,
  hourlyRate: null,
  allowances: [{ name: 'Transport', amount: 500, taxable: true, insured: false }],
  paidDays: 30,
  statutory: true,
  insured: true,
  insuredWage: 10_000,
  hoursPerDay: 8,
  expectedHours: 168,
  expectedDays: { workingDays: 22, holidays: 1 },
  adjustments: [COMMISSION, CORRECTION],
};

const result: PayrollResult = {
  fixed: 8000,
  variable: 2000,
  // one part: the terms have no segments of their own
  parts: [{ contractId: null, fixed: 8000, variable: 2000, allowances: 500 }],
  absentHours: 8,
  leaveHours: 8,
  expectedHours: 152,
  attendanceRatio: 0.875,
  attendanceScore: 0.875,
  kpiScore: 0.7625,
  attendanceCut: 1000,
  // not waived by the CEO (17 October 2026)
  attendanceWaived: 0,
  kpiCut: 475,
  noShowCut: 666.67,
  // no unpaid leave (18 October 2026)
  unpaidLeaveCut: 0,
  overtime: 0,
  bonus: 0,
  earned: 8858.33,
  allowances: 500,
  taxableAllowances: 500,
  insuredWage: 10_000,
  employeeInsurance: 1100,
  employerInsurance: 1875,
  monthlyTaxable: 8258.33,
  annualNetIncome: 79_090,
  monthlyTax: 464,
  martyrsFund: 4.68,
  penaltyCut: 0,
  deductions: 1668.68,
  net: 7689.65,
  released: 1000,
  transfer: 6689.65,
  companyCost: 11_233.33,
  // the commission and the correction (17 October 2026)
  additionsTaxed: 1000,
  additionsUntaxed: 0,
  adjustmentDeductions: 100,
  adjustments: [COMMISSION, CORRECTION],
  warnings: [],
};

const inputs: PayrollInputs = {
  ...EMPTY_PAYROLL_INPUTS,
  noShowDays: 1,
  leaveDays: 1,
  workedHours: 133,
  performance: 65,
  released: 1000,
};
const line = { payBasis: 'monthly' as const, terms, inputs, result };

type Line = Parameters<typeof breakdown>[0];

/**
 * The rules of a run made before attendance left the KPI (owner, 25 October 2026: "Fixed cut only"): copied without
 * kpiIncludesAttendance, so the KPI inputs typed on a line (as this one's performance) are averaged with the attendance,
 * as worked out by hand above.
 */
const RULES_BEFORE = { ...PAYROLL_RULE_DEFAULTS, kpiIncludesAttendance: undefined };

const row = (key: string) => breakdown(line, RULES_BEFORE).find((r) => r.key === key);

/** A line as payrollLine works it out now (with the rules sent: those a run copies now unless sent). */
const lineOf = (t: PayrollTerms, i: PayrollInputs, rules: Parameters<typeof payrollLine>[2] = PAYROLL_RULE_DEFAULTS): Line => ({ payBasis: t.payBasis, terms: t, inputs: i, result: payrollLine(t, i, rules) });

/** A step of a line's breakdown, by its key. */
const stepOf = (l: Line, key: string) => breakdown(l, PAYROLL_RULE_DEFAULTS).find((s) => s.key === key);

describe('a line’s breakdown', () => {
  it('is payrollLine’s line, worked out by hand above', () => {
    expect(payrollLine(terms, inputs, RULES_BEFORE)).toEqual(result);
  });

  it('goes through every step, in order', () => {
    expect(breakdown(line, PAYROLL_RULE_DEFAULTS).map((r) => r.label)).toEqual([
      'Fixed',
      'Variable',
      'Expected hours',
      'Hours worked',
      'Attendance',
      'Attendance cut',
      'KPI score',
      'KPI cut',
      'No-show cut',
      'Leave days',
      'Overtime',
      // the month's additions and deductions by type (17 October 2026): no Bonus, Settlements or Penalties of the grid's
      'Commission',
      'Earned',
      'Allowances',
      'Insured wage',
      'Social insurance',
      'Taxable pay',
      'Income tax',
      'Martyrs’ fund',
      'Correction',
      'Deductions',
      'Net',
      'Released',
      'Transfer',
      'Company cost',
    ]);
  });

  it('shows every amount in EGP with two decimals, what is taken off with a minus', () => {
    expect(row('fixed')?.value).toBe('EGP 8,000.00');
    expect(row('attendanceCut')?.value).toBe('−EGP 1,000.00');
    expect(row('adjustment-c1')).toEqual({ key: 'adjustment-c1', label: 'Commission', value: 'EGP 1,000.00', kind: 'add', note: 'September sales · taxed' });
    expect(row('adjustment-c2')).toEqual({ key: 'adjustment-c2', label: 'Correction', value: '−EGP 100.00', kind: 'cut', note: 'Overpaid in September · after tax' });
    expect(row('overtime')?.value).toBe('EGP 0.00');
    expect(row('net')).toMatchObject({ value: 'EGP 7,689.65', kind: 'total' });
    expect(row('companyCost')?.note).toBe("Earned, allowances and the company's social insurance (EGP 1,875.00)");
  });

  it('explains the expected hours, the attendance, the KPIs, the no-shows, the leave and the insurance', () => {
    // the shift's 168:00 less the no-show and the leave day, 8:00 each (owner, 17 October 2026)
    expect(row('expected')).toMatchObject({
      value: '152:00',
      kind: 'info',
      note: 'Scheduled 168:00 (22 working days of the shift less 1 holiday), less 1 no-show day and 1 leave day, 8:00 a day',
    });
    expect(row('hours')).toEqual({ key: 'hours', label: 'Hours worked', value: '133:00 of 152:00', kind: 'info' });
    expect(row('attendance')).toMatchObject({ value: '87.5%', note: 'Below 90%: the fixed part follows it' });
    // the KPIs typed, which the inputs grid no longer shows
    expect(row('kpi')).toMatchObject({ value: '76.25%', note: 'The average of performance 65% and attendance 87.5%; at or above 80% counts in full' });
    expect(row('noShowCut')?.note).toBe("1 day, each costing 2 days' pay");
    expect(row('leave')).toMatchObject({ value: '1 day', kind: 'info', note: 'Paid leave: nothing cut, and not counted in attendance, as typed by HR' });
    expect(row('employeeInsurance')?.note).toBe('11% of the insured wage');
    expect(row('allowances')?.note).toBe('Transport');
  });

  it('gives the employee’s share of the run’s rates set by law (owner’s request, 16 October 2026)', () => {
    const law = { ...lawRatesFor(2026), employeeInsuranceRate: 0.115 };
    expect(breakdown(line, PAYROLL_RULE_DEFAULTS, law).find((r) => r.key === 'employeeInsurance')?.note).toBe('11.5% of the insured wage');
    // a run from an API before them: the built-in rates of its year
    expect(breakdown(line, PAYROLL_RULE_DEFAULTS).find((r) => r.key === 'employeeInsurance')?.note).toBe('11% of the insured wage');
  });

  it('lists every KPI given; with none, the variable part isn’t cut (owner, 16 October 2026: "fixed only")', () => {
    const kpi = (i: Partial<PayrollInputs>, r: Partial<PayrollResult>) => breakdown({ ...line, inputs: { ...inputs, ...i }, result: { ...result, ...r } }, RULES_BEFORE).find((s) => s.key === 'kpi');
    // (100 + 70 + 65 + 72.5) ÷ 4 = 76.875%
    expect(kpi({ softSkills: 70, clientSatisfaction: 72.5 }, { attendanceScore: 1, kpiScore: 0.76875 })).toMatchObject({
      value: '76.88%',
      note: 'The average of soft skills 70%, performance 65%, client satisfaction 72.5% and attendance 100%; at or above 80% counts in full',
    });
    expect(kpi({ performance: null }, { kpiScore: 1, kpiCut: 0 })).toMatchObject({ value: '100%', note: "No KPIs given: the variable part isn't cut" });
    // a line worked out before then took the attendance alone
    expect(kpi({ performance: null }, { kpiScore: 0.875 })).toMatchObject({ value: '87.5%', note: 'No KPIs given: the attendance alone' });
  });

  it('averages the KPIs given alone once attendance is out of the KPI (owner, 25 October 2026: "Fixed cut only")', () => {
    // a draft refreshed since: its rules don't take attendance in, so the performance of 65% alone, 700 off the variable 2,000
    const now = lineOf(terms, inputs);
    expect(now.result).toMatchObject({ attendanceScore: 0.875, kpiScore: 0.65, kpiCut: 700, attendanceCut: 1000 });
    expect(breakdown(now, PAYROLL_RULE_DEFAULTS).find((s) => s.key === 'kpi')).toMatchObject({
      value: '65%',
      note: 'The average of performance 65%; at or above 80% counts in full. The KPI is performance only: attendance is cut on the fixed part.',
    });
    // the attendance is still cut on the fixed part, as before
    expect(breakdown(now, PAYROLL_RULE_DEFAULTS).find((s) => s.key === 'attendanceCut')?.value).toBe('−EGP 1,000.00');
    // a run with the CEO, approved or paid keeps the rules it copied: averaged with the attendance, as it was
    expect(lineOf(terms, inputs, RULES_BEFORE).result).toEqual(result);
  });

  it('says when attendance isn’t tracked or can’t be counted, the part month, and who has no insurance deducted', () => {
    // without a shift and with nothing typed: neither the expected hours nor the hours worked
    const untracked = lineOf({ ...terms, paidDays: 19, insured: false, expectedHours: null, expectedDays: null }, EMPTY_PAYROLL_INPUTS);
    expect(stepOf(untracked, 'attendance')).toMatchObject({ value: 'Not tracked', note: 'No hours typed: counts in full' });
    expect(stepOf(untracked, 'expected')).toBeUndefined();
    expect(stepOf(untracked, 'hours')).toBeUndefined();
    expect(stepOf(untracked, 'fixed')?.note).toBe('80% of the gross, for 19 of 30 days');
    expect(stepOf(untracked, 'employeeInsurance')?.note).toBe('Not registered with social insurance: nothing deducted');
    // a shift of 2 working days, 16:00, and 2 no-show days: 16 − 2 × 8 = 0 expected, so attendance isn't counted
    const notCounted = lineOf({ ...terms, expectedHours: 16, expectedDays: { workingDays: 2, holidays: 0 } }, { ...EMPTY_PAYROLL_INPUTS, workedHours: 10, noShowDays: 2 });
    expect(notCounted.result.warnings).toContain("The no-show days' hours are all the shift's hours this month or more: attendance isn't counted, only the no-show cut");
    expect(stepOf(notCounted, 'expected')).toMatchObject({ value: '0:00', note: 'Scheduled 16:00 (2 working days of the shift), less 2 no-show days, 8:00 a day' });
    expect(stepOf(notCounted, 'hours')?.value).toBe('10:00 of 0:00');
    expect(stepOf(notCounted, 'attendance')).toMatchObject({ value: 'Not counted', note: 'See the warnings: counts in full' });
    const freelance = breakdown({ ...line, terms: { ...terms, statutory: false } }, PAYROLL_RULE_DEFAULTS);
    expect(freelance.find((r) => r.key === 'employeeInsurance')?.note).toBe('Freelance: no social insurance, tax or Martyrs’ fund');
  });

  it('pays the hours at the rate for pay by the hour, with no split or cuts, nor expected hours or leave', () => {
    const hourly = breakdown(
      {
        payBasis: 'hourly',
        terms: { ...terms, payBasis: 'hourly', hourlyRate: 100, expectedHours: null, expectedDays: null },
        inputs: { ...EMPTY_PAYROLL_INPUTS, workedHours: 120.5, leaveDays: 1 },
        // the hours' 12,050 and the commission's 1,000
        result: { ...result, fixed: 0, variable: 0, expectedHours: null, earned: 13_050, bonus: 0 },
      },
      PAYROLL_RULE_DEFAULTS,
    );
    expect(hourly.slice(0, 2).map((r) => r.label)).toEqual(['Pay for the hours', 'Commission']);
    expect(hourly[0]).toMatchObject({ value: 'EGP 12,050.00', note: '120:30 hours at EGP 100.00 an hour' });
    expect(hourly.find((r) => r.key === 'expected' || r.key === 'leave')).toBeUndefined();
  });
});

describe('breakdown: the expected hours (owner, 17 October 2026: "prefill the expected hours, and dont count abcent days or leave days")', () => {
  it('are the shift’s less the no-show and leave days given, a day of the shift each', () => {
    // 2 no-show days and half a leave day: 168 − 2.5 × 8 = 148; 133 of 148 is 89.86%, below the grace
    const halfDay = lineOf(terms, { ...inputs, noShowDays: 2, leaveDays: 0.5 });
    expect(halfDay.result.expectedHours).toBe(148);
    expect(stepOf(halfDay, 'expected')).toMatchObject({
      value: '148:00',
      note: 'Scheduled 168:00 (22 working days of the shift less 1 holiday), less 2 no-show days and 0.5 leave days, 8:00 a day',
    });
    expect(stepOf(halfDay, 'hours')?.value).toBe('133:00 of 148:00');
    expect(stepOf(halfDay, 'attendance')?.value).toBe('89.86%');
    // leave days alone: 168 − 2 × 8 = 152
    expect(stepOf(lineOf(terms, { ...inputs, noShowDays: null, leaveDays: 2 }), 'expected')).toMatchObject({
      value: '152:00',
      note: 'Scheduled 168:00 (22 working days of the shift less 1 holiday), less 2 leave days, 8:00 a day',
    });
    // no days off, and no holiday: 21 × 8 = 168, as scheduled
    const whole = lineOf({ ...terms, expectedDays: { workingDays: 21, holidays: 0 } }, { ...inputs, noShowDays: null, leaveDays: null });
    expect(stepOf(whole, 'expected')).toMatchObject({ value: '168:00', note: 'Scheduled 168:00 (21 working days of the shift), at 8:00 a day' });
    expect(stepOf(whole, 'hours')?.value).toBe('133:00 of 168:00');
    // without the shift's days: no parenthesis
    expect(shiftHoursNote({ expectedHours: 168, expectedDays: null, hoursPerDay: 8 }, { noShowDays: 1, leaveDays: null })).toBe('Scheduled 168:00, less 1 no-show day, 8:00 a day');
  });

  it('are shown filled in before any hours are typed, without the hours worked', () => {
    const empty = lineOf(terms, EMPTY_PAYROLL_INPUTS);
    expect(stepOf(empty, 'expected')).toMatchObject({ value: '168:00', note: 'Scheduled 168:00 (22 working days of the shift less 1 holiday), at 8:00 a day' });
    expect(stepOf(empty, 'hours')).toBeUndefined();
    expect(stepOf(empty, 'attendance')?.value).toBe('Not tracked');
  });

  it('are HR’s on a line saved with them before they were locked (20 October 2026), taken as already without the no-show and leave days', () => {
    // a run with the CEO, approved or paid, as it was worked out: HR's 140 with the no-show and the leave day still
    // given: 133 of 140 is 95%, counted in full
    const typed = lineOf(terms, { ...inputs, expectedHours: 140 });
    expect(typed.result).toMatchObject({ expectedHours: 140, absentHours: 0, leaveHours: 0, attendanceCut: 0 });
    expect(stepOf(typed, 'expected')).toMatchObject({ value: '140:00', note: 'As typed by HR: already without the no-show and leave days' });
    expect(stepOf(typed, 'hours')?.value).toBe('133:00 of 140:00');
    expect(stepOf(typed, 'attendance')).toMatchObject({ value: '95%', note: 'At or above 90%: counts in full' });
  });

  it('are none without a shift (HR’s on a line saved with them before then): the hours worked stand alone', () => {
    const noShift = { ...terms, hoursPerDay: null, expectedHours: null, expectedDays: null };
    const typed = lineOf(noShift, { ...inputs, expectedHours: 140 });
    expect(stepOf(typed, 'expected')).toMatchObject({ value: '140:00', note: 'As typed by HR: already without the no-show and leave days' });
    const none = lineOf(noShift, inputs);
    expect(stepOf(none, 'expected')).toBeUndefined();
    expect(stepOf(none, 'hours')).toEqual({ key: 'hours', label: 'Hours worked', value: '133:00', kind: 'info' });
    expect(stepOf(none, 'attendance')?.value).toBe('Not counted');
  });

  it('lists the leave days only when there are some, nothing cut for them', () => {
    // 2 leave days and the no-show day: 168 − 3 × 8 = 144, and 133 of 144 is 92.36%: no attendance cut
    const leave = lineOf(terms, { ...inputs, leaveDays: 2 });
    expect(stepOf(leave, 'leave')).toMatchObject({ value: '2 days', note: 'Paid leave: nothing cut, and not counted in attendance, as typed by HR' });
    expect(leave.result).toMatchObject({ expectedHours: 144, attendanceCut: 0, noShowCut: 666.67 });
    expect(stepOf(lineOf(terms, { ...inputs, leaveDays: null }), 'leave')).toBeUndefined();
    expect(stepOf(lineOf(terms, { ...inputs, leaveDays: 0 }), 'leave')).toBeUndefined();
  });

  it('takes the leave approved this month when HR typed none, and cuts a day’s pay for each unpaid leave day (owner, 18 October 2026)', () => {
    // 1 paid and 2 unpaid days of the leave approved: 168 − (1 no-show + 1 + 2) × 8 = 136
    const approved = lineOf({ ...terms, leave: { paidDays: 1, unpaidDays: 2 } }, { ...inputs, leaveDays: null });
    expect(approved.result.expectedHours).toBe(136);
    expect(approved.result.unpaidLeaveCut).toBeGreaterThan(0);
    expect(stepOf(approved, 'leave')).toMatchObject({ value: '1 day', note: 'Paid leave: nothing cut, and not counted in attendance, from the leave approved this month' });
    expect(stepOf(approved, 'unpaidLeaveCut')).toMatchObject({
      value: cutText(approved.result.unpaidLeaveCut!),
      kind: 'cut',
      note: "2 days of unpaid leave, each a day's pay (the gross ÷ 30), from the leave approved this month",
    });
    // the shift's hours say so too
    expect(stepOf(approved, 'expected')?.note).toContain('1 leave day and 2 unpaid leave days');
    // none: no row
    expect(stepOf(lineOf(terms, inputs), 'unpaidLeaveCut')).toBeUndefined();
  });
});

describe('breakdown: a line worked out before 17 October 2026, as it was', () => {
  // the month as it was then: 238 worked, 280 typed with a no-show day of 8 hours out of them (16 October 2026), 238 of
  // 272 = 87.5%; no record of the expected hours, no leave hours, no parts, and inputs without leave days
  const before = (t: PayrollTerms, i: Partial<PayrollInputs>, r: Partial<PayrollResult>): Line => {
    const oldInputs: Partial<PayrollInputs> = { ...inputs, workedHours: 238, expectedHours: 280, ...i };
    delete oldInputs.leaveDays;
    const oldResult: Partial<PayrollResult> = { ...result, ...r };
    delete oldResult.expectedHours;
    delete oldResult.leaveHours;
    delete oldResult.parts;
    return { payBasis: 'monthly', terms: t, inputs: oldInputs as PayrollInputs, result: oldResult as PayrollResult };
  };

  it('takes the no-show day’s hours out of HR’s figure, as then', () => {
    const typed = before(terms, {}, { absentHours: 8 });
    expect(stepOf(typed, 'expected')).toMatchObject({ value: '272:00', note: '280:00 expected as typed, less 8:00 for the no-show day' });
    expect(stepOf(typed, 'hours')?.value).toBe('238:00 of 272:00');
    expect(stepOf(typed, 'leave')).toBeUndefined();
  });

  it('shows the hours as typed on a line worked out before the no-show days’ hours came out (16 October 2026)', () => {
    const older = before(terms, {}, { attendanceRatio: 0.85, attendanceScore: 0.85 });
    delete (older.result as Partial<PayrollResult>).absentHours;
    expect(stepOf(older, 'expected')).toMatchObject({ value: '280:00', note: 'Expected hours as typed' });
    expect(stepOf(older, 'hours')?.value).toBe('238:00 of 280:00');
  });

  it('says the shift’s hours the old way: 168 less the no-show day’s 8 is 160', () => {
    const fromShift = before(terms, { expectedHours: null }, { absentHours: 8 });
    expect(stepOf(fromShift, 'expected')).toMatchObject({
      value: '160:00',
      note: '168:00 expected from 22 working days of the shift less 1 holiday, at its 8:00 hours to work a day; less 8:00 for the no-show day',
    });
    expect(stepOf(fromShift, 'hours')?.value).toBe('238:00 of 160:00');
    const whole = before({ ...terms, expectedDays: { workingDays: 21, holidays: 0 } }, { expectedHours: null, noShowDays: null }, { absentHours: 0 });
    expect(stepOf(whole, 'expected')?.note).toBe('168:00 expected from 21 working days of the shift, at its 8:00 hours to work a day');
    expect(expectedHoursNote({ ...terms, expectedDays: null }, { ...inputs, expectedHours: null }, 0)).toBe('168:00 expected from the shift');
  });
});

describe('breakdown: a month under two contracts (owner, 17 October 2026: "take into consideration the start and end date of the contract if it is in the middle of the billing period")', () => {
  // A renewal on 15 October: CON-2026-0007 v1 for 1–14 October at a gross of 10,000 with a 500 transport allowance, and
  // CON-2026-0019 v2 for 15–31 October at 12,000 with 600 transport and 300 mobile; 14 and 16 of the 30 days paid.
  // Fixed (80%): 8,000 × 14 ÷ 30 = 3,733.33 and 9,600 × 16 ÷ 30 = 5,120.00, 8,853.33 in all; variable (20%): 2,000 ×
  // 14 ÷ 30 = 933.33 and 2,400 × 16 ÷ 30 = 1,280.00, 2,213.33 in all; allowances 500 × 14 ÷ 30 = 233.33, and 600 × 16
  // ÷ 30 + 300 × 16 ÷ 30 = 320 + 160 = 480.00, 713.33 in all. No hours or KPIs typed: nothing cut, earned 8,853.33 +
  // 2,213.33 = 11,066.66.
  const transport = (amount: number) => ({ name: 'Transport', amount, taxable: true, insured: false });
  const mobile = { name: 'Mobile', amount: 300, taxable: false, insured: false };
  const first: PayrollSegment = {
    contractId: 'c1',
    number: 'CON-2026-0007',
    version: 1,
    from: '2026-10-01',
    to: '2026-10-14',
    days: 14,
    payBasis: 'monthly',
    gross: 10_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [transport(500)],
  };
  const renewal: PayrollSegment = { ...first, contractId: 'c2', number: 'CON-2026-0019', version: 2, from: '2026-10-15', to: '2026-10-31', days: 16, gross: 12_000, allowances: [transport(600), mobile] };
  // the pay at the month's end is the renewal's
  const split: PayrollTerms = { ...terms, gross: 12_000, allowances: [transport(600), mobile], segments: [first, renewal], adjustments: undefined };
  const month = lineOf(split, EMPTY_PAYROLL_INPUTS);
  const steps = breakdown(month, PAYROLL_RULE_DEFAULTS);
  const step = (key: string) => steps.find((s) => s.key === key);

  it('is paid each contract’s own pay for its days, worked out by hand above', () => {
    expect(month.result.parts).toEqual([
      { contractId: 'c1', fixed: 3733.33, variable: 933.33, allowances: 233.33 },
      { contractId: 'c2', fixed: 5120, variable: 1280, allowances: 480 },
    ]);
    expect(month.result).toMatchObject({ fixed: 8853.33, variable: 2213.33, allowances: 713.33, earned: 11_066.66 });
  });

  it('lists the contracts first, then each part’s fixed and variable pay, and each part’s allowances', () => {
    expect(steps.slice(0, 7).map((s) => s.label)).toEqual([
      'Contracts',
      'Fixed · 1–14 October',
      'Fixed · 15–31 October',
      'Variable · 1–14 October',
      'Variable · 15–31 October',
      'Expected hours',
      'Attendance',
    ]);
    expect(steps.filter((s) => s.label.startsWith('Allowances')).map((s) => s.label)).toEqual(['Allowances · 1–14 October', 'Allowances · 15–31 October']);
    expect(steps.find((s) => s.key === 'fixed' || s.key === 'variable' || s.key === 'allowances')).toBeUndefined();
  });

  it('says each part’s days and what its pay was worked out from', () => {
    expect(step('contracts')).toMatchObject({ value: '2 this month', kind: 'info', note: 'CON-2026-0007 v1, 1–14 October: 14 days · CON-2026-0019 v2, 15–31 October: 16 days' });
    expect(step('fixed-1')).toMatchObject({ value: 'EGP 3,733.33', kind: 'add', note: '80% of the EGP 10,000.00 gross, for 14 of 30 days' });
    expect(step('fixed-2')).toMatchObject({ value: 'EGP 5,120.00', note: '80% of the EGP 12,000.00 gross, for 16 of 30 days' });
    expect(step('variable-1')).toMatchObject({ value: 'EGP 933.33', note: '20% of the EGP 10,000.00 gross, for 14 of 30 days' });
    expect(step('variable-2')).toMatchObject({ value: 'EGP 1,280.00', note: '20% of the EGP 12,000.00 gross, for 16 of 30 days' });
    expect(step('allowances-1')).toMatchObject({ value: 'EGP 233.33', kind: 'add', note: 'Transport' });
    expect(step('allowances-2')).toMatchObject({ value: 'EGP 480.00', note: 'Transport, Mobile' });
    expect(step('earned')?.value).toBe('EGP 11,066.66');
  });

  it('reads as one contract when one of them is by the hour: the latest alone is paid, for all the days', () => {
    // the renewal's 12,000 for the 30 days: 9,600 fixed, 2,400 variable, and its 900 of allowances
    const mixed = lineOf({ ...split, segments: [{ ...first, payBasis: 'hourly', hourlyRate: 60 }, renewal] }, EMPTY_PAYROLL_INPUTS);
    expect(mixed.result.warnings).toContain(
      "2 contracts this month, one paid by the hour: the whole month is paid on the latest, CON-2026-0019 v2, as hours can't be split between contracts without attendance",
    );
    const labels = breakdown(mixed, PAYROLL_RULE_DEFAULTS).map((s) => s.label);
    expect(labels.slice(0, 2)).toEqual(['Fixed', 'Variable']);
    expect(labels).not.toContain('Contracts');
    expect(stepOf(mixed, 'fixed')?.value).toBe('EGP 9,600.00');
    expect(stepOf(mixed, 'allowances')).toMatchObject({ value: 'EGP 900.00', note: 'Transport, Mobile' });
  });

  it('reads as one contract on a line without its parts', () => {
    const withoutParts: Partial<PayrollResult> = { ...month.result };
    delete withoutParts.parts;
    const labels = breakdown({ ...month, result: withoutParts as PayrollResult }, PAYROLL_RULE_DEFAULTS).map((s) => s.label);
    expect(labels.slice(0, 2)).toEqual(['Fixed', 'Variable']);
  });
});

describe('the figures', () => {
  it('shows a fraction as a percent and an amount taken off with a minus', () => {
    expect(percentText(0.9661)).toBe('96.61%');
    expect(percentText(1)).toBe('100%');
    expect(cutText(0)).toBe('EGP 0.00');
    expect(cutText(1100)).toBe('−EGP 1,100.00');
  });
});

describe('breakdown: overtime (owner, 16 October 2026: "No overtime for now")', () => {
  const overtimeOf = (rules: Parameters<typeof breakdown>[1]) => breakdown(line, rules).find((r) => r.key === 'overtime');

  it('says it isn’t paid while the run’s rules don’t pay it', () => {
    expect(overtimeOf(PAYROLL_RULE_DEFAULTS)).toMatchObject({ value: 'EGP 0.00', note: 'Overtime: not paid' });
  });

  it('says when it is paid, as on a run whose rules were copied before the switch', () => {
    expect(overtimeOf({ ...PAYROLL_RULE_DEFAULTS, payOvertime: true })?.note).toBe('For attendance above 110%, at 1.5×');
    // as copied before the switch existed: none
    const older = { ...PAYROLL_RULE_DEFAULTS, payOvertime: undefined };
    expect(overtimeOf(older)?.note).toBe('For attendance above 110%, at 1.5×');
  });
});

describe('breakdown: the insured wage after a raise (owner, 16 October 2026: "From the next January unless amended in Form 2")', () => {
  const insuredOf = (t: PayrollTerms) => breakdown({ ...line, terms: t }, PAYROLL_RULE_DEFAULTS).find((r) => r.key === 'insuredWage');

  it('says it is as before the raise until the next January, or the Form 2 date', () => {
    expect(insuredOf(terms)?.note).toBeUndefined();
    expect(insuredOf({ ...terms, insuredWageAsBefore: '2027-01-01' })?.note).toBe('As before the raise until January 2027');
    expect(insuredOf({ ...terms, insuredWageAsBefore: '2026-12-01' })?.note).toBe('As before the raise until December 2026');
  });
});

describe('breakdown: the month’s additions and deductions (owner, 17 October 2026: Additions / Deductions)', () => {
  const withAdjustments: PayrollTerms = {
    ...terms,
    adjustments: [
      { id: 'a1', kind: 'addition', type: 'incentive', taxed: true, amount: 1500, reason: 'Campaign launch' },
      { id: 'a2', kind: 'addition', type: 'reimbursement', taxed: false, amount: 320.75, reason: 'Taxi' },
      { id: 'a3', kind: 'deduction', type: 'damage_loss', taxed: false, amount: 250, reason: 'Broken charger' },
    ],
  };
  const worked = payrollLine(withAdjustments, EMPTY_PAYROLL_INPUTS, PAYROLL_RULE_DEFAULTS);
  const rows = breakdown({ payBasis: 'monthly', terms: withAdjustments, inputs: EMPTY_PAYROLL_INPUTS, result: worked }, PAYROLL_RULE_DEFAULTS);
  const keys = rows.map((r) => r.key);

  it('puts the taxed additions before the pay earned, the deductions with the others, the untaxed additions before the net', () => {
    expect(keys.slice(keys.indexOf('overtime'), keys.indexOf('earned') + 1)).toEqual(['overtime', 'adjustment-a1', 'earned']);
    expect(keys.slice(keys.indexOf('martyrsFund'), keys.indexOf('net') + 1)).toEqual(['martyrsFund', 'adjustment-a3', 'deductions', 'adjustment-a2', 'net']);
    expect(rows.find((r) => r.key === 'adjustment-a1')).toEqual({ key: 'adjustment-a1', label: 'Incentive', value: 'EGP 1,500.00', kind: 'add', note: 'Campaign launch · taxed' });
    expect(rows.find((r) => r.key === 'adjustment-a2')).toMatchObject({ label: 'Reimbursement', kind: 'add', note: 'Taxi · not taxed, added after tax' });
    expect(rows.find((r) => r.key === 'adjustment-a3')).toEqual({ key: 'adjustment-a3', label: 'Damage or loss', value: '−EGP 250.00', kind: 'cut', note: 'Broken charger · after tax' });
    expect(rows.find((r) => r.key === 'companyCost')?.note).toMatch(/^Earned, allowances, the untaxed additions and the company's social insurance/);
  });

  it('pays by the hour for the hours alone, the taxed additions apart', () => {
    const hourly: PayrollTerms = { ...withAdjustments, payBasis: 'hourly', hourlyRate: 100, expectedHours: null, expectedDays: null };
    const inputs: PayrollInputs = { ...EMPTY_PAYROLL_INPUTS, workedHours: 80 };
    const r = payrollLine(hourly, inputs, PAYROLL_RULE_DEFAULTS);
    expect(breakdown({ payBasis: 'hourly', terms: hourly, inputs, result: r }, PAYROLL_RULE_DEFAULTS).find((x) => x.key === 'hours')?.value).toBe('EGP 8,000.00');
  });

  it('a line without any has no such rows', () => {
    const none = { ...terms, adjustments: [] };
    expect(breakdown({ payBasis: 'monthly', terms: none, inputs: EMPTY_PAYROLL_INPUTS, result: payrollLine(none, EMPTY_PAYROLL_INPUTS) }, PAYROLL_RULE_DEFAULTS).some((r) => r.key.startsWith('adjustment-'))).toBe(false);
  });
});

describe('breakdown: a Recurring deduction before tax (owner, 20 October 2026: "Before Tax i think")', () => {
  const medical: PayrollAdjustmentItem = { id: 'r1', kind: 'deduction', type: 'recurring', taxed: false, amount: 350, reason: 'Medical subscription (family)', beforeTax: true };
  const loan: PayrollAdjustmentItem = { id: 'l1', kind: 'deduction', type: 'loan_installment', taxed: false, amount: 1000, reason: 'Car loan, 2 of 6' };
  const lineWith = (items: PayrollAdjustmentItem[], law = lawRatesFor(2026)) => {
    const t: PayrollTerms = { ...terms, adjustments: items };
    return { payBasis: 'monthly' as const, terms: t, inputs: EMPTY_PAYROLL_INPUTS, result: payrollLine(t, EMPTY_PAYROLL_INPUTS, PAYROLL_RULE_DEFAULTS, law) };
  };

  it('is a row before the taxable pay, which says what it was lowered by; the others after tax as before', () => {
    const line = lineWith([medical, loan]);
    const rows = breakdown(line, PAYROLL_RULE_DEFAULTS);
    const keys = rows.map((r) => r.key);
    expect(keys.slice(keys.indexOf('employeeInsurance'), keys.indexOf('tax') + 1)).toEqual(['employeeInsurance', 'adjustment-r1', 'taxable', 'tax']);
    expect(keys.slice(keys.indexOf('martyrsFund'), keys.indexOf('deductions') + 1)).toEqual(['martyrsFund', 'adjustment-l1', 'deductions']);
    expect(rows.find((r) => r.key === 'adjustment-r1')).toEqual({
      key: 'adjustment-r1',
      label: 'Recurring deduction',
      value: '−EGP 350.00',
      kind: 'cut',
      note: 'Medical subscription (family) · before tax: lowers the taxable pay',
    });
    expect(rows.find((r) => r.key === 'taxable')?.note).toBe(`After EGP 350.00 deducted before tax; a year's net income for tax: ${formatEgp(line.result.annualNetIncome)}`);
    expect(rows.find((r) => r.key === 'adjustment-l1')?.note).toBe('Car loan, 2 of 6 · after tax');
    // the tax is lower than with it after tax
    expect(line.result.monthlyTax).toBeLessThan(lineWith([{ ...medical, beforeTax: undefined }, loan]).result.monthlyTax);
  });

  it('says when the year’s limit held some of it back', () => {
    const line = lineWith([medical], { ...lawRatesFor(2026), beforeTaxHealthLimit: 2400 });
    expect(line.result).toMatchObject({ beforeTaxDeductions: 350, taxableLowered: 200 });
    expect(breakdown(line, PAYROLL_RULE_DEFAULTS).find((r) => r.key === 'taxable')?.note).toBe(
      `After EGP 200.00 of the EGP 350.00 deducted before tax (the before-tax limit, or the pay, holds back the rest); a year's net income for tax: ${formatEgp(line.result.annualNetIncome)}`,
    );
  });

  it('after tax, the rows read as they always did', () => {
    const line = lineWith([{ ...medical, beforeTax: undefined }]);
    const rows = breakdown(line, PAYROLL_RULE_DEFAULTS);
    const keys = rows.map((r) => r.key);
    expect(keys.slice(keys.indexOf('employeeInsurance'), keys.indexOf('taxable') + 1)).toEqual(['employeeInsurance', 'taxable']);
    expect(rows.find((r) => r.key === 'adjustment-r1')?.note).toBe('Medical subscription (family) · after tax');
    expect(rows.find((r) => r.key === 'taxable')?.note).toBe(`A year's net income for tax: ${formatEgp(line.result.annualNetIncome)}`);
  });
});

describe('breakdown: a Bonus (days) and a Penalty (days) (owner, 17 October 2026: "Yes, as proposed")', () => {
  // a bonus day is a day of the fixed 8,000: 1.5 × 8,000 ÷ 30 = 400. A penalty day a day of the contract's net: 10,000
  // less 1,100 insurance; taxable 8,900, × 12 − 20,000 = 86,800, tax 1,500 + 2,250 + 20% of 16,800 = 7,110 a year,
  // 592.50 a month; the Fund 5: a net of 8,302.50, ÷ 30 = 276.75
  const inDays: PayrollTerms = {
    ...terms,
    adjustments: [
      { id: 'b1', kind: 'addition', type: 'bonus_days', taxed: true, amount: null, days: 1.5, reason: 'Target met' },
      { id: 'p1', kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days: 1, reason: 'Late twice' },
    ],
  };
  const steps = breakdown(lineOf(inDays, EMPTY_PAYROLL_INPUTS), PAYROLL_RULE_DEFAULTS);
  const step = (key: string) => steps.find((s) => s.key === key);

  it('says each one’s days, what the run worked it out to and its reason', () => {
    expect(step('adjustment-b1')).toEqual({ key: 'adjustment-b1', label: 'Bonus (days)', value: 'EGP 400.00', kind: 'add', note: '1.5 days of the fixed part · Target met · taxed' });
    expect(step('adjustment-p1')).toEqual({
      key: 'adjustment-p1',
      label: 'Penalty (days)',
      value: '−EGP 276.75',
      kind: 'cut',
      note: "1 day of the contract's net · Late twice · after tax",
    });
    // no rows of the grid's
    expect(steps.find((s) => ['bonus', 'commission', 'settlements', 'penalties'].includes(s.key))).toBeUndefined();
  });
});

describe('breakdown: a line saved with the grid’s figures (before 17 October 2026), as it was', () => {
  // 1,000 commission and −100 settlements in the gross, 2 bonus days of 8,000 ÷ 30 = 533.33 and a penalty day: earned
  // 8,000 − 1,000 + 2,000 − 475 − 666.67 + 533.33 + 1,000 − 100 = 9,291.66
  const typed: SavedPayrollInputs = { ...inputs, bonusDays: 2, penaltyDays: 1, commission: 1000, settlements: -100 };
  const was = { ...terms, adjustments: undefined };
  const old = lineOf(was, typed, RULES_BEFORE);
  const steps = breakdown(old, RULES_BEFORE);
  const step = (key: string) => steps.find((s) => s.key === key);

  it('has its Bonus, Commission, Settlements and Penalties rows, with the days typed', () => {
    expect(old.result).toMatchObject({ bonus: 533.33, commission: 1000, settlements: -100, earned: 9291.66 });
    expect(steps.slice(steps.findIndex((s) => s.key === 'overtime') + 1, steps.findIndex((s) => s.key === 'earned')).map((s) => s.label)).toEqual([
      'Bonus',
      'Commission',
      'Settlements',
    ]);
    expect(step('bonus')).toMatchObject({ value: 'EGP 533.33', note: '2 days' });
    expect(step('settlements')).toMatchObject({ value: '−EGP 100.00', kind: 'cut' });
    expect(step('penalties')).toMatchObject({ value: cutText(old.result.penaltyCut), note: "1 day of the contract's net" });
  });
});

describe('breakdown: the attendance deduction waived by the CEO (owner, 17 October 2026)', () => {
  // "if there is an attendance deduction, allow the CEO to wave the deduction by ticking a box": the 1,000 off the fixed
  // 8,000 for 87.5% attendance
  const waived = lineOf(terms, { ...inputs, attendanceWaived: true });

  it('says what was waived on the attendance cut, which is 0', () => {
    expect(waived.result).toMatchObject({ attendanceCut: 0, attendanceWaived: 1000 });
    expect(stepOf(waived, 'attendanceCut')).toMatchObject({ value: 'EGP 0.00', note: 'Attendance deduction of EGP 1,000.00 waived by the CEO' });
    expect(stepOf(waived, 'attendance')?.note).toBe('Below 90%: its deduction waived by the CEO');
    expect(stepOf(lineOf(terms, inputs), 'attendanceCut')?.note).toBeUndefined();
  });

  it('offers the CEO the cut to waive, or the waiver to take back; nothing without a cut', () => {
    expect(waiverOf(lineOf(terms, inputs))).toEqual({ amount: 1000, waived: false });
    expect(waiverOf(waived)).toEqual({ amount: 1000, waived: true });
    // 150 of 152 hours: no cut
    expect(waiverOf(lineOf(terms, { ...inputs, workedHours: 150 }))).toBeNull();
    // a line worked out before the waiver existed
    const older: Partial<PayrollResult> = { ...lineOf(terms, inputs).result };
    delete older.attendanceWaived;
    expect(waiverOf({ inputs, result: older as PayrollResult })).toEqual({ amount: 1000, waived: false });
  });

  it('marks a waived line for HR and Finance', () => {
    expect(waivedByCeo(waived)).toBe(true);
    expect(waivedByCeo(lineOf(terms, inputs))).toBe(false);
  });
});

describe('breakdown: the permission hours (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours per day")', () => {
  it('says "Permission: 4:00" where the hours explain the attendance, counted as worked, from the permission approved', () => {
    // 133 worked and 4 of permission of the 152 expected: 137 ÷ 152 = 90.13%, at or above the grace
    const approved = lineOf({ ...terms, permissionHours: 4 }, inputs);
    expect(approved.result.permissionHours).toBe(4);
    expect(stepOf(approved, 'permission')).toEqual({ key: 'permission', label: 'Permission', value: '4:00', kind: 'info', note: 'Counted as worked, from the permission approved this month' });
    expect(stepOf(approved, 'hours')).toMatchObject({ value: '133:00 of 152:00', note: '137:00 with the permission hours, as attendance counts them' });
    expect(stepOf(approved, 'attendance')).toMatchObject({ value: '90.13%', note: 'At or above 90%: counts in full' });
    // the steps come in order: the hours worked, then the permission, then the attendance
    const keys = breakdown(approved, PAYROLL_RULE_DEFAULTS).map((r) => r.key);
    expect(keys.indexOf('permission')).toBe(keys.indexOf('hours') + 1);
    expect(keys.indexOf('attendance')).toBe(keys.indexOf('permission') + 1);
  });

  it('says so when HR typed them, and has no row without any, without worked hours, or by the hour', () => {
    const typed = lineOf({ ...terms, permissionHours: 4 }, { ...inputs, permissionHours: 1.5 });
    expect(stepOf(typed, 'permission')).toMatchObject({ value: '1:30', note: 'Counted as worked, as typed by HR' });
    expect(stepOf(lineOf(terms, inputs), 'permission')).toBeUndefined();
    expect(stepOf(lineOf(terms, inputs), 'hours')).toEqual({ key: 'hours', label: 'Hours worked', value: '133:00 of 152:00', kind: 'info' });
    // attendance not tracked: nothing to add them to
    expect(stepOf(lineOf({ ...terms, permissionHours: 4 }, { ...inputs, workedHours: null }), 'permission')).toBeUndefined();
    const hourly = lineOf({ ...terms, payBasis: 'hourly', hourlyRate: 60, permissionHours: 4 }, { ...EMPTY_PAYROLL_INPUTS, workedHours: 100 });
    expect(stepOf(hourly, 'permission')).toBeUndefined();
  });
});

describe('a line’s breakdown with make-up hours (owner, 20 October 2026: "within the same month")', () => {
  it('says what above the expected hours wasn’t counted while overtime isn’t paid, nothing otherwise', () => {
    // 160 worked of 152 expected on a shift that counts hours until a time: 152 counted, 8 left out, no overtime
    const madeUp = lineOf({ ...terms, makeUpHours: true }, { ...inputs, workedHours: 160 });
    expect(madeUp.result).toMatchObject({ attendanceRatio: 1, hoursOverExpected: 8, overtime: 0 });
    expect(stepOf(madeUp, 'hours')).toEqual({
      key: 'hours',
      label: 'Hours worked',
      value: '160:00 of 152:00',
      kind: 'info',
      note: '8:00 above the expected hours not counted: extra time fills short hours, never overtime',
    });
    expect(stepOf(madeUp, 'attendance')).toMatchObject({ value: '100%', note: 'At or above 90%: counts in full' });
    // with the permission hours too: both said
    expect(stepOf(lineOf({ ...terms, makeUpHours: true, permissionHours: 4 }, { ...inputs, workedHours: 150 }), 'hours')?.note).toBe(
      '154:00 with the permission hours, as attendance counts them; 2:00 above the expected hours not counted: extra time fills short hours, never overtime',
    );
    // not on such a shift: as before
    expect(stepOf(lineOf(terms, { ...inputs, workedHours: 160 }), 'hours')).toEqual({ key: 'hours', label: 'Hours worked', value: '160:00 of 152:00', kind: 'info' });
  });
});

describe('a line’s KPI from the KPIs module (owner, 21 October 2026: "Last month’s KPI, this pay")', () => {
  // the October run reads September's final scorecard; the line's KPI inputs (a performance of 65%) don't count then
  const kpiOf = (finalPercent: number, level: 'needs_improvement' | 'meets' | 'unsatisfactory') => ({ month: '2026-09', scorecardId: 'sc-1', finalPercent, level });
  // the rules of a run made before attendance left the KPI: a line from before the module averaged it in
  const step = (t: PayrollTerms, key = 'kpi') => breakdown(lineOf(t, inputs, RULES_BEFORE), RULES_BEFORE, undefined, '2026-10').find((s) => s.key === key);

  it('says the final %, the level and what it does to the variable part, with the scorecard’s link ("As the sheet: full at 80%+")', () => {
    expect(step({ ...terms, kpi: kpiOf(86, 'needs_improvement') })).toEqual({
      key: 'kpi',
      label: 'KPI score',
      value: '86%',
      kind: 'info',
      note: "KPI (September 2026): 86% · Needs improvement · paid in full (80%+). Last month's KPI counts in this month's pay.",
      link: { href: '/kpis/scorecards/sc-1', label: 'Open the September 2026 scorecard' },
    });
    // in full: nothing off the variable 2,000
    expect(step({ ...terms, kpi: kpiOf(86, 'needs_improvement') }, 'kpiCut')?.value).toBe('EGP 0.00');
    // below 80%: the variable part at 70%, 600 off it
    expect(step({ ...terms, kpi: kpiOf(70, 'needs_improvement') })).toMatchObject({
      value: '70%',
      note: "KPI (September 2026): 70% · Needs improvement · variable paid at 70%. Last month's KPI counts in this month's pay.",
    });
    expect(step({ ...terms, kpi: kpiOf(70, 'needs_improvement') }, 'kpiCut')?.value).toBe('−EGP 600.00');
    expect(step({ ...terms, kpi: kpiOf(55.5, 'unsatisfactory') })?.note).toBe(
      "KPI (September 2026): 55.5% · Unsatisfactory · variable paid at 55.5%. Last month's KPI counts in this month's pay.",
    );
  });

  it('isn’t cut with no final scorecard, and has no link then', () => {
    expect(step({ ...terms, kpi: null })).toEqual({
      key: 'kpi',
      label: 'KPI score',
      value: 'None',
      kind: 'info',
      note: "KPI (September 2026): no final scorecard · not cut. Last month's KPI counts in this month's pay.",
    });
    expect(step({ ...terms, kpi: null }, 'kpiCut')?.value).toBe('EGP 0.00');
  });

  it('takes the month before the run’s, else the scorecard’s own', () => {
    expect(kpiStep(kpiOf(92, 'meets'), PAYROLL_RULE_DEFAULTS, '2027-01').note).toBe(
      "KPI (December 2026): 92% · Meets expectations · paid in full (80%+). Last month's KPI counts in this month's pay.",
    );
    expect(kpiStep(kpiOf(92, 'meets'), PAYROLL_RULE_DEFAULTS).note?.startsWith('KPI (September 2026): 92%')).toBe(true);
    expect(kpiStep(null, { kpiGracePercent: 80 }).note).toBe("KPI: no final scorecard · not cut. Last month's KPI counts in this month's pay.");
  });

  it('says a scorecard that is performance only is so (owner, 25 October 2026: "Fixed cut only")', () => {
    expect(kpiStep({ ...kpiOf(86, 'needs_improvement'), attendanceCounted: false }, PAYROLL_RULE_DEFAULTS, '2026-11').note).toBe(
      "KPI (October 2026): 86% · Needs improvement · paid in full (80%+). Last month's KPI counts in this month's pay. The KPI is performance only: attendance is cut on the fixed part.",
    );
    // one whose Attendance metric counted, or a line from before then: as it was
    for (const kpi of [{ ...kpiOf(86, 'needs_improvement'), attendanceCounted: true }, kpiOf(86, 'needs_improvement')]) {
      expect(kpiStep(kpi, PAYROLL_RULE_DEFAULTS, '2026-11').note).toBe("KPI (October 2026): 86% · Needs improvement · paid in full (80%+). Last month's KPI counts in this month's pay.");
    }
  });

  it('keeps a line from before the module as it was: the KPI inputs averaged with attendance', () => {
    expect(step(terms)).toMatchObject({ value: '76.25%', note: 'The average of performance 65% and attendance 87.5%; at or above 80% counts in full' });
    expect(step(terms)?.link).toBeUndefined();
  });

  it('has no KPI step on pay by the hour, which has no KPI cut', () => {
    const hourly = { ...terms, payBasis: 'hourly' as const, hourlyRate: 100, expectedHours: null, expectedDays: null, kpi: kpiOf(60, 'unsatisfactory') };
    expect(breakdown(lineOf(hourly, { ...EMPTY_PAYROLL_INPUTS, workedHours: 100 }), PAYROLL_RULE_DEFAULTS, undefined, '2026-10').find((s) => s.key === 'kpi')).toBeUndefined();
  });
});
