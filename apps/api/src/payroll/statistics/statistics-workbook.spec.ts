import { payrollStatistics, type StatisticsLine } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import { statisticsFileName, statisticsWorkbook } from './statistics-workbook.js';

// The payroll statistics as an Excel workbook (owner, 17 October 2026: "Reports (Statistics)" under Payroll): by month
// with the totals below, by department with its teams under it, and the period's and this year's summary. Every figure
// is invented.

const line = (employeeId: string, department: string | null, earned: number): StatisticsLine => ({
  employeeId,
  department,
  onHold: false,
  earned,
  allowances: 0,
  net: earned * 0.8,
  transfer: earned * 0.8,
  monthlyTax: earned * 0.1,
  employeeInsurance: earned * 0.11,
  employerInsurance: earned * 0.1875,
  martyrsFund: earned * 0.0005,
  companyCost: earned * 1.1875,
});

async function load(data: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  return wb;
}

const values = (ws: ExcelJS.Worksheet, row: number) => (ws.getRow(row).values as unknown[]).slice(1);

describe('statisticsWorkbook', () => {
  const stats = payrollStatistics(
    [
      { id: 'r1', month: '2026-08', status: 'paid', lines: [line('a', 'Sales › Inside Sales', 10000), line('b', 'Finance', 20000)] },
      { id: 'r2', month: '2026-09', status: 'approved', lines: [line('a', 'Sales › Inside Sales', 10000)] },
    ],
    { from: '2026-08', to: '2026-09' },
    '2026-10-17',
  );

  it('is named with its period', () => {
    expect(statisticsFileName({ from: '2026-01', to: '2026-12' })).toBe('Payroll statistics 2026-01 to 2026-12.xlsx');
  });

  it('has a row a month with the totals below, each department with its teams, and the summary', async () => {
    const wb = await load(await statisticsWorkbook(stats));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['By Month', 'By Department', 'Summary']);

    const byMonth = wb.getWorksheet('By Month')!;
    expect(values(byMonth, 1).slice(0, 6)).toEqual(['Month', 'Status', 'Employees', 'On hold', 'Gross', 'Net']);
    expect(values(byMonth, 2).slice(0, 5)).toEqual(['August 2026', 'Paid', 2, 0, 30000]);
    expect(values(byMonth, 3).slice(0, 5)).toEqual(['September 2026', 'Approved', 1, 0, 10000]);
    // the totals: people once each
    expect(values(byMonth, 4).slice(0, 5)).toEqual(['Total', undefined, 2, 0, 40000]);
    expect(byMonth.getRow(4).getCell(1).font?.bold).toBe(true);
    expect(byMonth.getRow(2).getCell(5).numFmt).toBe('#,##0.00');

    const byDepartment = wb.getWorksheet('By Department')!;
    expect([2, 3, 4].map((r) => values(byDepartment, r).slice(0, 4))).toEqual([
      ['Finance', undefined, 1, 1],
      ['Sales', undefined, 1, 2],
      ['Sales', 'Inside Sales', 1, 2],
    ]);

    const summary = wb.getWorksheet('Summary')!;
    expect(values(summary, 2).slice(0, 4)).toEqual(['August 2026 to September 2026', 2, 2, 3]);
    expect(values(summary, 3)[0]).toBe('2026 to date (January 2026 to October 2026)');
  });

  it('is only headers without an approved month', async () => {
    const wb = await load(await statisticsWorkbook(payrollStatistics([], { from: '2026-01', to: '2026-03' }, '2026-10-17')));
    expect(wb.getWorksheet('By Month')!.rowCount).toBe(1);
    expect(wb.getWorksheet('By Department')!.rowCount).toBe(1);
  });
});
