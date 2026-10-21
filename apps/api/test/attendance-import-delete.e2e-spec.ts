import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { zohoWorkbook } from './fixtures/zoho.js';
import { createApp, createUser, signIn } from './helpers.js';

// Deleting an attendance import (asked, 21 October 2026: "how to delete previous imports"), a Super Admin's only, like
// every deletion (owner's decision, 15 October 2026), on a draft run: one not applied goes with its files; one applied is
// refused unless undone first (?undo=1, Undo and delete), which puts back every line it filled, the C-level person's the
// CEO fills too, and removes the days it kept, a line filled from the attendance days taking the days left. Everyone and
// every workbook here is invented (test/fixtures/zoho.ts); the people's names end with RUN, and the tests delete what
// they made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const MONTH = monthsLater(CURRENT, -1); // last month: its days are past

interface Line {
  id: string;
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null; permissionHours: number | null };
  attendanceImport: { source: string; importId?: string; sources?: string[] } | null;
}

interface HistoryRow {
  id: string;
  files: { name: string; rows: number }[];
  kept: { lines: number; days: number };
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Deleting an attendance import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let admin: string;
  let superAdmin: string;
  let superAdminId: string;
  let hrSuper: string;
  let hrUserId: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let shiftId: string;
  let runId: string;
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const work: string[] = []; // the month's Sundays to Thursdays, none of them a holiday
  const api = () => request(app.getHttpServer());

  async function person(key: string, name: string, employment: Record<string, unknown> = {}, session = () => hr) {
    const created = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    people.push(created.body.id);
    ids[key] = created.body.id;
    const hired = await api()
      .post(`/api/employees/${created.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(CURRENT, -4)), departmentId: deptId, shiftId, ...employment })
      .expect(201);
    const draft = (await api().post(`/api/employees/${created.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', session()).send({ grossSalary: 15000, durationMonths: 24 }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session()).send({ signedOn: draft.startDate }).expect(200);
  }

  const imports = () => `/api/payroll/runs/${runId}/attendance-imports`;
  const upload = async (file: Buffer, name: string) =>
    (await api().post(imports()).set('Cookie', hr).attach('files', file, name).expect(201)).body.id as string;
  const remove = (importId: string, session: string, query = '') => api().delete(`${imports()}/${importId}${query}`).set('Cookie', session);
  const apply = (importId: string, session = hr) => api().post(`${imports()}/${importId}/apply`).set('Cookie', session).expect(200);
  const typeIn = (lineId: string, inputs: Record<string, number | null>, session = hr) =>
    api().patch(`/api/payroll/runs/${runId}/lines`).set('Cookie', session).send({ lines: [{ id: lineId, inputs }] }).expect(200);
  const lineOf = async (key: string, session = hr) =>
    ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', session).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;
  const history = async () => (await api().get(`/api/attendance/imports?month=${MONTH}`).set('Cookie', hr).expect(200)).body as HistoryRow[];

  // the people in the files, as Zoho spells them: the same names as their profiles
  const RANIA = `Rania Deleteme ${RUN}`;
  const CLEO = `Cleo Deleteme ${RUN}`; // C-level: the CEO fills her line
  const LINA = `Lina Deleteme ${RUN}`; // checks in on the system: her line is filled from her attendance days

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail }, select: { id: true } })).id;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    const superEmail = await createUser(prisma, ['super_admin']);
    superAdmin = await signIn(app, superEmail);
    superAdminId = (await prisma.user.findUniqueOrThrow({ where: { email: superEmail }, select: { id: true } })).id;
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Import delete ${RUN}` }).expect(201)).body.id;
    // 9 hours within 9:00–19:00, Sunday to Thursday
    shiftId = (
      await prisma.shift.create({
        data: { code: `D${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(MONTH); d <= lastDay(MONTH); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work.push(d);

    await person('rania', 'Rania Deleteme');
    await person('lina', 'Lina Deleteme');
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Deleteme', { gradeId: g9.id }, () => hrSuper);
    // Lina checks in on the system from the 9th working day: 9 hours that day
    await prisma.attendanceDay.create({
      data: {
        employeeId: ids.lina,
        date: toDateOnly(work[8]),
        status: 'worked',
        checkIn: new Date(`${work[8]}T06:00:00.000Z`),
        checkOut: new Date(`${work[8]}T15:00:00.000Z`),
        place: 'office',
        hoursCounted: 9,
        source: 'system',
        importedById: hrUserId,
      },
    });

    await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(MONTH)) } });
    runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: runId } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('an import not applied', () => {
    let importId: string;

    beforeAll(async () => {
      const file = await zohoWorkbook([
        {
          id: `81-${RUN}`,
          name: RANIA,
          days: [
            { date: work[0], in: '09:00', out: '18:00' },
            { date: work[1], status: 'Absent' },
          ],
        },
      ]);
      importId = await upload(file, `not-applied-${RUN}.xlsx`);
    });

    it('is a Super Admin’s to delete: HR, the CEO and Admin get 403, undo or not', async () => {
      for (const session of [hr, ceo, admin]) {
        expect(said(await remove(importId, session).expect(403))).toEqual(['Only a Super Admin can delete records.']);
        await remove(importId, session, '?undo=1').expect(403);
      }
      expect(await prisma.attendanceImport.findUnique({ where: { id: importId } })).not.toBeNull();
      // undo is 1 (or true), else left out
      await remove(importId, superAdmin, '?undo=maybe').expect(400);
    });

    it('goes with its files: nothing on the payroll changes, and one delete entry is in the audit log', async () => {
      const row = (await history()).find((r) => r.id === importId)!;
      expect(row.kept).toEqual({ lines: 0, days: 0 });
      const rania = await lineOf('rania');

      const done = (await remove(importId, superAdmin).expect(200)).body;
      expect(done).toEqual({ id: importId, runId, month: MONTH, undone: false, lines: 0, days: 0 });
      expect(await prisma.attendanceImport.findUnique({ where: { id: importId } })).toBeNull();
      expect((await history()).map((r) => r.id)).not.toContain(importId);
      await api().get(`${imports()}/${importId}`).set('Cookie', hr).expect(404);
      expect((await lineOf('rania')).inputs).toEqual(rania.inputs);
      await remove(importId, superAdmin).expect(404);

      const log = await prisma.auditLog.findMany({ where: { entityType: 'attendance_import', entityId: importId, action: 'delete' } });
      expect(log).toHaveLength(1);
      expect(log[0].userId).toBe(superAdminId);
      expect(log[0].diff).toEqual({ runId, month: MONTH, files: [`not-applied-${RUN}.xlsx`], rows: 2, people: 1, undone: false });
    });
  });

  describe('an import applied', () => {
    let importId: string;
    let days: number;
    let linaBefore: Line;

    beforeAll(async () => {
      // what was typed before: HR's for Rania, the CEO's for Cleo (C-level); Undo and delete puts them back
      await typeIn((await lineOf('rania')).id, { workedHours: 100 });
      await typeIn((await lineOf('cleo', ceo)).id, { workedHours: 120 }, ceo);
      const file = await zohoWorkbook([
        {
          id: `91-${RUN}`,
          name: RANIA,
          days: [
            { date: work[0], in: '09:00', out: '18:00' },
            { date: work[1], in: '09:00', out: '18:00' },
            { date: work[2], status: 'Absent' },
          ],
        },
        {
          id: `92-${RUN}`,
          name: CLEO,
          days: [
            { date: work[0], in: '09:00', out: '18:00' },
            { date: work[1], status: 'Absent' },
          ],
        },
        {
          id: `93-${RUN}`,
          name: LINA,
          days: [
            { date: work[0], in: '09:00', out: '18:00' },
            { date: work[1], in: '09:00', out: '18:00' },
          ],
        },
      ]);
      importId = await upload(file, `applied-${RUN}.xlsx`);
      // HR fills Rania's line (Lina's from her attendance days, now with the Zoho days in them), the CEO Cleo's
      await apply(importId);
      await apply(importId, ceo);
      days = await prisma.attendanceDay.count({ where: { importId } });
      linaBefore = await lineOf('lina');
    });

    it('is filled from on the payroll: its lines and days', async () => {
      expect((await lineOf('rania')).attendanceImport).toMatchObject({ source: 'zoho', importId });
      expect((await lineOf('cleo', ceo)).attendanceImport).toMatchObject({ source: 'zoho', importId });
      expect(linaBefore.attendanceImport).toMatchObject({ source: 'attendance' });
      expect(linaBefore.attendanceImport?.sources).toContain('zoho');
      expect(days).toBe(7);
      expect((await history()).find((r) => r.id === importId)!.kept).toEqual({ lines: 2, days: 7 });
    });

    it('is refused without undoing it first', async () => {
      expect(said(await remove(importId, superAdmin).expect(409))).toEqual([
        `The ${monthName(MONTH)} import is applied: 2 lines of the payroll are filled from it and 7 days of attendance are kept from it. Undo it first, or undo and delete it.`,
      ]);
      await remove(importId, superAdmin, '?undo=0').expect(409);
      expect(await prisma.attendanceImport.findUnique({ where: { id: importId } })).not.toBeNull();
      expect((await lineOf('rania')).attendanceImport?.importId).toBe(importId);
    });

    it('is undone and deleted with ?undo=1: every line it filled is back, the C-level one too, and its days are gone', async () => {
      const done = (await remove(importId, superAdmin, '?undo=1').expect(200)).body;
      expect(done).toEqual({ id: importId, runId, month: MONTH, undone: true, lines: 3, days: 7 });

      // Rania's back to HR's figures, Cleo's to the CEO's (the Super Admin acts for every line, not only HR's)
      const rania = await lineOf('rania');
      expect(rania.inputs).toMatchObject({ workedHours: 100, noShowDays: null, permissionHours: null });
      expect(rania.attendanceImport).toBeNull();
      const cleo = await lineOf('cleo', ceo);
      expect(cleo.inputs).toMatchObject({ workedHours: 120, noShowDays: null });
      expect(cleo.attendanceImport).toBeNull();
      // Lina's filled again from the days left: her check-in on the system, not Zoho's two days of 9 hours
      const lina = await lineOf('lina');
      expect(lina.attendanceImport).toMatchObject({ source: 'attendance', sources: ['system'] });
      expect(lina.inputs.workedHours).toBeCloseTo(9, 6);
      expect(linaBefore.inputs.workedHours! - lina.inputs.workedHours!).toBeCloseTo(18, 6);

      // its days gone, everyone's; the day checked in on the system stays
      expect(await prisma.attendanceDay.count({ where: { employeeId: { in: people }, source: 'zoho' } })).toBe(0);
      expect(await prisma.attendanceDay.count({ where: { employeeId: ids.lina, source: 'system', date: toDateOnly(work[8]) } })).toBe(1);
      // the import and its files gone
      expect(await prisma.attendanceImport.findUnique({ where: { id: importId } })).toBeNull();
      expect((await history()).map((r) => r.id)).not.toContain(importId);

      const log = await prisma.auditLog.findMany({ where: { entityType: 'attendance_import', entityId: importId, action: 'delete' } });
      expect(log).toHaveLength(1);
      expect(log[0].userId).toBe(superAdminId);
      expect(log[0].diff).toEqual({ runId, month: MONTH, files: [`applied-${RUN}.xlsx`], rows: 7, people: 3, undone: true, lines: 3, days: 7 });
      // each line put back is in the audit log too, as Undo writes it
      const lines = await prisma.auditLog.findMany({ where: { entityType: 'payroll_line', entityId: { in: [rania.id, cleo.id] }, userId: superAdminId } });
      expect(lines).toHaveLength(2);
      for (const id of [rania.id, cleo.id]) expect(lines.find((l) => l.entityId === id)?.diff).toMatchObject({ source: 'zoho', importId, undone: true });
    });
  });

  describe('on a payroll that isn’t a draft', () => {
    it('is refused with the CEO, approved or paid, and deleted once it is a draft again', async () => {
      const importId = await upload(await zohoWorkbook([{ id: `99-${RUN}`, name: RANIA, days: [{ date: work[0], in: '09:00', out: '18:00' }] }]), `locked-${RUN}.xlsx`);
      try {
        for (const status of ['pending_ceo', 'approved', 'paid']) {
          await prisma.payrollRun.update({ where: { id: runId }, data: { status } });
          expect(said(await remove(importId, superAdmin).expect(409))).toEqual([`The ${monthName(MONTH)} payroll isn't a draft any more, so its attendance import can't be deleted.`]);
          await remove(importId, superAdmin, '?undo=1').expect(409);
        }
      } finally {
        await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'draft' } });
      }
      expect(await prisma.attendanceImport.findUnique({ where: { id: importId } })).not.toBeNull();
      await remove(importId, superAdmin).expect(200);
      expect(await prisma.attendanceImport.findUnique({ where: { id: importId } })).toBeNull();
    });
  });
});
