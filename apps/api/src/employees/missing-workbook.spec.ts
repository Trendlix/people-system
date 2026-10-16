import ExcelJS from 'exceljs';
import type { Missing } from './completeness.js';
import { documentsText, missingDetailsFileName, missingDetailsWorkbook, personalDetailsText, type MissingDetailsRow } from './missing-workbook.js';

const MOBILE: Missing = { key: 'mobile', label: 'Mobile', tab: 'basic' };
const CITY: Missing = { key: 'city', label: 'City', tab: 'basic' };
const FACULTY: Missing = { key: 'faculty', label: 'Faculty', tab: 'education' };
const SHIFT: Missing = { key: 'shift', label: 'Shift', tab: 'employment' };
const CRIMINAL: Missing = { key: 'criminal_record', label: 'Criminal record certificate', tab: 'documents' };
const PHOTO: Missing = { key: 'personal_photo', label: 'Personal photo', tab: 'documents' };

const row = (employeeCode: string, missing: Missing[], extra: Partial<MissingDetailsRow> = {}): MissingDetailsRow => ({
  employeeCode,
  fullNameEn: `Person ${employeeCode}`,
  fullNameAr: 'موظف',
  standing: 'active',
  department: null,
  jobTitle: null,
  percent: 50,
  missing,
  ...extra,
});

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return rows;
}

describe('the Missing Details workbook', () => {
  it('groups the missing personal details by section, in the order of the profile tabs, and lists the papers apart', () => {
    const missing = [FACULTY, MOBILE, CRIMINAL, CITY, SHIFT, PHOTO];
    expect(personalDetailsText(missing)).toBe('Basic data: Mobile, City · Education: Faculty · Employment: Shift');
    expect(documentsText(missing)).toBe('Criminal record certificate, Personal photo');
    expect(personalDetailsText([CRIMINAL])).toBe('');
    expect(documentsText([MOBILE])).toBe('');
  });

  it('is named with the day it was made', () => {
    expect(missingDetailsFileName('2026-10-16')).toBe('Missing details 2026-10-16.xlsx');
  });

  it('has a row per person with something missing and a row per missing item, under bold, frozen, filtered headers', async () => {
    const team = { nameEn: 'Content Team', parent: { nameEn: 'Marketing' } };
    const data = await missingDetailsWorkbook([
      row('EMP-0002', [MOBILE, FACULTY, CRIMINAL], { percent: 25, department: team, jobTitle: { titleEn: 'Writer' } }),
      row('EMP-0001', [PHOTO], { percent: 97, standing: 'not_employed' }),
      row('EMP-0003', [], { percent: 100 }), // complete: left out
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Missing Details', 'Each Missing Item']);

    const [people, items] = wb.worksheets;
    expect(rowsOf(people)).toEqual([
      ['Code', 'Name (English)', 'Name (Arabic)', 'Department', 'Job title', 'Standing', 'Complete', 'Missing personal details', 'Missing documents'],
      ['EMP-0002', 'Person EMP-0002', 'موظف', 'Marketing › Content Team', 'Writer', 'Active', 0.25, 'Basic data: Mobile · Education: Faculty', 'Criminal record certificate'],
      ['EMP-0001', 'Person EMP-0001', 'موظف', undefined, undefined, 'Not employed yet', 0.97, undefined, 'Personal photo'],
    ]);
    expect(people.getCell('G2').numFmt).toBe('0%');
    expect(rowsOf(items)).toEqual([
      ['Code', 'Name', 'Section', 'Item'],
      ['EMP-0002', 'Person EMP-0002', 'Basic data', 'Mobile'],
      ['EMP-0002', 'Person EMP-0002', 'Education', 'Faculty'],
      ['EMP-0002', 'Person EMP-0002', 'Documents', 'Criminal record certificate'],
      ['EMP-0001', 'Person EMP-0001', 'Documents', 'Personal photo'],
    ]);
    for (const ws of [people, items]) {
      expect(ws.getCell('A1').font?.bold).toBe(true);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
    }
  });
});
