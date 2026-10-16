import { describe, expect, it } from 'vitest';
import type { HolidayImportDay, HolidayImportResult } from '../../../../lib/types';
import { dayNote, importButtonText, importCounts, importedMessage, importedYears, importFileProblem, importGroups, previewSummary, templateHref } from './import';

// Importing a year's holidays from a file (owner's request, 16 October 2026: "allow me to import yearly holiday list"):
// the file checked before it is sent, the preview grouped by what happens to each day, and what the page says.

const day = (row: number, date: string, nameEn: string, status: HolidayImportDay['status'], more: Partial<HolidayImportDay> = {}): HolidayImportDay => ({
  row,
  date,
  nameEn,
  nameAr: null,
  status,
  ...more,
});

const days: HolidayImportDay[] = [
  day(2, '2027-01-07', 'Coptic Christmas', 'new'),
  day(3, '2027-04-25', 'Sinai Liberation Day', 'on_file', { onFile: { nameEn: 'Sinai Liberation Day', nameAr: null } }),
  day(4, '2027-05-01', 'Labour Day', 'clash', { onFile: { nameEn: 'Workers Day', nameAr: null } }),
  day(5, '2027-05-16', 'Eid al-Adha', 'new'),
  day(5, '2027-05-17', 'Eid al-Adha', 'new'),
  day(7, '2027-05-17', 'Arafat Day', 'duplicate', { firstRow: 5 }),
];
const problems = [
  { row: 8, message: "Row 8: the date 31/02/2027 isn't a real day." },
  { row: 9, message: "Row 9: enter the holiday's name in English." },
  { row: 9, message: 'Row 9: keep the Arabic name to 100 characters or fewer.' },
];
const preview = { fingerprint: 'f'.repeat(64), rows: 8, days, problems };

describe('Importing holidays', () => {
  it('takes an .xlsx or a .csv file of up to 1 MB', () => {
    expect(importFileProblem({ name: 'Holidays 2027.xlsx', size: 20_000 })).toBe('');
    expect(importFileProblem({ name: 'holidays.CSV ', size: 1024 * 1024 })).toBe('');
    for (const name of ['holidays.xls', 'holidays.pdf', 'holidays']) {
      expect(importFileProblem({ name, size: 100 })).toBe('Choose an Excel workbook (.xlsx) or a CSV file (.csv), such as the template filled in.');
    }
    expect(importFileProblem({ name: 'holidays.xlsx', size: 1024 * 1024 + 1 })).toBe('The file must be 1 MB or smaller.');
    expect(templateHref(2027)).toBe('/organization/holidays/template?year=2027');
  });

  it('groups the preview by what happens to each day, in order, leaving out empty groups', () => {
    const groups = importGroups(preview);
    expect(groups.map((g) => [g.title, g.days.map((d) => `${d.row} ${d.date}`)])).toEqual([
      ['New', ['2 2027-01-07', '5 2027-05-16', '5 2027-05-17']],
      ['Already on File', ['3 2027-04-25']],
      ['Clashes', ['4 2027-05-01']],
      ['In the File Twice', ['7 2027-05-17']],
    ]);
    expect(importGroups({ days: days.filter((d) => d.status === 'new') }).map((g) => g.status)).toEqual(['new']);
    expect(importGroups({ days: [] })).toEqual([]);
  });

  it('counts the days each way and the rows with problems (a row once, whatever its problems)', () => {
    expect(importCounts(preview)).toEqual({ new: 3, on_file: 1, clash: 1, duplicate: 1, problemRows: 2 });
  });

  it('says the preview in a sentence, and what the import button imports', () => {
    expect(previewSummary(preview)).toBe('Read 8 rows: 3 new days, 1 already on file, 1 clash, 1 in the file twice and 2 rows with problems.');
    expect(previewSummary({ rows: 1, days: [days[0]], problems: [] })).toBe('Read 1 row: 1 new day.');
    expect(previewSummary({ rows: 2, days: [days[1]], problems: [problems[0]] })).toBe('Read 2 rows: 1 already on file and 1 row with a problem.');
    expect(previewSummary({ rows: 1, days: [], problems: [problems[0]] })).toBe('Read 1 row: 1 row with a problem.');
    expect(importButtonText(1)).toBe('Import 1 holiday');
    expect(importButtonText(12)).toBe('Import 12 holidays');
  });

  it('notes the holiday on file on a clash, and the first row of a day given twice', () => {
    expect(days.map(dayNote)).toEqual(['', '', 'On file: Workers Day', '', '', 'First on row 5']);
  });

  it('says what was imported, in which years, and what was left out', () => {
    const imported = (dates: string[]) => dates.map((date, i) => ({ id: String(i), date, nameEn: 'A holiday', nameAr: null }));
    const result: HolidayImportResult = { ...preview, imported: imported(['2027-01-07', '2027-05-16', '2027-05-17']) };
    expect(importedMessage(result)).toBe(
      'Imported 3 holidays in 2027. Left out: 1 already on file, 1 clash, 1 in the file twice and 2 rows with problems. Runs made or refreshed from now on count them.',
    );
    const across = { days: [days[0]], problems: [], imported: imported(['2027-12-31', '2028-01-01']) };
    expect(importedYears(across)).toEqual([2027, 2028]);
    expect(importedMessage(across)).toBe('Imported 2 holidays in 2027 and 2028. Runs made or refreshed from now on count them.');
    expect(importedMessage({ days: [days[0]], problems: [], imported: imported(['2027-01-07']) })).toBe('Imported 1 holiday in 2027. Runs made or refreshed from now on count it.');
    // a holiday added on its day since the preview: nothing new by then
    expect(importedMessage({ days: [{ ...days[0], status: 'clash' }], problems: [], imported: [] })).toBe('Nothing was imported: no day in the file is new now (1 clash).');
    expect(importedMessage({ days: [], problems: [], imported: [] })).toBe('Nothing was imported: no day in the file is new now.');
  });
});
