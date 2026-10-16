import { payrollLine, PAYROLL_RULE_DEFAULTS } from '@trendlix/shared';
import { MONTHLY_TERMS, payslipSource } from '../../test/fixtures/payslip.js';
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
      { label: 'Bonus', note: '1 day of the fixed salary', amount: '640.00', value: 640 },
      { label: 'Transportation allowance', note: 'Not taxed', amount: '1,500.00', value: 1500 },
      { label: 'Mobile allowance', note: null, amount: '500.00', value: 500 },
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
    const c = payslipContent(payslipSource('monthly', { inputs: { bonusDays: null, released: null, softSkills: null, performance: null, clientSatisfaction: null } }), 'en');
    expect(labels(c.earnings?.rows)).toEqual(['Fixed salary', 'Variable salary', 'Transportation allowance', 'Mobile allowance']);
    expect(labels(c.deductions?.rows)).toEqual(['Social insurance', 'Salary tax', 'Martyrs’ Fund']);
    expect(c.thisMonth!.cells.map((x) => x.label)).toEqual(['Hours worked']);
    expect(c.thisMonth!.line).toBeNull();
    expect(labels(c.afterNet)).toEqual(['Transferred to CIB ···4821']);
  });

  it('nothing typed for the month: no This Month section at all', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { workedHours: null, expectedHours: null, softSkills: null, performance: null, clientSatisfaction: null, bonusDays: null } }), 'en');
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

  it('overtime above the overtime percent: the cell says so, and the overtime is a row', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { workedHours: 202.4, softSkills: null, performance: null, clientSatisfaction: null } }), 'en');
    expect(c.thisMonth!.cells[0].note).toBe('115.00%: overtime paid above 110%');
    const overtime = c.earnings!.rows.find((r) => r.label === 'Overtime')!;
    expect(overtime).toMatchObject({ note: 'Attendance above 110%, at 1.5', value: payslipSource('monthly', { inputs: { workedHours: 202.4 } }).line.result.overtime });
    expect(overtime.value).toBeGreaterThan(0);
  });

  it('no-show and penalty days: a cell each, the no-show cut in the earnings, the penalty in the deductions', () => {
    const source = payslipSource('monthly', { inputs: { noShowDays: 1, penaltyDays: 2 } });
    const c = payslipContent(source, 'en');
    // the day's 8 hours out of the 176 expected (owner's decisions, 16 October 2026): 165:30 of 168:00 is 98.51%
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '165:30 of 168:00', note: '98.51%: counts as full (90% or more)' });
    expect(c.thisMonth!.cells.slice(3)).toEqual([
      { label: 'No-show days', value: '1', note: 'Each costs 2 days’ pay; their 8:00 hours aren’t counted again in attendance' },
      { label: 'Penalty days', value: '2', note: 'A day’s net salary each' },
    ]);
    // 1 × 2 × 24,000 ÷ 30
    expect(c.earnings!.rows.find((r) => r.label === 'No-show')).toMatchObject({ note: '1 day, 2 days’ pay each', amount: '−1,600.00', value: -1600 });
    expect(c.deductions!.rows.find((r) => r.label === 'Penalty')).toMatchObject({ note: '2 days', value: source.line.result.penaltyCut });
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
    expect(sum(c.deductions!.rows)).toBe(c.deductions!.total.value);
  });

  it('a line worked out before the no-show days’ hours came out of the expected hours (16 October 2026): the hours as typed', () => {
    const source = payslipSource('monthly', { inputs: { noShowDays: 1 } });
    // its stored result as payrollLine worked it out then: no absent hours, attendance on the 176 typed
    const { absentHours, ...was } = source.line.result;
    expect(absentHours).toBe(8);
    const old = { ...source, line: { ...source.line, result: { ...was, attendanceRatio: 0.9403409091 } as typeof source.line.result } };
    const c = payslipContent(old, 'en');
    expect(c.thisMonth!.cells[0]).toEqual({ label: 'Hours worked', value: '165:30 of 176:00', note: '94.03%: counts as full (90% or more)' });
    expect(c.thisMonth!.cells.find((x) => x.label === 'No-show days')!.note).toBe('Each costs 2 days’ pay');
  });

  it('a commission and a negative settlement: rows of their own, the settlement minus, still adding up', () => {
    const c = payslipContent(payslipSource('monthly', { inputs: { commission: 1250, settlements: -300 } }), 'en');
    expect(c.earnings!.rows.find((r) => r.label === 'Commission')).toEqual({ label: 'Commission', note: null, amount: '1,250.00', value: 1250 });
    expect(c.earnings!.rows.find((r) => r.label === 'Settlement')).toEqual({ label: 'Settlement', note: 'One-off amount this month', amount: '−300.00', value: -300 });
    expect(c.earnings!.total.amount).toBe('26,474.00');
    expect(sum(c.earnings!.rows)).toBe(c.earnings!.total.value);
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

describe('payslipContent: by the hour', () => {
  const c = payslipContent(payslipSource('hourly'), 'en');

  it('pays the hours at the contract’s rate in place of the fixed and variable salary', () => {
    expect(c.earnings!.rows).toEqual([
      { label: 'Hours worked', note: '92:30 × 150.00 an hour', amount: '13,875.00', value: 13875 },
      { label: 'Settlement', note: 'One-off amount this month', amount: '450.00', value: 450 },
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
    expect(c.earnings!.rows.slice(-2).map((r) => [r.label, r.note])).toEqual([
      ['بدل انتقال', 'غير خاضع للضريبة'],
      ['بدل هاتف محمول', null],
    ]);
    expect(c.yearToDate!.period).toBe('يناير إلى أكتوبر ٢٠٢٦');
    expect(c.companyShare).toBe('إلى جانب راتبك، تدفع الشركة ٣٬١٣١٫٢٥ حصتها في التأمينات الاجتماعية عنك: ١٨٫٧٥٪ من أجر الاشتراك.');
  });

  it('falls back to the English name, job title and allowance when there is no Arabic one', () => {
    const source = payslipSource('monthly');
    const content = payslipContent({ ...source, employee: { ...source.employee, nameAr: null, jobTitleAr: null, departmentAr: null }, allowancesAr: {} }, 'ar');
    expect(content.facts.slice(0, 4).map((f) => f.value)).toEqual(['Mariam Adel Hassan', 'EMP-0142', 'Senior Content Writer', 'Marketing › Content Team']);
    expect(content.earnings!.rows.at(-1)!.label).toBe('Mobile allowance');
  });

  it('a part month, hours and days in Arabic', () => {
    const part = payslipContent(payslipSource('monthly', { terms: { paidDays: 19 }, inputs: { noShowDays: 2, penaltyDays: 1 } }), 'ar');
    expect(part.earnings!.rows[0].note).toBe('٨٠٪ من الراتب الشامل ٢٤٬٠٠٠٫٠٠، عن ١٩ من ٣٠ يومًا');
    expect(part.earnings!.rows.find((r) => r.label === 'الغياب دون إذن')!.note).toBe('يومان، بأجر يومين عن كل يوم');
    // two 8-hour days out of the expected hours
    expect(part.thisMonth!.cells.find((x) => x.label === 'أيام الغياب دون إذن')!.note).toBe('يُخصم عن كل يوم أجر يومين، ولا تُحتسب ساعاتها (١٦:٠٠) مرة أخرى في الحضور');
    expect(part.deductions!.rows.find((r) => r.label === 'جزاء')!.note).toBe('يوم واحد');
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
