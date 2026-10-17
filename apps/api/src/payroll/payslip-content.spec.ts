import { payrollLine, PAYROLL_RULE_DEFAULTS, type PayrollAdjustmentItem, type PayrollSegment } from '@trendlix/shared';
import { BONUS_DAY, MONTHLY_TERMS, payslipSource } from '../../test/fixtures/payslip.js';
import {
  arabicNumerals,
  formatAmount,
  payslipContent,
  withoutMarks,
  yearToDate,
  type PayslipContent,
  type PayslipRow,
  type YearToDateLine,
} from './payslip-content.js';

// What a payslip says (owner's decisions, 16 October 2026, on the payslip proposal): the proposal's two people, their
// figures payrollLine's own, so the payslip shows exactly the approved line, row by row.

/** Mariam's shift hours for October: 22 working days of 8 hours, no holidays (her expected hours when HR types none). */
const SHIFT = { expectedHours: 176, expectedDays: { workingDays: 22, holidays: 0 } };

/** A Penalty (days) (owner, 17 October 2026: the grid's penalty days moved to Additions / Deductions). */
const penaltyDays = (days: number): PayrollAdjustmentItem => ({ id: `adj-penalty-${days}`, kind: 'deduction', type: 'penalty_days', taxed: false, amount: null, days, reason: 'Late twice' });

/** No bonus day: none of the month's additions and deductions. */
const NONE = { adjustments: [] };

const labels = (rows: readonly PayslipRow[] | undefined) => (rows ?? []).map((r) => r.label);
const sum = (rows: readonly PayslipRow[]) => rows.reduce((cents, r) => cents + Math.round(r.value * 100), 0) / 100;

/** Every piece of text a payslip prints. */
function texts(c: PayslipContent): string[] {
  const rows = (list: readonly PayslipRow[]) => list.flatMap((r) => [r.label, r.note ?? '', r.amount]);
  return [
    c.company.name,
    c.company.line ?? '',
    ...Object.values(c.title).map((v) => v ?? ''),
    ...c.facts.flatMap((f) => [f.label, f.value]),
    ...(c.thisMonth ? [c.thisMonth.heading, c.thisMonth.line ?? '', ...c.thisMonth.cells.flatMap((x) => [x.label, x.value, x.note ?? ''])] : []),
    ...[c.earnings, c.deductions].flatMap((s) => (s ? [s.heading, ...rows(s.rows), ...rows([s.total])] : [])),
    c.net.label,
    c.net.amount,
    c.net.currency,
    c.net.words ?? '',
    ...rows(c.afterNet),
    c.companyShare ?? '',
    ...(c.yearToDate ? [c.yearToDate.heading, c.yearToDate.period, ...c.yearToDate.cells.flatMap((x) => [x.label, x.value])] : []),
    c.footer.issued,
    c.footer.note,
  ].filter(Boolean);
}

describe('payslipContent: a monthly salary in English', () => {
  const c = payslipContent(payslipSource('monthly'), 'en');

  it('heads it with the company, the month and the day it was paid', () => {
    expect(c).toMatchObject({ language: 'en', rtl: false, company: { name: 'TrendLIX', line: 'Cairo · Tax registration no. 512-384-907' } });
    expect(c.title).toEqual({ kind: 'Payslip', month: 'October 2026', paid: 'Paid on 29/10/2026' });
  });

  it('gives the facts, label above value, the account by its last 4 digits only', () => {
    expect(c.facts).toEqual([
      { label: 'Name', value: 'Mariam Adel Hassan' },
      { label: 'Employee code', value: 'EMP-0142' },
      { label: 'Job title', value: 'Senior Content Writer' },
      { label: 'Department', value: 'Marketing › Content Team' },
      { label: 'Employment', value: 'Full-time · since 01/03/2025' },
      { label: 'Social insurance no.', value: '28461937' },
      { label: 'Paid to', value: 'CIB · account ending 4821' },
      { label: 'Days paid', value: '30 of 30' },
    ]);
    expect(texts(c).join(' ')).not.toContain('100045214821');
  });

  it('explains the month: the hours against the grace, the KPI average and the variable it pays, the bonus days', () => {
    expect(c.thisMonth).toEqual({
      heading: 'This Month',
      cells: [
        { label: 'Hours worked', value: '165:30 of 176:00', note: '94.03%: counts as full (90% or more)' },
        { label: 'KPI average', value: '76.75%', note: 'Below 80%: variable paid at 76.75%' },
        { label: 'Bonus days', value: '1', note: 'Days of the fixed salary' },
      ],
      line: 'Soft skills 70% · Performance 65% · Client satisfaction 72% · Attendance 100%',
    });
  });

  it('lists the earnings the line has, the cuts as minus, each allowance by name; they add up to the total', () => {
    expect(c.earnings!.rows).toEqual([
      { label: 'Fixed salary', note: '80% of the 24,000.00 gross', amount: '19,200.00', value: 19200 },
      { label: 'Variable salary', note: '20% of the gross', amount: '4,800.00', value: 4800 },
      { label: 'Performance adjustment', note: 'Variable paid at 76.75%', amount: '−1,116.00', value: -1116 },
      { label: 'Transportation allowance', note: 'Not taxed', amount: '1,500.00', value: 1500 },
      { label: 'Mobile allowance', note: null, amount: '500.00', value: 500 },
      // the Bonus (days) on Additions / Deductions (17 October 2026), with its days and reason: 19,200 ÷ 30
      { label: 'Bonus (days)', note: '1 day of the fixed salary · Campaign launch', amount: '640.00', value: 640 },
    ]);
    expect(c.earnings!.total).toEqual({ label: 'Total earnings', note: null, amount: '25,524.00', value: 25524 });
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
  });

  it('lists the deductions with how each is worked out; they add up to the line’s deductions', () => {
    expect(c.deductions!.rows).toEqual([
      { label: 'Social insurance', note: '11% of the insured wage, 16,700.00', amount: '1,837.00', value: 1837 },
      { label: 'Salary tax', note: null, amount: '3,346.17', value: 3346.17 },
      { label: 'Martyrs’ Fund', note: '0.05% of the pay', amount: '12.01', value: 12.01 },
    ]);
    // 1,837 + 3,346.17 + 12.01
    expect(c.deductions!.total).toMatchObject({ label: 'Total deductions', amount: '5,195.18', value: 5195.18 });
    expect(sum(c.deductions!.rows)).toBe(c.deductions!.total.value);
  });

  it('gives the net in figures and words, what was paid already, the transfer, and the company’s share', () => {
    // 25,524 − 5,195.18; less the 2,000 already paid
    expect(c.net).toEqual({ label: 'Net pay', amount: '20,328.82', currency: 'EGP', words: 'Twenty thousand three hundred twenty-eight Egyptian pounds and eighty-two piasters only' });
    expect(c.afterNet).toEqual([
      { label: 'Already paid this month', note: null, amount: '−2,000.00', value: -2000 },
      { label: 'Transferred to CIB ···4821', note: null, amount: '18,328.82', value: 18328.82 },
    ]);
    expect(c.companyShare).toBe('On top of your pay, the company pays 3,131.25 social insurance for you: 18.75% of the insured wage.');
  });

  it('ends with the year to date, the approval, the reference and that it needs no signature', () => {
    expect(c.yearToDate).toEqual({
      heading: 'Year to Date',
      period: 'January to October 2026',
      cells: [
        { label: 'Earnings', value: '252,876.00' },
        { label: 'Salary tax', value: '33,180.45' },
        { label: 'Social insurance', value: '18,370.00' },
        { label: 'Net pay', value: '197,699.59' },
      ],
    });
    expect(c.footer).toEqual({
      issued: 'Approved by the CEO on 27/10/2026 · Issued on 29/10/2026 · PAY-2026-10 · EMP-0142',
      note: 'Issued by the system; it needs no signature. Confidential to the employee.',
    });
  });

  it('leaves off the company cost, the tax working, HR’s comments and warnings, the IBAN and the national ID', () => {
    const r = payslipSource('monthly').line.result;
    const all = texts(c).join(' | ');
    for (const hidden of [r.companyCost, r.monthlyTaxable, r.annualNetIncome]) expect(all).not.toContain(formatAmount(hidden));
    expect(all).not.toMatch(/company cost|taxable|annual/i);
  });

  it('titles every heading in Title Case', () => {
    expect([c.thisMonth!.heading, c.earnings!.heading, c.deductions!.heading, c.yearToDate!.heading]).toEqual(['This Month', 'Earnings', 'Deductions', 'Year to Date']);
  });
});

describe('payslipContent: rows that are 0 are left out', () => {
  it('no bonus, released or KPIs: no row, no cell, no line for them', () => {
    const c = payslipContent(payslipSource('monthly', { terms: NONE, inputs: { released: null, softSkills: null, performance: null, clientSatisfaction: null } }), 'en');
    expect(labels(c.earnings?.rows)).toEqual(['Fixed salary', 'Variable salary', 'Transportation allowance', 'Mobile allowance']);
    expect(labels(c.deductions?.rows)).toEqual(['Social insurance', 'Salary tax', 'Martyrs’ Fund']);
    expect(c.thisMonth!.cells.map((x) => x.label)).toEqual(['Hours worked']);
    expect(c.thisMonth!.line).toBeNull();
    expect(labels(c.afterNet)).toEqual(['Transferred to CIB ···4821']);
  });

  it('nothing typed for the month: no This Month section at all', () => {
    const c = payslipContent(payslipSource('monthly', { terms: NONE, inputs: { workedHours: null, expectedHours: null, softSkills: null, performance: null, clientSatisfaction: null } }), 'en');
    expect(c.thisMonth).toBeNull();
  });

  it('a freelancer with nothing deducted: no deductions section, no insurance number, no company share', () => {
    const c = payslipContent(payslipSource('monthly', { terms: { statutory: false } }), 'en');
    expect(c.deductions).toBeNull();
    expect(c.facts.map((f) => f.label)).not.toContain('Social insurance no.');
    expect(c.companyShare).toBeNull();
    // the net is what was earned: nothing deducted
    expect(c.net.amount).toBe(c.earnings!.total.amount);
  });

  it('not registered with social insurance: no insurance row, number or company share; the year to date leaves it out', () => {
    const source = payslipSource('monthly', { terms: { insured: false } });
    const c = payslipContent({ ...source, yearToDate: { ...source.yearToDate!, insurance: 0 } }, 'en');
    expect(labels(c.deductions!.rows)).not.toContain('Social insurance');
    expect(c.facts.map((f) => f.label)).not.toContain('Social insurance no.');
    expect(c.companyShare).toBeNull();
    expect(c.yearToDate!.cells.map((x) => x.label)).toEqual(['Earnings', 'Salary tax', 'Net pay']);
  });

  it('nothing transferred (all of it paid out already): no transfer row', () => {
    const net = payslipSource('monthly').line.result.net;
    const c = payslipContent(payslipSource('monthly', { inputs: { released: net } }), 'en');
    expect(labels(c.afterNet)).toEqual(['Already paid this month']);
  });
});

describe('payslipContent: the month’s cuts and extras, with the run’s own rules', () => {
  it('attendance below the grace: the cell says so, and the fixed salary’s cut is a row', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { workedHours: 149.6, softSkills: null, performance: null, clientSatisfaction: null } }), 'en');
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '149:36 of 176:00', note: '85.00%: below 90%, fixed salary paid at 85.00%' });
    expect(c.earnings!.rows.find((r) => r.label === 'Attendance adjustment')).toEqual({ label: 'Attendance adjustment', note: 'Fixed salary paid at 85.00%', amount: '−2,880.00', value: -2880 });
  });

  it('the grace percents are the run’s, not fixed ones', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { workedHours: 149.6 }, rules: { attendanceGracePercent: 85, kpiGracePercent: 75 } }), 'en');
    expect(c.thisMonth!.cells[0].note).toBe('85.00%: counts as full (85% or more)');
    expect(c.thisMonth!.cells[1].note).toBe('Counts as full (75% or more)');
    expect(labels(c.earnings!.rows)).not.toContain('Attendance adjustment');
  });

  it('overtime above the overtime percent, when the run pays it: the cell says so, and the overtime is a row', () => {
    const paying = { payOvertime: true };
    const c = payslipContent(payslipSource('monthly', { inputs: { workedHours: 202.4, softSkills: null, performance: null, clientSatisfaction: null }, rules: paying }), 'en');
    expect(c.thisMonth!.cells[0].note).toBe('115.00%: overtime paid above 110%');
    const overtime = c.earnings!.rows.find((r) => r.label === 'Overtime')!;
    expect(overtime).toMatchObject({ note: 'Attendance above 110%, at 1.5', value: payslipSource('monthly', { inputs: { workedHours: 202.4 }, rules: paying }).line.result.overtime });
    expect(overtime.value).toBeGreaterThan(0);
  });

  it('no overtime while the run doesn’t pay it (owner, 16 October 2026: "No overtime for now"): counts as full, no row', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { workedHours: 202.4, softSkills: null, performance: null, clientSatisfaction: null } }), 'en');
    expect(c.thisMonth!.cells[0].note).toBe('115.00%: counts as full (90% or more)');
    expect(labels(c.earnings!.rows)).not.toContain('Overtime');
  });

  it('no-show and penalty days: a cell each, the no-show cut in the earnings, the Penalty (days) in the deductions', () => {
    const source = payslipSource('monthly', { terms: { ...SHIFT, adjustments: [BONUS_DAY, penaltyDays(2)] }, inputs: { expectedHours: null, noShowDays: 1 } });
    const c = payslipContent(source, 'en');
    // the day's 8 hours out of the shift's 176 (owner's decisions, 16 and 17 October 2026): 165:30 of 168:00 is 98.51%
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '165:30 of 168:00', note: '98.51%: counts as full (90% or more)' });
    expect(c.thisMonth!.cells.slice(3)).toEqual([
      { label: 'No-show days', value: '1', note: 'Each costs 2 days’ pay; their 8:00 hours aren’t counted again in attendance' },
      { label: 'Penalty days', value: '2', note: 'A day’s net salary each' },
    ]);
    // 1 × 2 × 24,000 ÷ 30
    expect(c.earnings!.rows.find((r) => r.label === 'No-show')).toMatchObject({ note: '1 day, 2 days’ pay each', amount: '−1,600.00', value: -1600 });
    // by its type, with its days and reason; no Penalty row besides (none typed on the grid)
    expect(c.deductions!.rows.find((r) => r.label === 'Penalty (days)')).toMatchObject({ note: '2 days of the net salary · Late twice', value: source.line.result.penaltyCut });
    expect(labels(c.deductions!.rows)).not.toContain('Penalty');
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
    expect(sum(c.deductions!.rows)).toBe(c.deductions!.total.value);
  });

  it('a line saved with the grid’s bonus and penalty days (before 17 October 2026) reads as it was', () => {
    const source = payslipSource('monthly', { terms: { ...SHIFT, ...NONE }, inputs: { expectedHours: null, noShowDays: 1, bonusDays: 1, penaltyDays: 2, commission: null, settlements: null } });
    const c = payslipContent(source, 'en');
    expect(c.thisMonth!.cells.map((x) => x.label)).toEqual(['Hours worked', 'KPI average', 'Bonus days', 'No-show days', 'Penalty days']);
    expect(c.earnings!.rows.find((r) => r.label === 'Bonus')).toEqual({ label: 'Bonus', note: '1 day of the fixed salary', amount: '640.00', value: 640 });
    expect(c.deductions!.rows.find((r) => r.label === 'Penalty')).toMatchObject({ note: '2 days', value: source.line.result.penaltyCut });
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
    expect(sum(c.deductions!.rows)).toBe(c.deductions!.total.value);
  });

  it('the expected hours HR typed are taken as they are, the no-show day already out of them (17 October 2026)', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { noShowDays: 1 } }), 'en');
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '165:30 of 176:00', note: '94.03%: counts as full (90% or more)' });
    expect(c.thisMonth!.cells.find((x) => x.label === 'No-show days')!.note).toBe('Each costs 2 days’ pay');
  });

  it('a line worked out before 17 October 2026 reads as it was: before 16 October with the hours as typed, then less the no-show day’s', () => {
    const source = payslipSource('monthly', { inputs: { noShowDays: 1 } });
    const { absentHours: _a, leaveHours: _l, expectedHours: _e, parts: _p, ...was } = source.line.result;
    // before 16 October 2026: no absent hours, attendance on the 176 typed
    const older = { ...source, line: { ...source.line, result: { ...was, attendanceRatio: 0.9403409091 } as typeof source.line.result } };
    const c = payslipContent(older, 'en');
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '165:30 of 176:00', note: '94.03%: counts as full (90% or more)' });
    expect(c.thisMonth!.cells.find((x) => x.label === 'No-show days')!.note).toBe('Each costs 2 days’ pay');
    // on 16 October 2026: the day's 8 hours came out of the 176 typed, 168
    const then = { ...source, line: { ...source.line, result: { ...was, absentHours: 8, attendanceRatio: 0.9851190476 } as typeof source.line.result } };
    const d = payslipContent(then, 'en');
    expect(d.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '165:30 of 168:00', note: '98.51%: counts as full (90% or more)' });
    expect(d.thisMonth!.cells.find((x) => x.label === 'No-show days')!.note).toBe('Each costs 2 days’ pay; their 8:00 hours aren’t counted again in attendance');
  });

  it('leave days (17 October 2026): a cell saying they are paid, their hours out of the shift’s; nothing deducted', () => {
    // 2 days of 8 hours out of the shift's 176: 150 of 160 is 93.75%
    const source = payslipSource('monthly', { terms: SHIFT, inputs: { workedHours: 150, expectedHours: null, leaveDays: 2 } });
    const c = payslipContent(source, 'en');
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '150:00 of 160:00', note: '93.75%: counts as full (90% or more)' });
    expect(c.thisMonth!.cells.map((x) => x.label)).toEqual(['Hours worked', 'KPI average', 'Bonus days', 'Leave days']);
    expect(c.thisMonth!.cells[3]).toEqual({ label: 'Leave days', value: '2', note: 'Paid leave: nothing deducted; their 16:00 hours aren’t counted in attendance' });
    // the same pay as without them: nothing in the earnings or deductions for them
    expect(c.earnings).toEqual(payslipContent(payslipSource('monthly', { terms: SHIFT, inputs: { workedHours: 160, expectedHours: null } }), 'en').earnings);
    expect(payslipContent(source, 'ar').thisMonth!.cells[3]).toEqual({ label: 'أيام الإجازة', value: '٢', note: 'إجازة مدفوعة الأجر: لا يُخصم عنها، ولا تُحتسب ساعاتها (١٦:٠٠) في الحضور' });
    // HR's expected hours, already without them: no hours to speak of
    expect(payslipContent(payslipSource('monthly', { inputs: { leaveDays: 1.5 } }), 'en').thisMonth!.cells.at(-1)).toEqual({ label: 'Leave days', value: '1.5', note: 'Paid leave: nothing deducted' });
    // by the hour: none
    expect(payslipContent(payslipSource('hourly', { inputs: { leaveDays: 2 } }), 'en').thisMonth!.cells.map((x) => x.label)).toEqual(['Hours worked']);
  });

  it('a commission and a correction taken off (17 October 2026): rows of their own by type, the correction after tax', () => {
    const items: PayrollAdjustmentItem[] = [
      BONUS_DAY,
      { id: 'c1', kind: 'addition', type: 'commission', taxed: true, amount: 1250, reason: 'September sales' },
      { id: 'c2', kind: 'deduction', type: 'correction', taxed: false, amount: 300, reason: 'Overpaid in September' },
    ];
    const source = payslipSource('monthly', { terms: { adjustments: items } });
    const c = payslipContent(source, 'en');
    expect(c.earnings!.rows.at(-1)).toEqual({ label: 'Commission', note: 'September sales', amount: '1,250.00', value: 1250 });
    expect(c.deductions!.rows.at(-1)).toEqual({ label: 'Correction', note: 'Overpaid in September', amount: '300.00', value: 300 });
    // 25,524 + 1,250: the correction isn't in the earnings
    expect(c.earnings!.total.amount).toBe('26,774.00');
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
    expect(sum(c.deductions!.rows)).toBe(source.line.result.deductions);
  });

  it('a commission and a negative settlement typed on the grid (before 17 October 2026): rows of their own, as they were', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { commission: 1250, settlements: -300 } }), 'en');
    expect(c.earnings!.rows.find((r) => r.label === 'Commission')).toEqual({ label: 'Commission', note: null, amount: '1,250.00', value: 1250 });
    expect(c.earnings!.rows.find((r) => r.label === 'Settlement')).toEqual({ label: 'Settlement', note: 'One-off amount this month', amount: '−300.00', value: -300 });
    expect(c.earnings!.total.amount).toBe('26,474.00');
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
  });

  it('an attendance deduction the CEO waived (owner, 17 October 2026): said under This Month, not deducted', () => {
    // 149:36 of 176:00 is 85%: 15% of the fixed 19,200 = 2,880, waived
    const source = payslipSource('monthly', { inputs: { workedHours: 149.6, softSkills: null, performance: null, clientSatisfaction: null, attendanceWaived: true } });
    expect(source.line.result).toMatchObject({ attendanceCut: 0, attendanceWaived: 2880 });
    const c = payslipContent(source, 'en');
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '149:36 of 176:00', note: '85.00%: below 90%, the attendance deduction waived' });
    expect(c.thisMonth!.cells[1]).toEqual({ label: 'Attendance deduction', value: '2,880.00', note: 'Waived by the CEO: not deducted' });
    expect(labels(c.earnings!.rows)).not.toContain('Attendance adjustment');
    expect(c.earnings!.total.value).toBe(payslipContent(payslipSource('monthly', { inputs: { workedHours: 176, softSkills: null, performance: null, clientSatisfaction: null } }), 'en').earnings!.total.value);
    const ar = payslipContent(source, 'ar');
    expect(ar.thisMonth!.cells[0].note).toBe('٨٥٫٠٠٪: أقل من ٩٠٪، وأُعفي من خصم الحضور');
    expect(ar.thisMonth!.cells[1]).toEqual({ label: 'خصم الحضور', value: '٢٬٨٨٠٫٠٠', note: 'أعفى منه الرئيس التنفيذي: لا يُخصم' });
  });

  it('anything else the line deducts (comprehensive health insurance, 0 today) is a row of its own', () => {
    const source = payslipSource('monthly');
    const result = { ...source.line.result, deductions: source.line.result.deductions + 25.5, net: source.line.result.net - 25.5 };
    const c = payslipContent({ ...source, line: { ...source.line, result } }, 'en');
    expect(c.deductions!.rows.find((r) => r.label === 'Health insurance')).toMatchObject({ amount: '25.50', value: 25.5 });
    expect(sum(c.deductions!.rows)).toBe(c.deductions!.total.value);
  });

  it('a line approved before the medical subscription was taken off (16 October 2026): its medical is still its own row', () => {
    // its stored result as payrollLine worked it out then: the 350 in the deductions, and out of the net
    const source = payslipSource('monthly');
    const was = source.line.result;
    const by = (v: number, change: number) => Math.round((v + change) * 100) / 100;
    const result = { ...was, medical: 350, deductions: by(was.deductions, 350), net: by(was.net, -350), transfer: by(was.transfer, -350) };
    const old = { ...source, line: { ...source.line, result } };
    const c = payslipContent(old, 'en');
    expect(c.deductions!.rows.slice(-1)).toEqual([{ label: 'Medical insurance', note: 'Monthly subscription', amount: '350.00', value: 350 }]);
    expect(labels(c.deductions!.rows)).not.toContain('Health insurance');
    expect(c.deductions!.total).toMatchObject({ amount: '5,545.18', value: 5545.18 });
    expect(sum(c.deductions!.rows)).toBe(c.deductions!.total.value);
    expect(c.net.amount).toBe('19,978.82');
    expect(payslipContent(old, 'ar').deductions!.rows.at(-1)).toMatchObject({ label: 'التأمين الطبي', note: 'الاشتراك الشهري', amount: '٣٥٠٫٠٠' });
  });

  it('a line whose pay can’t be read is never drawn: it would print NaN', () => {
    const source = payslipSource('monthly');
    expect(() => payslipContent({ ...source, line: { ...source.line, result: {} as typeof source.line.result } }, 'en')).toThrow(/can't be read \(fixed, variable/);
  });

  it('a net below 0 has no words', () => {
    const source = payslipSource('monthly');
    const c = payslipContent({ ...source, line: { ...source.line, result: { ...source.line.result, net: -10 } } }, 'en');
    expect(c.net).toMatchObject({ amount: '−10.00', words: null });
  });
});

describe('payslipContent: a part month', () => {
  const source = payslipSource('monthly', { terms: { paidDays: 19 } });
  const c = payslipContent(source, 'en');

  it('says the days paid on the fixed and variable salary and on each allowance', () => {
    expect(c.facts.find((f) => f.label === 'Days paid')!.value).toBe('19 of 30');
    expect(c.earnings!.rows.slice(0, 2).map((r) => r.note)).toEqual(['80% of the 24,000.00 gross, for 19 of 30 days', '20% of the gross, for 19 of 30 days']);
    expect(c.earnings!.rows.filter((r) => r.label.endsWith('allowance'))).toEqual([
      { label: 'Transportation allowance', note: 'For 19 of 30 days, not taxed', amount: '950.00', value: 950 },
      { label: 'Mobile allowance', note: 'For 19 of 30 days', amount: '316.67', value: 316.67 },
    ]);
  });

  it('prorates the allowances as payrollLine does, so they add up to its allowances', () => {
    const allowances = c.earnings!.rows.filter((r) => r.label.endsWith('allowance'));
    expect(sum(allowances)).toBe(source.line.result.allowances);
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
  });

  it('adds up with odd amounts too', () => {
    const odd = payslipSource('monthly', {
      terms: { paidDays: 7, gross: 17333.33, allowances: [...MONTHLY_TERMS.allowances, { name: 'Meal allowance', amount: 333.33, taxable: true, insured: false }] },
    });
    const content = payslipContent(odd, 'en');
    expect(sum(content.earnings!.rows)).toBe(content.earnings!.total.value);
    expect(content.earnings!.total.value).toBe(Math.round((odd.line.result.earned + odd.line.result.allowances) * 100) / 100);
  });
});

describe('payslipContent: a month under two contracts (owner, 17 October 2026)', () => {
  // "take into consideration the start and end date of the contract if it is in the middle of the billing period":
  // Mariam renewed on 15 October at 27,000, her mobile allowance 600
  const segment = (over: Partial<PayrollSegment>): PayrollSegment => ({
    contractId: 'v1',
    number: 'CON-2025-0031',
    version: 1,
    from: '2026-10-01',
    to: '2026-10-14',
    days: 14,
    payBasis: 'monthly',
    gross: 24000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: MONTHLY_TERMS.allowances,
    ...over,
  });
  const renewal = segment({
    contractId: 'v2',
    number: 'CON-2026-0044',
    version: 2,
    from: '2026-10-15',
    to: '2026-10-31',
    days: 16,
    gross: 27000,
    allowances: [MONTHLY_TERMS.allowances[0], { ...MONTHLY_TERMS.allowances[1], amount: 600 }],
  });
  const source = payslipSource('monthly', { terms: { gross: 27000, allowances: renewal.allowances, segments: [segment({}), renewal] } });
  const c = payslipContent(source, 'en');

  it('gives each part’s fixed and variable salary and allowances, with its days; they add up to the total', () => {
    // Worked by hand. 1–14 October: fixed 19,200 × 14 ÷ 30 = 8,960, variable 4,800 × 14 ÷ 30 = 2,240, transportation
    // 1,500 × 14 ÷ 30 = 700, mobile 500 × 14 ÷ 30 = 233.33. 15–31 October: fixed 21,600 × 16 ÷ 30 = 11,520, variable
    // 5,400 × 16 ÷ 30 = 2,880, transportation 800, mobile 600 × 16 ÷ 30 = 320. The KPI average 76.75% cuts the
    // variable 5,120 by 23.25%: 1,190.40. A bonus day is the new fixed salary's: 21,600 ÷ 30 = 720. Earnings 8,960 +
    // 11,520 + 2,240 + 2,880 − 1,190.40 + 720 + 700 + 233.33 + 800 + 320 = 27,182.93
    expect(c.earnings!.rows).toEqual([
      { label: 'Fixed salary · 1–14 Oct', note: '80% of the 24,000.00 gross, for 14 of 30 days', amount: '8,960.00', value: 8960 },
      { label: 'Fixed salary · 15–31 Oct', note: '80% of the 27,000.00 gross, for 16 of 30 days', amount: '11,520.00', value: 11520 },
      { label: 'Variable salary · 1–14 Oct', note: '20% of the gross, for 14 of 30 days', amount: '2,240.00', value: 2240 },
      { label: 'Variable salary · 15–31 Oct', note: '20% of the gross, for 16 of 30 days', amount: '2,880.00', value: 2880 },
      { label: 'Performance adjustment', note: 'Variable paid at 76.75%', amount: '−1,190.40', value: -1190.4 },
      { label: 'Transportation allowance · 1–14 Oct', note: 'For 14 of 30 days, not taxed', amount: '700.00', value: 700 },
      { label: 'Mobile allowance · 1–14 Oct', note: 'For 14 of 30 days', amount: '233.33', value: 233.33 },
      { label: 'Transportation allowance · 15–31 Oct', note: 'For 16 of 30 days, not taxed', amount: '800.00', value: 800 },
      { label: 'Mobile allowance · 15–31 Oct', note: 'For 16 of 30 days', amount: '320.00', value: 320 },
      { label: 'Bonus (days)', note: '1 day of the fixed salary · Campaign launch', amount: '720.00', value: 720 },
    ]);
    expect(c.earnings!.total).toMatchObject({ amount: '27,182.93', value: 27182.93 });
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
    expect(c.facts.find((f) => f.label === 'Days paid')!.value).toBe('30 of 30');
  });

  it('in Arabic, with the month’s whole name', () => {
    const ar = payslipContent(source, 'ar');
    expect(ar.earnings!.rows.map((r) => r.label)).toEqual([
      'الراتب الثابت · ١–١٤ أكتوبر',
      'الراتب الثابت · ١٥–٣١ أكتوبر',
      'الراتب المتغير · ١–١٤ أكتوبر',
      'الراتب المتغير · ١٥–٣١ أكتوبر',
      'تسوية المتغير',
      'بدل انتقال · ١–١٤ أكتوبر',
      'بدل هاتف محمول · ١–١٤ أكتوبر',
      'بدل انتقال · ١٥–٣١ أكتوبر',
      'بدل هاتف محمول · ١٥–٣١ أكتوبر',
      'مكافأة (أيام)',
    ]);
    expect(ar.earnings!.rows[0].note).toBe('٨٠٪ من الراتب الشامل ٢٤٬٠٠٠٫٠٠، عن ١٤ من ٣٠ يومًا');
  });

  it('one part, or by the hour with the latest alone paid: as a month on one contract', () => {
    const one = payslipContent(payslipSource('monthly', { terms: { segments: [segment({ to: '2026-10-31', days: 30 })] } }), 'en');
    expect(one.earnings).toEqual(payslipContent(payslipSource('monthly'), 'en').earnings);
    const mixed = payslipSource('monthly', { terms: { gross: 27000, segments: [segment({ payBasis: 'hourly', hourlyRate: 150 }), renewal] } });
    expect(labels(payslipContent(mixed, 'en').earnings?.rows).slice(0, 2)).toEqual(['Fixed salary', 'Variable salary']);
  });
});

describe('payslipContent: by the hour', () => {
  const c = payslipContent(payslipSource('hourly'), 'en');

  it('pays the hours at the contract’s rate in place of the fixed and variable salary', () => {
    expect(c.earnings!.rows).toEqual([
      { label: 'Hours worked', note: '92:30 × 150.00 an hour', amount: '13,875.00', value: 13875 },
      // a correction (a settlement until 17 October 2026), taxed with the pay
      { label: 'Correction', note: 'September’s hours', amount: '450.00', value: 450 },
    ]);
    expect(c.earnings!.total.amount).toBe('14,325.00');
    expect(c.deductions!.rows.map((r) => [r.label, r.amount])).toEqual([
      ['Salary tax', '1,677.50'],
      ['Martyrs’ Fund', '7.16'],
    ]);
    expect(c.net.amount).toBe('12,640.34');
  });

  it('shows the hours and the rate for the month, never a KPI or attendance cell', () => {
    const withKpis = payslipContent(payslipSource('hourly', { inputs: { softSkills: 50, expectedHours: 100, noShowDays: 2 } }), 'en');
    for (const content of [c, withKpis]) expect(content.thisMonth!.cells).toEqual([{ label: 'Hours worked', value: '92:30', note: 'At 150.00 an hour' }]);
  });

  it('says so in the employment, pays to the IBAN’s last 4 digits, and has no insurance number or share', () => {
    expect(c.facts).toEqual([
      { label: 'Name', value: 'Youssef Tarek Fahmy' },
      { label: 'Employee code', value: 'EMP-0187' },
      { label: 'Job title', value: 'Video Editor' },
      { label: 'Department', value: 'Marketing › Video Team' },
      { label: 'Employment', value: 'Part-time, by the hour · since 15/02/2026' },
      { label: 'Paid to', value: 'QNB · account ending 0937' },
      { label: 'Days paid', value: '30 of 30' },
    ]);
    expect(labels(c.afterNet)).toEqual(['Transferred to QNB ···0937']);
    expect(c.companyShare).toBeNull();
    expect(c.yearToDate!.period).toBe('February to October 2026');
  });

  it('no bank details: "Paid", and no Paid to', () => {
    const source = payslipSource('hourly');
    const content = payslipContent({ ...source, line: { ...source.line, bankShort: null, accountNo: null, iban: null } }, 'en');
    expect(content.facts.map((f) => f.label)).not.toContain('Paid to');
    expect(labels(content.afterNet)).toEqual(['Paid']);
  });
});

describe('payslipContent: in Arabic', () => {
  const c = payslipContent(payslipSource('monthly'), 'ar');
  const all = texts(c);

  it('reads right to left, in the proposal’s Arabic', () => {
    expect(c.rtl).toBe(true);
    expect(c.title).toEqual({ kind: 'قسيمة الراتب', month: 'أكتوبر ٢٠٢٦', paid: 'تاريخ الصرف ٢٩/١٠/٢٠٢٦' });
    expect(c.facts).toEqual([
      { label: 'الاسم', value: 'مريم عادل حسن' },
      { label: 'كود الموظف', value: 'EMP-0142' },
      { label: 'المسمى الوظيفي', value: 'كاتبة محتوى أولى' },
      { label: 'الإدارة', value: 'التسويق › فريق المحتوى' },
      { label: 'نوع التعاقد', value: 'دوام كامل · منذ ٠١/٠٣/٢٠٢٥' },
      { label: 'الرقم التأميني', value: '٢٨٤٦١٩٣٧' },
      { label: 'يُحوَّل إلى', value: 'CIB · حساب ينتهي بـ ٤٨٢١' },
      { label: 'الأيام المدفوعة', value: '٣٠ من ٣٠' },
    ]);
    expect([c.thisMonth!.heading, c.earnings!.heading, c.deductions!.heading, c.yearToDate!.heading]).toEqual(['هذا الشهر', 'الاستحقاقات', 'الاستقطاعات', 'منذ بداية العام']);
  });

  it('writes every number in ٠-٩ with the Arabic separators, but the codes and the banks’ short names', () => {
    expect(c.earnings!.rows[0]).toEqual({ label: 'الراتب الثابت', note: '٨٠٪ من الراتب الشامل ٢٤٬٠٠٠٫٠٠', amount: '١٩٬٢٠٠٫٠٠', value: 19200 });
    expect(c.earnings!.rows[2].amount).toBe('−١٬١١٦٫٠٠');
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'ساعات العمل', value: '١٦٥:٣٠ من ١٧٦:٠٠', note: '٩٤٫٠٣٪: تُحتسب كاملة (٩٠٪ فأكثر)' });
    expect(c.net).toMatchObject({ amount: '٢٠٬٣٢٨٫٨٢', currency: 'جنيه', words: 'عشرون ألف و ثلاثمائة و ثمانية و عشرون جنيهاً مصرياً و اثنان و ثمانون قرشاً فقط لا غير' });
    expect(c.footer.issued).toBe('اعتمده الرئيس التنفيذي في ٢٧/١٠/٢٠٢٦ · صدر في ٢٩/١٠/٢٠٢٦ · PAY-2026-10 · EMP-0142');
    // no Latin digit anywhere but in the codes
    const latinDigits = all.map((t) => t.replace(/PAY-\d{4}-\d{2}|EMP-\d{4}/g, '')).filter((t) => /[0-9]/.test(t));
    expect(latinDigits).toEqual([]);
  });

  it('keeps the tax number and the account’s end the right way round inside the Arabic', () => {
    expect(withoutMarks(c.company.line!)).toBe('القاهرة · رقم التسجيل الضريبي ٥١٢-٣٨٤-٩٠٧');
    expect(c.company.line).toContain('‭٥١٢-٣٨٤-٩٠٧‬');
    expect(withoutMarks(c.afterNet[1].label)).toBe('المحوَّل إلى CIB ···٤٨٢١');
  });

  it('names the allowances in Arabic (the contract’s), and the year to date’s months', () => {
    expect(c.earnings!.rows.slice(-3, -1).map((r) => [r.label, r.note])).toEqual([
      ['بدل انتقال', 'غير خاضع للضريبة'],
      ['بدل هاتف محمول', null],
    ]);
    // the Bonus (days) by its Arabic name, its days in Arabic and the reason typed in English kept left to right
    expect(c.earnings!.rows.at(-1)!.label).toBe('مكافأة (أيام)');
    expect(withoutMarks(c.earnings!.rows.at(-1)!.note!)).toBe('يوم واحد من الراتب الثابت، Campaign launch');
    expect(c.yearToDate!.period).toBe('يناير إلى أكتوبر ٢٠٢٦');
    expect(c.companyShare).toBe('إلى جانب راتبك، تدفع الشركة ٣٬١٣١٫٢٥ حصتها في التأمينات الاجتماعية عنك: ١٨٫٧٥٪ من أجر الاشتراك.');
  });

  it('falls back to the English name, job title and allowance when there is no Arabic one', () => {
    const source = payslipSource('monthly');
    const content = payslipContent({ ...source, employee: { ...source.employee, nameAr: null, jobTitleAr: null, departmentAr: null }, allowancesAr: {} }, 'ar');
    expect(content.facts.slice(0, 4).map((f) => f.value)).toEqual(['Mariam Adel Hassan', 'EMP-0142', 'Senior Content Writer', 'Marketing › Content Team']);
    expect(content.earnings!.rows.at(-2)!.label).toBe('Mobile allowance');
  });

  it('a part month, hours and days in Arabic', () => {
    const part = payslipContent(
      payslipSource('monthly', {
        terms: { paidDays: 19, expectedHours: 104, expectedDays: { workingDays: 13, holidays: 0 }, adjustments: [BONUS_DAY, penaltyDays(1)] },
        inputs: { expectedHours: null, noShowDays: 2 },
      }),
      'ar',
    );
    expect(part.earnings!.rows[0].note).toBe('٨٠٪ من الراتب الشامل ٢٤٬٠٠٠٫٠٠، عن ١٩ من ٣٠ يومًا');
    expect(part.earnings!.rows.find((r) => r.label === 'الغياب دون إذن')!.note).toBe('يومان، بأجر يومين عن كل يوم');
    // two 8-hour days out of the expected hours
    expect(part.thisMonth!.cells.find((x) => x.label === 'أيام الغياب دون إذن')!.note).toBe('يُخصم عن كل يوم أجر يومين، ولا تُحتسب ساعاتها (١٦:٠٠) مرة أخرى في الحضور');
    expect(withoutMarks(part.deductions!.rows.find((r) => r.label === 'جزاء (أيام)')!.note!)).toBe('يوم واحد من صافي الراتب، Late twice');
    const hourly = payslipContent(payslipSource('hourly'), 'ar');
    expect(hourly.earnings!.rows[0]).toMatchObject({ label: 'أجر الساعات', note: '٩٢:٣٠ × ١٥٠٫٠٠ للساعة' });
    expect(hourly.facts.find((f) => f.label === 'نوع التعاقد')!.value).toBe('دوام جزئي بالساعة · منذ ١٥/٠٢/٢٠٢٦');
  });
});

describe('payslipContent: the company line', () => {
  it('only the parts that exist; the city in Arabic on the Arabic payslip when it is a governorate', () => {
    const source = payslipSource('monthly');
    const at = (company: Partial<typeof source.company>, language: 'en' | 'ar' = 'en') => payslipContent({ ...source, company: { ...source.company, ...company } }, language).company.line;
    expect(at({ taxRegNo: null })).toBe('Cairo');
    expect(at({ city: null })).toBe('Tax registration no. 512-384-907');
    expect(at({ city: null, taxRegNo: '  ' })).toBeNull();
    expect(at({ taxRegNo: null }, 'ar')).toBe('القاهرة');
    expect(at({ city: 'New Cairo', taxRegNo: null }, 'ar')).toBe('New Cairo');
  });
});

describe('yearToDate', () => {
  const line = (month: string, more: Partial<YearToDateLine> = {}): YearToDateLine => ({
    month,
    status: 'paid',
    onHold: false,
    earned: 10000.1,
    allowances: 500.2,
    monthlyTax: 800.3,
    employeeInsurance: 1100,
    net: 8600.01,
    ...more,
  });

  it('sums the lines of the same year up to the month, approved or paid, not on hold', () => {
    const y = yearToDate(
      [
        line('2026-02'),
        line('2026-03', { status: 'approved' }),
        line('2026-04', { onHold: true }),
        line('2026-05', { status: 'draft' }),
        line('2026-06', { status: 'pending_ceo' }),
        line('2025-12'),
        line('2026-11'),
        line('2026-10'),
      ],
      '2026-10',
    );
    expect(y).toEqual({ from: '2026-02', to: '2026-10', earnings: 31500.9, tax: 2400.9, insurance: 3300, net: 25800.03 });
  });

  it('just the month when it is the only one; none when nothing counts', () => {
    const y = yearToDate([line('2026-10')], '2026-10')!;
    expect(y.from).toBe('2026-10');
    expect(payslipContent({ ...payslipSource('monthly'), yearToDate: y }, 'en').yearToDate!.period).toBe('October 2026');
    expect(payslipContent({ ...payslipSource('monthly'), yearToDate: y }, 'ar').yearToDate!.period).toBe('أكتوبر ٢٠٢٦');
    expect(yearToDate([line('2026-10', { onHold: true })], '2026-10')).toBeNull();
    expect(payslipContent({ ...payslipSource('monthly'), yearToDate: null }, 'en').yearToDate).toBeNull();
  });
});

describe('numbers as printed', () => {
  it('amounts with two decimals, thousands separated, a minus sign', () => {
    expect([formatAmount(0), formatAmount(1234567.5), formatAmount(-1116), formatAmount(0.05)]).toEqual(['0.00', '1,234,567.50', '−1,116.00', '0.05']);
  });

  it('in Arabic: ٠-٩, ٬ for thousands, ٫ for decimals, ٪ for percent; other signs as they are', () => {
    expect(arabicNumerals('1,234,567.50')).toBe('١٬٢٣٤٬٥٦٧٫٥٠');
    expect(arabicNumerals('94.03%: (90%)')).toBe('٩٤٫٠٣٪: (٩٠٪)');
    expect(arabicNumerals('29/10/2026 165:30')).toBe('٢٩/١٠/٢٠٢٦ ١٦٥:٣٠');
    expect(arabicNumerals('Sentence. 5')).toBe('Sentence. ٥');
  });

  it('the line’s figures are payrollLine’s: nothing in the money is worked out again', () => {
    const source = payslipSource('monthly');
    expect(source.line.result).toEqual(payrollLine(source.line.terms, source.line.inputs, PAYROLL_RULE_DEFAULTS));
    const c = payslipContent(source, 'en');
    expect(c.deductions!.rows.find((r) => r.label === 'Salary tax')!.value).toBe(source.line.result.monthlyTax);
    expect(c.deductions!.total.value).toBe(source.line.result.deductions);
  });
});
