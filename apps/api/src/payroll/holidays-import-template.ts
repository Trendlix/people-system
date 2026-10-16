import ExcelJS from 'exceljs';
import { toDateOnly } from '../common/date-only.js';
import { IMPORT_HEADINGS, IMPORT_MAX_MB, IMPORT_MAX_RANGE_DAYS, IMPORT_MAX_ROWS, IMPORT_NAME_MAX } from './holidays-import.js';

// The template HR fills in to import a year's holidays (owner's request, 16 October 2026: "allow me to import yearly
// holiday list"): a "Holidays" sheet with the four columns the import reads (holidays-import.ts) and one example row,
// and a "How to Fill It" sheet on the formats. Written like the system's other workbooks (employees/missing-workbook.ts):
// bold, filled, frozen headings and set column widths. The date columns are formatted as dates, so a day typed there
// is kept as an Excel date; the names are text.

/** The name the template is saved under: "Holidays template 2027.xlsx". */
export const holidayTemplateName = (year: number) => `Holidays template ${year}.xlsx`;

const THIN = { style: 'thin' } as const;
const HEADING_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const DATE_FORMAT = 'dd/mm/yyyy';

const COLUMNS: readonly { width: number; numFmt: string; rtl?: boolean }[] = [
  { width: 14, numFmt: DATE_FORMAT },
  { width: 14, numFmt: DATE_FORMAT },
  { width: 36, numFmt: '@' },
  { width: 36, numFmt: '@', rtl: true },
];

/** The notes sheet: each column, what goes in it and an example; then how the import goes. */
function notes(year: number): { columns: [string, string, string][]; lines: string[] } {
  return {
    columns: [
      ['Date', 'The holiday’s day, as a date (DD/MM/YYYY) or as text: DD/MM/YYYY or YYYY-MM-DD. Arabic digits are fine.', `25/04/${year}`],
      [
        'Until',
        `Optional. The last day of a holiday of several days, such as Eid al-Adha: it is imported as one holiday a day, from Date to Until, ${IMPORT_MAX_RANGE_DAYS} days at most. Leave it empty for a holiday of one day.`,
        `19/05/${year} (for a holiday from 16/05/${year})`,
      ],
      ['Name (English)', `Needed, up to ${IMPORT_NAME_MAX} characters.`, 'Sinai Liberation Day'],
      ['Name (Arabic)', `Optional, up to ${IMPORT_NAME_MAX} characters.`, 'عيد تحرير سيناء'],
    ],
    lines: [
      'One row for each holiday, under the headings on the Holidays sheet. The first row is an example: change it or delete it.',
      `Blank rows are skipped. A file can have up to ${IMPORT_MAX_ROWS} rows and be up to ${IMPORT_MAX_MB} MB.`,
      'You can import this workbook as it is (.xlsx), or save the Holidays sheet as CSV (UTF-8) and import that.',
      'Before anything is saved you see each day with what will happen to it: new; already on file (the same day and name: skipped); a clash (another holiday that day: not imported, change or remove it on the Holidays tab first); in the file twice (the first counts); or a problem with its row. Then you import the new ones.',
    ],
  };
}

/** The template as an .xlsx, its example row for `year` (Coptic Christmas, 7 January, the same day every year). */
export async function holidayTemplate(year: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Holidays', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
  // each column formatted, so a day typed under Date or Until is kept as a date and a name as text
  COLUMNS.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    column.width = c.width;
    column.numFmt = c.numFmt;
    if (c.rtl) column.alignment = { horizontal: 'right', readingOrder: 'rtl' };
  });

  const heading = ws.getRow(1);
  IMPORT_HEADINGS.forEach((text, i) => {
    const cell = heading.getCell(i + 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = HEADING_FILL;
    cell.numFmt = '@';
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });

  const example = ws.getRow(2);
  example.getCell(1).value = toDateOnly(`${year}-01-07`);
  example.getCell(3).value = 'Coptic Christmas';
  example.getCell(4).value = 'عيد الميلاد المجيد';

  const help = wb.addWorksheet('How to Fill It');
  [16, 80, 34].forEach((width, i) => (help.getColumn(i + 1).width = width));
  help.getCell('A1').value = 'Importing the Year’s Holidays';
  help.getCell('A1').font = { name: 'Calibri', size: 14, bold: true };
  const { columns, lines } = notes(year);
  const headings = help.getRow(3);
  ['Column', 'What to enter', 'Example'].forEach((text, i) => {
    const cell = headings.getCell(i + 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = HEADING_FILL;
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });
  columns.forEach((values, i) => {
    const row = help.getRow(4 + i);
    values.forEach((text, j) => {
      const cell = row.getCell(j + 1);
      cell.value = text;
      cell.alignment = { vertical: 'top', wrapText: true };
      if (j === 0) cell.font = { name: 'Calibri', size: 11, bold: true };
    });
  });
  lines.forEach((text, i) => {
    const row = 5 + columns.length + i;
    help.mergeCells(row, 1, row, 3);
    const cell = help.getCell(row, 1);
    cell.value = text;
    cell.alignment = { vertical: 'top', wrapText: true };
    help.getRow(row).height = text.length > 120 ? 48 : 18;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
