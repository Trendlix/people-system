import ExcelJS from 'exceljs';
import { EMPTY_PAYROLL_INPUTS, lawRatesFor, PAYROLL_RULE_DEFAULTS, payrollLine, type PayrollTerms } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import type { PayrollLineView, PayrollRunView, PayrollTotals } from '@/lib/types';
import { REVIEW_COLUMNS, reviewAmounts, reviewFileName, reviewMarks, reviewWorkbook } from './review-sheet';

// Two invented employees in two departments (the second in a team), worked out by the shared payroll rules, and the
// run's totals as the API sends them; one C-level line hidden from the caller.
const law = lawRatesFor(2026);
const terms = (gross: number): PayrollTerms => ({
  year: 2026,
  payBasis: 'monthly',
  gross,
  basicPercent: 80,
  hourlyRate: null,
  allowances: [],
  paidDays: 30,
  statutory: true,
  insured: true,
  insuredWage: Math.min(gross, 16_700),
  hoursPerDay: 8,
  expectedHours: 176,
  expectedDays: { workingDays: 22, holidays: 0 },
  adjustments: [],
});

function line(id: string, name: string, department: string | null, gross: number, extra: Partial<PayrollLineView> = {}): PayrollLineView {
  const t = terms(gross);
  return {
    id,
    employeeId: `e-${id}`,
    employeeCode: `EMP-${id}`,
    name,
    department,
    jobTitle: 'Producer',
    employmentType: 'full_time',
    payBasis: 'monthly',
    onHold: false,
    comments: null,
    terms: t,
    inputs: EMPTY_PAYROLL_INPUTS,
    result: payrollLine(t, EMPTY_PAYROLL_INPUTS, PAYROLL_RULE_DEFAULTS, law),
    bank: { file: null, bankShort: null, problem: null },
    ...extra,
  } as PayrollLineView;
}

const yasmine = line('0001', 'Yasmine Example', 'Operation Department', 25_500, { comments: 'Raise from March' });
const omar = line('0002', 'Omar Example', 'Operation Department › Post', 12_000, { onHold: true });
const sum = (k: keyof PayrollLineView['result']) => [yasmine, omar].reduce((n, l) => n + (l.result[k] as number), 0);
const totals = {
  employees: 2,
  earned: sum('earned'),
  allowances: sum('allowances'),
  employeeInsurance: sum('employeeInsurance'),
  employerInsurance: sum('employerInsurance'),
  monthlyTax: sum('monthlyTax'),
  martyrsFund: sum('martyrsFund'),
  deductions: sum('deductions'),
  net: sum('net'),
  released: 0,
  transfer: sum('transfer'),
  companyCost: 0,
} as PayrollTotals;
const run = {
  id: 'r1',
  month: '2026-11',
  status: 'draft',
  rules: PAYROLL_RULE_DEFAULTS,
  lawRates: law,
  totals,
  lines: [omar, yasmine],
  hidden: { count: 2, label: 'C-level (2 people) — hidden' },
} as unknown as PayrollRunView;

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}
const rowValues = (ws: ExcelJS.Worksheet, n: number) => (ws.getRow(n).values as unknown[]).slice(1);

describe('the Pay to review', () => {
  it('takes off insurance, tax, the Martyrs’ Fund and the deductions as minuses, as the page shows them', () => {
    expect(reviewAmounts({ earned: 100, allowances: 5, employeeInsurance: 11, monthlyTax: 7, martyrsFund: 0.05, deductions: 18.05, net: 86.95, transfer: 86.95 })).toEqual([
      100, 5, -11, -7, -0.05, -18.05, 86.95, 86.95,
    ]);
    expect(reviewAmounts({ earned: 0, allowances: 0, employeeInsurance: 0, monthlyTax: 0, martyrsFund: 0, deductions: 0, net: 0, transfer: 0 })).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('marks a line as its row does', () => {
    expect(reviewMarks(omar)).toBe('On hold · No deductions');
    expect(reviewMarks({ ...yasmine, confidential: true } as PayrollLineView)).toBe('C-level · No deductions');
  });

  it('names the file by the month, a draft said', () => {
    expect(reviewFileName({ month: '2026-11', status: 'draft' })).toBe('November 2026 Payroll (draft) - review.xlsx');
    expect(reviewFileName({ month: '2026-10', status: 'paid' })).toBe('October 2026 Payroll - review.xlsx');
  });

  it('is the table grouped by department and team, the hidden row, the totals, and every breakdown', async () => {
    const wb = await read(await reviewWorkbook(run, [], '02/11/2026, 5:42 PM'));
    const pay = wb.getWorksheet('Pay')!;
    expect(pay.getCell('A1').value).toBe('November 2026 Payroll — for review');
    expect(pay.getCell('A2').value).toBe("Draft · exported 02/11/2026, 5:42 PM · as the run's Pay shows it");
    expect(rowValues(pay, 4)).toEqual(REVIEW_COLUMNS.map((h, i) => (i >= 4 && i < 12 ? `${h} (EGP)` : h)));
    // the department, its own people first, then the team
    expect(pay.getCell('A5').value).toBe('Operation Department · 2 employees');
    expect(rowValues(pay, 6).slice(0, 4)).toEqual(['Yasmine Example', 'EMP-0001', 'Producer', 'No deductions']);
    expect(rowValues(pay, 6).slice(4, 12)).toEqual(reviewAmounts(yasmine.result));
    // the salary insured (16,700 of 25,500): 11% of it taken off
    expect(pay.getCell('G6').value).toBe(-1837);
    expect(pay.getCell('A7').value).toBe('   Post · 1 employee');
    expect(pay.getCell('A8').value).toBe('Omar Example');
    expect(pay.getCell('A9').value).toBe('C-level (2 people) — hidden');
    expect(pay.getCell('A10').value).toBe('Total · 2 employees');
    expect(rowValues(pay, 10).slice(4, 12)).toEqual(reviewAmounts(totals));

    const steps = wb.getWorksheet('Breakdowns')!;
    const text = (steps.getSheetValues() as unknown[][]).flatMap((r) => (r ?? []).filter((v) => typeof v === 'string'));
    expect(text).toContain('Yasmine Example · EMP-0001 · Operation Department');
    expect(text).toContain('Comments: Raise from March');
    expect(text).toContain('C-level (2 people) — hidden');
    expect(text.indexOf('Yasmine Example · EMP-0001 · Operation Department')).toBeLessThan(text.indexOf('Omar Example · EMP-0002 · Operation Department › Post'));
  });
});
