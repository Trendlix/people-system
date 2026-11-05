import ExcelJS from 'exceljs';
import { TIMESHEET_TEMPLATE_HEADINGS, TIMESHEET_TEMPLATE_ROWS, TIMESHEET_TEMPLATE_SHEETS, TIMESHEET_UPLOAD_MAX_MB, TIMESHEET_UPLOAD_MAX_ROWS } from '@trendlix/shared';

// The template hours are uploaded with (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel
// template", by "each person and HR"): Hours (Date, Employee code, Employee name, Client, Task, Hours, Note: the Client
// chosen from a list of the active clients, Employee name looked up from the code, for reading) and How to fill (what goes
// where, then the clients and the employees: for someone uploading their own, themselves; for HR, the CEO or a Super
// Admin, those switched to timesheets they may see). Written like the leave import's template: bold, filled, frozen
// headings and set widths, Date formatted as a date so a day typed there stays one.

const THIN = { style: 'thin' } as const;
const HEADING_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const READ_ONLY_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const BOLD = { name: 'Calibri', size: 11, bold: true } as const;

export interface TemplateClient {
  name: string;
  code: string | null;
}

export interface TemplatePerson {
  employeeCode: string;
  fullNameEn: string;
}

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

/** The lines How to fill opens with: for someone's own hours, or HR's for others. */
export function instructions(forOthers: boolean, year: number): string[] {
  return [
    `${TIMESHEET_TEMPLATE_SHEETS.hours}: one row for each piece of work: the day, the client or the task (or both), the hours and, if you like, a note.`,
    forOthers
      ? 'Employee code: on every row, as listed below (those switched to timesheets). Employee name shows who it is, for reading.'
      : 'Employee code: leave it empty, or write your own (below). Employee name shows who it is, for reading.',
    `Date: the day worked, as a date (DD/MM/YYYY), e.g. 02/11/${year}; not a day to come. Client: choose it from the list (the active clients, below), or leave it empty and write the Task. Task: what the work was, e.g. Editing.`,
    'Hours: in quarter hours from 0.25 to 24, e.g. 1.5, 7.75 or 7:45. A day has 24 hours at most, all its rows together.',
    forOthers
      ? 'Each person’s weeks (Sunday to Saturday) in the file replace those weeks’ hours and are sent to whoever approves them. A week already waiting for approval, or approved, can’t be changed: leave its rows out.'
      : 'Each week (Sunday to Saturday) in the file replaces that week’s hours on your timesheet. A week already waiting for approval, or approved, can’t be changed: leave its rows out. Upload and save keeps the weeks to send later; Upload and send sends them for approval too.',
    `Nothing is saved while any row has a problem: each one is listed with its row number, to put right in the file and upload again. Blank rows are skipped; a file can have up to ${TIMESHEET_UPLOAD_MAX_ROWS.toLocaleString('en-US')} rows and be up to ${TIMESHEET_UPLOAD_MAX_MB} MB.`,
  ];
}

/** The template, with the active `clients` and the `people` whose codes go in it listed on How to fill. */
export async function timesheetUploadTemplate(input: { clients: readonly TemplateClient[]; people: readonly TemplatePerson[]; forOthers: boolean; year: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // Employee name's look-ups are worked out when the workbook is opened
  wb.calcProperties.fullCalcOnLoad = true;
  const hours = wb.addWorksheet(TIMESHEET_TEMPLATE_SHEETS.hours, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
  const help = wb.addWorksheet(TIMESHEET_TEMPLATE_SHEETS.help);

  // How to fill: the instructions, then the clients and the employees, whose ranges the list and the look-up point at
  [30, 20, 20, 20].forEach((width, i) => (help.getColumn(i + 1).width = width));
  title(help, 1, 'Uploading Hours', 14);
  const lines = instructions(input.forOthers, input.year);
  lines.forEach((text, i) => {
    const row = 3 + i;
    help.mergeCells(row, 1, row, 4);
    const cell = help.getCell(row, 1);
    cell.value = text;
    cell.alignment = { vertical: 'top', wrapText: true };
    help.getRow(row).height = Math.max(30, Math.ceil(text.length / 80) * 15);
  });
  let r = 3 + lines.length + 1;
  title(help, r, 'Clients');
  tableHeadings(help, r + 1, ['Client', 'Client code']);
  const clientsFrom = r + 2;
  input.clients.forEach((c, i) => {
    help.getCell(clientsFrom + i, 1).value = c.name;
    if (c.code) help.getCell(clientsFrom + i, 2).value = c.code;
  });
  const clientsTo = clientsFrom + Math.max(1, input.clients.length) - 1;
  r = clientsTo + 2;
  title(help, r, 'Employees');
  tableHeadings(help, r + 1, ['Employee code', 'Employee name']);
  const peopleFrom = r + 2;
  input.people.forEach((p, i) => {
    help.getCell(peopleFrom + i, 1).value = p.employeeCode;
    help.getCell(peopleFrom + i, 2).value = p.fullNameEn;
  });
  const peopleTo = peopleFrom + Math.max(1, input.people.length) - 1;
  const sheetRef = `'${TIMESHEET_TEMPLATE_SHEETS.help}'`;
  const peopleRange = `${sheetRef}!$A$${peopleFrom}:$B$${peopleTo}`;

  // Hours: the headings, then the rows made ready
  const widths = [12, 15, 26, 26, 24, 8, 40];
  const head = hours.getRow(1);
  TIMESHEET_TEMPLATE_HEADINGS.forEach((text, i) => {
    hours.getColumn(i + 1).width = widths[i];
    const cell = head.getCell(i + 1);
    cell.value = text;
    cell.font = BOLD;
    cell.fill = HEADING_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });
  hours.getColumn(1).numFmt = 'dd/mm/yyyy';
  hours.getColumn(2).numFmt = '@';
  hours.getColumn(4).numFmt = '@';
  hours.getColumn(5).numFmt = '@';
  hours.getColumn(6).numFmt = '0.00';
  hours.getColumn(7).numFmt = '@';
  const last = TIMESHEET_TEMPLATE_ROWS + 1;
  for (let row = 2; row <= last; row++) {
    const name = hours.getCell(row, 3);
    name.value = { formula: `IF(B${row}="","",IFERROR(VLOOKUP(B${row},${peopleRange},2,FALSE),""))` };
    name.fill = READ_ONLY_FILL;
    hours.getCell(row, 1).dataValidation = {
      type: 'date',
      operator: 'between',
      allowBlank: true,
      formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Date',
      error: 'Write the day as a date, DD/MM/YYYY.',
    };
    if (input.clients.length) {
      hours.getCell(row, 4).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`${sheetRef}!$A$${clientsFrom}:$A$${clientsTo}`],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Client',
        error: 'Choose a client from the list (the active clients), or leave it empty and write the Task.',
      };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
