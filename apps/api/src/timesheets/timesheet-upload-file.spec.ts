import ExcelJS from 'exceljs';
import { readHours, TIMESHEET_TEMPLATE_HEADINGS, uploadProblemsShown } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { timesheetsUploadedText } from '../notifications/texts.js';
import { readHoursFile, TimesheetFileError } from './timesheet-upload-file.js';
import { instructions, timesheetUploadTemplate } from './timesheet-upload-template.js';

// Uploading hours from a file (owner, 5 November 2026: "how to upload a bulk time log?"; "Our own Excel template", "each
// person and HR"). Every name is invented.

async function workbook(sheet: string, rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('hours as written', () => {
  it('reads quarter hours as numbers, with a comma, or as a clock', () => {
    expect(readHours('7.5')).toBe(7.5);
    expect(readHours('7,75')).toBe(7.75);
    expect(readHours('7:45')).toBe(7.75);
    expect(readHours('8')).toBe(8);
    expect(readHours('0.25')).toBe(0.25);
    for (const bad of ['', '0', '1.3', '25', '7:40', 'eight', '-2']) expect(readHours(bad)).toBeNull();
  });

  it('says at most 50 problems, then how many more', () => {
    const many = Array.from({ length: 53 }, (_, i) => `Row ${i + 2}: write the date.`);
    const shown = uploadProblemsShown(many);
    expect(shown).toHaveLength(51);
    expect(shown[50]).toBe('… and 3 more problems. Put them right in the file and upload it again.');
    expect(uploadProblemsShown(many.slice(0, 2))).toEqual(many.slice(0, 2));
  });
});

describe('reading a file of hours', () => {
  it('reads the template’s columns: dates, codes, clients, tasks, hours and notes, skipping blank rows', async () => {
    const data = await workbook('Hours', [
      [...TIMESHEET_TEMPLATE_HEADINGS],
      [new Date(Date.UTC(2026, 10, 2)), 'EMP-0001', 'Nour Adel', 'Acme', 'Editing', 7.5, 'Cut 2'],
      [],
      ['03/11/2026', 'EMP-0001', '', '', 'Shoot', '7:45', ''],
      ['2026-11-04', '', '', 'Acme', '', 'eight', ''],
      ['someday', '', '', 'Acme', '', 2, ''],
    ]);
    const rows = await readHoursFile(data);
    expect(rows.map((r) => [r.row, r.date, r.code, r.client, r.task, r.hours, r.note])).toEqual([
      [2, '2026-11-02', 'EMP-0001', 'Acme', 'Editing', 7.5, 'Cut 2'],
      [4, '2026-11-03', 'EMP-0001', null, 'Shoot', 7.75, null],
      [5, '2026-11-04', null, 'Acme', null, null, null],
      [6, null, null, 'Acme', null, 2, null],
    ]);
    expect(rows[2].hoursText).toBe('eight');
    expect(rows[3].dateText).toBe('someday');
  });

  it('finds headings written in other words, on any sheet, below a title', async () => {
    const data = await workbook('Export', [['Time log, November'], ['Day', 'Description', 'Duration', 'Activity'], ['05/11/2026', 'Retouching', 3, 'Edit']]);
    const rows = await readHoursFile(data);
    expect(rows.map((r) => [r.date, r.task, r.hours, r.note])).toEqual([['2026-11-05', 'Edit', 3, 'Retouching']]);
  });

  it('reads a time typed in a time-formatted cell as hours', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hours');
    ws.addRow(['Date', 'Task', 'Hours']);
    const row = ws.addRow(['02/11/2026', 'Editing', new Date(Date.UTC(1899, 11, 30, 7, 45))]);
    row.getCell(3).numFmt = 'h:mm';
    const rows = await readHoursFile(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows[0].hours).toBe(7.75);
  });

  it('refuses a file it can’t read, in words', async () => {
    await expect(readHoursFile(Buffer.from('hello'))).rejects.toThrow(TimesheetFileError);
    await expect(readHoursFile(await workbook('Hours', [['Name', 'Amount']]))).rejects.toThrow(/no heading row with Date, Hours and Client or Task/);
    await expect(readHoursFile(await workbook('Hours', [['Date', 'Task', 'Hours'], []]))).rejects.toThrow(/no hours under its headings/);
  });
});

describe('the template', () => {
  it('has Hours and How to fill, the clients and the people listed, and reads back as it is filled', async () => {
    const data = await timesheetUploadTemplate({
      clients: [{ name: 'Acme', code: 'ACM' }, { name: 'Zed', code: null }],
      people: [{ employeeCode: 'EMP-0001', fullNameEn: 'Nour Adel' }],
      forOthers: true,
      year: 2026,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Hours', 'How to fill']);
    const hours = wb.getWorksheet('Hours')!;
    expect((hours.getRow(1).values as unknown[]).slice(1)).toEqual([...TIMESHEET_TEMPLATE_HEADINGS]);
    expect(hours.getCell(2, 4).dataValidation).toMatchObject({ type: 'list' });
    const help: string[] = [];
    wb.getWorksheet('How to fill')!.eachRow((r) => help.push((r.values as unknown[]).slice(1).filter(Boolean).join(' | ')));
    expect(help).toEqual(expect.arrayContaining(['Acme | ACM', 'Zed', 'EMP-0001 | Nour Adel']));

    // filled in and read back: the look-up column's formulas are no rows
    hours.getCell(2, 1).value = new Date(Date.UTC(2026, 10, 2));
    hours.getCell(2, 2).value = 'EMP-0001';
    hours.getCell(2, 4).value = 'Acme';
    hours.getCell(2, 6).value = 6;
    const rows = await readHoursFile(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows.map((r) => [r.date, r.code, r.client, r.hours])).toEqual([['2026-11-02', 'EMP-0001', 'Acme', 6]]);
  });

  it('tells someone uploading their own to leave the code empty, HR to write it on every row', () => {
    expect(instructions(false, 2026).join(' ')).toContain('leave it empty, or write your own');
    expect(instructions(true, 2026).join(' ')).toContain('on every row');
    expect(instructions(true, 2026).join(' ')).toContain('sent to whoever approves them');
  });
});

describe('the uploader’s manager told', () => {
  it('names who uploaded, for whom, and the week or weeks', () => {
    expect(timesheetsUploadedText('Sara Ali', 'Omar Adel', ['2026-11-01'], '/timesheets/1')).toEqual({
      kind: 'manual_change',
      title: 'Sara Ali uploaded hours for Omar Adel',
      body: 'Week of 01/11/2026 to 07/11/2026',
      link: '/timesheets/1',
    });
    expect(timesheetsUploadedText('Sara Ali', 'Omar Adel', ['2026-11-01', '2026-10-18', '2026-10-25'], '/timesheets/1').body).toBe('3 weeks, 18/10/2026 to 07/11/2026');
  });
});
