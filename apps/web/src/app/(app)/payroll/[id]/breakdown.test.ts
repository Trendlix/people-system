import { EMPTY_PAYROLL_INPUTS, lawRatesFor, PAYROLL_RULE_DEFAULTS, payrollLine, type PayrollInputs, type PayrollResult, type PayrollTerms } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { breakdown, cutText, expectedHoursNote, percentText } from './breakdown';

// An invented employee's month, worked out by hand: one no-show day of an 8-hour shift, so 238 hours worked of the 280
// expected less 8 is 87.5%, below the 90% grace: 1,000 off the fixed 8,000. A performance of 65%: (87.5 + 65) ÷ 2 =
// 76.25%, below 80%: 475 off the variable 2,000. The no-show day 2 × 10,000 ÷ 30 = 666.67. Earned 8,000 − 1,000 +
// 2,000 − 475 − 666.67 + 1,000 commission − 100 settlements = 8,758.33. Taxable 8,758.33 + 500 − 1,100 = 8,158.33;
// × 12 − 20,000 = 77,890 a year; tax 1,500 + 2,250 + 20% of 7,890 = 5,328, 444 a month. Martyrs' Fund 9,258.33 ×
// 0.05% = 4.63. Deductions 1,548.63; net 8,758.33 + 500 − 1,548.63 = 7,709.70; 1,000 released.
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
};

const result: PayrollResult = {
  fixed: 8000,
  variable: 2000,
  absentHours: 8,
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
  warnings: [],
};

const inputs: PayrollInputs = { ...EMPTY_PAYROLL_INPUTS, noShowDays: 1, workedHours: 238, expectedHours: 280, performance: 65, commission: 1000, settlements: -100, released: 1000 };
const line = { payBasis: 'monthly' as const, terms, inputs, result };

const row = (key: string) => breakdown(line, PAYROLL_RULE_DEFAULTS).find((r) => r.key === key);

describe('a line’s breakdown', () => {
  it('is payrollLine’s line, worked out by hand above', () => {
    expect(payrollLine(terms, inputs)).toEqual(result);
  });

  it('goes through every step, in order', () => {
    expect(breakdown(line, PAYROLL_RULE_DEFAULTS).map((r) => r.label)).toEqual([
      'Fixed',
      'Variable',
      'Hours worked',
      'Attendance',
      'Attendance cut',
      'KPI score',
      'KPI cut',
      'No-show cut',
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

  it('explains the attendance, the KPIs, the no-shows and the insurance', () => {
    // the no-show day's hours out of the expected hours (owner's decisions, 16 October 2026)
    expect(row('hours')).toMatchObject({ value: '238:00 of 272:00', kind: 'info', note: '280:00 expected as typed, less 8:00 for the no-show day' });
    expect(row('attendance')).toMatchObject({ value: '87.5%', note: 'Below 90%: the fixed part follows it' });
    // the KPIs typed, which the inputs grid no longer shows
    expect(row('kpi')).toMatchObject({ value: '76.25%', note: 'The average of performance 65% and attendance 87.5%; at or above 80% counts in full' });
    expect(row('noShowCut')?.note).toBe("1 day, each costing 2 days' pay");
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

  it('shows the hours as typed on a line worked out before the no-show days’ hours came out (16 October 2026)', () => {
    const older: Partial<PayrollResult> = { ...result, attendanceRatio: 0.85, attendanceScore: 0.85 };
    delete older.absentHours;
    const steps = breakdown({ ...line, result: older as PayrollResult }, PAYROLL_RULE_DEFAULTS);
    expect(steps.find((r) => r.key === 'hours')).toMatchObject({ value: '238:00 of 280:00', note: 'Expected hours as typed' });
  });

  it('says where the expected hours came from: the shift less the holidays unless HR typed them (16 October 2026)', () => {
    // 22 working days of an 8-hour shift less 1 holiday: 168 hours; the no-show day's 8 out of them
    const fromShift = { ...terms, expectedHours: 168, expectedDays: { workingDays: 22, holidays: 1 } };
    const hoursOf = (t: PayrollTerms, i: Partial<PayrollInputs>, r: Partial<PayrollResult> = {}) =>
      breakdown({ ...line, terms: t, inputs: { ...inputs, ...i }, result: { ...result, ...r } }, PAYROLL_RULE_DEFAULTS).find((s) => s.key === 'hours');
    expect(hoursOf(fromShift, { expectedHours: null })).toMatchObject({
      value: '238:00 of 160:00',
      note: '168:00 expected from 22 working days of the shift less 1 holiday, at 8:00 a day; less 8:00 for the no-show day',
    });
    expect(hoursOf({ ...fromShift, expectedDays: { workingDays: 21, holidays: 0 } }, { expectedHours: null, noShowDays: null }, { absentHours: 0 })?.note).toBe(
      '168:00 expected from 21 working days of the shift, at 8:00 a day',
    );
    // typed over: HR's figure, as typed
    expect(hoursOf(fromShift, {})).toMatchObject({ value: '238:00 of 272:00', note: '280:00 expected as typed, less 8:00 for the no-show day' });
    // without a shift's figure or a typed one: no hours row
    expect(hoursOf(terms, { expectedHours: null })).toBeUndefined();
    expect(expectedHoursNote({ ...fromShift, expectedDays: null }, { ...inputs, expectedHours: null }, 0)).toBe('168:00 expected from the shift');
  });

  it('says when attendance isn’t tracked or can’t be counted, the part month, and who has no insurance deducted', () => {
    const untracked = breakdown(
      { ...line, inputs: EMPTY_PAYROLL_INPUTS, terms: { ...terms, paidDays: 19, insured: false }, result: { ...result, attendanceRatio: null, attendanceScore: 1 } },
      PAYROLL_RULE_DEFAULTS,
    );
    const find = (key: string) => untracked.find((r) => r.key === key);
    expect(find('attendance')).toMatchObject({ value: 'Not tracked', note: 'No hours typed: counts in full' });
    expect(find('hours')).toBeUndefined();
    // hours typed, but the no-show days' hours are all of them: the warnings say so
    const notCounted = breakdown({ ...line, inputs: { ...inputs, expectedHours: 8 }, result: { ...result, attendanceRatio: null, attendanceScore: 1 } }, PAYROLL_RULE_DEFAULTS);
    expect(notCounted.find((r) => r.key === 'hours')).toMatchObject({ value: '238:00 of 0:00', note: '8:00 expected as typed, less 8:00 for the no-show day' });
    expect(notCounted.find((r) => r.key === 'attendance')).toMatchObject({ value: 'Not counted', note: 'See the warnings: counts in full' });
    expect(find('fixed')?.note).toBe('80% of the gross, for 19 of 30 days');
    expect(find('employeeInsurance')?.note).toBe('Not registered with social insurance: nothing deducted');
    const freelance = breakdown({ ...line, terms: { ...terms, statutory: false } }, PAYROLL_RULE_DEFAULTS);
    expect(freelance.find((r) => r.key === 'employeeInsurance')?.note).toBe('Freelance: no social insurance, tax or Martyrs’ fund');
  });

  it('pays the hours at the rate for pay by the hour, with no split or cuts', () => {
    const hourly = breakdown(
      {
        payBasis: 'hourly',
        terms: { ...terms, payBasis: 'hourly', hourlyRate: 100 },
        inputs: { ...EMPTY_PAYROLL_INPUTS, workedHours: 120.5 },
        result: { ...result, fixed: 0, variable: 0, earned: 12_950, bonus: 0, commission: 1000, settlements: -100 },
      },
      PAYROLL_RULE_DEFAULTS,
    );
    expect(hourly.slice(0, 2).map((r) => r.label)).toEqual(['Pay for the hours', 'Bonus']);
    expect(hourly[0]).toMatchObject({ value: 'EGP 12,050.00', note: '120:30 hours at EGP 100.00 an hour' });
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
