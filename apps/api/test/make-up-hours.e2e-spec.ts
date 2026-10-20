import type { INestApplication } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zonedMoment } from '@trendlix/shared';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { zohoWorkbook, type ZohoTestDay } from './fixtures/zoho.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// Make-up hours (owner, 20 October 2026, asked "if an employee failed to complete 9 hours in a da, can he work extra
// hours next day ? to raise his average?" and choosing within the same month: "within the same month with no working
// hours to be counted after 8 PM even if the check out was 11 PM / record the checkout time but count till the checkout
// window limit"): a shift's "Count hours until" (HR or Admin, validated, audited, kept by the database, 8:00 PM on the
// MORNING shift by the migration); a month of short and long days from Zoho People's daily entries giving full
// attendance on payroll; a day HR corrects counted until the limit; the check-in counter's shift. These tests look at
// their own people and shifts (names end with RUN) and delete what they made. Every name is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
const MONTH = monthsLater(CURRENT, -10); // its days are past; a draft run
const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const SCHEMA = 'migration_check_count_until';

const said = (res: { body: { message: string | string[] } }) => [...new Set(([] as string[]).concat(res.body.message))];

interface ShiftView {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  hoursPerDay: number | null;
  countUntil: string | null;
}

interface Line {
  employeeId: string;
  terms: { makeUpHours?: boolean; expectedHours: number | null };
  inputs: { workedHours: number | null; noShowDays: number | null };
  result: { expectedHours: number | null; attendanceRatio: number | null; attendanceCut: number; hoursOverExpected?: number; overtime: number };
  attendanceImport: { source: string } | null;
}

interface PersonMonth {
  person: {
    figures: { hoursCounted: number; shortHours: number; extraHours: number; shortHoursFilled: number };
    days: { date: string; source: string; checkIn: string | null; checkOut: string | null; hoursCounted: number; shortHours: number; extraHours: number }[];
  };
}

describe('Make-up hours (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let finance: string;
  let employee: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let runId: string;
  const shifts: string[] = [];
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const work: string[] = []; // the month's Sundays to Thursdays, none of them a holiday
  const api = () => request(app.getHttpServer());
  const code = (letter: string) => `${letter}${RUN}`.slice(0, 10).toUpperCase();

  /** A profile with a sign-in, on `shiftId` from two months before MONTH, under a signed contract. */
  async function person(key: string, name: string, shiftId: string) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(MONTH, -2)), departmentId: deptId, shiftId })
      .expect(201);
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 15000, durationMonths: 24 }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  const lineOf = async (key: string) => ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;
  const monthOf = async (key: string) => (await api().get(`/api/attendance/employees/${ids[key]}?month=${MONTH}`).set('Cookie', hr).expect(200)).body as PersonMonth;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    employee = await signIn(app, await createUser(prisma, ['employee']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Make-up Hours ${RUN}` }).expect(201)).body.id;
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(MONTH); d <= lastDay(MONTH); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work.push(d);
  });

  afterAll(async () => {
    if (runId) await prisma.payrollRun.deleteMany({ where: { id: runId } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceCorrection.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: { in: shifts } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('a shift’s "Count hours until"', () => {
    let shift: ShiftView;
    const patch = (body: object, session = hr) => api().patch(`/api/shifts/${shift.id}`).set('Cookie', session).send(body);

    it('is set by HR on a new shift and shown with it; a shift without it has none', async () => {
      shift = (await api().post('/api/shifts').set('Cookie', hr).send({ code: code('U'), startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15, countUntil: '20:00' }).expect(201))
        .body as ShiftView;
      shifts.push(shift.id);
      expect(shift).toMatchObject({ startTime: '09:00', endTime: '19:00', hoursPerDay: 9, countUntil: '20:00' });
      expect((await api().get(`/api/shifts/${shift.id}`).set('Cookie', employee).expect(200)).body.countUntil).toBe('20:00');
      expect(((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as ShiftView[]).find((s) => s.id === shift.id)?.countUntil).toBe('20:00');
      const plain = (await api().post('/api/shifts').set('Cookie', hr).send({ code: code('V'), startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 }).expect(201)).body as ShiftView;
      shifts.push(plain.id);
      expect(plain.countUntil).toBeNull();
    });

    it('is at or after the shift’s end, the same day: refused before it, as a time not written HH:MM, and when the end moves past it', async () => {
      const post = (countUntil: unknown) => api().post('/api/shifts').set('Cookie', hr).send({ code: code('W'), startTime: '09:00', endTime: '19:00', countUntil });
      expect(said(await post('18:30').expect(400))).toEqual(['Choose a "Count hours until" time at or after the shift ends, 7:00 PM, and before midnight.']);
      for (const bad of ['8 PM', '24:00', '', 20]) expect(said(await post(bad).expect(400))).toEqual(['Use 24-hour time for the time hours count until, e.g. 20:00, or leave it empty.']);
      expect(said(await patch({ countUntil: '18:00' }).expect(400))).toEqual(['Choose a "Count hours until" time at or after the shift ends, 7:00 PM, and before midnight.']);
      // the time kept, 8:00 PM, is before an end at 9:00 PM: refused unless it moves too
      expect(said(await patch({ endTime: '21:00' }).expect(400))).toEqual(['Choose a "Count hours until" time at or after the shift ends, 9:00 PM, and before midnight.']);
      expect((await api().get(`/api/shifts/${shift.id}`).set('Cookie', hr).expect(200)).body).toMatchObject({ endTime: '19:00', countUntil: '20:00' });
      // at the end itself is allowed
      expect((await patch({ countUntil: '19:00' }).expect(200)).body.countUntil).toBe('19:00');
    });

    it('is changed by HR or an Admin only, cleared with null', async () => {
      for (const session of [employee, finance]) {
        await patch({ countUntil: '21:00' }, session).expect(403);
        await api().post('/api/shifts').set('Cookie', session).send({ code: code('X'), startTime: '09:00', endTime: '19:00', countUntil: '20:00' }).expect(403);
      }
      expect((await patch({ countUntil: '21:00' }, admin).expect(200)).body.countUntil).toBe('21:00');
      expect((await patch({ countUntil: null }).expect(200)).body.countUntil).toBeNull();
      // not sent: kept as it is
      await patch({ countUntil: '20:00' }).expect(200);
      expect((await patch({ graceMinutes: 15 }).expect(200)).body.countUntil).toBe('20:00');
    });

    it('is in the audit log with every change, and the database keeps it at or after the end', async () => {
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'shift', entityId: shift.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'update', 'update', 'update']);
      expect(audit[0].diff).toMatchObject({ countUntil: '20:00' });
      expect(audit.slice(1).map((a) => a.diff)).toEqual([
        { countUntil: { from: '20:00', to: '19:00' } },
        { countUntil: { from: '19:00', to: '21:00' } },
        { countUntil: { from: '21:00', to: null } },
        { countUntil: { from: null, to: '20:00' } },
      ]);
      await expect(prisma.$executeRaw`UPDATE shifts SET count_until = '18:00' WHERE id = ${shift.id}::uuid`).rejects.toThrow(/shifts_count_until_check/);
    });
  });

  describe('the migration', () => {
    let db: pg.Client;

    beforeAll(async () => {
      db = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      assertTestDatabase((await db.query<{ name: string }>('SELECT current_database() AS name')).rows[0].name);
    });

    afterAll(async () => {
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await db.end();
    });

    it('sets the MORNING shift (any case) to 8:00 PM, every other shift none, and one ending after 8 PM as it was', async () => {
      const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_shift_count_until'))!;
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((x) => /^\d{14}_/.test(x) && x < migration).sort()) await db.query(readFileSync(`${MIGRATIONS}${m}/migration.sql`, 'utf8'));
      await db.query(`
        INSERT INTO shifts (id, code, start_time, end_time, hours_per_day, updated_at) VALUES
          (gen_random_uuid(), 'Morning', '09:00', '19:00', 9, now()),
          (gen_random_uuid(), 'MORNING', '13:00', '21:00', NULL, now()),
          (gen_random_uuid(), 'A', '09:00', '18:00', NULL, now());
      `);
      await db.query(readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8'));
      expect((await db.query('SELECT code, count_until::text FROM shifts ORDER BY end_time')).rows).toEqual([
        { code: 'A', count_until: null },
        { code: 'Morning', count_until: '20:00:00' },
        { code: 'MORNING', count_until: null },
      ]);
      await expect(db.query("UPDATE shifts SET count_until = '17:59' WHERE code = 'A'")).rejects.toThrow(/shifts_count_until_check/);
      await db.query("UPDATE shifts SET count_until = '23:30' WHERE code = 'A'");
      await db.query("UPDATE shifts SET start_time = '22:00', end_time = '06:00', count_until = '08:00' WHERE code = 'A'");
      await expect(db.query("UPDATE shifts SET count_until = '22:30' WHERE code = 'A'")).rejects.toThrow(/shifts_count_until_check/);
    });
  });

  describe('a month with short and long days', () => {
    // the same days for both: a short day (11:00 AM to 6:00 PM, 7 hours) then a long one (9:00 AM to 9:30 PM, counted
    // until 8:00 PM: 11 hours), each pair making two days' 18 hours; an odd day out 9:00 AM to 6:00 PM
    const days = (): ZohoTestDay[] =>
      work.map((date, i) => (i === work.length - 1 && work.length % 2 ? { date, in: '09:00', out: '18:00' } : i % 2 === 0 ? { date, in: '11:00', out: '18:00' } : { date, in: '09:00', out: '21:30' }));
    const pairs = () => Math.floor(work.length / 2);

    beforeAll(async () => {
      await person('maya', 'Maya Makeup', shifts[0]);
      await person('nour', 'Nour Nolimit', shifts[1]);
      if (await prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(MONTH)) } })) throw new Error(`A payroll run for ${MONTH} is left by another test.`);
      runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body.id;
    });

    it('counts Zoho’s long days until 8:00 PM, keeping the real check-out, and gives full attendance on payroll', async () => {
      const file = await zohoWorkbook([
        { id: `81-${RUN}`, name: `Maya Makeup ${RUN}`, days: days() },
        { id: `82-${RUN}`, name: `Nour Nolimit ${RUN}`, days: days() },
      ]);
      const made = (await api().post(`/api/payroll/runs/${runId}/attendance-imports`).set('Cookie', hr).attach('files', file, 'month.xlsx').expect(201)).body as {
        id: string;
        people: { zohoName: string; month: { hoursCounted: number; days: { hoursCounted: number }[] } | null }[];
      };
      const maya = made.people.find((p) => p.zohoName === `Maya Makeup ${RUN}`)!.month!;
      const nour = made.people.find((p) => p.zohoName === `Nour Nolimit ${RUN}`)!.month!;
      expect(maya.days.slice(0, 2).map((d) => d.hoursCounted)).toEqual([7, 11]);
      expect(nour.days.slice(0, 2).map((d) => d.hoursCounted)).toEqual([7, 9]);
      expect(maya.hoursCounted).toBe(9 * work.length);
      await api().post(`/api/payroll/runs/${runId}/attendance-imports/${made.id}/apply`).set('Cookie', hr).expect(200);

      // the long days fill the short ones: the month's expected hours, full attendance
      const line = await lineOf('maya');
      expect(line.terms).toMatchObject({ makeUpHours: true, expectedHours: 9 * work.length });
      expect(line.inputs.workedHours).toBe(9 * work.length);
      expect(line.result).toMatchObject({ expectedHours: 9 * work.length, attendanceRatio: 1, attendanceCut: 0, overtime: 0 });
      // without the limit the long days count 9: short by 2 hours each pair, below the 90% grace with 22 working days
      const plain = await lineOf('nour');
      expect('makeUpHours' in plain.terms).toBe(false);
      expect(plain.inputs.workedHours).toBe(9 * work.length - 2 * pairs());
      expect(plain.result.attendanceRatio).toBeCloseTo((9 * work.length - 2 * pairs()) / (9 * work.length), 6);

      // Daily Attendance: the long days' extra time, and the short hours it fills
      const month = await monthOf('maya');
      const long = month.person.days.find((d) => d.date === work[1])!;
      expect(long).toMatchObject({ hoursCounted: 11, shortHours: 0, extraHours: 2 });
      // the real check-out kept: 9:30 PM in Cairo
      expect(long.checkOut).toBe(new Date(zonedMoment(work[1], '21:30')).toISOString());
      expect(month.person.figures).toMatchObject({ shortHours: 2 * pairs(), extraHours: 2 * pairs(), shortHoursFilled: 2 * pairs() });
      expect((await monthOf('nour')).person.figures).toMatchObject({ shortHours: 2 * pairs(), extraHours: 0, shortHoursFilled: 0 });
    });

    it('counts a day HR corrects until 8:00 PM too, and the month is capped at the expected hours while overtime isn’t paid', async () => {
      // a short day (7 hours) corrected to 9:00 AM to 10:00 PM: 11 hours counted, the check-out kept at 10:00 PM
      const res = await api()
        .post('/api/attendance/corrections')
        .set('Cookie', hr)
        .send({ employeeId: ids.maya, date: work[0], kind: 'wrong_time', checkIn: '09:00', checkOut: '22:00', reason: 'Stayed for the launch' })
        .expect(201);
      expect(res.body.status).toBe('approved');
      const day = (await monthOf('maya')).person.days.find((d) => d.date === work[0])!;
      expect(day).toMatchObject({ source: 'correction', hoursCounted: 11, extraHours: 2, shortHours: 0 });
      expect([day.checkIn, day.checkOut]).toEqual([new Date(zonedMoment(work[0], '09:00')).toISOString(), new Date(zonedMoment(work[0], '22:00')).toISOString()]);
      // 4 hours more than the month's expected hours: counted at most them, the rest left out, no overtime
      const line = await lineOf('maya');
      expect(line.attendanceImport?.source).toBe('attendance');
      expect(line.inputs.workedHours).toBe(9 * work.length + 4);
      expect(line.result).toMatchObject({ attendanceRatio: 1, hoursOverExpected: 4, overtime: 0 });
    });
  });

  describe('the check-in counter’s shift', () => {
    it('sends the time hours count until with today’s shift, none on a shift without it', async () => {
      const today = async (key: string) => (await api().get('/api/me/attendance/today').set('Cookie', sessions[key]).expect(200)).body as { shift: { countUntil: string | null } | null };
      expect((await today('maya')).shift).toMatchObject({ startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15, countUntil: '20:00' });
      expect((await today('nour')).shift?.countUntil).toBeNull();
    });
  });
});
