import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Importing a year's holidays from a file (owner's request, 16 October 2026: "allow me to import yearly holiday list"),
// on Organization → Holidays: the template, the preview that saves nothing, the import confirmed with the preview's
// fingerprint (the file sent again), who can do it, and the files refused. Only the years 2091 to 2093 are used, and
// their holidays are removed before and after, so the other test files' holidays aren't touched. Every holiday is in a
// far-off year; the names are those of real holidays, the dates invented.

const FROM = new Date('2091-01-01T00:00:00Z');
const TO = new Date('2093-12-31T00:00:00Z');
const HEADINGS = ['Date', 'Until', 'Name (English)', 'Name (Arabic)'];
const NOT_A_SHEET = "This file isn't an Excel workbook (.xlsx) or a CSV file (.csv). Fill in the template and import it again.";

interface Day {
  row: number;
  date: string;
  nameEn: string;
  nameAr: string | null;
  status: 'new' | 'on_file' | 'clash' | 'duplicate';
  onFile?: { nameEn: string; nameAr: string | null };
  firstRow?: number;
}

interface Preview {
  fingerprint: string;
  rows: number;
  days: Day[];
  problems: { row: number; message: string }[];
}

interface Result extends Preview {
  imported: { id: string; date: string; nameEn: string; nameAr: string | null }[];
}

const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** A workbook's bytes: the template's headings, then `rows`. */
async function workbook(rows: ExcelJS.CellValue[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Holidays');
  ws.addRow(HEADINGS);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A file downloaded whole. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** Each day as [row, date, status]. */
const statuses = (days: Day[]) => days.map((d) => [d.row, d.date, d.status]);

describe('Holidays import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrId: string;
  let admin: string;
  let finance: string;
  let ceo: string;
  let staff: string;
  let manager: string;
  const api = () => request(app.getHttpServer());

  const template = (query = '', session = hr) => api().get(`/api/payroll/holidays/template.xlsx${query}`).set('Cookie', session);
  const preview = (file: Buffer, name = 'holidays.xlsx', session = hr) => api().post('/api/payroll/holidays/import/preview').set('Cookie', session).attach('file', file, name);
  const confirm = (file: Buffer, fingerprint?: string, name = 'holidays.xlsx', session = hr) => {
    const req = api().post('/api/payroll/holidays/import').set('Cookie', session).attach('file', file, name);
    return fingerprint === undefined ? req : req.field('fingerprint', fingerprint);
  };
  const holidaysOf = async (year: number) => (await api().get(`/api/payroll/holidays?year=${year}`).set('Cookie', hr).expect(200)).body as Result['imported'];
  const lastAuditId = async () => (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
  const importsSince = (since: bigint) => prisma.auditLog.findMany({ where: { entityType: 'holiday', action: 'import', id: { gt: since } }, orderBy: { id: 'asc' } });
  const ours = () => prisma.holiday.deleteMany({ where: { date: { gte: FROM, lte: TO } } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    admin = await signIn(app, await createUser(prisma, ['admin']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    manager = await signIn(app, await createUser(prisma, ['employee', 'manager']));
    await ours();
  });

  afterAll(async () => {
    await ours();
    await app.close();
  });

  describe('the template', () => {
    it('HR and Admin download it as a workbook, its example row in the year asked; nobody else does', async () => {
      for (const session of [finance, ceo, manager, staff]) await template('?year=2091', session).expect(403);
      const res = await template('?year=2091').buffer(true).parse(bytes).expect(200);
      expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Holidays template 2091\.xlsx"/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as ArrayBuffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Holidays', 'How to Fill It']);
      const ws = wb.getWorksheet('Holidays')!;
      expect([1, 2, 3, 4].map((c) => ws.getRow(1).getCell(c).value)).toEqual(HEADINGS);
      expect([1, 2, 3, 4].map((c) => ws.getRow(2).getCell(c).value)).toEqual([utc('2091-01-07'), null, 'Coptic Christmas', 'عيد الميلاد المجيد']);

      // this year's without ?year=; a year out of range refused
      const thisYear = todayInCairo().slice(0, 4);
      expect((await template('', admin).expect(200)).headers['content-disposition']).toContain(`filename="Holidays template ${thisYear}.xlsx"`);
      expect((await template('?year=1999').expect(400)).body.message).toEqual(['Choose a year from 2000 to 2100.']);
    });

    it('imports as it is: the example row is a new holiday in the preview', async () => {
      const file = (await template('?year=2091').buffer(true).parse(bytes).expect(200)).body as Buffer;
      const body = (await preview(file).expect(200)).body as Preview;
      expect(body.rows).toBe(1);
      expect(body.days).toEqual([{ row: 2, date: '2091-01-07', nameEn: 'Coptic Christmas', nameAr: 'عيد الميلاد المجيد', status: 'new' }]);
    });
  });

  describe('a year’s list', () => {
    let file: Buffer;
    let fingerprint: string;

    beforeAll(async () => {
      // on file already: the same name (skipped) and another name (a clash, not imported)
      await api().post('/api/payroll/holidays').set('Cookie', hr).send({ date: '2091-04-25', nameEn: 'Sinai Liberation Day' }).expect(201);
      await api().post('/api/payroll/holidays').set('Cookie', hr).send({ date: '2091-05-01', nameEn: 'Workers Day', nameAr: 'عيد العمال' }).expect(201);
      file = await workbook([
        [utc('2091-01-07'), null, 'Coptic Christmas', 'عيد الميلاد المجيد'],
        ['25/04/2091', null, '  sinai liberation day '],
        ['٠١/٠٥/٢٠٩١', null, 'Labour Day', 'عيد العمال'],
        ['2091-06-10', '13/06/2091', 'Eid al-Adha', 'عيد الأضحى'],
        [],
        ['11/06/2091', null, 'Arafat Day'],
        ['31/02/2091', null, 'Not a day'],
        ['01/07/2091', '30/06/2091', 'Backwards'],
      ]);
    });

    it('is previewed day by day against the holidays on file, and nothing is saved', async () => {
      const since = await lastAuditId();
      const body = (await preview(file).expect(200)).body as Preview;
      fingerprint = body.fingerprint;
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
      // the blank row isn't counted
      expect(body.rows).toBe(7);
      expect(statuses(body.days)).toEqual([
        [2, '2091-01-07', 'new'],
        [3, '2091-04-25', 'on_file'],
        [4, '2091-05-01', 'clash'],
        [5, '2091-06-10', 'new'],
        [5, '2091-06-11', 'new'],
        [5, '2091-06-12', 'new'],
        [5, '2091-06-13', 'new'],
        [7, '2091-06-11', 'duplicate'],
      ]);
      expect(body.days[2]).toEqual({ row: 4, date: '2091-05-01', nameEn: 'Labour Day', nameAr: 'عيد العمال', status: 'clash', onFile: { nameEn: 'Workers Day', nameAr: 'عيد العمال' } });
      expect(body.days[7].firstRow).toBe(5);
      expect(body.problems).toEqual([
        { row: 8, message: "Row 8: the date 31/02/2091 isn't a real day." },
        { row: 9, message: 'Row 9: Until (30/06/2091) is before the date (01/07/2091).' },
      ]);

      expect((await holidaysOf(2091)).map((h) => h.date)).toEqual(['2091-04-25', '2091-05-01']);
      expect(await importsSince(since)).toEqual([]);
    });

    it('is confirmed only with the preview’s fingerprint and the same file', async () => {
      expect((await confirm(file).expect(400)).body.message).toEqual(['Preview the file before importing it.']);
      expect((await confirm(file, 'not-a-fingerprint').expect(400)).body.message).toEqual(['Preview the file before importing it.']);
      const other = await workbook([['01/08/2091', null, 'Another holiday']]);
      expect((await confirm(other, fingerprint).expect(409)).body.message).toBe("This isn't the file that was previewed. Preview it again, then import it.");
      expect((await holidaysOf(2091)).map((h) => h.date)).toEqual(['2091-04-25', '2091-05-01']);
    });

    it('adds the new days in one go, with one entry in the audit log, and leaves the rest as they are', async () => {
      const since = await lastAuditId();
      const body = (await confirm(file, fingerprint).expect(201)).body as Result;
      expect(body.imported.map((h) => [h.date, h.nameEn, h.nameAr])).toEqual([
        ['2091-01-07', 'Coptic Christmas', 'عيد الميلاد المجيد'],
        ['2091-06-10', 'Eid al-Adha', 'عيد الأضحى'],
        ['2091-06-11', 'Eid al-Adha', 'عيد الأضحى'],
        ['2091-06-12', 'Eid al-Adha', 'عيد الأضحى'],
        ['2091-06-13', 'Eid al-Adha', 'عيد الأضحى'],
      ]);
      expect(body.problems).toHaveLength(2);

      const year = await holidaysOf(2091);
      expect(year.map((h) => [h.date, h.nameEn])).toEqual([
        ['2091-01-07', 'Coptic Christmas'],
        ['2091-04-25', 'Sinai Liberation Day'],
        ['2091-05-01', 'Workers Day'],
        ['2091-06-10', 'Eid al-Adha'],
        ['2091-06-11', 'Eid al-Adha'],
        ['2091-06-12', 'Eid al-Adha'],
        ['2091-06-13', 'Eid al-Adha'],
      ]);
      const audit = await importsSince(since);
      expect(audit.map((a) => [a.userId, a.entityId, a.diff])).toEqual([
        [hrId, null, { count: 5, dates: ['2091-01-07', '2091-06-10', '2091-06-11', '2091-06-12', '2091-06-13'] }],
      ]);
    });

    it('imported again, finds its days on file and adds nothing', async () => {
      const since = await lastAuditId();
      const again = (await preview(file).expect(200)).body as Preview;
      expect(again.fingerprint).toBe(fingerprint);
      expect(again.days.filter((d) => d.status === 'new')).toEqual([]);
      const body = (await confirm(file, fingerprint).expect(201)).body as Result;
      expect(body.imported).toEqual([]);
      expect(statuses(body.days).filter(([, , s]) => s === 'on_file')).toHaveLength(6);
      expect(await holidaysOf(2091)).toHaveLength(7);
      expect(await importsSince(since)).toEqual([]);
    });

    it('is checked again when confirmed: a holiday added since the preview is a clash', async () => {
      const list = await workbook([
        ['2093-04-25', null, 'Sinai Liberation Day'],
        ['2093-05-01', null, 'Labour Day'],
      ]);
      const seen = (await preview(list).expect(200)).body as Preview;
      expect(statuses(seen.days)).toEqual([
        [2, '2093-04-25', 'new'],
        [3, '2093-05-01', 'new'],
      ]);
      await api().post('/api/payroll/holidays').set('Cookie', admin).send({ date: '2093-05-01', nameEn: 'Workers Day' }).expect(201);
      const body = (await confirm(list, seen.fingerprint).expect(201)).body as Result;
      expect(body.imported.map((h) => h.date)).toEqual(['2093-04-25']);
      expect(statuses(body.days)).toEqual([
        [2, '2093-04-25', 'new'],
        [3, '2093-05-01', 'clash'],
      ]);
      expect((await holidaysOf(2093)).map((h) => [h.date, h.nameEn])).toEqual([
        ['2093-04-25', 'Sinai Liberation Day'],
        ['2093-05-01', 'Workers Day'],
      ]);
    });
  });

  describe('who imports', () => {
    // Admin's list, saved from Excel as CSV UTF-8 with semicolons
    const csv = Buffer.from('\ufeffDate;Until;Name (English);Name (Arabic)\r\n07/01/2092;;Coptic Christmas;عيد الميلاد المجيد\r\n٢٣/٠٧/٢٠٩٢;;Revolution Day;عيد الثورة\r\n', 'utf8');

    it('Finance, the CEO, a manager and staff can’t preview or import', async () => {
      // the employee and the manager read the holidays (their dashboard), and no more
      for (const session of [finance, ceo, manager, staff]) {
        await preview(csv, 'holidays.csv', session).expect(403);
        await confirm(csv, '0'.repeat(64), 'holidays.csv', session).expect(403);
      }
      expect(await holidaysOf(2092)).toEqual([]);
    });

    it('Admin imports a CSV file', async () => {
      const seen = (await preview(csv, 'holidays.csv', admin).expect(200)).body as Preview;
      expect(seen.days.map((d) => [d.date, d.nameEn, d.nameAr, d.status])).toEqual([
        ['2092-01-07', 'Coptic Christmas', 'عيد الميلاد المجيد', 'new'],
        ['2092-07-23', 'Revolution Day', 'عيد الثورة', 'new'],
      ]);
      const body = (await confirm(csv, seen.fingerprint, 'holidays.csv', admin).expect(201)).body as Result;
      expect(body.imported.map((h) => h.date)).toEqual(['2092-01-07', '2092-07-23']);
      expect((await holidaysOf(2092)).map((h) => h.nameEn)).toEqual(['Coptic Christmas', 'Revolution Day']);
    });
  });

  describe('a file that isn’t a holiday list', () => {
    const refused = async (file: Buffer, name: string, status = 400) => (await preview(file, name).expect(status)).body.message as string;

    it('is refused with a plain message, by its content, and nothing is saved', async () => {
      const since = await lastAuditId();
      expect((await api().post('/api/payroll/holidays/import/preview').set('Cookie', hr).expect(400)).body.message).toBe(
        'Choose the file to import: the template filled in, as an Excel workbook (.xlsx) or a CSV file (.csv).',
      );
      // a PDF and a picture, whatever they are called
      expect(await refused(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj', 'latin1'), 'holidays.xlsx')).toBe(NOT_A_SHEET);
      expect(await refused(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), 'holidays.csv')).toBe(NOT_A_SHEET);
      expect(await refused(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'holidays.xls')).toMatch(/^This is an old Excel file \(\.xls\)/);
      expect(await refused(Buffer.from('When,What\n01/05/2092,Labour Day'), 'holidays.csv')).toMatch(/^The file doesn't have the template's headings \(Date, Until, Name \(English\), Name \(Arabic\)\)/);

      const many = await workbook(Array.from({ length: 501 }, (_, i) => [utc('2092-01-01'), null, `Holiday ${i + 1}`]));
      expect(await refused(many, 'holidays.xlsx')).toBe('The file has more than 500 rows of holidays. Import at most 500 at a time.');
      const big = Buffer.concat([Buffer.from('Date,Name (English)\n'), Buffer.alloc(1024 * 1024, 0x20)]);
      expect(await refused(big, 'holidays.csv', 413)).toBe('The file must be 1 MB or smaller.');
      expect((await confirm(big, '0'.repeat(64), 'holidays.csv').expect(413)).body.message).toBe('The file must be 1 MB or smaller.');

      expect(await holidaysOf(2092)).toHaveLength(2);
      expect(await importsSince(since)).toEqual([]);
    });
  });
});
