import type { INestApplication } from '@nestjs/common';
import { calendarYear, DEVELOPER_NO_FILES, HIDDEN, type ContractsReport, type ContractsReportRow } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Contracts report (owner, 25 October 2026: "if i want to export a contracts report, status, start and end dates,
// how?"; asked, "A report under Reports" and "Dates and status", no pay): a period's contract versions filtered by
// status, type, length, department or team, ending within and a search, one row per employment or every version, the
// totals, and the same as an Excel workbook; HR, Finance and the CEO, as the Contracts page; the C-level people left out
// for HR and counted; never the workbook for a developer. Other test files leave contracts in the same database, so the
// checks look at this run's departments (or search for this run's names, which end with RUN). Everything made here is
// deleted at the end. Every name is invented.

const RUN = Date.now().toString(36).toLowerCase();
const today = todayInCairo();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Report = ContractsReport & { generatedAt: string; confidentialExcluded: number };

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
}

interface Version {
  id: string;
  number: string;
  startDate: string;
  endDate: string | null;
}

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

/** A refusal's messages, each once. */
const messagesOf = (res: request.Response) => [...new Set([res.body.message].flat() as string[])];

/** Whole days from one day to another. */
const daysTo = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

describe('Contracts report (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let hrSuper: string; // HR and Super Admin: gives the C-level grade
  let manager: string;
  let staff: string;
  let developer: string;
  let g9: string;
  let g9WasConfidential: boolean;
  let ops: string; // a department, with the Field team under it
  let field: string;
  let back: string; // another department
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  // Rami (Field): 2021, renewed for 2022 (signed in December 2021); never renewed again
  let rami: Person;
  let ramiV1: Version;
  let ramiV2: Version;
  // Sara (Ops): a draft only, for 2022
  let sara: Person;
  // Omar (Back), freelance: signed for a year from February 2022, left in September; his contract ended with it
  let omar: Person;
  let omarV1: Version;
  // Nour (Field): a year's contract ending in about 19 days
  let nour: Person;
  let nourV1: Version;
  // Hana (Ops): open-ended since June 2022
  let hana: Person;
  // Clara (Ops): C-level (G9), signed for 2022
  let clara: Person;

  async function hire(name: string, employment: Record<string, unknown>, session = hr): Promise<Person> {
    const e = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تقرير العقود' }).expect(201);
    people.push(e.body.id);
    const hired = await api().post(`/api/employees/${e.body.id}/employments`).set('Cookie', session).send({ employmentType: 'full_time', ...employment }).expect(201);
    return { id: e.body.id, employeeCode: e.body.employeeCode, employmentId: hired.body.employment.id };
  }

  /** A version as HR enters it (the first, or a renewal of the signed one), signed on `signedOn` unless it stays a draft. */
  async function contract(p: Person, body: Record<string, unknown>, signedOn: string | null, session = hr): Promise<Version> {
    const made = await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', session).send({ grossSalary: 12000, ...body }).expect(201);
    if (signedOn) await api().post(`/api/contracts/${made.body.id}/sign`).set('Cookie', session).send({ signedOn }).expect(200);
    return made.body as Version;
  }

  const get = (query: Record<string, string | number>, session = hr) => api().get('/api/reports/contracts').query(query).set('Cookie', session);
  const report = async (query: Record<string, string | number> = {}, session = hr) => (await get(query, session).expect(200)).body as Report;
  /** The rows as [employee code, version, status]. */
  const shape = (r: Report) => r.rows.map((x) => [x.employee.employeeCode, x.version, x.status]);
  const workbookFile = (query: Record<string, string | number>, session = hr) => api().get('/api/reports/contracts.xlsx').query(query).set('Cookie', session).buffer(true).parse(bytes);
  const Y2022 = { from: '2022-01', to: '2022-12' };
  const BOTH = { from: '2021-01', to: '2022-12' };
  const SINCE_2021 = { from: '2021-01', to: `${today.slice(0, 4)}-12` };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    manager = await signIn(app, await createUser(prisma, ['manager', 'employee']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    developer = await signIn(app, await createUser(prisma, ['developer']));

    // G9 · Executive is C-level (owner, 19 October 2026), as the migration marks it
    const grade = await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true, confidential: true } });
    g9 = grade.id;
    g9WasConfidential = grade.confidential;
    await prisma.grade.update({ where: { id: g9 }, data: { confidential: true } });

    ops = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Ops ${RUN}` }).expect(201)).body.id;
    field = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Field', parentId: ops }).expect(201)).body.id;
    back = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Back ${RUN}` }).expect(201)).body.id;

    rami = await hire('Rami Renewed', { joinDate: '2021-01-01', departmentId: field });
    ramiV1 = await contract(rami, { probationMonths: 3 }, '2021-01-01');
    ramiV2 = await contract(rami, {}, '2021-12-20'); // renewed from 2022 with the same pay

    sara = await hire('Sara Drafted', { joinDate: '2022-03-01', departmentId: ops });
    await contract(sara, {}, null);

    omar = await hire('Omar Left', { employmentType: 'freelance', joinDate: '2022-02-01', departmentId: back });
    omarV1 = await contract(omar, {}, '2022-02-01');
    await api().post(`/api/employees/${omar.id}/employments/${omar.employmentId}/end`).set('Cookie', hr).send({ endDate: '2022-09-30', endReason: 'resigned' }).expect(200);

    nour = await hire('Nour Ending', { joinDate: addDays(addMonths(today, -12), 20), departmentId: field });
    nourV1 = await contract(nour, {}, addDays(addMonths(today, -12), 20));

    hana = await hire('Hana Open', { joinDate: '2022-06-01', departmentId: ops });
    await contract(hana, { form: 'open_ended' }, '2022-06-01');

    // HR alone can't give the C-level grade: HR with Super Admin hires Clara and signs her contract
    clara = await hire('Clara Chief', { joinDate: '2022-01-01', departmentId: ops, gradeId: g9 }, hrSuper);
    await contract(clara, {}, '2022-01-01', hrSuper);
  });

  afterAll(async () => {
    // the employments first (their contracts and offboarding go with them), then the people and the departments
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: { in: [field].filter(Boolean) } } });
    await prisma.department.deleteMany({ where: { id: { in: [ops, back].filter(Boolean) } } });
    if (g9) await prisma.grade.update({ where: { id: g9 }, data: { confidential: g9WasConfidential } });
    await app.close();
  });

  describe('who sees it', () => {
    it('HR, Finance and the CEO; not an Admin, a Super Admin, a manager or an employee as such', async () => {
      for (const session of [hr, finance, ceo]) {
        await get({ ...Y2022, departmentId: ops }, session).expect(200).expect('Cache-Control', 'private, no-store');
        await workbookFile({ ...Y2022, departmentId: ops }, session).expect(200);
      }
      for (const session of [admin, superAdmin, manager, staff]) {
        await get({}, session).expect(403);
        await workbookFile({}, session).expect(403);
      }
      await api().get('/api/reports/contracts').expect(401);
    });
  });

  describe('the period', () => {
    it('is this calendar year unless asked; one month alone takes its year', async () => {
      expect((await report({ departmentId: ops })).filters).toMatchObject({ period: calendarYear(today), status: 'signed', show: 'latest' });
      expect((await report({ from: '2022-04', departmentId: ops })).filters.period).toEqual({ from: '2022-04', to: '2022-12' });
    });

    it('refuses months it can’t read, a period ending before it starts, and filters it doesn’t know', async () => {
      expect(messagesOf(await get({ from: '2022-13' }).expect(400))).toEqual(['Choose the month the period starts in, as YYYY-MM, e.g. 2026-01.']);
      expect(messagesOf(await get({ from: '2023-01', to: '2022-12' }).expect(400))).toEqual(['The period ends before it starts: choose a "to" month on or after the "from" month.']);
      expect(messagesOf(await get({ status: 'signedish' }).expect(400))).toEqual(['Choose a status: signed (active, ended and superseded), active, draft, ended, superseded or all.']);
      expect(messagesOf(await get({ show: 'some' }).expect(400))).toEqual(['Choose what to show: latest (the latest version per employment) or every (every version).']);
      expect(messagesOf(await get({ departmentId: 'ops' }).expect(400))).toEqual(['Choose the department or team from the list.']);
      expect(messagesOf(await get({ departmentId: '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e' }).expect(400))).toEqual(['Choose the department or team from the list.']);
      expect(messagesOf(await get({ endingWithin: 'soon' }).expect(400))).toEqual(['Enter endingWithin as a whole number of days, 0 to 1830 (e.g. 30).']);
    });

    it('keeps the versions whose term touches it: an open end runs on, one ended before or starting after is left out', async () => {
      // 2021: Rami's first version only, replaced since
      expect(shape(await report({ from: '2021-01', to: '2021-12', departmentId: ops }))).toEqual([[rami.employeeCode, 1, 'superseded']]);
      // 2023: Rami's renewal ended with 2022; Hana's open-ended contract runs on
      expect(shape(await report({ from: '2023-01', to: '2023-12', departmentId: ops }))).toEqual([[hana.employeeCode, 1, 'active']]);
    });
  });

  describe('the rows', () => {
    it('signed unless asked: drafts left out; one status, or all', async () => {
      const q = { ...Y2022, departmentId: ops };
      expect(shape(await report(q))).toEqual([
        [rami.employeeCode, 2, 'active'],
        [hana.employeeCode, 1, 'active'],
      ]);
      expect(shape(await report({ ...q, status: 'draft' }))).toEqual([[sara.employeeCode, 1, 'draft']]);
      expect(shape(await report({ ...q, status: 'all' }))).toEqual([
        [rami.employeeCode, 2, 'active'],
        [sara.employeeCode, 1, 'draft'],
        [hana.employeeCode, 1, 'active'],
      ]);
      expect(shape(await report({ ...Y2022, departmentId: back, status: 'ended' }))).toEqual([[omar.employeeCode, 1, 'ended']]);
      expect(shape(await report({ ...q, status: 'superseded' }))).toEqual([]);
    });

    it('a renewed employment is one row by default, two with every version', async () => {
      const latest = await report({ ...BOTH, departmentId: field });
      expect(shape(latest)).toEqual([[rami.employeeCode, 2, 'active']]);
      const every = await report({ ...BOTH, departmentId: field, show: 'every' });
      expect(shape(every)).toEqual([
        [rami.employeeCode, 1, 'superseded'],
        [rami.employeeCode, 2, 'active'],
      ]);
      expect(every.rows.map((r) => [r.number, r.kind, r.nextVersion])).toEqual([
        [ramiV1.number, 'first', { number: ramiV2.number, status: 'active' }],
        [ramiV2.number, 'renewal', null],
      ]);
    });

    it('with the person, their place, the dates and status, and nothing of the pay', async () => {
      const r = await report({ ...BOTH, departmentId: field, show: 'every' }, finance);
      const [v1, v2] = r.rows;
      expect(v2).toEqual({
        contractId: ramiV2.id,
        number: ramiV2.number,
        version: 2,
        kind: 'renewal',
        employee: { id: rami.id, employeeCode: rami.employeeCode, fullNameEn: `Rami Renewed ${RUN}`, fullNameAr: 'موظف تقرير العقود' },
        employmentId: rami.employmentId,
        department: { id: field, nameEn: 'Field', parent: { id: ops, nameEn: `Ops ${RUN}` } },
        jobTitle: null,
        employmentType: 'full_time',
        form: 'fixed',
        startDate: '2022-01-01',
        endDate: '2022-12-31',
        // still the contract in force, its end long past
        daysLeft: daysTo(today, '2022-12-31'),
        status: 'active',
        signedOn: '2021-12-20',
        probationEnd: null,
        employeeStatus: 'current',
        nextVersion: null,
      } satisfies ContractsReportRow);
      expect(v1).toMatchObject({ startDate: '2021-01-01', endDate: '2021-12-31', daysLeft: null, signedOn: '2021-01-01', probationEnd: '2021-03-31' });
      const text = JSON.stringify(r).toLowerCase();
      for (const word of ['salary', 'gross', 'allowance', 'insured', 'hourly', '12000']) expect(text).not.toContain(word);

      // a person who left: Former, their ended contract without days left
      const left = await report({ ...Y2022, departmentId: back, status: 'all' });
      expect(left.rows).toEqual([expect.objectContaining({ contractId: omarV1.id, status: 'ended', daysLeft: null, employeeStatus: 'former', employmentType: 'freelance' })]);
    });

    it('ending within N days: active contracts only, those past their end included', async () => {
      expect(shape(await report({ departmentId: ops, endingWithin: 30 }))).toEqual([[nour.employeeCode, 1, 'active']]);
      expect(shape(await report({ ...SINCE_2021, departmentId: ops, endingWithin: 30, status: 'all' }))).toEqual([
        [rami.employeeCode, 2, 'active'],
        [nour.employeeCode, 1, 'active'],
      ]);
      expect((await report({ departmentId: ops, endingWithin: 30 })).rows[0].daysLeft).toBe(daysTo(today, nourV1.endDate!));
    });

    it('by department (with its teams) or team, employment type, length and search', async () => {
      const codes = async (q: Record<string, string | number>) => (await report({ ...SINCE_2021, status: 'all', ...q })).rows.map((r) => r.employee.employeeCode);
      expect(await codes({ departmentId: field })).toEqual([rami.employeeCode, nour.employeeCode]);
      expect(await codes({ departmentId: ops })).toEqual([rami.employeeCode, sara.employeeCode, nour.employeeCode, hana.employeeCode]);
      expect(await codes({ departmentId: back })).toEqual([omar.employeeCode]);
      expect(await codes({ q: RUN, type: 'freelance' })).toEqual([omar.employeeCode]);
      expect(await codes({ q: RUN, form: 'open_ended' })).toEqual([hana.employeeCode]);
      expect(await codes({ q: `nour ending ${RUN}`.toUpperCase() })).toEqual([nour.employeeCode]);
      expect(await codes({ q: rami.employeeCode })).toEqual([rami.employeeCode]);
      // a version's number finds that version alone
      const found = await report({ ...SINCE_2021, q: ramiV1.number, show: 'every' });
      expect(found.rows.map((r) => r.number)).toEqual([ramiV1.number]);
    });
  });

  describe('the totals', () => {
    it('by status, ending soon, not renewed and the renewals signed', async () => {
      expect((await report({ ...Y2022, departmentId: ops, status: 'all' })).totals).toEqual({
        contracts: 3,
        people: 3,
        byStatus: { draft: 1, active: 2, ended: 0, superseded: 0 },
        endingIn: [
          { days: 30, count: 0 },
          { days: 60, count: 0 },
          { days: 90, count: 0 },
        ],
        // Rami's renewal ended with 2022, never renewed
        notRenewed: 1,
        // renewed in December 2021
        renewalsSigned: 0,
      });
      expect((await report({ from: '2021-01', to: '2021-12', departmentId: ops })).totals).toMatchObject({ contracts: 1, byStatus: { superseded: 1 }, notRenewed: 0, renewalsSigned: 1 });
      expect((await report({ departmentId: ops })).totals).toMatchObject({
        endingIn: [
          { days: 30, count: 1 },
          { days: 60, count: 1 },
          { days: 90, count: 1 },
        ],
      });
    });
  });

  describe('C-level people', () => {
    it('are left out for HR and Finance and counted; the CEO and HR with Super Admin see them', async () => {
      const q = { ...Y2022, departmentId: ops };
      for (const session of [hr, finance]) {
        const r = await report(q, session);
        expect(r.rows.map((x) => x.employee.id)).not.toContain(clara.id);
        expect(r.confidentialExcluded).toBe(1);
        expect(r.totals.contracts).toBe(2);
      }
      for (const session of [ceo, hrSuper]) {
        const r = await report(q, session);
        expect(r.rows.map((x) => x.employee.id)).toContain(clara.id);
        expect(r.confidentialExcluded).toBe(0);
        expect(r.totals.contracts).toBe(3);
      }
      // counted by the period, the status and the place only: a search or "ending within" says nothing of their contract
      expect((await report({ ...q, endingWithin: 30 })).confidentialExcluded).toBe(1);
      expect(await report({ ...q, q: 'nobody at all' })).toMatchObject({ rows: [], confidentialExcluded: 1 });
      expect((await report({ ...q, departmentId: back })).confidentialExcluded).toBe(0);
    });
  });

  describe('the workbook', () => {
    it('has the same rows, dates as dates, the Summary, no pay, named with its period; every download in the audit log', async () => {
      const q = { ...BOTH, departmentId: ops, show: 'every' };
      const json = await report(q);
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      const res = await workbookFile(q).expect(200);
      expect(res.headers['content-type']).toBe(XLSX);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain('Contracts 2021-01 to 2022-12.xlsx');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Contracts', 'Summary']);
      const [sheet, summary] = wb.worksheets;
      const rows = rowsOf(sheet);
      expect(rows[0].slice(0, 6)).toEqual(['Employee code', 'Employee name (English)', 'Department', 'Team', 'Job title', 'Contract number']);
      expect(rows.slice(1).map((r) => [r[0], r[5], r[13]])).toEqual(json.rows.map((r) => [r.employee.employeeCode, r.number, { active: 'Active', superseded: 'Replaced', ended: 'Ended', draft: 'Draft' }[r.status]]));
      // Rami's first version: in the Field team of Ops, its dates real dates shown DD/MM/YYYY
      const first = rows[1];
      expect(first.slice(0, 4)).toEqual([rami.employeeCode, `Rami Renewed ${RUN}`, `Ops ${RUN}`, 'Field']);
      expect(first[10]).toEqual(new Date('2021-01-01T00:00:00.000Z'));
      expect(first[11]).toEqual(new Date('2021-12-31T00:00:00.000Z'));
      expect(first[15]).toEqual(new Date('2021-03-31T00:00:00.000Z'));
      expect(sheet.getCell('K2').numFmt).toBe('dd/mm/yyyy');
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
      const lines = Object.fromEntries(rowsOf(summary).map(([item, value]) => [item, value]));
      expect(lines).toMatchObject({ Contracts: json.totals.contracts, People: json.totals.people, Period: 'January 2021 to December 2022', Show: 'Every version', 'Department or team': `Ops ${RUN}` });
      // no pay anywhere
      const text = JSON.stringify([...rows, ...rowsOf(summary)]).toLowerCase();
      for (const word of ['salary', 'gross', 'allowance', 'insured', '12000']) expect(text).not.toContain(word);

      const audit = await prisma.auditLog.findMany({ where: { action: 'contracts_report_file', id: { gt: since } } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        entityType: 'contracts_report',
        diff: { from: '2021-01', to: '2022-12', status: 'signed', show: 'every', contracts: json.rows.length, employees: [...new Set(json.rows.map((r) => r.employee.employeeCode))] },
      });
    });

    it('leaves the C-level people out for HR, as the report', async () => {
      const codes = async (session: string) => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load((await workbookFile({ ...Y2022, departmentId: ops }, session).expect(200)).body as ArrayBuffer);
        return rowsOf(wb.worksheets[0])
          .slice(1)
          .map((r) => r[0]);
      };
      expect(await codes(hr)).not.toContain(clara.employeeCode);
      expect(await codes(ceo)).toContain(clara.employeeCode);
    });
  });

  describe('a developer', () => {
    it('is refused the workbook, and sees the report with pseudonyms, codes and numbers hidden, no dates, unfiltered by place or type', async () => {
      const refused = await workbookFile({ ...BOTH }, developer).expect(403);
      expect(JSON.parse((refused.body as Buffer).toString('utf8')).message).toBe(DEVELOPER_NO_FILES);
      const r = await report({ ...BOTH, status: 'all', show: 'every', departmentId: ops, type: 'freelance' }, developer);
      // the department and type aren't filters for a developer (22 October 2026: "Hide per-person details")
      expect(r.filters).toMatchObject({ department: null, employmentType: null });
      const ramis = r.rows.filter((x) => x.employee.id === rami.id);
      expect(ramis).toHaveLength(2);
      for (const row of ramis) {
        expect(row.employee.fullNameEn).not.toContain(RUN);
        expect(row.employee.employeeCode).toBe(HIDDEN);
        expect(row.number).toBe(HIDDEN);
        expect(row).toMatchObject({ startDate: null, endDate: null, signedOn: null, probationEnd: null, daysLeft: null, employmentType: HIDDEN, jobTitle: null });
        expect(row.department).toMatchObject({ id: null, nameEn: HIDDEN });
      }
      const text = JSON.stringify(r);
      for (const leak of [RUN, rami.employeeCode, ramiV1.number, ramiV2.number, '2021-12-20']) expect(text).not.toContain(leak);
    });
  });
});
