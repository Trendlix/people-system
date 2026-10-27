import ExcelJS from 'exceljs';
import {
  lawRatesFor,
  siMissingCounts,
  siMissingRow,
  siMonthRow,
  siMonthTotals,
  siRatesOf,
  siRegisterRow,
  siTotals,
  type SiContributionsReport,
  type SiMissingReport,
  type SiRegisterReport,
  type SiSource,
} from '@trendlix/shared';
import { siFileName, siWorkbook } from './social-insurance-workbook.js';

// The Social Insurance report's workbooks (owner, 27 October 2026: "is there a report for the social insurance? to be
// filled from the social insurance tab"; he chose all three, the register "download as Excel"): each view's sheet, the
// national ID and the employee file's columns only for those who see them, money and dates as numbers and dates, the
// month's total under its table, and the Summary. Everyone here is invented.

const LAW = lawRatesFor(2026);

const source = (name: string, code: string, over: { tab?: Partial<SiSource['tab']>; employment?: Partial<SiSource['employment']>; file?: SiSource['file'] } = {}): SiSource => ({
  employee: { id: `id-${code}`, employeeCode: code, fullNameEn: name, fullNameAr: 'موظف' },
  tab: { insuranceNo: '12345678', occupationCode: '194200', insuranceStartDate: null, insuranceBasicWage: null, insuranceComprehensiveWage: null, socialInsured: true, ...over.tab },
  nationalId: '29001011234567',
  employment: {
    id: `employment-${code}`,
    employmentType: 'full_time',
    standing: 'active',
    joinDate: '2026-10-12',
    leftOn: null,
    endingRecorded: false,
    department: { nameEn: 'Field', parent: { nameEn: 'Sales' } },
    ...over.employment,
  },
  contractPay: 12000,
  file: over.file === undefined ? { form1: ['verified'], form6: [], printReceivedOn: null } : over.file,
});

const BASE = { generatedAt: '2026-10-27T10:00:00.000Z', confidentialExcluded: 1 };

function register(sees: boolean): SiRegisterReport {
  const rows = [siRegisterRow(source('Rana', 'EMP-0001', sees ? {} : { file: null }), LAW, 410)];
  if (!sees) rows[0].nationalId = null;
  return {
    ...BASE,
    view: 'register',
    today: '2026-10-27',
    filters: { department: null, status: 'current' },
    rates: siRatesOf(LAW),
    insuranceBasicDefault: 410,
    seesIdentity: sees,
    seesFile: sees,
    rows,
    totals: siTotals(rows),
    notRegistered: 2,
  };
}

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

async function load(report: SiRegisterReport | SiContributionsReport | SiMissingReport) {
  const file = await siWorkbook(report);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.data as unknown as ArrayBuffer);
  return { file, wb };
}

describe('the Social Insurance report’s workbooks', () => {
  it('are named with their day or month', () => {
    expect(siFileName(register(true))).toBe('Social insurance register 2026-10-27.xlsx');
    expect(siFileName({ view: 'contributions', month: '2026-10' } as SiContributionsReport)).toBe('Social insurance contributions 2026-10.xlsx');
    expect(siFileName({ view: 'missing', today: '2026-10-27' } as SiMissingReport)).toBe('Social insurance missing data 2026-10-27.xlsx');
  });

  it('the register: the national ID in full and the forms for HR and the CEO, the wages as numbers, the dates as dates', async () => {
    const { wb } = await load(register(true));
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Register', 'Summary']);
    const [heads, rana] = rowsOf(wb.worksheets[0]) as [string[], unknown[]];
    const at = (h: string) => rana[heads.indexOf(h)];
    expect(heads).toEqual(expect.arrayContaining(['National ID', 'Insurance number', 'Occupation', 'Employee share (11%)', 'Company share (18.75%)', 'Form 1', 'Form 6', 'Insurance print']));
    expect(at('National ID')).toBe('29001011234567');
    expect(at('Department')).toBe('Sales');
    expect(at('Team')).toBe('Field');
    expect(at('Insured wage')).toBe(12000);
    expect(at('Employee share (11%)')).toBe(1320);
    expect(at('Company share (18.75%)')).toBe(2250);
    expect(at('Basic wage')).toBe(410);
    expect(at('Basic wage from')).toBe('Default');
    // without a subscription start of their own, Form 1 prints the join date
    expect(at('Subscription start')).toEqual(new Date('2026-10-12T00:00:00.000Z'));
    expect(at('Subscription start from')).toBe('Join date');
    expect(at('Form 1')).toBe('Verified');
    expect(at('Form 6')).toBe('Not due');
    expect(at('Insurance print')).toBe('Not received');
    expect(wb.worksheets[0].views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

    const summary = rowsOf(wb.worksheets[1]);
    expect(summary).toEqual(expect.arrayContaining([['People', 1], ['Not registered (not listed)', 2], ['Status', 'Current employees'], ['Department or team', 'Everyone']]));
    expect(summary.map((r) => r[0])).toContain('C-level people left out');
  });

  it('the register for Finance: no national ID, no forms or print', async () => {
    const { wb } = await load(register(false));
    const heads = rowsOf(wb.worksheets[0])[0] as string[];
    expect(heads).not.toContain('National ID');
    expect(heads).not.toContain('Form 1');
    expect(heads).not.toContain('Insurance print');
    expect(heads).toContain('Insured wage');
  });

  it('the month: joiners and leavers marked, the total under the table to pay the insurance office', async () => {
    const rows = [
      siMonthRow(source('Rana', 'EMP-0001'), LAW),
      siMonthRow(source('Omar', 'EMP-0002', { tab: { insuranceComprehensiveWage: 20000 }, employment: { joinDate: '2026-01-04', leftOn: '2026-10-20' } }), LAW),
    ];
    const report: SiContributionsReport = {
      ...BASE,
      view: 'contributions',
      month: '2026-10',
      filters: { department: { id: 'd', nameEn: 'Field', parent: { id: 'p', nameEn: 'Sales' } } },
      rates: siRatesOf(LAW),
      insureEveryone: true,
      rows,
      totals: siMonthTotals(rows, '2026-10'),
      notRegistered: 0,
    };
    const { wb } = await load(report);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Contributions', 'Summary']);
    const all = rowsOf(wb.worksheets[0]);
    const heads = all[0] as string[];
    const at = (row: unknown[], h: string) => row[heads.indexOf(h)];
    const [rana, omar] = [all[1], all[2]];
    expect(at(rana, 'Joined or left')).toBe('Joined');
    expect(at(omar, 'Joined or left')).toBe('Left');
    expect(at(omar, 'Insured wage')).toBe(16700);
    expect(at(omar, 'Both shares')).toBe(4968.25);
    const total = all.find((r) => r[0] === 'Total')!;
    expect(at(total, 'Insured wage')).toBe(28700);
    expect(at(total, 'Employee share (11%)')).toBe(3157);
    expect(at(total, 'Company share (18.75%)')).toBe(5381.25);
    expect(at(total, 'Both shares')).toBe(8538.25);
    // a row apart from the table, outside its filter
    expect(wb.worksheets[0].autoFilter).toBe('A1:P3');
    expect(wb.worksheets[0].getRow(5).getCell(1).value).toBe('Total');
    const summary = rowsOf(wb.worksheets[1]);
    expect(summary).toEqual(expect.arrayContaining([['Month', 'October 2026'], ['Joined in the month', 1], ['Left in the month', 1], ['Department or team', 'Sales › Field']]));
  });

  it('the missing data: one row per person and one per item', async () => {
    const all = [
      siMissingRow(source('Rana', 'EMP-0001', { tab: { insuranceNo: null, socialInsured: false } })),
      siMissingRow(source('Omar', 'EMP-0002', { file: { form1: ['generated'], form6: [], printReceivedOn: '2026-10-01' } })),
    ];
    const report: SiMissingReport = {
      ...BASE,
      view: 'missing',
      today: '2026-10-27',
      filters: { department: null },
      rows: all.filter((r) => r.missing.length),
      checked: all.length,
      byItem: siMissingCounts(all),
    };
    const { wb } = await load(report);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Missing data', 'Each missing item', 'Summary']);
    const people = rowsOf(wb.worksheets[0]);
    expect(people).toHaveLength(3);
    expect(people.find((r) => r[0] === 'EMP-0001')!.at(-1)).toBe('Not registered with social insurance, Insurance number, Subscription start, Social insurance print not received');
    const items = rowsOf(wb.worksheets[1]).slice(1);
    expect(items.filter((r) => r[0] === 'EMP-0001').map((r) => r.at(-1))).toEqual([
      'Not registered with social insurance',
      'Insurance number',
      'Subscription start',
      'Social insurance print not received',
    ]);
    expect(items.filter((r) => r[0] === 'EMP-0002').map((r) => r.at(-1))).toEqual(['Subscription start']);
    expect(rowsOf(wb.worksheets[2])).toEqual(expect.arrayContaining([['Checked', 2], ['Missing something', 2], ['Subscription start', 2]]));
  });
});
