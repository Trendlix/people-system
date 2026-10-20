import ExcelJS from 'exceljs';
import { ACH_AMOUNT_FORMAT, ACH_HEADERS, achWorkbook, CIB_HEADERS, cibDate, cibWorkbook } from './bank-files.js';
import { REGISTER_COLUMNS, registerTitle, registerWorkbook, type RegisterLine } from './register.js';

// The bank files are built cell by cell as the owner's files have them (owner's decisions, 16 October 2026): each is
// read back here and checked for what the bank reads (sheet name, headers, text or number in each cell, the totals)
// and how it looks (formats, fonts, fills, borders, widths). Every name, account and amount is invented.

async function read(data: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  return wb;
}

const fillOf = (cell: ExcelJS.Cell) => (cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? cell.fill.fgColor : undefined);

describe('CIB payroll system file', () => {
  const lines = [
    { account: '100012345678', name: 'Test Person One', amount: 12345.67 },
    { account: '200098765432', name: 'Test Person Two', amount: 8000 },
    { account: '300011112222', name: 'Test Person Three', amount: 0.33 },
  ];
  let ws: ExcelJS.Worksheet;

  beforeAll(async () => {
    const wb = await read(
      await cibWorkbook({ fileDate: '2026-10-06', valueDate: '2026-10-08', month: '2026-09', debitAccount: '123456789012', debitAccountName: 'Invented Company LLC', lines }),
    );
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Payroll']);
    ws = wb.getWorksheet('Payroll')!;
  });

  it('has the headers, green and bold, with their formats', () => {
    expect(CIB_HEADERS.map((_, i) => ws.getRow(1).getCell(i + 1).value)).toEqual([
      'File_Date',
      'Value_Date',
      'Narrative',
      'Currency',
      'Creditor_BIC_Code',
      'Account_Number',
      'Account_Name',
      'Debit_Amount',
      'Credit_Amount',
    ]);
    expect(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((c) => ws.getCell(`${c}1`).numFmt ?? 'General')).toEqual([
      'General',
      'General',
      'General',
      'General',
      '@',
      '00000',
      '@',
      '#,##0.00',
      '#,##0.00',
    ]);
    for (const c of ['A', 'E', 'I']) {
      const cell = ws.getCell(`${c}1`);
      expect(cell.font).toMatchObject({ name: 'Calibri', size: 12, bold: true });
      expect(fillOf(cell)).toEqual({ argb: 'FF92D050' });
      expect(cell.alignment).toMatchObject({ horizontal: 'center', vertical: 'middle' });
      expect(cell.border).toMatchObject({ left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } });
    }
    expect(ws.getRow(1).height).toBe(17);
    expect(ws.getRow(2).height).toBe(16);
  });

  it('row 2 is the company’s debit: the dates as text, month first; the account a number; the debit the credits’ total', () => {
    expect(cibDate('2026-10-06')).toBe('10/06/2026');
    const [a, b, c, d, e, f, g, h, i] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((col) => ws.getCell(`${col}2`));
    expect([a.value, a.type, a.numFmt]).toEqual(['10/06/2026', ExcelJS.ValueType.String, '@']);
    expect([b.value, b.type, b.numFmt]).toEqual(['10/08/2026', ExcelJS.ValueType.String, '@']);
    for (const cell of [a, b]) {
      expect(cell.font).toMatchObject({ name: 'Calibri', size: 11, bold: true });
      expect(fillOf(cell)).toEqual({ argb: 'FFFFC000' });
    }
    expect([c.value, c.type, c.numFmt]).toEqual(['SEP Salary', ExcelJS.ValueType.String, 'mm-dd-yy']);
    expect(c.font?.bold).toBeFalsy();
    expect(d.value).toBe('egp');
    expect([e.value, e.numFmt]).toEqual([null, '@']);
    expect(fillOf(e)).toEqual({ theme: 1 }); // blacked out, as in their template
    expect([f.value, f.type, f.numFmt, f.font?.bold]).toEqual([123456789012, ExcelJS.ValueType.Number, '0', true]);
    expect([g.value, g.type, g.numFmt, g.font?.bold]).toEqual(['Invented Company LLC', ExcelJS.ValueType.String, '@', true]);
    expect(h.type).toBe(ExcelJS.ValueType.Formula);
    expect(h.value).toEqual({ formula: 'I6', result: 20346 });
    expect([h.numFmt, h.border?.top?.style]).toEqual(['#,##0.00', 'medium']);
    expect([i.value, i.numFmt]).toEqual([null, '#,##0.00']);
    expect(fillOf(i)).toEqual({ theme: 1 });
    for (const cell of [a, b, c, d, f, g, h]) expect(cell.alignment).toMatchObject({ horizontal: 'center', vertical: 'middle' });
  });

  it('one credit row per employee: the BIC and name as text, the account and amount numbers, the amount bold on orange', () => {
    lines.forEach((line, n) => {
      const r = 3 + n;
      for (const col of ['A', 'B', 'C', 'D']) expect(ws.getCell(`${col}${r}`).value).toBeNull();
      const [e, f, g, h, i] = ['E', 'F', 'G', 'H', 'I'].map((col) => ws.getCell(`${col}${r}`));
      expect([e.value, e.type, e.numFmt]).toEqual(['CIBEEGCXXXX', ExcelJS.ValueType.String, '@']);
      expect([f.value, f.type, f.numFmt]).toEqual([Number(line.account), ExcelJS.ValueType.Number, '0']);
      expect([g.value, g.type, g.numFmt ?? 'General']).toEqual([line.name, ExcelJS.ValueType.String, 'General']);
      expect(h.value).toBeNull();
      expect(fillOf(h)).toEqual({ theme: 1 });
      expect([i.value, i.type, i.numFmt]).toEqual([line.amount, ExcelJS.ValueType.Number, '#,##0.00']);
      expect(i.font).toMatchObject({ name: 'Calibri', size: 11, bold: true });
      expect(fillOf(i)).toEqual({ argb: 'FFFFC000' });
      expect(i.alignment).toMatchObject({ horizontal: 'center', vertical: 'middle' });
      expect(i.border?.left).toBeUndefined();
      expect(i.border).toMatchObject({ right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } });
      expect(e.border).toMatchObject({ left: { style: 'thin' }, right: { style: 'thin' } });
      expect(f.border).toMatchObject({ left: { style: 'hair' }, right: { style: 'hair' } });
    });
  });

  it('the check row counts the names and totals the credits, with the results already worked out', () => {
    expect(ws.getCell('G6').value).toEqual({ formula: 'COUNTA(G3:G5)', result: 3 });
    expect(fillOf(ws.getCell('G6'))).toEqual({ argb: 'FFFFC000' });
    expect(ws.getCell('H6').value).toEqual({ formula: 'H2', result: 20346 });
    expect(ws.getCell('I6').value).toEqual({ formula: 'SUM(I3:I5)', result: 20346 });
    for (const ref of ['H6', 'I6']) expect(ws.getCell(ref).numFmt).toBe('#,##0.00');
    expect(ws.rowCount).toBe(6); // nothing below the check row
  });

  it('keeps the column widths of their template, with no gridlines', () => {
    const widths = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((c) => [c, Math.round(ws.getColumn(c).width! * 100) / 100]));
    expect(widths).toEqual({ A: 10.66, B: 12.16, C: 10.33, D: 9.66, E: 19.5, F: 30.66, G: 51.16, H: 15.5, I: 18.16, J: 3.66 });
    expect(ws.views[0]).toMatchObject({ showGridLines: false });
  });
});

describe('ACH file', () => {
  const lines = [
    { name: 'Test Person Four', account: 'EG380019000500000000263180002', bankShort: 'NBE', amount: 15000.5 },
    { name: 'Test Person Five', account: '12345678901', bankShort: 'QNB', amount: 7250 },
  ];
  let wb: ExcelJS.Workbook;
  let ws: ExcelJS.Worksheet;

  beforeAll(async () => {
    wb = await read(await achWorkbook({ month: '2026-09', purpose: 'CASH', lines }));
    ws = wb.worksheets[0];
  });

  it('is one sheet named after the month in Arabic', () => {
    expect(wb.worksheets.map((s) => s.name)).toEqual(['سبتمبر 2026']);
  });

  it('has the headers, bold and centred (the amount’s to the left), with their formats', () => {
    expect(ACH_HEADERS.map((_, i) => ws.getRow(1).getCell(i + 1).value)).toEqual([
      'TransactionID',
      'CreditorName',
      'CreditorAccountNumber',
      'CreditorBank',
      'CreditorBankBranch',
      'TransactionAmount',
      'TransactionPurpose',
      'Comments',
      'ReceiverEmail',
      'SMSMobileNumber',
    ]);
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    expect(cols.map((c) => ws.getCell(`${c}1`).numFmt)).toEqual(['@', '@', '@', '@', '0', '0.00', '@', '@', '@', '@']);
    expect(cols.map((c) => ws.getCell(`${c}1`).alignment?.horizontal)).toEqual(['center', 'center', 'center', 'center', 'center', 'left', 'center', 'center', 'center', 'center']);
    for (const c of cols) {
      expect(ws.getCell(`${c}1`).font).toMatchObject({ name: 'Calibri', size: 11, bold: true });
      expect(ws.getCell(`${c}1`).border).toMatchObject({ left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } });
    }
    expect(ws.getRow(1).height).toBe(15.75);
  });

  it('one row per employee: the number, account and bank as text, the amount a number in the accounting format; no total', () => {
    lines.forEach((line, n) => {
      const r = 2 + n;
      const cell = (c: string) => ws.getCell(`${c}${r}`);
      expect([cell('A').value, cell('A').type, cell('A').numFmt]).toEqual([String(n + 1), ExcelJS.ValueType.String, '@']);
      expect(cell('A').font).toMatchObject({ name: 'Arial', size: 11 });
      expect(cell('A').alignment).toMatchObject({ horizontal: 'center' });
      expect([cell('B').value, cell('B').type, cell('B').numFmt]).toEqual([line.name, ExcelJS.ValueType.String, '@']);
      expect([cell('C').value, cell('C').type, cell('C').numFmt]).toEqual([line.account, ExcelJS.ValueType.String, '@']);
      expect([cell('D').value, cell('D').type, cell('D').numFmt]).toEqual([line.bankShort, ExcelJS.ValueType.String, '@']);
      for (const c of ['B', 'C', 'D']) expect(cell(c).alignment).toMatchObject({ horizontal: 'center', vertical: 'middle' });
      expect(cell('E').value).toBeNull();
      // exceljs reads Excel's accounting format back without its escapes; the file has it as the owner's has it
      expect([cell('F').value, cell('F').type, cell('F').numFmt?.replace(/\\/g, '')]).toEqual([line.amount, ExcelJS.ValueType.Number, ACH_AMOUNT_FORMAT.replace(/\\/g, '')]);
      expect([cell('G').value, cell('G').numFmt]).toEqual(['CASH', '@']);
      expect([cell('H').value, cell('H').numFmt]).toEqual(['September 2026 Salary', '@']);
      expect([cell('I').value, cell('J').value]).toEqual([null, null]);
      for (const c of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
        expect(cell(c).border).toMatchObject({ left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } });
      }
    });
    expect(ws.rowCount).toBe(3);
    expect(ACH_AMOUNT_FORMAT).toBe('_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)');
  });

  it('keeps the column widths of their file', () => {
    const widths = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((c) => [c, Math.round(ws.getColumn(c).width! * 100) / 100]));
    expect(widths).toEqual({ A: 13.5, B: 45.16, C: 32.5, D: 12.5, E: 19.16, F: 19.33, G: 17.66, H: 50.5, I: 13.66, J: 20 });
  });
});

describe('payroll register', () => {
  const result = (net: number): RegisterLine['result'] => ({
    fixed: 8000,
    variable: 2000,
    parts: [{ contractId: 'contract', fixed: 8000, variable: 2000, allowances: 500 }],
    absentHours: 0,
    leaveHours: 0,
    // the shift's (never typed since 20 October 2026): 190 worked of 200
    expectedHours: 200,
    attendanceRatio: 0.95,
    attendanceScore: 1,
    kpiScore: 1,
    attendanceCut: 0,
    kpiCut: 0,
    noShowCut: 0,
    overtime: 0,
    bonus: 0,
    commission: 0,
    settlements: 0,
    earned: 10000,
    allowances: 500,
    taxableAllowances: 500,
    insuredWage: 10500,
    employeeInsurance: 1155,
    employerInsurance: 1968.75,
    monthlyTaxable: 9345,
    annualNetIncome: 92140,
    monthlyTax: 958.17,
    martyrsFund: 5.25,
    penaltyCut: 0,
    deductions: 2118.42,
    net,
    released: 0,
    transfer: net,
    companyCost: 12468.75,
    warnings: [],
  });
  const line = (name: string, department: string | null, net: number): RegisterLine => ({
    department,
    employeeCode: `EMP-9${name.length}`,
    name,
    jobTitle: 'Invented Title',
    payBasis: 'monthly',
    terms: {
      year: 2026,
      payBasis: 'monthly',
      gross: 10000,
      basicPercent: 80,
      hourlyRate: null,
      allowances: [],
      paidDays: 30,
      statutory: true,
      insured: true,
      insuredWage: 10500,
      hoursPerDay: 8,
      // 25 working days of 8:00: the expected hours, worked out from the shift (owner, 20 October 2026: "expected hours to
      // be locked based on shifts and attendance data")
      expectedHours: 200,
      expectedDays: { workingDays: 25, holidays: 0 },
    },
    inputs: {
      workedHours: 190,
      expectedHours: null,
      softSkills: 90,
      performance: null,
      clientSatisfaction: null,
      noShowDays: null,
      leaveDays: null,
      penaltyDays: null,
      bonusDays: null,
      commission: null,
      settlements: null,
      released: null,
      attendanceWaived: false,
    },
    result: result(net),
    bankFile: 'cib',
    onHold: false,
    comments: null,
  });

  it('a row per line by department (none last), the amounts as numbers, a totals row of formulas with their results', async () => {
    const wb = await read(
      await registerWorkbook({
        month: '2026-09',
        status: 'draft',
        paidOn: null,
        lines: [line('Zed Invented', 'Sales', 8381.58), line('Amy Invented', null, 8000), line('Bob Invented', 'Marketing', 8381.58)],
      }),
    );
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Payroll — September 2026 — DRAFT');
    expect(registerTitle({ month: '2026-09', status: 'approved' })).toBe('Payroll — September 2026');
    expect(ws.getCell('A2').value).toBe('Status: Draft');
    const headers = REGISTER_COLUMNS.map((_, i) => ws.getRow(4).getCell(i + 1).value);
    expect(headers.slice(0, 7)).toEqual(['#', 'Department', 'ID', 'Name', 'Title', 'Pay basis', 'Gross salary']);
    expect(headers).toContain('Social insurance (employee)');
    expect(headers).not.toContain('Medical'); // no medical subscription any more (owner's decision, 16 October 2026)
    expect(headers.at(-1)).toBe('Comments');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 4, ySplit: 4 });

    expect([5, 6, 7].map((r) => ws.getRow(r).getCell(4).value)).toEqual(['Bob Invented', 'Zed Invented', 'Amy Invented']);
    const net = REGISTER_COLUMNS.findIndex((c) => c.header === 'Net') + 1;
    expect(ws.getRow(5).getCell(net).value).toBe(8381.58);
    expect(ws.getRow(5).getCell(net).numFmt).toBe('#,##0.00');
    const attendance = REGISTER_COLUMNS.findIndex((c) => c.header === 'Attendance %') + 1;
    expect([ws.getRow(5).getCell(attendance).value, ws.getRow(5).getCell(attendance).numFmt]).toEqual([0.95, '0.00%']);

    const letter = ws.getRow(8).getCell(net).address.replace(/\d+/g, '');
    expect(ws.getRow(8).getCell(net).value).toEqual({ formula: `SUM(${letter}5:${letter}7)`, result: 24763.16 });
    expect(ws.getRow(8).getCell(2).value).toBe('Total');
    // two columns more since 17 October 2026: the attendance waived, and the additions and deductions in words; two more
    // since 18 October 2026: the unpaid leave days and their cut; one more since 19 October 2026: the permission hours;
    // one more since 20 October 2026: the deductions before tax
    expect(ws.getRow(8).getCell(REGISTER_COLUMNS.length).address).toBe('AY8');
  });

  it('the expected hours attendance was measured on, and the leave days after the no-show days (17 October 2026)', async () => {
    // from the shift: 176 (22 days of 8 hours) less 1 no-show day and 2 of leave, 152; 150:24 worked is 98.95%
    const shift = line('Amy Invented', 'Sales', 8000);
    shift.terms = { ...shift.terms, expectedHours: 176, expectedDays: { workingDays: 22, holidays: 0 } };
    shift.inputs = { ...shift.inputs, workedHours: 150.4, expectedHours: null, noShowDays: 1, leaveDays: 2 };
    shift.result = { ...shift.result, absentHours: 8, leaveHours: 16, expectedHours: 152, attendanceRatio: 0.9894736842 };
    // worked out before 17 October 2026, its no-show day's 8 hours taken out of the 200 typed, and no leave days
    const older = line('Zed Invented', 'Sales', 8381.58);
    older.inputs = { ...older.inputs, expectedHours: 200, noShowDays: 1 };
    delete (older.inputs as Partial<RegisterLine['inputs']>).leaveDays;
    older.result = { ...older.result, absentHours: 8, attendanceRatio: 0.9895833333 };
    delete (older.result as Partial<RegisterLine['result']>).expectedHours;
    const ws = (await read(await registerWorkbook({ month: '2026-09', status: 'approved', paidOn: null, lines: [shift, older, line('Bob Invented', 'Sales', 8381.58)] })))
      .worksheets[0];
    const headers = REGISTER_COLUMNS.map((c) => c.header);
    const expected = headers.indexOf('Expected hours');
    expect(headers.slice(expected, expected + 2)).toEqual(['Expected hours', 'Attendance %']);
    expect(headers).not.toContain('No-show hours');
    const noShow = headers.indexOf('No-show days');
    // the unpaid leave days beside the leave days (18 October 2026: the Leave module)
    expect(headers.slice(noShow, noShow + 4)).toEqual(['No-show days', 'Leave days', 'Unpaid leave days', 'Penalty days']);
    // Amy, Bob, Zed: 152, the 200 typed, 200 − 8
    expect([5, 6, 7].map((r) => ws.getRow(r).getCell(expected + 1).value)).toEqual([152, 200, 192]);
    expect(ws.getRow(5).getCell(expected + 1).numFmt).toBe('#,##0.00');
    expect([5, 6, 7].map((r) => ws.getRow(r).getCell(noShow + 2).value)).toEqual([2, null, null]);
  });
});
