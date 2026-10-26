import ExcelJS from 'exceljs';
import { leaveImportTemplate, type TemplateLeaveType } from './leave-import-template.js';

// owner, 26 October 2026: "in the import leaves templete there is no working from home option"; then, of official duty,
// "Import (template + Zoho)": Official duty after Work from home

const annual: TemplateLeaveType = { nameEn: 'Annual leave', balance: 'annual', paid: 'paid', payPercent: null, calendarDays: false };

async function book(types: TemplateLeaveType[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await leaveImportTemplate({ types, balanceTypes: [annual], people: [{ employeeCode: 'EMP-1', fullNameEn: 'Ann' }], year: 2026 })) as unknown as ArrayBuffer);
  return wb;
}

describe('the leave import template’s Work from home and Official duty', () => {
  it('end the Leave type list, and the Leave Types table of How to fill', async () => {
    const wb = await book([annual, { ...annual, nameEn: 'Sick leave' }]);
    const help = wb.getWorksheet('How to fill')!;
    const rows: string[][] = [];
    help.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map(String)));
    const at = rows.findIndex((r) => r[0] === 'Work from home');
    expect(rows[at]).toEqual(['Work from home', 'Not leave: work-from-home days', 'Normal working day', 'Working days']);
    expect(rows[at - 1][0]).toBe('Sick leave');
    expect(rows[at + 1]).toEqual(['Official duty', 'Not leave: official duty', 'Attended working day', 'Working days']);
    // the dropdown's range ends on Official duty, after Work from home
    const rule = wb.getWorksheet('Leaves taken')!.getCell('C2').dataValidation;
    const range = rule.formulae![0] as string;
    const [, from, to] = /\$A\$(\d+):\$A\$(\d+)$/.exec(range)!;
    expect(help.getCell(`A${to}`).value).toBe('Official duty');
    expect(help.getCell(`A${Number(to) - 1}`).value).toBe('Work from home');
    expect(help.getCell(`A${from}`).value).toBe('Annual leave');
    expect(rule.error).toContain('Work from home');
    expect(rule.error).toContain('Official duty');
  });

  it('are on the list even when no leave type is on, and the instructions say what a row becomes', async () => {
    const wb = await book([]);
    const help = wb.getWorksheet('How to fill')!;
    const text: string[] = [];
    help.eachRow((row) => text.push(String(row.getCell(1).value)));
    expect(text.some((t) => /^Work from home: .*approved work-from-home days.*no balance is used.*never a half day/.test(t))).toBe(true);
    expect(text.some((t) => /^Official duty: choose it from the Leave type list.*OD, On duty or مأمورية.*one approved official duty.*at most 31 days.*no balance is used.*Its place is “Imported” and its Notes are its reason/.test(t))).toBe(true);
    const range = wb.getWorksheet('Leaves taken')!.getCell('C2').dataValidation.formulae![0] as string;
    const [, from, to] = /\$A\$(\d+):\$A\$(\d+)$/.exec(range)!;
    expect(Number(to)).toBe(Number(from) + 1);
    expect(help.getCell(`A${from}`).value).toBe('Work from home');
    expect(help.getCell(`A${to}`).value).toBe('Official duty');
  });
});
