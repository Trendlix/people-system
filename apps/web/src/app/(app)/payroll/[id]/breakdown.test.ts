import {
  EMPTY_PAYROLL_INPUTS,
  lawRatesFor,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  type PayrollInputs,
  type PayrollResult,
  type PayrollSegment,
  type PayrollTerms,
} from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { breakdown, cutText, expectedHoursNote, percentText, shiftHoursNote } from './breakdown';

// An invented employee's month, worked out by hand. The shift: 22 working days in the month less 1 holiday, at 8:00 to
// work a day, 168:00 scheduled; a no-show day and a leave day come out of them, a day of the shift each (owner,
// 17 October 2026): 168 − 2 × 8 = 152 expected. 133 worked of 152 is 87.5%, below the 90% grace: 1,000 off the fixed
// 8,000. A performance of 65%: (87.5 + 65) ÷ 2 = 76.25%, below 80%: 475 off the variable 2,000. The no-show day 2 ×
// 10,000 ÷ 30 = 666.67; the leave day costs nothing. Earned 8,000 − 1,000 + 2,000 − 475 − 666.67 + 1,000 commission −
// 100 settlements = 8,758.33. Taxable 8,758.33 + 500 − 1,100 = 8,158.33; × 12 − 20,000 = 77,899.96, 77,890 a year (to
// the 10 below); tax 1,500 + 2,250 + 20% of 7,890 = 5,328, 444 a month. Martyrs' Fund 9,258.33 × 0.05% = 4.63.
// Deductions 1,548.63; net 8,758.33 + 500 − 1,548.63 = 7,709.70; 1,000 released. No warnings: the most attendance
// counts, (22 − 1 holiday − 2 days off) × 8 = 152, is not less than the 133 worked.
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
  kpiCut: 475,
  noShowCut: 666.67,
  overtime: 0,
  bonus: 0,
  commission: 1000,
  settlements: -100,
  earned: 8758.33,
  allowances: 500,
  taxableAllowances: 500,
  insuredWage: 10_000,
  employeeInsurance: 1100,
  employerInsurance: 1875,
  monthlyTaxable: 8158.33,
  annualNetIncome: 77_890,
  monthlyTax: 444,
  martyrsFund: 4.63,
  penaltyCut: 0,
  deductions: 1548.63,
  net: 7709.7,
  released: 1000,
  transfer: 6709.7,
  companyCost: 11_133.33,
  // no additions or deductions this month (17 October 2026)
  additionsTaxed: 0,
  additionsUntaxed: 0,
  adjustmentDeductions: 0,
  warnings: [],
};

const inputs: PayrollInputs = {
  ...EMPTY_PAYROLL_INPUTS,
  noShowDays: 1,
  leaveDays: 1,
  workedHours: 133,
  performance: 65,
  commission: 1000,
  settlements: -100,
  released: 1000,
};
const line = { payBasis: 'monthly' as const, terms, inputs, result };

type Line = Parameters<typeof breakdown>[0];

const row = (key: string) => breakdown(line, PAYROLL_RULE_DEFAULTS).find((r) => r.key === key);

/** A line as payrollLine works it out now. */
const lineOf = (t: PayrollTerms, i: PayrollInputs): Line => ({ payBasis: t.payBasis, terms: t, inputs: i, result: payrollLine(t, i) });

/** A step of a line's breakdown, by its key. */
const stepOf = (l: Line, key: string) => breakdown(l, PAYROLL_RULE_DEFAULTS).find((s) => s.key === key);

describe('a line’s breakdown', () => {
  it('is payrollLine’s line, worked out by hand above', () => {
    expect(payrollLine(terms, inputs)).toEqual(result);
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
      'Bonus',
      'Commission',
      'Settlements',
      'Earned',
      'Allowances',
      'Insured wage',
      'Social insurance',
      'Taxable pay',
      'Income tax',
      'Martyrs’ fund',
      'Penalties',
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
    expect(row('settlements')).toMatchObject({ value: '−EGP 100.00', kind: 'cut' });
    expect(row('overtime')?.value).toBe('EGP 0.00');
    expect(row('net')).toMatchObject({ value: 'EGP 7,709.70', kind: 'total' });
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
    expect(row('leave')).toMatchObject({ value: '1 day', kind: 'info', note: 'Paid leave: nothing cut, and not counted in attendance' });
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
    const kpi = (i: Partial<PayrollInputs>, r: Partial<PayrollResult>) => breakdown({ ...line, inputs: { ...inputs, ...i }, result: { ...result, ...r } }, PAYROLL_RULE_DEFAULTS).find((s) => s.key === 'kpi');
    // (100 + 70 + 65 + 72.5) ÷ 4 = 76.875%
    expect(kpi({ softSkills: 70, clientSatisfaction: 72.5 }, { attendanceScore: 1, kpiScore: 0.76875 })).toMatchObject({
      value: '76.88%',
      note: 'The average of soft skills 70%, performance 65%, client satisfaction 72.5% and attendance 100%; at or above 80% counts in full',
    });
    expect(kpi({ performance: null }, { kpiScore: 1, kpiCut: 0 })).toMatchObject({ value: '100%', note: "No KPIs given: the variable part isn't cut" });
    // a line worked out before then took the attendance alone
    expect(kpi({ performance: null }, { kpiScore: 0.875 })).toMatchObject({ value: '87.5%', note: 'No KPIs given: the attendance alone' });
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
        result: { ...result, fixed: 0, variable: 0, expectedHours: null, earned: 12_950, bonus: 0, commission: 1000, settlements: -100 },
      },
      PAYROLL_RULE_DEFAULTS,
    );
    expect(hourly.slice(0, 2).map((r) => r.label)).toEqual(['Pay for the hours', 'Bonus']);
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

  it('are HR’s when typed, taken as already without the no-show and leave days: nothing more out of them', () => {
    // HR's 140 with the no-show and the leave day still given: 133 of 140 is 95%, counted in full
    const typed = lineOf(terms, { ...inputs, expectedHours: 140 });
    expect(typed.result).toMatchObject({ expectedHours: 140, absentHours: 0, leaveHours: 0, attendanceCut: 0 });
    expect(stepOf(typed, 'expected')).toMatchObject({ value: '140:00', note: 'As typed by HR: already without the no-show and leave days' });
    expect(stepOf(typed, 'hours')?.value).toBe('133:00 of 140:00');
    expect(stepOf(typed, 'attendance')).toMatchObject({ value: '95%', note: 'At or above 90%: counts in full' });
  });

  it('are HR’s alone without a shift; with none typed, the hours worked stand alone', () => {
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
    expect(stepOf(leave, 'leave')).toMatchObject({ value: '2 days', note: 'Paid leave: nothing cut, and not counted in attendance' });
    expect(leave.result).toMatchObject({ expectedHours: 144, attendanceCut: 0, noShowCut: 666.67 });
    expect(stepOf(lineOf(terms, { ...inputs, leaveDays: null }), 'leave')).toBeUndefined();
    expect(stepOf(lineOf(terms, { ...inputs, leaveDays: 0 }), 'leave')).toBeUndefined();
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
  const split: PayrollTerms = { ...terms, gross: 12_000, allowances: [transport(600), mobile], segments: [first, renewal] };
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
    expect(keys.slice(keys.indexOf('settlements'), keys.indexOf('earned') + 1)).toEqual(['settlements', 'adjustment-a1', 'earned']);
    expect(keys.slice(keys.indexOf('penalties'), keys.indexOf('net') + 1)).toEqual(['penalties', 'adjustment-a3', 'deductions', 'adjustment-a2', 'net']);
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
    expect(breakdown({ payBasis: 'monthly', terms, inputs: EMPTY_PAYROLL_INPUTS, result: payrollLine(terms, EMPTY_PAYROLL_INPUTS) }, PAYROLL_RULE_DEFAULTS).some((r) => r.key.startsWith('adjustment-'))).toBe(false);
  });
});
