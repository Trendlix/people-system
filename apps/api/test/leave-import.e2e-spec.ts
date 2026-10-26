import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { templateWorkbook, zohoLeaveWorkbook, type ZohoLeaveIn } from './fixtures/leave-import.js';
import { zohoWorkbook } from './fixtures/zoho.js';
import { createApp, createUser, signIn } from './helpers.js';

// Importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"; he chose "Both", the leave taken and
// the balances, and "Our Excel template"; Zoho People's leave export too; "while importing make sure there will be no
// duplicates from the previous imported files"; and, after the import, a day of approved leave is never a no-show on a
// draft payroll): the template, an upload's review (ready, problems, duplicates, overlaps, people to confirm or not
// found), Zoho's types mapped and its five statuses, half days and holidays or weekends, applying (approved leave, the
// balances set with adjustments), the payroll (an approved month untouched, a draft's no-shows made leave), undo, delete
// (a Super Admin only), roles, and C-level people (the CEO's, hidden from HR). Everyone and every number is invented.

const RUN = Date.now().toString(36).toLowerCase();
/** The run as letters only: names compared by their letters (attendance-import.ts nameWords) stay whole. */
const TAG = RUN.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
const TODAY = todayInCairo();
const YEAR = Number(TODAY.slice(0, 4));
const M_APPROVED = `${YEAR}-02`;
const M_DRAFT = `${YEAR}-03`;
const M_FREE = `${YEAR}-05`;
const M_FREE2 = `${YEAR}-06`;
const ZARA_ZOHO = String(70_000_000 + (Date.now() % 10_000_000));
const XENA_ZOHO = String(80_000_000 + (Date.now() % 10_000_000));

interface Row {
  sheet: 'leaves' | 'balances';
  row: number;
  status: string;
  reasons: string[];
  warnings: string[];
  notes: string[];
  personKey: string;
  employee: { id: string } | null;
  type: { id: string; nameEn: string } | null;
  from: string | null;
  to: string | null;
  days: number | null;
  halfDay: boolean;
  pending: boolean;
  wfh: boolean;
  wfhDays: string[] | null;
  adjustment: number | null;
  yours: boolean;
  notYours: string | null;
}

interface View {
  id: string;
  fileName: string;
  source: string;
  sourceLabel: string;
  sameFile: string | null;
  people: { key: string; name: string; code: string | null; match: string; toConfirm: boolean; employee: { id: string } | null; candidates: { id: string }[] }[];
  types: { zohoType: string; rows: number; typeId: string | null; wfh: boolean; chosen: boolean; note: string | null }[];
  leaves: Row[];
  balances: Row[];
  counts: Record<string, number>;
  hidden: { rows: number; label: string } | null;
  holidaysHint: string | null;
  noShowsToLeave: { days: number; people: number; text: string } | null;
  canApply: boolean;
  undoable: number;
  kept: { leaves: number; adjustments: number; wfhDays: number };
  appliedAt: string | null;
  undoneAt: string | null;
}

interface Line {
  id: string;
  employeeId: string;
  terms: { leave?: { paidDays: number; unpaidDays: number } };
  inputs: { noShowDays: number | null; workedHours: number | null };
  result: { noShowCut: number; unpaidLeaveCut?: number };
  attendanceImport: { source: string; fields: string[] } | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
/** A date as the messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => ymd.split('-').reverse().join('/');

describe('Leave import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrName: string;
  let ceo: string;
  let finance: string;
  let manager: string;
  let employee: string;
  let superAdmin: string;
  let emailDomainBefore: string | null;
  let g9Before: boolean;
  let g9Id: string;
  let deptId: string;
  let shiftId: string;
  let compTypeId: string | null = null;
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const codes: Record<string, string> = {};
  const imports: string[] = [];
  const runs: string[] = [];
  const types: Record<string, string> = {};
  const holidays = new Set<string>();
  const api = () => request(app.getHttpServer());

  /** A month's working days (Sunday to Thursday) that aren't holidays. */
  const workDays = (month: string) => {
    const out: string[] = [];
    for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) out.push(d);
    return out;
  };
  const fridays = (month: string) => {
    const out: string[] = [];
    for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) === 5) out.push(d);
    return out;
  };

  async function person(key: string, name: string, joinDate: string, extra: Record<string, unknown> = {}, contract = false) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: name, fullNameAr: 'موظف تجريبي', ...extra }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    codes[key] = res.body.employeeCode;
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate, departmentId: deptId, shiftId, ...(key === 'zara' && ids.mia && { managerId: ids.mia }) })
      .expect(201);
    if (contract) {
      const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 15000, durationMonths: 12 }).expect(201)).body as {
        id: string;
        startDate: string;
      };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    }
    return hired.body.employment.id as string;
  }

  const upload = async (file: Buffer, name: string, status = 201, session = hr) => {
    const res = await api().post('/api/leave/import').set('Cookie', session).attach('file', file, name);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    if (res.status === 201) imports.push(res.body.id);
    return res;
  };
  const review = async (id: string, session = hr) => (await api().get(`/api/leave/import/${id}`).set('Cookie', session).expect(200)).body as View;
  const apply = (id: string, session = hr) => api().post(`/api/leave/import/${id}/apply`).set('Cookie', session);
  const undo = (id: string, session = hr) => api().post(`/api/leave/import/${id}/undo`).set('Cookie', session);
  const choose = (id: string, body: object, session = hr) => api().patch(`/api/leave/import/${id}/people`).set('Cookie', session).send(body);
  const mapType = (id: string, body: object, session = hr) => api().patch(`/api/leave/import/${id}/types`).set('Cookie', session).send(body);
  const rowOf = (v: View, row: number, sheet: 'leaves' | 'balances' = 'leaves') => (sheet === 'leaves' ? v.leaves : v.balances).find((r) => r.row === row)!;
  const balances = async (key: string, session = hr) =>
    (await api().get(`/api/employees/${ids[key]}/leave?year=${YEAR}`).set('Cookie', session).expect(200)).body as {
      annual: { entitlement: number; adjustments: number; taken: number; booked: number; pending: number; available: number };
      requests: { id: string; status: string; recordedByHr: boolean; reason: string | null; days: number; halfDay: boolean; type: { key: string }; steps: { kind: string }[] }[];
    };
  const lineOf = async (runId: string, key: string) =>
    ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrName = hrEmail;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    manager = await signIn(app, await createUser(prisma, ['manager']));
    employee = await signIn(app, await createUser(prisma, ['employee']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Leave import ${TAG}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `LI${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('18:00'), hoursPerDay: 9, graceMinutes: 0, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    for (const h of await prisma.holiday.findMany({ select: { date: true } })) holidays.add(fromDateOnly(h.date));
    for (const t of (await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]) types[t.key] = t.id;

    await person('ann', `Ann Template ${TAG}`, '2024-01-01');
    await person('ben', `Ben Template ${TAG}`, '2024-01-01', { gender: 'male' });
    await person('nina', `Nina Newcomer ${TAG}`, `${YEAR}-01-01`);
    const ceeEmployment = await person('cee', `Cleo Chief ${TAG}`, '2024-01-01');
    await person('mia', `Mia Manager ${TAG}`, '2024-01-01');
    await person('zara', `Zara Zoho ${TAG}`, `${YEAR}-01-01`, {}, true);
    await person('yara', `Yara Zoho ${TAG}`, '2024-01-01', { gender: 'female' });
    await person('xena', `Xena Payroll ${TAG}`, `${YEAR}-01-01`, {}, true);
    await prisma.employee.update({ where: { id: ids.zara }, data: { zohoPeopleId: ZARA_ZOHO } });
    await prisma.employee.update({ where: { id: ids.xena }, data: { zohoPeopleId: XENA_ZOHO } });
    // Cleo is C-level: G9, a grade marked confidential (owner, 19 October 2026)
    const g9 = (await prisma.grade.findFirst({ where: { code: 'G9' }, select: { id: true, confidential: true } }))!;
    g9Id = g9.id;
    g9Before = g9.confidential;
    await prisma.grade.update({ where: { id: g9.id }, data: { confidential: true } });
    await prisma.employment.update({ where: { id: ceeEmployment }, data: { gradeId: g9.id } });
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceImport.deleteMany({ where: { runId: { in: runs } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveImport.deleteMany({ where: { id: { in: imports } } });
    await prisma.holiday.deleteMany({ where: { nameEn: { endsWith: TAG } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveType.deleteMany({ where: { nameEn: { endsWith: TAG } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.grade.update({ where: { id: g9Id }, data: { confidential: g9Before } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the template', () => {
    it('downloads as a workbook: Leaves taken with the types as a list, Balances, and How to fill with the employees HR may see', async () => {
      const res = await api().get('/api/leave/import/template').set('Cookie', hr).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Leaves taken', 'Balances', 'How to fill']);
      expect((wb.getWorksheet('Leaves taken')!.getRow(1).values as string[]).slice(1)).toEqual(['Employee code', 'Employee name', 'Leave type', 'From', 'To', 'Days', 'Notes']);
      expect((wb.getWorksheet('Balances')!.getRow(1).values as string[]).slice(1)).toEqual(['Employee code', 'Employee name', 'Leave type', 'Balance in days', 'As of']);
      expect(wb.getWorksheet('Leaves taken')!.getCell('C2').dataValidation).toMatchObject({ type: 'list' });
      const help: string[] = [];
      wb.getWorksheet('How to fill')!.eachRow((row) => help.push((row.values as unknown[]).slice(1).map(String).join(' | ')));
      expect(help.join('\n')).toContain(`${codes.ann} | Ann Template ${TAG}`);
      expect(help.join('\n')).toContain('Annual leave | The annual balance');
      // a C-level person isn't listed to HR (owner, 19 October 2026); the CEO sees them
      expect(help.join('\n')).not.toContain(codes.cee);
      const forCeo = await api().get('/api/leave/import/template').set('Cookie', ceo).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      const ceoBook = new ExcelJS.Workbook();
      await ceoBook.xlsx.load(forCeo.body as ArrayBuffer);
      const ceoHelp: string[] = [];
      ceoBook.getWorksheet('How to fill')!.eachRow((row) => ceoHelp.push((row.values as unknown[]).slice(1).map(String).join(' | ')));
      expect(ceoHelp.join('\n')).toContain(codes.cee);
    });

    it('is HR’s and the CEO’s: an employee, a manager and Finance are refused, everywhere', async () => {
      const file = await templateWorkbook([{ code: codes.ann, type: 'Annual leave', from: workDays(M_FREE)[0], to: workDays(M_FREE)[0] }]);
      for (const session of [employee, manager, finance]) {
        await api().get('/api/leave/import/template').set('Cookie', session).expect(403);
        await api().get('/api/leave/import').set('Cookie', session).expect(403);
        await api().post('/api/leave/import').set('Cookie', session).attach('file', file, 'leave.xlsx').expect(403);
      }
    });

    it('refuses a file that isn’t a workbook, or has neither the template’s sheets nor Zoho’s headings', async () => {
      expect(said(await upload(Buffer.from('Employee code,Leave type\n'), 'leave.csv', 400))[0]).toMatch(/isn’t an Excel workbook/);
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Other').addRow(['Something', 'Else']);
      expect(said(await upload(Buffer.from(await wb.xlsx.writeBuffer()), 'other.xlsx', 400))[0]).toMatch(/neither the template’s sheets/);
    });
  });

  describe('the template filled in', () => {
    let importId: string;
    const w5 = () => workDays(M_FREE);
    const w6 = () => workDays(M_FREE2);

    it('reads every row: ready, a duplicate in the file, a problem, a person to confirm or not found, and the C-level people hidden from HR', async () => {
      const [a, , c, , , f, g, h] = w5();
      const nina = w6();
      const file = await templateWorkbook(
        [
          { code: codes.ann, type: 'Annual leave', from: a, to: c, notes: 'Family trip' }, // 2: ready, 3 days
          { code: codes.ann, type: 'Annual leave', from: a, to: c }, // 3: the same as row 2
          { code: codes.ann, type: 'Holiday leave', from: f, to: f }, // 4: no such type
          { code: codes.ann, type: 'Annual leave', from: `31/02/${YEAR}`, to: f }, // 5: not a date
          { name: `Ben Template ${TAG}`, type: 'Sick leave', from: g, to: g, days: 2 }, // 6: by name alone: to confirm
          { code: 'EMP-NOPE', name: `Nobody Known ${TAG}`, type: 'Annual leave', from: h, to: h }, // 7: not found
          { code: codes.ann, type: 'Casual leave', from: f, to: h }, // 8: casual, 3 days at once: a warning only
          { code: codes.nina, type: 'Annual leave', from: nina[0], to: nina[15] }, // 9: 16 days of a first year's 15
          { code: codes.cee, type: 'Annual leave', from: a, to: a }, // 10: C-level
        ],
        [
          { code: codes.ann, balance: 10, asOf: `${YEAR}-12-31` }, // 2: sets the balance
          { code: codes.ann, balance: 10, asOf: `${YEAR}-12-31` }, // 3: the same again
          { code: codes.ann, type: 'Casual leave', balance: 3, asOf: `${YEAR}-12-31` }, // 4: casual has no balance of its own
          { code: codes.ben, balance: -1, asOf: `${YEAR}-12-31` }, // 5: below 0
          { code: codes.cee, balance: 25, asOf: `${YEAR}-12-31` }, // 6: C-level
          { code: codes.ann, balance: 4, asOf: `${YEAR - 3}-12-31` }, // 7: As of in another year
        ],
      );
      const res = await upload(file, `Leave history ${TAG}.xlsx`);
      importId = res.body.id;
      const v = res.body as View;
      expect(v).toMatchObject({ source: 'template', sourceLabel: 'The leave import template', sameFile: null });
      expect(rowOf(v, 2)).toMatchObject({ status: 'ready', days: 3, type: { nameEn: 'Annual leave' }, yours: true });
      expect(rowOf(v, 3)).toMatchObject({ status: 'duplicate', reasons: ['In the file twice: the same as row 2.'] });
      expect(rowOf(v, 4)).toMatchObject({ status: 'problem', reasons: ['“Holiday leave” isn’t a leave type of the system: choose one from the list.'] });
      expect(rowOf(v, 5)).toMatchObject({ status: 'problem', reasons: [`“31/02/${YEAR}” isn’t a date: enter From as DD/MM/YYYY.`] });
      expect(rowOf(v, 6)).toMatchObject({ status: 'waiting' });
      expect(rowOf(v, 7)).toMatchObject({ status: 'waiting' });
      // casual leave's limits don't block history (21 October 2026)
      expect(rowOf(v, 8)).toMatchObject({ status: 'ready', days: 3 });
      expect(rowOf(v, 8).warnings).toContain('Casual leave is at most 2 days at a time; this is 3 days.');
      // below 0, as history: warned, not blocked
      expect(rowOf(v, 9)).toMatchObject({ status: 'ready', days: 16 });
      expect(rowOf(v, 9).warnings).toEqual(expect.arrayContaining(['Brings annual leave to −1 day (entitlement 15).', `Annual leave can be used from 01/07/${YEAR}, six months after joining; this was before.`]));
      expect(rowOf(v, 3, 'balances')).toMatchObject({ status: 'duplicate', reasons: ['In the file twice: the same as row 2.'] });
      expect(rowOf(v, 4, 'balances').reasons).toEqual(['Casual leave is counted against the annual balance: give the balance of Annual leave instead.']);
      expect(rowOf(v, 5, 'balances').reasons).toEqual(['A balance can’t be below 0: enter 0 or more days.']);
      expect(rowOf(v, 7, 'balances').reasons[0]).toMatch(/^As of must be in /);
      // Ann's 21 days, less the 3 of annual and 3 of casual leave imported, are 15: 10 takes 5 off
      expect(rowOf(v, 2, 'balances')).toMatchObject({ status: 'ready', adjustment: -5 });
      // Cleo's rows: hidden from HR, one line
      expect(v.leaves.some((r) => r.row === 10) || v.balances.some((r) => r.row === 6)).toBe(false);
      expect(v.hidden).toEqual({ rows: 2, label: 'C-level (1 person): 2 rows, imported by the CEO' });
      // the people to confirm: Ben by his name; nobody for EMP-NOPE
      const benPerson = v.people.find((p) => p.name === `Ben Template ${TAG}`)!;
      expect(benPerson).toMatchObject({ match: 'exact', toConfirm: true, employee: null });
      expect(benPerson.candidates.map((c) => c.id)).toEqual([ids.ben]);
      expect(v.people.find((p) => p.code === 'EMP-NOPE')).toMatchObject({ match: 'none', toConfirm: true });
    });

    it('HR confirms who a person is or skips them; a C-level person can’t be chosen by HR', async () => {
      const v0 = await review(importId);
      const benKey = v0.people.find((p) => p.name === `Ben Template ${TAG}`)!.key;
      const nobodyKey = v0.people.find((p) => p.code === 'EMP-NOPE')!.key;
      await choose(importId, { key: nobodyKey, employeeId: ids.cee }).expect(400);
      await choose(importId, { key: benKey, employeeId: ids.ben }).expect(200);
      const v = (await choose(importId, { key: nobodyKey, skipped: true }).expect(200)).body as View;
      // Ben's sick day: the file's 2 days, the system's 1; no document, as history
      expect(rowOf(v, 6)).toMatchObject({ status: 'ready', days: 1 });
      expect(rowOf(v, 6).warnings).toEqual([
        'The file says 2 days; the system counts 1 day (in working days, without rest days and official holidays), and that is used.',
        'Sick leave needs a document: imported as history without one.',
      ]);
      expect(rowOf(v, 7)).toMatchObject({ status: 'skipped', reasons: ['Its person is skipped.'] });
      expect(v.counts).toMatchObject({ ready: 5, problem: 5, duplicate: 2, skipped: 1, waiting: 0, hidden: 2 });
    });

    it('applies: the leave approved and marked imported, no steps; then the balance set to the figure; one audit entry with the counts', async () => {
      const v = (await apply(importId).expect(200)).body as View;
      expect(v.counts).toMatchObject({ applied: 5, ready: 0 });
      expect(v.kept).toEqual({ leaves: 4, adjustments: 1, wfhDays: 0 });
      const ann = await balances('ann');
      // 21 earned, 5 taken off by the opening balance, 6 imported: 10 left, the figure given
      expect(ann.annual).toMatchObject({ entitlement: 21, adjustments: -5 });
      expect(ann.annual.available).toBe(10);
      const imported = ann.requests.filter((r) => r.reason?.startsWith(`Imported from Leave history ${TAG}.xlsx by `));
      expect(imported).toHaveLength(2);
      expect(imported.map((r) => r.status)).toEqual(['approved', 'approved']);
      expect(imported.every((r) => r.recordedByHr && r.steps.length === 0)).toBe(true);
      expect(imported.find((r) => r.type.key === 'annual')!.reason).toBe(`Imported from Leave history ${TAG}.xlsx by ${hrName}: Family trip`);
      const rows = await prisma.leaveRequest.findMany({ where: { importId }, select: { importId: true } });
      expect(rows).toHaveLength(4);
      const adjustment = await prisma.leaveAdjustment.findFirst({ where: { importId }, select: { days: true, reason: true } });
      expect(adjustment).toMatchObject({ reason: `Opening balance from Leave history ${TAG}.xlsx` });
      expect(adjustment!.days.toNumber()).toBe(-5);
      const entry = await prisma.auditLog.findFirst({ where: { entityType: 'leave_import', entityId: importId, action: 'import' }, select: { diff: true } });
      expect(entry?.diff).toMatchObject({ leaves: 4, pending: 0, balances: 1 });
      expect(await prisma.auditLog.count({ where: { entityType: 'leave_request', action: 'import', entityId: { in: (await prisma.leaveRequest.findMany({ where: { importId }, select: { id: true } })).map((r) => r.id) } } })).toBe(4);
      // nothing left for HR to apply
      expect(v.canApply).toBe(false);
      await apply(importId).expect(409);
    });

    it('the CEO sees and applies the C-level person’s rows, not HR’s', async () => {
      const v = await review(importId, ceo);
      expect(v.hidden).toBeNull();
      expect(rowOf(v, 10)).toMatchObject({ status: 'ready', yours: true });
      expect(rowOf(v, 6, 'balances')).toMatchObject({ status: 'ready', yours: true });
      expect(rowOf(v, 2)).toMatchObject({ status: 'applied' });
      const after = (await apply(importId, ceo).expect(200)).body as View;
      expect(rowOf(after, 10)).toMatchObject({ status: 'applied' });
      expect((await balances('cee', ceo)).annual.available).toBe(25);
      // still hidden from HR
      await api().get(`/api/employees/${ids.cee}/leave?year=${YEAR}`).set('Cookie', hr).expect(404);
    });

    it('no duplicates: the same file again is said and every row is a duplicate; the same balance again changes nothing', async () => {
      const again = (await upload(await prisma.leaveImport.findUniqueOrThrow({ where: { id: importId }, select: { fileData: true } }).then((r) => Buffer.from(r.fileData)), `Leave history ${TAG} (2).xlsx`)).body as View;
      expect(again.sameFile).toMatch(/^This file was already imported on \d{2}\/\d{2}\/\d{4} by /);
      expect(again.leaves.every((r) => r.status === 'duplicate' || r.status === 'skipped')).toBe(true);
      expect(again.canApply).toBe(false);
      await apply(again.id).expect(409);

      // a balance file of its own, the same figure: already at it
      const balanceOnly = (await upload(await templateWorkbook(null, [{ code: codes.ann, balance: 10, asOf: `${YEAR}-12-31` }]), `Balances ${TAG}.xlsx`)).body as View;
      expect(rowOf(balanceOnly, 2, 'balances')).toMatchObject({ status: 'duplicate', reasons: ['Already at this balance: nothing to change.'], adjustment: 0 });
      await apply(balanceOnly.id).expect(409);
      expect(await prisma.leaveAdjustment.count({ where: { employeeId: ids.ann } })).toBe(1);

      // a template row the same as a leave imported before: "Already imported from <file>, <date>"
      const [a, , c] = w5();
      const repeat = (await upload(await templateWorkbook([{ code: codes.ann, type: 'Annual leave', from: a, to: c }, { code: codes.ann, type: 'Annual leave', from: c, to: c }]), `Repeat ${TAG}.xlsx`))
        .body as View;
      expect(rowOf(repeat, 2)).toMatchObject({ status: 'duplicate' });
      expect(rowOf(repeat, 2).reasons[0]).toMatch(new RegExp(`^Already imported from Leave history ${TAG}\\.xlsx, \\d{2}/\\d{2}/\\d{4}\\.$`));
      // a partial overlap is a problem, not a duplicate
      expect(rowOf(repeat, 3)).toMatchObject({ status: 'problem' });
      expect(rowOf(repeat, 3).reasons[0]).toMatch(/^Overlaps Annual leave from .* already in the system \(approved\)\./);
    });

    it('undo: HR removes what is HR’s, the CEO the C-level person’s; a Super Admin deletes it only once nothing is left', async () => {
      await api().delete(`/api/leave/import/${importId}`).set('Cookie', hr).expect(403);
      expect(said(await api().delete(`/api/leave/import/${importId}`).set('Cookie', superAdmin).expect(409))[0]).toMatch(/still in the system\. Undo it first, then delete it\.$/);
      const v = (await undo(importId).expect(200)).body as View;
      expect(v.kept).toEqual({ leaves: 1, adjustments: 1, wfhDays: 0 });
      expect(v.undoneAt).toBeNull();
      expect((await balances('ann')).annual).toMatchObject({ adjustments: 0, available: 21 });
      await undo(importId).expect(409);
      const byCeo = (await undo(importId, ceo).expect(200)).body as View;
      expect(byCeo.kept).toEqual({ leaves: 0, adjustments: 0, wfhDays: 0 });
      expect(byCeo.undoneAt).not.toBeNull();
      // its rows are free again: ready to apply once more
      expect(rowOf(await review(importId), 2)).toMatchObject({ status: 'ready' });
      await api().delete(`/api/leave/import/${importId}`).set('Cookie', superAdmin).expect(204);
      await api().get(`/api/leave/import/${importId}`).set('Cookie', hr).expect(404);
      const history = (await api().get('/api/leave/import').set('Cookie', hr).expect(200)).body as { id: string; state: string }[];
      expect(history.some((h) => h.id === importId)).toBe(false);
    });
  });

  describe('Zoho People’s leave export', () => {
    let first: string;
    let second: string;
    let secondFile: Buffer;
    // the first file's very bytes: ExcelJS stamps each workbook it writes with the time, so building it again would
    // make another file
    let firstFile: Buffer;
    const zara = () => `Zara Zoho ${TAG} ${ZARA_ZOHO}`;
    let leaves: ZohoLeaveIn[];
    let picks: Record<string, string>;

    beforeAll(async () => {
      const w = workDays(M_FREE);
      const june = workDays(M_FREE2);
      // a Thursday and the Sunday after it, both working days; a Sunday and the Monday after it, later on
      const thu = june.find((d) => weekday(d) === 4 && june.includes(addDays(d, 3)))!;
      const sun = june.find((d) => d > addDays(thu, 3) && weekday(d) === 0 && june.includes(addDays(d, 1)))!;
      const [fri1, fri2] = fridays(M_FREE);
      picks = { a: w[0], b: w[1], c: w[3], d: w[4], e: w[5], f: w[6], g: w[8], h: w[9], r1: w[10], r2: w[11], n: w[12], thu, sun, fri1, fri2 };
      // the leave HR recorded already, unpaid, on g
      await api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids.zara).field('typeId', types.unpaid).field('startDate', picks.g).field('endDate', picks.g).expect(201);
      const full = (date: string) => ({ date, duration: 'Full Day' as const });
      const off = (date: string) => ({ date, duration: 'Holiday/Weekend' as const });
      leaves = [
        { linkId: `${ZARA_ZOHO}01`, employee: zara(), type: 'Annual Leave', status: 'Approved', days: [full(picks.a)] }, // 2
        { linkId: `${ZARA_ZOHO}02`, employee: zara(), type: 'Annual Leave', status: 'System Approved', days: [full(thu), off(addDays(thu, 1)), off(addDays(thu, 2)), full(addDays(thu, 3))] }, // 3
        { linkId: `${ZARA_ZOHO}03`, employee: zara(), type: 'Annual Leave', status: 'Approved', days: [full(sun), off(addDays(sun, 1))] }, // 4: Monday a holiday in Zoho only
        { linkId: `${ZARA_ZOHO}04`, employee: zara(), type: 'Casual leave (Exceptional)', status: 'Approved', days: [{ date: picks.c, duration: 'Half Day', session: '2nd Half' }] }, // 5
        { linkId: `${ZARA_ZOHO}05`, employee: zara(), type: 'Working from home - Bi Weekly', status: 'Approved', days: [full(picks.b)] }, // 6
        { linkId: `${ZARA_ZOHO}06`, employee: zara(), type: 'Working from home - Bi Weekly', status: 'Pending', days: [full(picks.b)] }, // 7
        { linkId: `${ZARA_ZOHO}07`, employee: zara(), type: 'Compensatory Off', status: 'Approved', days: [full(picks.d)] }, // 8
        { linkId: `${ZARA_ZOHO}08`, employee: zara(), type: 'Annual Leave', status: 'Pending', days: [full(picks.e)] }, // 9
        { linkId: `${ZARA_ZOHO}09`, employee: zara(), type: 'Annual Leave', status: 'Rejected', days: [full(picks.r1)] }, // 10
        { linkId: `${ZARA_ZOHO}10`, employee: zara(), type: 'Annual Leave', status: 'Cancelled', days: [full(picks.r2)] }, // 11
        { linkId: `${ZARA_ZOHO}11`, employee: zara(), type: 'Compensatory Off', status: 'Cancelled', days: [off(fri1)] }, // 12
        { linkId: `${ZARA_ZOHO}12`, employee: zara(), type: 'Annual Leave', status: 'Approved', days: [off(fri2)] }, // 13: 0 days
        { linkId: `${ZARA_ZOHO}13`, employee: `Yarra Zohoo ${TAG}`, type: 'Sick Leave', status: 'Approved', days: [full(picks.f)] }, // 14: a close name
        { linkId: `${ZARA_ZOHO}14`, employee: `Nobody Here ${TAG} 98765`, type: 'Annual Leave', status: 'Approved', days: [full(picks.f)] }, // 15
        { linkId: `${ZARA_ZOHO}15`, employee: zara(), type: 'Annual Leave', status: 'Approved', days: [full(picks.a)] }, // 16: the same as row 2
        { linkId: `${ZARA_ZOHO}16`, employee: zara(), type: 'Annual Leave', status: 'Approved', days: [full(picks.a), full(picks.b)] }, // 17: overlaps row 2
        { linkId: `${ZARA_ZOHO}17`, employee: zara(), type: 'Leave Without Pay', status: 'Approved', days: [full(picks.g)] }, // 18: already in the system
        { linkId: `${ZARA_ZOHO}18`, employee: zara(), type: 'Annual Leave', status: 'Approved', days: [full(picks.g), full(picks.h)] }, // 19: overlaps it
      ];
    });

    it('is told by its headings; its types mapped by default; its five statuses; half days and holidays or weekends; names matched', async () => {
      firstFile = await zohoLeaveWorkbook(leaves);
      const v = (await upload(firstFile, `Leave View ${TAG}.xlsx`)).body as View;
      first = v.id;
      expect(v).toMatchObject({ source: 'zoho', sourceLabel: 'Zoho People leave export' });
      const typeOf = (t: string) => v.types.find((x) => x.zohoType === t)!;
      expect(typeOf('Annual Leave')).toMatchObject({ typeId: types.annual, chosen: false });
      expect(typeOf('Casual leave (Exceptional)')).toMatchObject({ typeId: types.casual });
      expect(typeOf('Sick Leave')).toMatchObject({ typeId: types.sick });
      expect(typeOf('Leave Without Pay')).toMatchObject({ typeId: types.unpaid });
      // owner, 21 October 2026: "Yes, as approved WFH days"
      expect(typeOf('Working from home - Bi Weekly')).toMatchObject({ typeId: null, wfh: true, chosen: false });
      expect(typeOf('Working from home - Bi Weekly').note).toBe('Imported as approved work-from-home days (not leave): they don’t touch balances or pay.');
      expect(typeOf('Compensatory Off')).toMatchObject({ typeId: null });
      expect(typeOf('Compensatory Off').note).toMatch(/Create a “Compensatory day off” type in Leave Setup \(paid, no balance\)/);

      expect(rowOf(v, 2)).toMatchObject({ status: 'ready', days: 1, employee: { id: ids.zara } });
      // Thursday, Friday and Saturday off in Zoho, Sunday: 2 days, as the system counts them
      expect(rowOf(v, 3)).toMatchObject({ status: 'ready', days: 2, warnings: expect.not.arrayContaining([expect.stringMatching(/file says/)]) });
      // the Monday Zoho counts as a holiday isn't one here: the system's 2 days used, the year's holidays to check
      expect(rowOf(v, 4)).toMatchObject({ status: 'ready', days: 2 });
      expect(rowOf(v, 4).warnings.slice(0, 2)).toEqual([
        'The file says 1 day; the system counts 2 days (in working days, without rest days and official holidays), and those are used.',
        `${addDays(picks.sun, 1).split('-').reverse().join('/')} is a holiday or weekend in Zoho, a working day here.`,
      ]);
      expect(v.holidaysHint).toMatch(new RegExp(`^Check that ${YEAR}’s official holidays are set in Organization → Holidays before applying`));
      expect(rowOf(v, 5)).toMatchObject({ status: 'ready', days: 0.5, halfDay: true });
      // Working from home: a work-from-home day, not leave; the pending one on the same day is in the file twice
      expect(rowOf(v, 6)).toMatchObject({ status: 'ready', wfh: true, type: null, days: 1, wfhDays: [picks.b] });
      expect(rowOf(v, 7)).toMatchObject({ status: 'duplicate', wfh: true, pending: true, reasons: [`Already a work-from-home day on ${shown(picks.b)} in row 6 of the file.`] });
      expect(rowOf(v, 8)).toMatchObject({ status: 'skipped' });
      expect(rowOf(v, 9)).toMatchObject({ status: 'ready', pending: true });
      expect(rowOf(v, 10)).toMatchObject({ status: 'skipped', reasons: ['Rejected in Zoho People: not imported.'] });
      expect(rowOf(v, 11)).toMatchObject({ status: 'skipped', reasons: ['Cancelled in Zoho People: not imported.'] });
      expect(rowOf(v, 12)).toMatchObject({ status: 'skipped', reasons: ['Cancelled in Zoho People: not imported.'] });
      expect(rowOf(v, 13)).toMatchObject({ status: 'skipped', reasons: ['0 days: every day of it is a rest day or an official holiday.'] });
      expect(rowOf(v, 14)).toMatchObject({ status: 'waiting' });
      expect(v.people.find((p) => p.name === `Yarra Zohoo ${TAG}`)).toMatchObject({ match: 'close', toConfirm: true });
      expect(v.people.find((p) => p.name === `Yarra Zohoo ${TAG}`)!.candidates[0].id).toBe(ids.yara);
      expect(v.people.find((p) => p.name === `Zara Zoho ${TAG}`)).toMatchObject({ match: 'linked', toConfirm: false });
      expect(rowOf(v, 15)).toMatchObject({ status: 'waiting' });
      expect(rowOf(v, 16)).toMatchObject({ status: 'duplicate', reasons: ['In the file twice: the same as row 2.'] });
      expect(rowOf(v, 17)).toMatchObject({ status: 'problem', reasons: ['Overlaps row 2 of the file: put right one of them.'] });
      expect(rowOf(v, 18)).toMatchObject({ status: 'duplicate' });
      expect(rowOf(v, 18).reasons[0]).toMatch(/^Already in the system: Unpaid leave on .* \(approved\)\.$/);
      expect(rowOf(v, 19)).toMatchObject({ status: 'problem' });
      expect(rowOf(v, 19).reasons[0]).toMatch(/^Overlaps Unpaid leave on .* already in the system \(approved\)\.$/);
    });

    it('HR maps a type or skips it; a Compensatory day off type of no balance imports those rows, none of it from the annual balance', async () => {
      compTypeId = (await api().post('/api/leave/types').set('Cookie', hr).send({ nameEn: `Compensatory day off ${TAG}`, nameAr: 'بدل راحة', paid: 'paid', balance: 'none' }).expect(201)).body.id;
      let v = (await mapType(first, { zohoType: 'Compensatory Off', typeId: compTypeId }).expect(200)).body as View;
      expect(v.types.find((t) => t.zohoType === 'Compensatory Off')).toMatchObject({ typeId: compTypeId, chosen: true });
      expect(rowOf(v, 8)).toMatchObject({ status: 'ready', type: { id: compTypeId } });
      v = (await mapType(first, { zohoType: 'Sick Leave', skipped: true }).expect(200)).body as View;
      expect(rowOf(v, 14)).toMatchObject({ status: 'skipped' });
      v = (await mapType(first, { zohoType: 'Sick Leave' }).expect(200)).body as View;
      expect(rowOf(v, 14)).toMatchObject({ status: 'waiting' });
      await mapType(first, { zohoType: 'Not In The File', skipped: true }).expect(404);
      const yarra = v.people.find((p) => p.name === `Yarra Zohoo ${TAG}`)!;
      v = (await choose(first, { key: yarra.key, employeeId: ids.yara }).expect(200)).body as View;
      expect(rowOf(v, 14)).toMatchObject({ status: 'ready', type: { nameEn: 'Sick leave' } });
    });

    it('applies: approved leave as history, the pending one as a request with Zara’s manager, the others left', async () => {
      const before = await balances('zara');
      const v = (await apply(first).expect(200)).body as View;
      expect([2, 3, 4, 5, 6, 8, 9, 14].map((n) => rowOf(v, n).status)).toEqual(Array(8).fill('applied'));
      // the Working from home row: a work-from-home day approved, from this import, not leave
      expect(await prisma.wfhRequest.findMany({ where: { importId: first }, select: { employeeId: true, status: true, zohoLinkId: true } })).toEqual([
        { employeeId: ids.zara, status: 'approved', zohoLinkId: `${ZARA_ZOHO}05:${picks.b}` },
      ]);
      const zara = await balances('zara');
      // the annual balance takes the annual and casual days (1 + 2 + 2 + 0.5), the pending one as pending; the
      // compensatory day off, of no balance, none
      expect(zara.annual.taken + zara.annual.booked).toBe(before.annual.taken + before.annual.booked + 5.5);
      expect(zara.annual.pending).toBe(before.annual.pending + 1);
      const pending = zara.requests.find((r) => r.status === 'with_manager')!;
      expect(pending.steps.map((s) => s.kind)).toEqual(['submitted']);
      expect(pending.recordedByHr).toBe(false);
      const halfDay = zara.requests.find((r) => r.type.key === 'casual')!;
      expect(halfDay).toMatchObject({ halfDay: true, days: 0.5, status: 'approved' });
      expect((await prisma.leaveRequest.findMany({ where: { importId: first }, select: { zohoLinkId: true } })).map((r) => r.zohoLinkId ?? '').sort((x, y) => x.localeCompare(y))).toEqual(
        ['01', '02', '03', '04', '07', '08', '13'].map((n) => `${ZARA_ZOHO}${n}`),
      );
      // the manager has it waiting for them
      expect(await prisma.leaveRequest.count({ where: { importId: first, managerId: ids.mia, status: 'with_manager' } })).toBe(1);
    });

    it('re-importing the same file adds nothing; a second file overlapping the first applies only its new rows', async () => {
      const again = (await upload(firstFile, `Leave View ${TAG} again.xlsx`)).body as View;
      expect(again.sameFile).not.toBeNull();
      expect(again.canApply).toBe(false);
      expect(again.leaves.filter((r) => r.status === 'ready')).toEqual([]);

      secondFile = await zohoLeaveWorkbook([leaves[0], { linkId: `${ZARA_ZOHO}19`, employee: zara(), type: 'Annual Leave', status: 'Approved', days: [{ date: picks.n, duration: 'Full Day' }] }]);
      const v = (await upload(secondFile, `Leave View ${TAG} October.xlsx`)).body as View;
      second = v.id;
      expect(v.sameFile).toBeNull();
      expect(rowOf(v, 2)).toMatchObject({ status: 'duplicate' });
      expect(rowOf(v, 2).reasons[0]).toMatch(new RegExp(`^Already imported from Leave View ${TAG}\\.xlsx, `));
      expect(rowOf(v, 3)).toMatchObject({ status: 'ready' });
      const applied = (await apply(second).expect(200)).body as View;
      expect(applied.kept).toEqual({ leaves: 1, adjustments: 0, wfhDays: 0 });
    });

    it('undoing frees its rows: the same file uploaded again is applied again', async () => {
      const undone = (await undo(second).expect(200)).body as View;
      expect(undone.undoneAt).not.toBeNull();
      expect(await prisma.leaveRequest.count({ where: { zohoLinkId: `${ZARA_ZOHO}19` } })).toBe(0);
      const v = (await upload(secondFile, `Leave View ${TAG} October.xlsx`)).body as View;
      expect(v.sameFile).toBeNull();
      expect(rowOf(v, 3)).toMatchObject({ status: 'ready' });
      expect((await apply(v.id).expect(200)).body.kept).toEqual({ leaves: 1, adjustments: 0, wfhDays: 0 });
      expect(await prisma.leaveRequest.count({ where: { zohoLinkId: `${ZARA_ZOHO}19` } })).toBe(1);
    });
  });

  describe('Zoho’s Working from home as work-from-home days (owner, 21 October 2026: "Yes, as approved WFH days")', () => {
    const M_WFH = `${YEAR}-08`;
    const M_WFH2 = `${YEAR}-09`;
    const WREN_ZOHO = String(50_000_000 + (Date.now() % 10_000_000));
    const WALT_ZOHO = String(40_000_000 + (Date.now() % 10_000_000));
    const wren = () => `Wren Remote ${TAG} ${WREN_ZOHO}`;
    const walt = () => `Walt Remote ${TAG} ${WALT_ZOHO}`;
    const full = (date: string) => ({ date, duration: 'Full Day' as const });
    const off = (date: string) => ({ date, duration: 'Holiday/Weekend' as const });
    let rows: ZohoLeaveIn[];
    let file: Buffer;
    let picks: Record<string, string>;
    let importId: string;
    let recordedId: string;
    const wfhOf = (id: string) => prisma.wfhRequest.findMany({ where: { importId: id }, orderBy: [{ employeeId: 'asc' }, { date: 'asc' }], include: { steps: { orderBy: { id: 'asc' } } } });

    beforeAll(async () => {
      const wrenEmployment = await person('wren', `Wren Remote ${TAG}`, '2024-01-01');
      await person('walt', `Walt Remote ${TAG}`, '2024-01-01');
      await prisma.employee.update({ where: { id: ids.wren }, data: { zohoPeopleId: WREN_ZOHO } });
      await prisma.employee.update({ where: { id: ids.walt }, data: { zohoPeopleId: WALT_ZOHO } });
      // Wren's direct manager decides her pending request; Walt has nobody in charge: straight to HR
      await prisma.employment.update({ where: { id: wrenEmployment }, data: { managerId: ids.mia } });
      const aug = workDays(M_WFH);
      // a Thursday and the Sunday after it, both working days, the Friday and Saturday between rest days
      const thu = aug.find((d) => d > aug[0] && weekday(d) === 4 && aug.includes(addDays(d, 3)))!;
      const sep = workDays(M_WFH2);
      // Sunday to Tuesday, all working days, the Monday made an official holiday here (Zoho counts it a full day)
      const sun = sep.find((d) => weekday(d) === 0 && sep.includes(addDays(d, 1)) && sep.includes(addDays(d, 2)))!;
      const holiday = addDays(sun, 1);
      await prisma.holiday.create({ data: { date: toDateOnly(holiday), nameEn: `WFH import holiday ${TAG}` } });
      holidays.add(holiday);
      const later = (d: string, gap: number) => sep.find((x) => x > addDays(d, gap))!;
      const pending = later(sun, 7);
      const rejected = later(pending, 1);
      const cancelled = later(rejected, 1);
      const recorded = later(cancelled, 3);
      picks = { a1: aug[0], thu, sun: addDays(thu, 3), s: sun, holiday, s2: addDays(sun, 2), pending, rejected, cancelled, recorded, walt: aug[1], leave: aug.find((d) => d > addDays(thu, 6))! };
      // a work-from-home day HR recorded already, on the system
      recordedId = (await api().post('/api/wfh').set('Cookie', hr).send({ employeeId: ids.wren, date: recorded, reason: 'Recorded before the import' }).expect(201)).body.id;
      rows = [
        { linkId: `${WREN_ZOHO}01`, employee: wren(), type: 'Working from home', status: 'Approved', days: [full(picks.a1)] }, // 2
        { linkId: `${WREN_ZOHO}02`, employee: wren(), type: 'Working from home', status: 'Approved', days: [full(thu), off(addDays(thu, 1)), off(addDays(thu, 2)), full(addDays(thu, 3))] }, // 3
        { linkId: `${WREN_ZOHO}03`, employee: wren(), type: 'Working from home', status: 'Approved', days: [full(sun), full(holiday), full(addDays(sun, 2))] }, // 4: a holiday inside
        { linkId: `${WREN_ZOHO}04`, employee: wren(), type: 'Working from home', status: 'Pending', days: [full(pending)] }, // 5
        { linkId: `${WREN_ZOHO}05`, employee: wren(), type: 'Working from home', status: 'Rejected', days: [full(rejected)] }, // 6
        { linkId: `${WREN_ZOHO}06`, employee: wren(), type: 'Working from home', status: 'Cancelled', days: [full(cancelled)] }, // 7
        { linkId: `${WREN_ZOHO}07`, employee: wren(), type: 'Working from home', status: 'Approved', days: [full(recorded)] }, // 8: already one
        { linkId: `${WREN_ZOHO}08`, employee: wren(), type: 'Working from home', status: 'Approved', days: [full(picks.a1)] }, // 9: the same day as row 2
        { linkId: `${WALT_ZOHO}01`, employee: walt(), type: 'Working from home', status: 'Pending', days: [full(picks.walt)] }, // 10: nobody in charge
        { linkId: `${WREN_ZOHO}09`, employee: wren(), type: 'Annual Leave', status: 'Approved', days: [full(picks.leave)] }, // 11: leave alongside
      ];
      file = await zohoLeaveWorkbook(rows);
    });

    it('defaults Working from home to work-from-home days: one a working day, Zoho’s holidays and weekends and the holidays here left out', async () => {
      const v = (await upload(file, `Leave View WFH ${TAG}.xlsx`)).body as View;
      importId = v.id;
      expect(v.types.find((t) => t.zohoType === 'Working from home')).toMatchObject({ typeId: null, wfh: true, chosen: false, note: 'Imported as approved work-from-home days (not leave): they don’t touch balances or pay.' });
      expect(rowOf(v, 2)).toMatchObject({ status: 'ready', wfh: true, type: null, days: 1, wfhDays: [picks.a1], pending: false });
      expect(rowOf(v, 3)).toMatchObject({ status: 'ready', wfh: true, days: 2, wfhDays: [picks.thu, picks.sun] });
      expect(rowOf(v, 3).notes).toContain(`Left out: ${shown(addDays(picks.thu, 1))} and ${shown(addDays(picks.thu, 2))}, holidays or weekends in Zoho.`);
      // the limits (2 a month, 7 days apart) don't block history: said, as Apply says them
      expect(rowOf(v, 3).warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/^Two work from home days must be at least 7 days apart/), expect.stringMatching(/days of working from home are already asked for for Wren Remote/)]),
      );
      expect(rowOf(v, 4)).toMatchObject({ status: 'ready', days: 2, wfhDays: [picks.s, picks.s2] });
      expect(rowOf(v, 4).notes).toContain(`Left out: ${shown(picks.holiday)}, a rest day or official holiday here.`);
      expect(rowOf(v, 5)).toMatchObject({ status: 'ready', wfh: true, pending: true, wfhDays: [picks.pending] });
      expect(rowOf(v, 5).notes).toContain('Pending in Zoho People: imported as a work-from-home request waiting for its decision here, the approver in charge’s, then HR’s.');
      expect(rowOf(v, 6)).toMatchObject({ status: 'skipped', reasons: ['Rejected in Zoho People: not imported.'] });
      expect(rowOf(v, 7)).toMatchObject({ status: 'skipped', reasons: ['Cancelled in Zoho People: not imported.'] });
      expect(rowOf(v, 8)).toMatchObject({ status: 'duplicate', reasons: [`Already a work-from-home day on ${shown(picks.recorded)} (approved).`] });
      expect(rowOf(v, 9)).toMatchObject({ status: 'duplicate', reasons: [`Already a work-from-home day on ${shown(picks.a1)} in row 2 of the file.`] });
      expect(rowOf(v, 10)).toMatchObject({ status: 'ready', wfh: true, pending: true, employee: { id: ids.walt } });
      expect(rowOf(v, 11)).toMatchObject({ status: 'ready', wfh: false, type: { id: types.annual } });
      expect(v.counts).toMatchObject({ ready: 6, duplicate: 2, skipped: 2, pending: 2 });
      expect(await prisma.wfhRequest.count({ where: { importId } })).toBe(0);
    });

    it('HR can still skip it, or choose work-from-home days for it again', async () => {
      let v = (await mapType(importId, { zohoType: 'Working from home', skipped: true }).expect(200)).body as View;
      expect(v.types.find((t) => t.zohoType === 'Working from home')).toMatchObject({ typeId: null, wfh: false, chosen: true, note: null });
      for (const n of [2, 3, 4, 5, 8, 9, 10]) {
        expect(rowOf(v, n)).toMatchObject({ status: 'skipped', reasons: ['“Working from home” is skipped: choose Work-from-home days for it above to import these rows.'] });
      }
      expect(rowOf(v, 11)).toMatchObject({ status: 'ready' });
      v = (await mapType(importId, { zohoType: 'Working from home', wfh: true }).expect(200)).body as View;
      expect(v.types.find((t) => t.zohoType === 'Working from home')).toMatchObject({ wfh: true, chosen: true });
      expect(rowOf(v, 2)).toMatchObject({ status: 'ready', wfh: true });
      v = (await mapType(importId, { zohoType: 'Working from home' }).expect(200)).body as View;
      expect(v.types.find((t) => t.zohoType === 'Working from home')).toMatchObject({ wfh: true, chosen: false });
      expect(v.counts).toMatchObject({ ready: 6 });
    });

    it('applies with the leave, in one go: approved days, Zoho’s pending as requests at their first step, nobody told of history', async () => {
      const v = (await apply(importId).expect(200)).body as View;
      expect([2, 3, 4, 5, 10, 11].map((n) => rowOf(v, n).status)).toEqual(Array(6).fill('applied'));
      expect(v.kept).toEqual({ leaves: 1, adjustments: 0, wfhDays: 7 });
      expect(rowOf(v, 3)).toMatchObject({ wfh: true, days: 2, wfhDays: [picks.thu, picks.sun] });
      // what bringing them over said comes back with the row
      expect(rowOf(v, 3).warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^Two work from home days must be at least 7 days apart/)]));
      const made = await wfhOf(importId);
      const of = (key: string) => made.filter((w) => w.employeeId === ids[key]);
      expect(of('wren').map((w) => [fromDateOnly(w.date), w.status])).toEqual(
        [
          [picks.a1, 'approved'],
          [picks.thu, 'approved'],
          [picks.sun, 'approved'],
          [picks.s, 'approved'],
          [picks.s2, 'approved'],
          [picks.pending, 'with_manager'],
        ].sort((x, y) => x[0].localeCompare(y[0])),
      );
      // the holiday, the Friday and the Saturday aren't work-from-home days
      expect(made.map((w) => fromDateOnly(w.date))).not.toEqual(expect.arrayContaining([picks.holiday]));
      expect(made.map((w) => fromDateOnly(w.date))).not.toEqual(expect.arrayContaining([addDays(picks.thu, 1)]));
      const approved = made.filter((w) => w.status === 'approved');
      for (const w of approved) {
        expect(w).toMatchObject({ source: 'zoho', recordedByHr: true, importId, managerId: null });
        expect(w.steps.map((x) => x.kind)).toEqual(['imported']);
      }
      expect(approved.find((w) => fromDateOnly(w.date) === picks.sun)!.warnings.length).toBeGreaterThan(0);
      expect(approved.find((w) => fromDateOnly(w.date) === picks.thu)!.zohoLinkId).toBe(`${WREN_ZOHO}02:${picks.thu}`);
      // pending in Zoho: Wren's with her manager, Walt's (nobody in charge) with HR
      const wrenPending = of('wren').find((w) => w.status === 'with_manager')!;
      expect(wrenPending).toMatchObject({ managerId: ids.mia, approverRole: 'direct_manager', recordedByHr: false, source: 'zoho', importId });
      expect(wrenPending.steps.map((x) => x.kind)).toEqual(['submitted']);
      expect(wrenPending.steps[0].comment).toBe(`Imported from Leave View WFH ${TAG}.xlsx: pending in Zoho People.`);
      const [waltPending] = of('walt');
      expect(waltPending).toMatchObject({ status: 'with_hr', managerId: null });
      expect(waltPending.steps.map((x) => x.kind)).toEqual(['submitted', 'no_manager']);
      // the leave of the same file, applied with them
      expect(await prisma.leaveRequest.count({ where: { importId, employeeId: ids.wren, status: 'approved' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityType: 'wfh_request', action: 'import', entityId: { in: made.map((w) => w.id) } } })).toBe(7);
      // the day HR recorded is left as it was
      expect(await prisma.wfhRequest.findUnique({ where: { id: recordedId }, select: { importId: true, status: true } })).toEqual({ importId: null, status: 'approved' });
    });

    it('re-importing makes nothing new: the same file is said, another with the same rows has them as work-from-home days already', async () => {
      const before = await prisma.wfhRequest.count({ where: { employeeId: { in: [ids.wren, ids.walt] } } });
      const again = (await upload(file, `Leave View WFH ${TAG} again.xlsx`)).body as View;
      expect(again.sameFile).not.toBeNull();
      expect(again.canApply).toBe(false);
      const other = (await upload(await zohoLeaveWorkbook([rows[0], rows[1], { ...rows[0], linkId: `${WREN_ZOHO}10` }]), `Leave View WFH ${TAG} October.xlsx`)).body as View;
      expect(other.sameFile).toBeNull();
      expect(rowOf(other, 2)).toMatchObject({ status: 'duplicate', reasons: [`Already a work-from-home day on ${shown(picks.a1)} (imported from Leave View WFH ${TAG}.xlsx).`] });
      expect(rowOf(other, 3)).toMatchObject({ status: 'duplicate' });
      expect(rowOf(other, 3).reasons).toHaveLength(2);
      // another link id, the same person and day
      expect(rowOf(other, 4)).toMatchObject({ status: 'duplicate', reasons: [`Already a work-from-home day on ${shown(picks.a1)} (imported from Leave View WFH ${TAG}.xlsx).`] });
      expect(other.canApply).toBe(false);
      await apply(other.id).expect(409);
      expect(await prisma.wfhRequest.count({ where: { employeeId: { in: [ids.wren, ids.walt] } } })).toBe(before);
    });

    it('undo removes the work-from-home days it made with its leave; a Super Admin deletes it only after', async () => {
      const refused = await api().delete(`/api/leave/import/${importId}`).set('Cookie', superAdmin).expect(409);
      expect(said(refused)[0]).toBe('1 leave and 7 work-from-home days from this import are still in the system. Undo it first, then delete it.');
      const made = (await wfhOf(importId)).map((w) => w.id);
      const v = (await undo(importId).expect(200)).body as View;
      expect(v.undoneAt).not.toBeNull();
      expect(v.kept).toEqual({ leaves: 0, adjustments: 0, wfhDays: 0 });
      expect(await prisma.wfhRequest.count({ where: { id: { in: made } } })).toBe(0);
      expect(await prisma.leaveRequest.count({ where: { importId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityType: 'wfh_request', action: 'delete', entityId: { in: made } } })).toBe(7);
      expect(await prisma.wfhRequest.count({ where: { id: recordedId } })).toBe(1);
      // its rows are free again
      expect([2, 3, 4, 5, 10, 11].map((n) => rowOf(v, n).status)).toEqual(Array(6).fill('ready'));
      await api().delete(`/api/leave/import/${importId}`).set('Cookie', superAdmin).expect(204);
    });
  });

  describe('the template’s Work from home (owner, 26 October 2026: "in the import leaves templete there is no working from home option")', () => {
    const M_TWFH = `${YEAR}-07`;
    let pair: [string, string];
    let leaveDay: string;
    let importId: string;

    beforeAll(async () => {
      await person('tess', `Tess Template ${TAG}`, '2024-01-01');
      const days = workDays(M_TWFH);
      const first = days.findIndex((d, i) => i > 3 && days[i + 1] === addDays(d, 1));
      pair = [days[first], days[first + 1]];
      leaveDay = days[0];
    });

    it('reads a Work from home row as work-from-home days, as a Zoho row is: a day each working day, not leave', async () => {
      const file = await templateWorkbook([
        { code: codes.tess, type: 'Annual leave', from: leaveDay, to: leaveDay }, // 2
        { code: codes.tess, type: 'Work from home', from: pair[0], to: pair[1] }, // 3: 2 days
      ]);
      const v = (await upload(file, `Template WFH ${TAG}.xlsx`)).body as View;
      importId = v.id;
      expect(v.source).toBe('template');
      expect(rowOf(v, 2)).toMatchObject({ status: 'ready', wfh: false, type: { nameEn: 'Annual leave' }, days: 1 });
      expect(rowOf(v, 3)).toMatchObject({ status: 'ready', wfh: true, type: null, pending: false, days: 2, wfhDays: pair });
      expect(await prisma.wfhRequest.count({ where: { importId } })).toBe(0);
    });

    it('takes its other spellings, whatever the case; a half day is a whole work-from-home day, said so; the Zoho path’s checks apply', async () => {
      const days = workDays(M_TWFH);
      const later = days.filter((d) => d > addDays(pair[1], 8));
      const file = await templateWorkbook([
        { code: codes.tess, type: 'wfh', from: later[0], to: later[0] }, // 2
        { code: codes.tess, type: 'WORKING FROM HOME', from: later[3], to: later[3], days: 0.5 }, // 3: a half day
        { code: codes.tess, type: 'عمل من المنزل', from: later[6], to: later[6] }, // 4
        { code: codes.tess, type: 'Work from home', from: later[6], to: later[6] }, // 5: the same day as row 4
        { code: codes.tess, type: 'Work from home', from: `${YEAR}-07-01`, to: `${YEAR + 2}-07-01` }, // 6: longer than a row may cover
        { code: codes.tess, type: 'Work from home', from: `${YEAR - 3}-01-04`, to: `${YEAR - 3}-01-04` }, // 7: before the employment
      ]);
      const v = (await upload(file, `Template WFH spellings ${TAG}.xlsx`)).body as View;
      for (const n of [2, 3, 4]) expect(rowOf(v, n)).toMatchObject({ status: 'ready', wfh: true, type: null, days: 1 });
      expect(rowOf(v, 3).warnings).toContain(`${shown(later[3])} is a half day in the file: a work-from-home day is a whole day here, so it is counted as one.`);
      expect(rowOf(v, 5)).toMatchObject({ status: 'duplicate', wfh: true, reasons: [`Already a work-from-home day on ${shown(later[6])} in row 4 of the file.`] });
      expect(rowOf(v, 6)).toMatchObject({ status: 'problem', wfh: true });
      expect(rowOf(v, 6).reasons[0]).toMatch(/^A work-from-home row covers at most \d+ days/);
      expect(rowOf(v, 7)).toMatchObject({ status: 'problem', wfh: true });
    });

    it('applies: 1 leave and 1 approved work-from-home request each day, no balance used; undoing removes both', async () => {
      const before = (await balances('tess')).annual;
      const v = (await apply(importId).expect(200)).body as View;
      expect(v.kept).toEqual({ leaves: 1, adjustments: 0, wfhDays: 2 });
      const made = await prisma.wfhRequest.findMany({ where: { importId }, orderBy: { date: 'asc' }, select: { id: true, employeeId: true, status: true, date: true, zohoLinkId: true } });
      expect(made.map((w) => [w.employeeId, w.status, fromDateOnly(w.date)])).toEqual(pair.map((d) => [ids.tess, 'approved', d]));
      expect(rowOf(v, 3)).toMatchObject({ status: 'applied', wfh: true, days: 2, wfhDays: pair });
      expect(await prisma.leaveRequest.count({ where: { importId } })).toBe(1);
      // the leave takes one day from the annual balance, the work-from-home days nothing
      const after = (await balances('tess')).annual;
      expect(before.available - after.available).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityType: 'wfh_request', action: 'import', entityId: { in: made.map((w) => w.id) } } })).toBe(2);
      const undone = (await undo(importId).expect(200)).body as View;
      expect(undone.kept).toEqual({ leaves: 0, adjustments: 0, wfhDays: 0 });
      expect(await prisma.wfhRequest.count({ where: { importId } })).toBe(0);
      expect(await prisma.leaveRequest.count({ where: { importId } })).toBe(0);
      expect((await balances('tess')).annual.available).toBe(before.available);
    });
  });

  describe('the payroll', () => {
    let approvedRun: string;
    let draftRun: string;
    let importId: string;
    let approvedLineBefore: Line;
    let absent: string;

    beforeAll(async () => {
      for (const m of [M_APPROVED, M_DRAFT]) await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(m)) } });
      approvedRun = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: M_APPROVED }).expect(201)).body.id;
      runs.push(approvedRun);
      await prisma.payrollRun.update({ where: { id: approvedRun }, data: { status: 'approved', submittedAt: new Date(), approvedAt: new Date() } });
      approvedLineBefore = await lineOf(approvedRun, 'zara');
      draftRun = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: M_DRAFT }).expect(201)).body.id;
      runs.push(draftRun);
      // Zoho's attendance for March: a day worked, then a day absent, for Zara and Xena
      const [worked, off] = workDays(M_DRAFT);
      absent = off;
      const file = await zohoWorkbook([
        { id: ZARA_ZOHO, name: `Zara Zoho ${TAG}`, days: [{ date: worked, in: '09:00', out: '18:00' }, { date: off, status: 'Absent' }] },
        { id: XENA_ZOHO, name: `Xena Payroll ${TAG}`, days: [{ date: worked, in: '09:00', out: '18:00' }, { date: off, status: 'Absent' }] },
      ]);
      const zohoImport = (await api().post(`/api/payroll/runs/${draftRun}/attendance-imports`).set('Cookie', hr).attach('files', file, 'attendance.xlsx').expect(201)).body.id;
      await api().post(`/api/payroll/runs/${draftRun}/attendance-imports/${zohoImport}/apply`).set('Cookie', hr).expect(200);
    });

    it('a Zoho absent day is a no-show on the draft until the leave on it is imported; the review says how many will move', async () => {
      const zara = await lineOf(draftRun, 'zara');
      expect(zara.inputs.noShowDays).toBe(1);
      expect(zara.attendanceImport).toMatchObject({ source: 'zoho' });
      expect(zara.result.noShowCut).toBe(1000);
      const approvedDay = workDays(M_APPROVED)[2];
      const v = (
        await upload(
          await templateWorkbook([
            { code: codes.zara, type: 'Annual leave', from: absent, to: absent }, // 2
            { code: codes.xena, type: 'Unpaid leave', from: absent, to: absent }, // 3
            { code: codes.zara, type: 'Annual leave', from: approvedDay, to: approvedDay }, // 4: an approved month
          ]),
          `Payroll leave ${TAG}.xlsx`,
        )
      ).body as View;
      importId = v.id;
      expect(v.noShowsToLeave).toEqual({
        days: 2,
        people: 2,
        text: 'These days were no-shows on a draft payroll and will count as leave once applied (a refresh of the payroll does the same): 2 days, 2 people.',
      });
      expect(rowOf(v, 2).notes).toContain(`1 of its days is a no-show on the March ${YEAR} draft payroll now: it counts as leave once applied, not a no-show.`);
      expect(rowOf(v, 3).notes).toContain(`Its unpaid days are cut from the March ${YEAR} draft payroll once applied, as recorded leave is.`);
      expect(rowOf(v, 4).notes).toEqual([`Counted in no payroll: the February ${YEAR} payroll is already approved.`]);
    });

    it('applied: the day is leave, not a no-show, paid leave costs nothing and unpaid leave a day; the approved month is untouched; a refresh keeps it so', async () => {
      await apply(importId).expect(200);
      const zara = await lineOf(draftRun, 'zara');
      expect(zara.inputs.noShowDays).toBe(0);
      expect(zara.terms.leave).toEqual({ paidDays: 1, unpaidDays: 0 });
      expect(zara.result.noShowCut).toBe(0);
      const xena = await lineOf(draftRun, 'xena');
      expect(xena.inputs.noShowDays).toBe(0);
      expect(xena.terms.leave).toEqual({ paidDays: 0, unpaidDays: 1 });
      expect(xena.result.noShowCut).toBe(0);
      expect(xena.result.unpaidLeaveCut).toBe(500);
      // a run past its draft never changes (owner's brief, 21 October 2026)
      expect(await lineOf(approvedRun, 'zara')).toEqual(approvedLineBefore);
      await api().post(`/api/payroll/runs/${draftRun}/refresh`).set('Cookie', hr).expect(200);
      expect((await lineOf(draftRun, 'zara')).inputs.noShowDays).toBe(0);
      expect((await lineOf(draftRun, 'xena')).terms.leave).toEqual({ paidDays: 0, unpaidDays: 1 });
    });

    it('undo is refused while a payroll counting the leave is past its draft; once it is a draft again, the no-shows are back', async () => {
      await prisma.payrollRun.update({ where: { id: draftRun }, data: { status: 'approved', submittedAt: new Date(), approvedAt: new Date() } });
      expect(said(await undo(importId).expect(409))).toEqual([`This import can't be undone: its leave is counted in the March ${YEAR} payroll, which isn’t a draft any more.`]);
      await prisma.payrollRun.update({ where: { id: draftRun }, data: { status: 'draft', submittedAt: null, approvedAt: null } });
      await undo(importId).expect(200);
      const zara = await lineOf(draftRun, 'zara');
      expect(zara.inputs.noShowDays).toBe(1);
      expect(zara.terms.leave).toBeUndefined();
      expect(await lineOf(approvedRun, 'zara')).toEqual(approvedLineBefore);
    });
  });
});
