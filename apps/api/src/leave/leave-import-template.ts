import ExcelJS from 'exceljs';
import {
  LEAVE_BALANCE_LABELS,
  LEAVE_IMPORT_BALANCE_HEADINGS,
  LEAVE_IMPORT_LEAVE_HEADINGS,
  LEAVE_IMPORT_MAX_MB,
  LEAVE_IMPORT_MAX_ROWS,
  LEAVE_IMPORT_SHEETS,
  LEAVE_IMPORT_TEMPLATE_ROWS,
  LEAVE_PAY_LABELS,
  OD_IMPORT_MAX_DAYS,
  TEMPLATE_OD_TYPE_NAME,
  TEMPLATE_WFH_TYPE_NAME,
  type LeaveBalanceKind,
  type LeavePay,
} from '@trendlix/shared';

// The template HR fills in to import leave (owner, 21 October 2026: "how to import bulk leaves?"; asked, he chose "Both"
// and "Our Excel template"): Leaves taken (who, the type from a list of the leave types on, From, To, the days if known,
// notes), Balances (who, the annual balance's type, the days left and the day they are as of) and How to fill (what goes
// where, then the leave types and the employees' codes and names the caller may see: a C-level person isn't listed to HR,
// as everywhere). Written like the holidays template (payroll/holidays-import-template.ts): bold, filled, frozen headings
// and set widths; the date columns formatted as dates, so a day typed there is kept as one. Each Employee name looks the
// typed code up on How to fill, for reading: the import matches by the code. The Leave type list ends with Work from
// home, then Official duty (owner, 26 October 2026: "Import (template + Zoho)"), neither of them leave.

/** The name the template is saved under. */
export const LEAVE_IMPORT_TEMPLATE_NAME = 'Leave import template.xlsx';

const THIN = { style: 'thin' } as const;
const HEADING_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const READ_ONLY_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const DATE_FORMAT = 'dd/mm/yyyy';
const BOLD = { name: 'Calibri', size: 11, bold: true } as const;

/** A leave type as the template lists it. */
export interface TemplateLeaveType {
  nameEn: string;
  balance: string;
  paid: string;
  payPercent: number | null;
  calendarDays: boolean;
}

/** An employee as How to fill lists them. */
export interface TemplatePerson {
  employeeCode: string;
  fullNameEn: string;
}

function headings(ws: ExcelJS.Worksheet, texts: readonly string[], widths: readonly number[]) {
  const row = ws.getRow(1);
  texts.forEach((text, i) => {
    ws.getColumn(i + 1).width = widths[i];
    const cell = row.getCell(i + 1);
    cell.value = text;
    cell.font = BOLD;
    cell.fill = HEADING_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });
}

/** A heading on How to fill, Title Case as every heading is. */
function title(ws: ExcelJS.Worksheet, row: number, text: string, size = 12) {
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: 'Calibri', size, bold: true };
}

function tableHeadings(ws: ExcelJS.Worksheet, row: number, texts: readonly string[]) {
  texts.forEach((text, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = text;
    cell.font = BOLD;
    cell.fill = HEADING_FILL;
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });
}

const typeCountedText = (t: TemplateLeaveType) => LEAVE_BALANCE_LABELS[t.balance as LeaveBalanceKind] ?? t.balance;
const typePaidText = (t: TemplateLeaveType) => (t.paid === 'partly' ? `Paid at ${t.payPercent ?? 100}%` : (LEAVE_PAY_LABELS[t.paid as LeavePay] ?? t.paid));

/** The lines How to fill opens with. */
function instructions(year: number): string[] {
  return [
    `${LEAVE_IMPORT_SHEETS.leaves}: one row for each leave already taken (or booked), recorded as approved when imported. Employee code (as listed below) finds the person; Employee name shows who it is, for reading. Without a code, the name is matched, for you to confirm.`,
    `Leave type: choose it from the list. From and To: the first and last day, as dates (DD/MM/YYYY), e.g. 05/03/${year} to 07/03/${year}. Days: optional. The system counts the days itself (working days by the person’s shift, without rest days and the official holidays set in Organization → Holidays; calendar days for the types counted so): a different figure is shown as a warning and the system’s used. A single day of 0.5 is a half day, for the types that allow one. Notes: optional.`,
    `Work from home: choose it from the Leave type list for days worked from home. Its working days (without rest days and the official holidays) become approved work-from-home days, not leave: no balance is used, and it is never a half day.`,
    `Official duty: choose it from the Leave type list for work for the company away from the office (rows pasted from elsewhere may say OD, On duty or مأمورية). A row becomes one approved official duty from its first working day to its last, full days, at most ${OD_IMPORT_MAX_DAYS} days in a row: the days count as attended, no balance is used, and it is never a half day. Its place is “Imported” and its Notes are its reason.`,
    `${LEAVE_IMPORT_SHEETS.balances}: optional, one row for each person whose annual leave balance should start from a figure: the days they have left as of a day (As of, in ${year} or in a year of the leave above). The system works out the year’s annual leave itself (Labour Law Art. 124, a first year pro-rated) and sets the balance to the figure with an adjustment, after the leave above is counted: give what is left of the whole year’s leave as of that day. Casual leave is counted against the annual balance, so it has no row of its own.`,
    `Before anything is saved you see every row: ready, a duplicate (already in the system or imported before), a problem (put it right in the file and upload it again), or a person to confirm. Leave in a month whose payroll is approved already is counted in no payroll. Blank rows are skipped; a file can have up to ${LEAVE_IMPORT_MAX_ROWS.toLocaleString('en-US')} rows and be up to ${LEAVE_IMPORT_MAX_MB} MB.`,
  ];
}

/**
 * The template, with `types` (the leave types on, in their order), `balanceTypes` (those whose balance may be set: the
 * annual balance's) and `people` (the employees the caller may see, by name) listed on How to fill.
 */
export async function leaveImportTemplate(input: { types: readonly TemplateLeaveType[]; balanceTypes: readonly TemplateLeaveType[]; people: readonly TemplatePerson[]; year: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // Employee name's look-ups are worked out when the workbook is opened
  wb.calcProperties.fullCalcOnLoad = true;
  const leaves = wb.addWorksheet(LEAVE_IMPORT_SHEETS.leaves, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
  const balances = wb.addWorksheet(LEAVE_IMPORT_SHEETS.balances, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
  const help = wb.addWorksheet(LEAVE_IMPORT_SHEETS.help);

  // How to fill: the instructions, then the types, the types with a balance and the employees, whose ranges the lists
  // and look-ups of the other sheets point at
  [18, 40, 26, 18].forEach((width, i) => (help.getColumn(i + 1).width = width));
  title(help, 1, 'Importing Leave', 14);
  const lines = instructions(input.year);
  lines.forEach((text, i) => {
    const row = 3 + i;
    help.mergeCells(row, 1, row, 4);
    const cell = help.getCell(row, 1);
    cell.value = text;
    cell.alignment = { vertical: 'top', wrapText: true };
    help.getRow(row).height = Math.max(30, Math.ceil(text.length / 95) * 15);
  });
  let r = 3 + lines.length + 1;
  title(help, r, 'Leave Types');
  tableHeadings(help, r + 1, ['Leave type', 'Counted against', 'Paid', 'Counted in']);
  const typesFrom = r + 2;
  input.types.forEach((t, i) => {
    const row = help.getRow(typesFrom + i);
    row.getCell(1).value = t.nameEn;
    row.getCell(2).value = typeCountedText(t);
    row.getCell(3).value = typePaidText(t);
    row.getCell(4).value = t.calendarDays ? 'Calendar days' : 'Working days';
  });
  // Work from home, last (owner, 26 October 2026: "in the import leaves templete there is no working from home option"):
  // not a leave type, its rows become approved work-from-home days
  const wfhRow = help.getRow(typesFrom + input.types.length);
  wfhRow.getCell(1).value = TEMPLATE_WFH_TYPE_NAME;
  wfhRow.getCell(2).value = 'Not leave: work-from-home days';
  wfhRow.getCell(3).value = 'Normal working day';
  wfhRow.getCell(4).value = 'Working days';
  // Official duty, after it (owner, 26 October 2026: "Import (template + Zoho)"): not a leave type, each row one approved
  // official duty
  const odRow = help.getRow(typesFrom + input.types.length + 1);
  odRow.getCell(1).value = TEMPLATE_OD_TYPE_NAME;
  odRow.getCell(2).value = 'Not leave: official duty';
  odRow.getCell(3).value = 'Attended working day';
  odRow.getCell(4).value = 'Working days';
  const typesTo = typesFrom + input.types.length + 1;
  r = typesTo + 2;
  title(help, r, 'Leave Types With a Balance');
  tableHeadings(help, r + 1, ['Leave type']);
  const balanceFrom = r + 2;
  input.balanceTypes.forEach((t, i) => (help.getCell(balanceFrom + i, 1).value = t.nameEn));
  const balanceTo = balanceFrom + Math.max(1, input.balanceTypes.length) - 1;
  r = balanceTo + 2;
  title(help, r, 'Employees');
  tableHeadings(help, r + 1, ['Employee code', 'Employee name']);
  const peopleFrom = r + 2;
  input.people.forEach((p, i) => {
    const row = help.getRow(peopleFrom + i);
    row.getCell(1).value = p.employeeCode;
    row.getCell(2).value = p.fullNameEn;
  });
  const peopleTo = peopleFrom + Math.max(1, input.people.length) - 1;
  const sheetRef = `'${LEAVE_IMPORT_SHEETS.help}'`;
  const peopleRange = `${sheetRef}!$A$${peopleFrom}:$B$${peopleTo}`;
  const last = LEAVE_IMPORT_TEMPLATE_ROWS + 1;

  /** A column's rows given the same check (written as one range: exceljs joins alike cells). */
  const validate = (ws: ExcelJS.Worksheet, col: number, rule: ExcelJS.DataValidation) => {
    for (let row = 2; row <= last; row++) ws.getCell(row, col).dataValidation = rule;
  };

  /** Employee name: the code's name on How to fill, for reading. */
  const lookUp = (ws: ExcelJS.Worksheet) => {
    for (let row = 2; row <= last; row++) {
      const cell = ws.getCell(row, 2);
      cell.value = { formula: `IF(A${row}="","",IFERROR(VLOOKUP(A${row},${peopleRange},2,FALSE),""))` };
      cell.fill = READ_ONLY_FILL;
    }
  };

  headings(leaves, LEAVE_IMPORT_LEAVE_HEADINGS, [16, 32, 30, 13, 13, 9, 40]);
  leaves.getColumn(1).numFmt = '@';
  leaves.getColumn(4).numFmt = DATE_FORMAT;
  leaves.getColumn(5).numFmt = DATE_FORMAT;
  leaves.getColumn(6).numFmt = '0.0';
  leaves.getColumn(7).numFmt = '@';
  lookUp(leaves);
  validate(leaves, 3, {
    type: 'list',
    allowBlank: true,
    formulae: [`${sheetRef}!$A$${typesFrom}:$A$${typesTo}`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Leave type',
    error: 'Choose a leave type from the list: the types on in Leave Setup, Work from home or Official duty.',
  });
  for (const [col, name] of [
    [4, 'From'],
    [5, 'To'],
  ] as const) {
    validate(leaves, col, {
      type: 'date',
      operator: 'between',
      allowBlank: true,
      formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: name,
      error: 'Enter a date, as DD/MM/YYYY.',
    });
  }

  headings(balances, LEAVE_IMPORT_BALANCE_HEADINGS, [16, 32, 30, 16, 13]);
  balances.getColumn(1).numFmt = '@';
  balances.getColumn(4).numFmt = '0.0';
  balances.getColumn(5).numFmt = DATE_FORMAT;
  lookUp(balances);
  validate(balances, 3, {
    type: 'list',
    allowBlank: true,
    formulae: [`${sheetRef}!$A$${balanceFrom}:$A$${balanceTo}`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Leave type',
    error: 'Choose the leave type from the list: only the annual balance is set.',
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
