import ExcelJS from 'exceljs';
import type { DueForReviewRow, SalaryRaiseRow } from '@trendlix/shared';
import { openRaiseText, promotionText, salaryRaisesFileName, salaryRaisesWorkbook } from './salary-raises-workbook.js';

// The Salary Raises report as an Excel workbook (owner's decision, 16 October 2026). Everyone here is invented.

const AMY = { id: 'e-1', employeeCode: 'EMP-0001', fullNameEn: 'Amy Example', fullNameAr: 'إيمي' };
const ACCOUNTS = { id: 'd-acc', nameEn: 'Accounts', parent: { id: 'd-fin', nameEn: 'Finance' } };

const RAISE: SalaryRaiseRow = {
  contractId: 'c-3',
  number: 'CON-2026-0004-A1',
  employee: AMY,
  employmentId: 'job-1',
  department: ACCOUNTS,
  jobTitle: 'Accountant',
  promotion: { jobTitle: 'Senior Accountant', grade: 'G5' },
  effectiveDate: '2026-06-01',
  upcoming: false,
  kind: 'amendment',
  reason: 'promotion',
  payBasis: 'monthly',
  gross: { from: 10000, to: 12500 },
  allowances: { from: 500, to: 700 },
  change: { amount: 2500, percent: 25 },
  monthlyCost: 2700,
  approvedBy: 'Chief Officer',
  // 23:30 in Cairo on 20 May, 20:30 UTC
  approvedAt: '2026-05-20T20:30:00.000Z',
  signedOn: '2026-05-21',
};

const DUE: DueForReviewRow = {
  employee: { id: 'e-4', employeeCode: 'EMP-0004', fullNameEn: 'Dina Example', fullNameAr: 'دينا' },
  employmentId: 'job-4',
  department: null,
  jobTitle: 'Analyst',
  joinDate: '2024-09-01',
  currentGross: 7000,
  lastRaise: null,
  monthsSince: 25,
  openRaise: { contractId: 'c-9', number: 'CON-2026-0009-A1', stage: 'pending_ceo', effectiveDate: '2026-11-01' },
  openRequest: { id: 'r-1', status: 'with_ceo' },
};

const TOTALS = { count: 2, people: 1, averagePercent: 14.5, medianPercent: 14.5, monthlyCostIncrease: 3200, yearlyCostIncrease: 38400 };

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return rows;
}

describe('the Salary Raises workbook', () => {
  it('is named with its period', () => {
    expect(salaryRaisesFileName({ from: '2026-01', to: '2026-12' })).toBe('Salary raises 2026-01 to 2026-12.xlsx');
  });

  it('words a promotion and an open raise', () => {
    expect(promotionText({ jobTitle: 'Senior Accountant', grade: 'G5' })).toBe('Senior Accountant, grade G5');
    expect(promotionText({ jobTitle: null, grade: 'G5' })).toBe('grade G5');
    expect(promotionText(null)).toBeNull();
    expect(openRaiseText(DUE.openRaise)).toBe('CON-2026-0009-A1 · With the CEO · from 01/11/2026');
    expect(openRaiseText(null)).toBeNull();
  });

  it('has the raises, each department with all of them below, and who is due for review, under bold, frozen, filtered headers', async () => {
    const data = await salaryRaisesWorkbook({
      raises: [RAISE, { ...RAISE, contractId: 'c-4', number: 'CON-2026-0004-A2', effectiveDate: '2026-12-01', upcoming: true, promotion: null, reason: 'annual', change: { amount: 500, percent: 4 }, monthlyCost: 500, approvedAt: null, signedOn: null }],
      totals: TOTALS,
      byDepartment: [{ department: { id: 'd-fin', nameEn: 'Finance' }, ...TOTALS }, { department: null, ...TOTALS, count: 0, people: 0, averagePercent: null, medianPercent: null }],
      dueForReview: [DUE],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Raises', 'By Department', 'Due for Review']);
    const [raises, departments, due] = wb.worksheets;

    expect(rowsOf(raises)).toEqual([
      [
        'Code',
        'Name (English)',
        'Name (Arabic)',
        'Department',
        'Job title',
        'Promotion',
        'Effective date',
        'In force',
        'Kind',
        'Reason',
        'Gross before',
        'Gross after',
        'Change',
        'Change %',
        'Allowances before',
        'Allowances after',
        'Monthly cost increase',
        'Approved by',
        'Approved on',
        'Signed on',
        'Contract',
      ],
      // approved late on 20 May in Cairo
      ['EMP-0001', 'Amy Example', 'إيمي', 'Finance › Accounts', 'Accountant', 'Senior Accountant, grade G5', '01/06/2026', 'Yes', 'Amendment', 'Promotion', 10000, 12500, 2500, 0.25, 500, 700, 2700, 'Chief Officer', '20/05/2026', '21/05/2026', 'CON-2026-0004-A1'],
      ['EMP-0001', 'Amy Example', 'إيمي', 'Finance › Accounts', 'Accountant', undefined, '01/12/2026', 'Not yet', 'Amendment', 'Annual raise', 10000, 12500, 500, 0.04, 500, 700, 500, 'Chief Officer', undefined, undefined, 'CON-2026-0004-A2'],
    ]);
    expect(raises.getCell('K2').numFmt).toBe('#,##0.00');
    expect(raises.getCell('N2').numFmt).toBe('0.0%');
    expect(raises.getCell('Q2').numFmt).toBe('#,##0.00');

    expect(rowsOf(departments)).toEqual([
      ['Department', 'Raises', 'People', 'Average change %', 'Median change %', 'Monthly cost increase', 'Yearly cost increase'],
      ['Finance', 2, 1, 0.145, 0.145, 3200, 38400],
      ['No department', 0, 0, undefined, undefined, 3200, 38400],
      ['All departments', 2, 1, 0.145, 0.145, 3200, 38400],
    ]);
    expect(departments.getCell('A4').font?.bold).toBe(true);
    expect(departments.getCell('F4').numFmt).toBe('#,##0.00');
    // the filter is over the departments, not their total
    expect(departments.autoFilter).toBe('A1:G3');

    expect(rowsOf(due)).toEqual([
      ['Code', 'Name (English)', 'Name (Arabic)', 'Department', 'Job title', 'Joined', 'Last raise', 'Months since', 'Current gross', 'Open raise', 'Open raise request'],
      ['EMP-0004', 'Dina Example', 'دينا', undefined, 'Analyst', '01/09/2024', undefined, 25, 7000, 'CON-2026-0009-A1 · With the CEO · from 01/11/2026', 'With the CEO'],
    ]);
    expect(due.getCell('I2').numFmt).toBe('#,##0.00');

    for (const ws of [raises, departments, due]) {
      expect(ws.getCell('A1').font?.bold).toBe(true);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
    }
  });
});
