import ExcelJS from 'exceljs';
import type { ContractsReportRow, ContractsReportTotals } from '@trendlix/shared';
import { contractsReportFileName, contractsReportWorkbook, daysLeftCell, excelDate, periodText } from './contracts-report-workbook.js';

// The Contracts report as an Excel workbook (owner, 25 October 2026: "Dates and status"; no salary or allowances). Everyone
// here is invented.

const ROW: ContractsReportRow = {
  contractId: 'c-2',
  number: 'CON-2026-0004',
  version: 2,
  kind: 'renewal',
  employee: { id: 'e-1', employeeCode: 'EMP-0001', fullNameEn: 'Amy Example', fullNameAr: 'إيمي' },
  employmentId: 'job-1',
  department: { id: 'd-pay', nameEn: 'Payroll', parent: { id: 'd-acc', nameEn: 'Accounts' } },
  jobTitle: 'Accountant',
  employmentType: 'full_time',
  form: 'fixed',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  daysLeft: 67,
  status: 'active',
  signedOn: '2025-12-15',
  probationEnd: null,
  employeeStatus: 'current',
  nextVersion: null,
};

const ENDED: ContractsReportRow = {
  ...ROW,
  contractId: 'c-9',
  number: 'CON-2025-0011',
  version: 1,
  kind: 'first',
  employee: { id: 'e-2', employeeCode: 'EMP-0002', fullNameEn: 'Bassem Example With A Rather Long Name', fullNameAr: 'باسم' },
  department: { id: 'd-sales', nameEn: 'Sales', parent: null },
  jobTitle: null,
  employmentType: 'part_time',
  form: 'open_ended',
  startDate: '2025-09-01',
  endDate: null,
  daysLeft: null,
  status: 'ended',
  signedOn: '2025-08-20',
  probationEnd: '2025-11-30',
  employeeStatus: 'former',
};

const TOTALS: ContractsReportTotals = {
  contracts: 2,
  people: 2,
  byStatus: { draft: 0, active: 1, ended: 1, superseded: 0 },
  endingIn: [
    { days: 30, count: 0 },
    { days: 60, count: 0 },
    { days: 90, count: 1 },
  ],
  notRenewed: 0,
  renewalsSigned: 1,
};

const FILTERS = {
  period: { from: '2026-01', to: '2026-12' },
  status: 'signed' as const,
  show: 'latest' as const,
  employmentType: null,
  form: null,
  department: { id: 'd-acc', nameEn: 'Accounts', parent: null },
  endingWithin: 90,
  q: 'example',
};

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return rows;
}

describe('the Contracts workbook', () => {
  it('is named with its period, and words it', () => {
    expect(contractsReportFileName({ from: '2026-01', to: '2026-12' })).toBe('Contracts 2026-01 to 2026-12.xlsx');
    expect(periodText({ from: '2026-01', to: '2026-12' })).toBe('January 2026 to December 2026');
    expect(periodText({ from: '2026-10', to: '2026-10' })).toBe('October 2026');
  });

  it('has the days left of a contract in force, "Ended" for an ended one, and real dates', () => {
    expect(daysLeftCell(ROW)).toBe(67);
    expect(daysLeftCell({ status: 'active', daysLeft: -5 })).toBe(-5);
    expect(daysLeftCell(ENDED)).toBe('Ended');
    expect(daysLeftCell({ status: 'superseded', daysLeft: null })).toBeNull();
    expect(excelDate('2026-07-30')?.toISOString()).toBe('2026-07-30T00:00:00.000Z');
    expect(excelDate(null)).toBeNull();
  });

  it('has the contracts under a bold, frozen, filtered header, dates as dates shown DD/MM/YYYY, and the Summary', async () => {
    const data = await contractsReportWorkbook({ filters: FILTERS, rows: [ROW, ENDED], totals: TOTALS, generatedAt: '2026-10-25T12:05:00.000Z', confidentialExcluded: 1 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Contracts', 'Summary']);
    const [contracts, summary] = wb.worksheets;

    const rows = rowsOf(contracts);
    expect(rows[0]).toEqual([
      'Employee code',
      'Employee name (English)',
      'Department',
      'Team',
      'Job title',
      'Contract number',
      'Version',
      'Kind',
      'Employment type',
      'Length',
      'Start date',
      'End date',
      'Days left',
      'Status',
      'Signed on',
      'Probation end',
      'Employee status',
    ]);
    const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
    expect(rows[1]).toEqual(['EMP-0001', 'Amy Example', 'Accounts', 'Payroll', 'Accountant', 'CON-2026-0004', 2, 'Renewal', 'Full-time', 'Fixed-term', day('2026-01-01'), day('2026-12-31'), 67, 'Active', day('2025-12-15'), undefined, 'Current']);
    // an open end and a missing job title stay blank; a department without a team has none
    expect(rows[2]).toEqual(['EMP-0002', 'Bassem Example With A Rather Long Name', 'Sales', undefined, undefined, 'CON-2025-0011', 1, 'First contract', 'Part-time', 'Open-ended', day('2025-09-01'), undefined, 'Ended', 'Ended', day('2025-08-20'), day('2025-11-30'), 'Former']);
    expect(contracts.getCell('K2').numFmt).toBe('dd/mm/yyyy');
    expect(contracts.getCell('M2').numFmt).toBe('0');
    expect(contracts.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(contracts.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(contracts.autoFilter).toBeTruthy();
    // widths fitted to what they hold: the long name, a header longer than its values
    expect(contracts.getColumn(2).width).toBe('Bassem Example With A Rather Long Name'.length + 2);
    expect(contracts.getColumn(13).width).toBe('Days left'.length + 2);

    expect(rowsOf(summary)).toEqual([
      ['Summary', 'Value'],
      ['Contracts', 2],
      ['People', 2],
      ['Active', 1],
      ['Drafts', 0],
      ['Ended', 1],
      ['Replaced', 0],
      ['Ending in the next 30 days', 0],
      ['Ending in the next 60 days', 0],
      ['Ending in the next 90 days', 1],
      ['Ended in the period, not renewed', 0],
      ['Renewals signed in the period', 1],
      ['Period', 'January 2026 to December 2026'],
      ['Status', 'Signed (active, ended and replaced)'],
      ['Show', 'Latest version per employment'],
      ['Employment type', 'All types'],
      ['Contract length', 'Any length'],
      ['Department or team', 'Accounts'],
      ['Ending within', '90 days'],
      ['Search', 'example'],
      ['C-level people left out', 1],
      ['C-level (1 person) is left out: only the CEO and the Super Admin see their contracts.'],
      ['Made on', '25/10/2026 15:05 (Cairo)'],
    ]);
    expect(summary.autoFilter).toBeFalsy();

    // no pay anywhere
    const text = JSON.stringify([...rows, ...rowsOf(summary)]).toLowerCase();
    for (const word of ['salary', 'gross', 'allowance', 'egp', 'net']) expect(text).not.toContain(word);
  });
});
