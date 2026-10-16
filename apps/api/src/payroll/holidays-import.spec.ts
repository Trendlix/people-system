import ExcelJS from 'exceljs';
import { writeZip } from '../templates/zip.js';
import {
  classifyDays,
  csvRows,
  csvText,
  holidayRows,
  IMPORT_HEADINGS,
  IMPORT_MAX_ROWS,
  importFileKind,
  ImportFileError,
  readDate,
  readHolidayRows,
  readImportFile,
  type HolidayRow,
  type ImportedDay,
  type SheetRow,
} from './holidays-import.js';
import { holidayTemplate, holidayTemplateName } from './holidays-import-template.js';

// Importing a year's holidays (owner's request, 16 October 2026: "allow me to import yearly holiday list"): the file's
// kind by its content, its rows under the headings, each row's dates in the ways HR writes them, a holiday of several
// days turned into one a day, each problem with its row, and each day set against the holidays on file. Every holiday
// here is invented or in a far-off year.

/** A workbook's bytes, from rows of cells under the template's headings (A1 on). */
async function workbook(rows: ExcelJS.CellValue[][], options: { sheet?: string; headings?: readonly string[]; date1904?: boolean } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  if (options.date1904) wb.properties.date1904 = true;
  const ws = wb.addWorksheet(options.sheet ?? 'Holidays');
  ws.addRow([...(options.headings ?? IMPORT_HEADINGS)]);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Rows under the template's headings, as holidayRows reads them. */
const sheet = (rows: unknown[][]): SheetRow[] => [{ row: 1, cells: [...IMPORT_HEADINGS] }, ...rows.map((cells, i) => ({ row: i + 2, cells: cells as SheetRow['cells'] }))];

/** One row of holidays, numbered `row`. */
const line = (row: number, date: unknown, until: unknown, nameEn: unknown, nameAr: unknown = null): HolidayRow =>
  ({ row, date, until, nameEn, nameAr }) as HolidayRow;

/** What a file can't be imported for. */
async function refusal(data: Buffer): Promise<string> {
  try {
    await readImportFile(data);
  } catch (err) {
    if (err instanceof ImportFileError) return err.message;
    throw err;
  }
  throw new Error('The file was read');
}

const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('a holiday list: the dates', () => {
  it('reads Excel dates, also with a time, a formula’s and a bare date number, in either date system', () => {
    expect(readDate(utc('2091-05-16'))).toEqual({ date: '2091-05-16' });
    expect(readDate(new Date('2091-05-16T18:30:00.000Z'))).toEqual({ date: '2091-05-16' });
    expect(readDate({ formula: 'A2+1', result: utc('2091-05-17') })).toEqual({ date: '2091-05-17' });
    // 46523 days after 30 December 1899; 45061 after 1 January 1904
    expect(readDate(46523)).toEqual({ date: '2027-05-16' });
    expect(readDate(45061, true)).toEqual({ date: '2027-05-16' });
    expect(readDate({ formula: 'TODAY()', result: 46523 })).toEqual({ date: '2027-05-16' });
  });

  it('reads text as YYYY-MM-DD or DD/MM/YYYY, also with "-" or ".", single digits, Arabic-Indic digits or a time', () => {
    for (const text of ['2091-05-16', '2091/5/16', '16/05/2091', '16-5-2091', '16.05.2091', ' 16/05/2091 ', '16/05/2091 00:00', '2091-05-16T00:00:00Z']) {
      expect(readDate(text)).toEqual({ date: '2091-05-16' });
    }
    expect(readDate('١٦/٠٥/٢٠٩١')).toEqual({ date: '2091-05-16' });
    expect(readDate('۱۶/۵/۲۰۹۱')).toEqual({ date: '2091-05-16' });
    // with direction marks, as Arabic text often has, and the Arabic date separator
    expect(readDate('\u200f١٦\u060d٠٥\u060d٢٠٩١\u200f')).toEqual({ date: '2091-05-16' });
    expect(readDate({ richText: [{ text: '16/05/' }, { text: '2091' }] })).toEqual({ date: '2091-05-16' });
  });

  it('tells a day that isn’t one from text that isn’t a date; an empty cell is none', () => {
    expect(readDate('31/02/2091')).toEqual({ problem: 'not_real', text: '31/02/2091' });
    expect(readDate('05/16/2091')).toEqual({ problem: 'not_real', text: '05/16/2091' });
    expect(readDate('٣١/٠٢/٢٠٩١')).toEqual({ problem: 'not_real', text: '31/02/2091' });
    for (const text of ['next Friday', '16/05/91', '2091']) expect(readDate(text)).toEqual({ problem: 'not_date', text });
    // a year, not a day; and a number past the years a holiday can be in
    expect(readDate(2091)).toEqual({ problem: 'not_date', text: '2091' });
    expect(readDate(9e15)).toEqual({ problem: 'not_date', text: '9000000000000000' });
    expect(readDate(true)).toEqual({ problem: 'not_date', text: 'true' });
    for (const empty of [null, undefined, '', '   ']) expect(readDate(empty)).toBeNull();
  });
});

describe('a holiday list: the rows', () => {
  it('finds the headings under a title, in any order and as written in Arabic, and skips blank rows', () => {
    const rows: SheetRow[] = [
      { row: 1, cells: ['Official holidays 2091'] },
      { row: 3, cells: ['Name (English)', 'Name (Arabic, optional)', 'From', 'To'] },
      { row: 4, cells: ['Labour Day', 'عيد العمال', '01/05/2091', null] },
      { row: 5, cells: [null, '  ', undefined, ''] },
      { row: 7, cells: ['Sinai Liberation Day', null, '25/04/2091'] },
    ];
    expect(holidayRows(rows)).toEqual([line(4, '01/05/2091', null, 'Labour Day', 'عيد العمال'), line(7, '25/04/2091', undefined, 'Sinai Liberation Day', null)]);
    expect(holidayRows([{ row: 1, cells: ['التاريخ', 'حتى', 'الاسم بالإنجليزية', 'الاسم بالعربية'] }, { row: 2, cells: ['01/05/2091', null, 'Labour Day'] }])).toHaveLength(1);
  });

  it('refuses a file without the headings, with no rows under them, or with more than 500', () => {
    expect(() => holidayRows([{ row: 1, cells: ['When', 'What'] }, { row: 2, cells: ['01/05/2091', 'Labour Day'] }])).toThrow(/doesn't have the template's headings \(Date, Until/);
    expect(() => holidayRows(sheet([[null, null, '  ']]))).toThrow('The file has no holidays under its headings.');
    const full = Array.from({ length: IMPORT_MAX_ROWS }, () => ['01/05/2091', null, 'Labour Day']);
    expect(holidayRows(sheet(full))).toHaveLength(IMPORT_MAX_ROWS);
    expect(() => holidayRows(sheet([...full, ['02/05/2091', null, 'One too many']]))).toThrow('The file has more than 500 rows of holidays. Import at most 500 at a time.');
    // blank rows aren't counted
    expect(holidayRows(sheet([...full, [null, null, null, null]]))).toHaveLength(IMPORT_MAX_ROWS);
  });

  it('turns a holiday of several days into one a day, each with the row’s names tidied', () => {
    const { days, problems } = readHolidayRows([
      line(2, '2091-06-10', '13/06/2091', '  Eid   al-Adha ', '\u200fعيد الأضحى\u200f'),
      line(3, utc('2091-07-23'), utc('2091-07-23'), 'Revolution Day'),
      line(4, '25/04/2091', '', { richText: [{ text: 'Sinai ' }, { text: 'Liberation Day' }] }, ''),
    ]);
    expect(problems).toEqual([]);
    expect(days).toEqual([
      { row: 2, date: '2091-06-10', nameEn: 'Eid al-Adha', nameAr: 'عيد الأضحى' },
      { row: 2, date: '2091-06-11', nameEn: 'Eid al-Adha', nameAr: 'عيد الأضحى' },
      { row: 2, date: '2091-06-12', nameEn: 'Eid al-Adha', nameAr: 'عيد الأضحى' },
      { row: 2, date: '2091-06-13', nameEn: 'Eid al-Adha', nameAr: 'عيد الأضحى' },
      { row: 3, date: '2091-07-23', nameEn: 'Revolution Day', nameAr: null },
      { row: 4, date: '2091-04-25', nameEn: 'Sinai Liberation Day', nameAr: null },
    ]);
    // 14 days is the longest; across the year's end too
    expect(readHolidayRows([line(2, '25/12/2091', '07/01/2092', 'A long holiday')]).days).toHaveLength(14);
  });

  it('says what is wrong with each row, by its number, and imports none of its days', () => {
    const { days, problems } = readHolidayRows([
      line(2, '31/02/2091', null, 'Not a day'),
      line(3, 'soon', null, 'Not a date'),
      line(4, null, null, 'No date'),
      line(5, '03/05/2091', '01/05/2091', 'Backwards'),
      line(6, '01/01/1999', null, 'Too early'),
      line(7, '01/06/2091', '20/06/2091', 'Too long'),
      line(8, '01/07/2091', '31/07/2091x', 'Bad until'),
      line(9, '01/08/2091', '30/02/2091', 'Unreal until'),
      line(10, '01/09/2091', null, '   ', 'بلا اسم'),
      line(11, '01/10/2091', null, 'x'.repeat(101), 'ع'.repeat(101)),
      line(12, '01/11/2091', '01/01/2101', 'Past 2100'),
    ]);
    expect(days).toEqual([]);
    expect(problems).toEqual([
      { row: 2, message: "Row 2: the date 31/02/2091 isn't a real day." },
      { row: 3, message: 'Row 3: "soon" under Date isn\'t a date. Write it as DD/MM/YYYY, e.g. 25/04/2027.' },
      { row: 4, message: "Row 4: enter the holiday's date under Date." },
      { row: 5, message: 'Row 5: Until (01/05/2091) is before the date (03/05/2091).' },
      { row: 6, message: 'Row 6: 01/01/1999 is outside the years a holiday can be in (2000 to 2100).' },
      { row: 7, message: 'Row 7: a holiday runs 14 days at most; this one runs 20 days, 01/06/2091 to 20/06/2091.' },
      { row: 8, message: 'Row 8: "31/07/2091x" under Until isn\'t a date. Write it as DD/MM/YYYY, e.g. 25/04/2027.' },
      { row: 9, message: "Row 9: the Until date 30/02/2091 isn't a real day." },
      { row: 10, message: "Row 10: enter the holiday's name in English." },
      { row: 11, message: 'Row 11: keep the English name to 100 characters or fewer.' },
      { row: 11, message: 'Row 11: keep the Arabic name to 100 characters or fewer.' },
      { row: 12, message: 'Row 12: 01/01/2101 is outside the years a holiday can be in (2000 to 2100).' },
    ]);
    // every problem of a row, in turn
    expect(readHolidayRows([line(5, 'soon', null, '')]).problems.map((p) => p.message)).toEqual([
      'Row 5: "soon" under Date isn\'t a date. Write it as DD/MM/YYYY, e.g. 25/04/2027.',
      "Row 5: enter the holiday's name in English.",
    ]);
  });
});

describe('a holiday list: against the holidays on file', () => {
  const day = (row: number, date: string, nameEn: string, nameAr: string | null = null): ImportedDay => ({ row, date, nameEn, nameAr });

  it('marks each day new, already on file (the same name), a clash (another name) or in the file twice', () => {
    const onFile = [
      { date: '2091-04-25', nameEn: 'Sinai  liberation day', nameAr: null },
      { date: '2091-05-01', nameEn: 'Workers Day', nameAr: 'عيد العمال' },
    ];
    expect(
      classifyDays(
        [day(2, '2091-04-25', 'Sinai Liberation Day'), day(3, '2091-05-01', 'Labour Day'), day(4, '2091-06-10', 'Eid al-Adha'), day(4, '2091-06-11', 'Eid al-Adha'), day(5, '2091-06-11', 'Arafat Day'), day(6, '2091-04-25', 'Sinai Liberation Day')],
        onFile,
      ),
    ).toEqual([
      { ...day(2, '2091-04-25', 'Sinai Liberation Day'), status: 'on_file', onFile: { nameEn: 'Sinai  liberation day', nameAr: null } },
      { ...day(3, '2091-05-01', 'Labour Day'), status: 'clash', onFile: { nameEn: 'Workers Day', nameAr: 'عيد العمال' } },
      { ...day(4, '2091-06-10', 'Eid al-Adha'), status: 'new' },
      { ...day(4, '2091-06-11', 'Eid al-Adha'), status: 'new' },
      { ...day(5, '2091-06-11', 'Arafat Day'), status: 'duplicate', firstRow: 4 },
      { ...day(6, '2091-04-25', 'Sinai Liberation Day'), status: 'duplicate', firstRow: 2 },
    ]);
  });
});

describe('a holiday list: the file', () => {
  it('reads a workbook: its Holidays sheet, Excel dates and text dates, a formula and rich text', async () => {
    const data = await workbook([
      [utc('2091-01-07'), null, 'Coptic Christmas', 'عيد الميلاد المجيد'],
      ['2091-06-10', '١٣/٠٦/٢٠٩١', 'Eid al-Adha', 'عيد الأضحى'],
      [],
      [{ formula: 'DATE(2091,7,23)', result: utc('2091-07-23') }, null, { richText: [{ text: 'Revolution ' }, { text: 'Day' }] }],
      ['30/02/2091', null, 'Not a day'],
    ]);
    expect(importFileKind(data)).toBe('xlsx');
    const reading = await readImportFile(data);
    expect(reading.rows).toBe(4);
    expect(reading.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(reading.days.map((d) => [d.row, d.date, d.nameEn])).toEqual([
      [2, '2091-01-07', 'Coptic Christmas'],
      [3, '2091-06-10', 'Eid al-Adha'],
      [3, '2091-06-11', 'Eid al-Adha'],
      [3, '2091-06-12', 'Eid al-Adha'],
      [3, '2091-06-13', 'Eid al-Adha'],
      [5, '2091-07-23', 'Revolution Day'],
    ]);
    expect(reading.problems).toEqual([{ row: 6, message: "Row 6: the date 30/02/2091 isn't a real day." }]);
  });

  it('reads the first visible sheet when none is named Holidays, and a 1904 workbook’s bare date numbers', async () => {
    const data = await workbook([[45061 + 365 * 64 + 16, null, 'Far off']], { sheet: 'Sheet1', date1904: true });
    expect((await readImportFile(data)).days[0].date).toBe('2091-05-16');
  });

  it('reads CSV: UTF-8 with or without its mark, a semicolon or a tab, quotes, Windows Arabic and UTF-16', async () => {
    const csv = 'Date,Until,Name (English),Name (Arabic)\r\n16/05/2091,19/05/2091,"Eid al-Adha, the feast",عيد الأضحى\r\n\r\n2091-07-23,,"Revolution ""23 July"" Day",\n';
    const plain = await readImportFile(Buffer.from(csv, 'utf8'));
    expect(plain.rows).toBe(2);
    expect(plain.days.map((d) => [d.row, d.date, d.nameEn, d.nameAr])).toEqual([
      [2, '2091-05-16', 'Eid al-Adha, the feast', 'عيد الأضحى'],
      [2, '2091-05-17', 'Eid al-Adha, the feast', 'عيد الأضحى'],
      [2, '2091-05-18', 'Eid al-Adha, the feast', 'عيد الأضحى'],
      [2, '2091-05-19', 'Eid al-Adha, the feast', 'عيد الأضحى'],
      [4, '2091-07-23', 'Revolution "23 July" Day', null],
    ]);
    const marked = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]);
    expect((await readImportFile(marked)).days).toEqual(plain.days);
    expect((await readImportFile(Buffer.from(csv.replace(/,/g, ';').replace('"Eid al-Adha; the feast"', 'Eid'), 'utf8'))).days[0].nameEn).toBe('Eid');
    expect((await readImportFile(Buffer.from('Date\tName (English)\n٢٥/٠٤/٢٠٩١\tSinai Liberation Day', 'utf8'))).days).toEqual([
      { row: 2, date: '2091-04-25', nameEn: 'Sinai Liberation Day', nameAr: null },
    ]);
    // Excel's "Unicode Text", and plain CSV saved on an Arabic Windows (windows-1256: "عيد" is C9 ED CF)
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Date,Name (English),Name (Arabic)\n25/04/2091,Sinai Liberation Day,عيد', 'utf16le')]);
    expect((await readImportFile(utf16)).days[0]).toEqual({ row: 2, date: '2091-04-25', nameEn: 'Sinai Liberation Day', nameAr: 'عيد' });
    const arabicWindows = Buffer.concat([Buffer.from('Date,Name (English),Name (Arabic)\n25/04/2091,Sinai Liberation Day,', 'latin1'), Buffer.from([0xda, 0xed, 0xcf])]);
    expect((await readImportFile(arabicWindows)).days[0].nameAr).toBe('عيد');
    expect(csvRows('a,b\n"c\nd",e')).toEqual([
      { row: 1, cells: ['a', 'b'] },
      { row: 2, cells: ['c\nd', 'e'] },
    ]);
    expect(csvText(Buffer.from('a,b'))).toBe('a,b');
  });

  it('gives the same file the same fingerprint, and another file another', async () => {
    const a = Buffer.from('Date,Name (English)\n25/04/2091,Sinai Liberation Day');
    const b = Buffer.from('Date,Name (English)\n25/04/2091,Sinai Liberation Day ');
    expect((await readImportFile(a)).fingerprint).toBe((await readImportFile(Buffer.from(a))).fingerprint);
    expect((await readImportFile(a)).fingerprint).not.toBe((await readImportFile(b)).fingerprint);
  });

  it('refuses, by its content, what isn’t a workbook or a CSV file', async () => {
    const notASheet = "This file isn't an Excel workbook (.xlsx) or a CSV file (.csv). Fill in the template and import it again.";
    expect(await refusal(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj'))).toBe(notASheet);
    expect(await refusal(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]))).toBe(notASheet);
    expect(await refusal(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x41]))).toBe(notASheet);
    expect(await refusal(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toMatch(/^This is an old Excel file \(\.xls\) or one protected by a password/);
    // a zip that isn't a workbook (a Word file's parts), and one that is damaged
    expect(await refusal(writeZip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }, { name: 'word/document.xml', data: Buffer.from('<w/>') }]))).toBe(notASheet);
    expect(await refusal(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]))).toBe(notASheet);
    expect(await refusal(Buffer.alloc(1024 * 1024 + 1, 0x41))).toBe('The file must be 1 MB or smaller.');
    expect(await refusal(Buffer.from('just some words'))).toMatch(/^The file doesn't have the template's headings/);
  });
});

describe('the template', () => {
  it('is named for its year, has the headings, an example row of dates and text, and a sheet on the formats', async () => {
    expect(holidayTemplateName(2091)).toBe('Holidays template 2091.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await holidayTemplate(2091)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Holidays', 'How to Fill It']);
    const ws = wb.getWorksheet('Holidays')!;
    expect([1, 2, 3, 4].map((c) => ws.getRow(1).getCell(c).value)).toEqual(['Date', 'Until', 'Name (English)', 'Name (Arabic)']);
    expect(ws.getRow(1).getCell(1).font).toMatchObject({ bold: true });
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getCell('A2').value).toEqual(utc('2091-01-07'));
    expect(ws.getCell('A2').numFmt).toBe('dd/mm/yyyy');
    expect([ws.getCell('C2').value, ws.getCell('D2').value]).toEqual(['Coptic Christmas', 'عيد الميلاد المجيد']);
    expect(ws.getColumn(2).numFmt).toBe('dd/mm/yyyy');
    expect(ws.getColumn(3).numFmt).toBe('@');
    const help = wb.getWorksheet('How to Fill It')!;
    expect(help.getCell('A1').value).toBe('Importing the Year’s Holidays');
    expect([4, 5, 6, 7].map((r) => help.getCell(`A${r}`).value)).toEqual(['Date', 'Until', 'Name (English)', 'Name (Arabic)']);
  });

  it('imports as it is: its example row', async () => {
    const reading = await readImportFile(await holidayTemplate(2091));
    expect(reading.rows).toBe(1);
    expect(reading.days).toEqual([{ row: 2, date: '2091-01-07', nameEn: 'Coptic Christmas', nameAr: 'عيد الميلاد المجيد' }]);
    expect(reading.problems).toEqual([]);
  });
});
