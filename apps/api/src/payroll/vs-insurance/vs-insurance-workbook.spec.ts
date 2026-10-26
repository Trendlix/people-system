import ExcelJS from 'exceljs';
import { EMPTY_PAYROLL_INPUTS, lawRatesFor, PAYROLL_RULE_DEFAULTS, payrollLine, payrollVsInsurance, type PayrollRules, type PayrollTerms, type VsInsuranceSourceLine } from '@trendlix/shared';
import { COMPARISON_HEADS, comparisonLines, vsInsuranceFileName, vsInsuranceWorkbook } from './vs-insurance-workbook.js';

// The Payroll vs Social Insurance report's workbook (owner, 26 October 2026: "a comparison report between the actual
// payroll run and the social insurance data"): the file's name with its period, the Comparison's groups as rows with their
// subtotals and the grand total, the three blocks' headings, numbers as numbers, the two "in full" sheets. Everyone here is
// invented.

const LAW = lawRatesFor(2026);
const RULES: PayrollRules = { ...PAYROLL_RULE_DEFAULTS, insureEveryone: true };

const terms = (over: Partial<PayrollTerms>): PayrollTerms => ({
  year: 2026,
  payBasis: 'monthly',
  gross: 20000,
  basicPercent: 80,
  hourlyRate: null,
  allowances: [{ name: 'Transport', amount: 2000, taxable: true, insured: false }],
  paidDays: 30,
  statutory: true,
  insured: true,
  insuredWage: 12000,
  hoursPerDay: 9,
  expectedHours: 198,
  expectedDays: { workingDays: 22, holidays: 0 },
  ...over,
});

let n = 0;
const line = (t: PayrollTerms, over: Partial<VsInsuranceSourceLine>): VsInsuranceSourceLine => {
  n += 1;
  return {
    id: `line-${n}`,
    employeeId: `employee-${n}`,
    employeeCode: `EMP-00${n}`,
    nameEn: `Person ${n}`,
    department: 'Sales › Field',
    jobTitle: null,
    employmentType: 'full_time',
    payBasis: 'monthly',
    onHold: false,
    terms: t,
    inputs: EMPTY_PAYROLL_INPUTS,
    result: payrollLine(t, EMPTY_PAYROLL_INPUTS, RULES, LAW),
    ...over,
  };
};

const rana = line(terms({}), { nameEn: 'Rana', employeeCode: 'EMP-001' });
const nour = line(terms({ gross: 9000, allowances: [], insuredWage: 9000, notRegistered: true }), { nameEn: 'Nour', employeeCode: 'EMP-002', department: 'Sales' });
const fady = line(terms({ gross: 5000, allowances: [], insuredWage: 5000, statutory: false, insured: false }), { nameEn: 'Fady', employeeCode: 'EMP-003', department: null, employmentType: 'freelance' });

const built = payrollVsInsurance([{ id: 'run-1', month: '2026-09', status: 'paid', rules: RULES, law: LAW, lines: [rana, nour, fady] }]);
const report = { ...built, period: { from: '2026-09', to: '2026-09' }, defaulted: null, generatedAt: '2026-10-26T10:00:00.000Z', confidentialExcluded: 1 };

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe('the Payroll vs Social Insurance workbook', () => {
  it('is named with its period', () => {
    expect(vsInsuranceFileName({ from: '2026-09', to: '2026-09' })).toBe('Payroll vs social insurance 2026-09.xlsx');
    expect(vsInsuranceFileName({ from: '2026-01', to: '2026-03' })).toBe('Payroll vs social insurance 2026-01 to 2026-03.xlsx');
  });

  it('has the groups as rows: headings, people, subtotals, then the grand total', () => {
    expect(comparisonLines(report).map((l) => (l.kind === 'row' ? l.row.employee.fullNameEn : l.kind === 'heading' ? `# ${l.text}` : `= ${l.text} ${l.totals.difference.companyCost}`))).toEqual([
      '# Sales',
      'Nour',
      '# Sales › Field',
      'Rana',
      '= Total · Field -10000',
      '= Total · Sales -10000',
      '# No department',
      'Fady',
      '= Total · No department 0',
      '= Total · everyone -10000',
    ]);
  });

  it('heads every column with its block, the differences saying which way they go', () => {
    expect(COMPARISON_HEADS.slice(0, 7)).toEqual(['Employee code', 'Employee name (English)', 'Department', 'Team', 'Month', 'Run status', 'Standing']);
    expect(COMPARISON_HEADS[7]).toBe('Actual: Gross');
    expect(COMPARISON_HEADS[19]).toBe('SI cycle: Gross');
    expect(COMPARISON_HEADS[31]).toBe('Difference: Employee insurance (SI cycle − actual)');
    expect(COMPARISON_HEADS[36]).toBe('Difference: Company cost (SI cycle − actual)');
    expect(COMPARISON_HEADS).toHaveLength(37);
  });

  it('writes three sheets, the figures as numbers, the SI cycle blank for those without one', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await vsInsuranceWorkbook(report)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Comparison', 'Actual run', 'SI cycle']);
    const [comparison, actual, insurance] = wb.worksheets;
    expect(comparison.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 1 });
    const rows = rowsOf(comparison);
    expect(rows[0]).toEqual(COMPARISON_HEADS);
    const ranaRow = rows.find((r) => r[0] === 'EMP-001')!;
    expect(ranaRow.slice(4, 7)).toEqual(['September 2026', 'Paid', 'Registered']);
    expect(ranaRow[7]).toBe(20000);
    expect(ranaRow[9]).toBe(2000);
    expect(ranaRow[19]).toBe(12000);
    expect(ranaRow[21]).toBe(0);
    expect(ranaRow[36]).toBe(-10000);
    expect(comparison.getCell(rows.indexOf(ranaRow) + 1, 8).numFmt).toBe('#,##0.00');
    const nourRow = rows.find((r) => r[0] === 'EMP-002')!;
    expect(nourRow[6]).toBe('Counted as insured (not registered)');
    expect(nourRow[7]).toBe(9000);
    expect(nourRow[11]).toBe(990);
    expect(nourRow[19]).toBeUndefined();
    expect(nourRow[36]).toBeUndefined();
    const grand = rows.find((r) => r[0] === 'Total · everyone')!;
    expect(grand[36]).toBe(-10000);
    // under the table: the period, the run with its rules, the counts, the C-level people left out
    const texts = rows.map((r) => [r[0], r[1]].map((v) => (typeof v === 'string' ? v : '')).join(': '));
    expect(texts).toContain('Period: September 2026');
    expect(texts.some((t) => t.startsWith('Run · September 2026: Paid. Social insurance 11% employee and 18.75% company'))).toBe(true);
    expect(texts).toContain('Counted: 3 people on the payroll: 1 registered, 1 not registered (1 counted as insured), 1 outside the labour law. The differences are summed over the registered people.');
    expect(texts).toContain('C-level people left out: C-level (1 person) is left out: only the CEO and the Super Admin see their amounts.');

    const full = rowsOf(actual);
    expect(full[0].slice(0, 11)).toEqual(['Employee code', 'Employee name (English)', 'Department', 'Team', 'Month', 'Run status', 'Standing', 'Employment type', 'Pay basis', 'On hold', 'Days paid']);
    expect(full[0].slice(11, 14)).toEqual(['Gross', 'Pay earned', 'Allowances']);
    expect(full.slice(1).map((r) => r[0])).toEqual(['EMP-002', 'EMP-001', 'EMP-003']);
    expect(full.find((r) => r[0] === 'EMP-003')!.slice(7, 12)).toEqual(['Freelance (outside the labour law)', 'Monthly salary', 'No', 30, 5000]);
    expect(actual.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

    const cycle = rowsOf(insurance);
    expect(cycle.slice(1).map((r) => r[0])).toEqual(['EMP-001']);
    expect(cycle[1].slice(11, 14)).toEqual([12000, 12000, 0]);
    expect(insurance.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});
