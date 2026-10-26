import ExcelJS from 'exceljs';
import { leaveReport, type LeaveReportSourceLeave, type ReportDepartment } from '@trendlix/shared';
import { leaveReportFileName, leaveReportWorkbook, summaryLines } from './leave-report-workbook.js';

// The Leave report's workbook (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"; asked,
// "Both"): the file's name with its period, the Summary's groups as rows with their subtotals and the grand total, the
// Leaves list with real dates. Everyone here is invented.

const SALES: ReportDepartment = { id: 'd-sales', nameEn: 'Sales', parent: null };
const FIELD: ReportDepartment = { id: 'd-field', nameEn: 'Field', parent: { id: 'd-sales', nameEn: 'Sales' } };
const RAMI = { id: 'p1', employeeCode: 'EMP-001', fullNameEn: 'Rami', fullNameAr: 'رامي' };
const SARA = { id: 'p2', employeeCode: 'EMP-002', fullNameEn: 'Sara', fullNameAr: 'سارة' };

const leave = (over: Partial<LeaveReportSourceLeave>): LeaveReportSourceLeave => ({
  id: 'l1',
  employee: RAMI,
  department: FIELD,
  typeId: 't-annual',
  typeName: 'Annual',
  typeOrder: 10,
  startDate: '2026-10-25',
  endDate: '2026-11-05',
  halfDay: false,
  calendarDays: false,
  days: 10,
  workingDays: [0, 1, 2, 3, 4],
  source: 'recorded',
  reason: 'Family trip',
  ...over,
});

const built = leaveReport({
  period: { from: '2026-10', to: '2026-10' },
  leaves: [leave({}), leave({ id: 'l2', employee: SARA, department: SALES, typeId: 't-sick', typeName: 'Sick', typeOrder: 30, startDate: '2026-10-12', endDate: '2026-10-12', days: 1, reason: null, source: 'imported' })],
  permissions: [{ employee: SARA, department: SALES, date: '2026-10-14', hours: 2 }],
  wfh: [{ employee: RAMI, department: FIELD, date: '2026-10-20' }],
  holidays: [],
  annualLeft: new Map([['p1', 12], ['p2', null]]),
});
const report = {
  ...built,
  filters: { period: { from: '2026-10', to: '2026-10' }, department: null, employee: null },
  generatedAt: '2026-10-26T10:00:00.000Z',
  balanceAsOf: '2026-10-26',
  confidentialExcluded: 1,
};

describe('the Leave report’s workbook', () => {
  it('is named with its period', () => {
    expect(leaveReportFileName({ from: '2026-10', to: '2026-10' })).toBe('Leave 2026-10.xlsx');
    expect(leaveReportFileName({ from: '2026-01', to: '2026-12' })).toBe('Leave 2026-01 to 2026-12.xlsx');
  });

  it('has the groups as rows: headings, people, subtotals, then the grand total', () => {
    expect(summaryLines(report).map((l) => (l.kind === 'person' ? l.person.employee.fullNameEn : l.kind === 'heading' ? `# ${l.text}` : `= ${l.text} ${l.totals.leaveDays}`))).toEqual([
      '# Sales',
      'Sara',
      '# Sales › Field',
      'Rami',
      '= Total · Field 5',
      '= Total · Sales 6',
      '= Total · everyone 6',
    ]);
  });

  it('writes the Summary and the Leaves with numbers as numbers and dates as dates, headings frozen', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await leaveReportWorkbook(report)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Summary', 'Leaves']);
    const [summary, leaves] = wb.worksheets;
    expect((summary.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Employee code', 'Employee name (English)', 'Department', 'Team', 'Annual', 'Sick', 'Leave days', 'Permission hours', 'Work from home days', 'Annual balance left',
    ]);
    // Rami's row: the Field team of Sales, 5 annual days inside October, 1 work from home day, 12 days left
    const rami = (summary.getRow(5).values as unknown[]).slice(1);
    expect(rami).toEqual(['EMP-001', 'Rami', 'Sales', 'Field', 5, 0, 5, 0, 1, 12]);
    expect(summary.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(leaves.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect((leaves.getRow(1).values as unknown[]).slice(1, 10)).toEqual(['Employee code', 'Employee name (English)', 'Department', 'Team', 'Leave type', 'From', 'To', 'Half day', 'Days in the period']);
    // Sara's sick day, first by date: real dates shown DD/MM/YYYY, her days as numbers
    expect(leaves.getCell('A2').value).toBe('EMP-002');
    expect(leaves.getCell('F2').value).toEqual(new Date('2026-10-12T00:00:00.000Z'));
    expect(leaves.getCell('F2').numFmt).toBe('dd/mm/yyyy');
    expect([leaves.getCell('I2').value, leaves.getCell('J2').value, leaves.getCell('K2').value]).toEqual([1, 1, 'Imported']);
    expect(leaves.getCell('F3').value).toEqual(new Date('2026-10-25T00:00:00.000Z'));
    expect([leaves.getCell('I3').value, leaves.getCell('J3').value, leaves.getCell('L3').value]).toEqual([5, 10, 'Family trip']);
  });
});
