import type { INestApplication } from '@nestjs/common';
import { EXPECTED_HOURS_NOT_TYPED, NO_SHIFT_NO_EXPECTED_HOURS, type PayrollInputs, type PayrollResult, type PayrollTerms } from '@trendlix/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// Payroll Setup (owner's request, 16 October 2026: "creating a setup page for payroll to enter the variables that might
// affect the sheet"): the official holidays and who keeps them, the payday, the basic share of the gross new contracts
// start with, and the expected hours a run works out from each monthly-paid person's shift less the holidays, which HR
// can't type over (owner, 20 October 2026: "expected hours to be locked based on shifts and attendance data"). Other test files leave people with signed contracts in the same database, so these tests look at
// their own people (names end with RUN). The run is for last month, counted from today in Cairo. Every name and
// holiday is invented.

const RUN = Date.now().toString(36).toLowerCase();
/** A flexible shift of this run's: 9 hours to work within 9:00 AM to 7:00 PM. */
const FLEXIBLE = `FX${RUN.slice(-6).toUpperCase()}`;
const ONLY_SUPER_ADMIN_DELETES = 'Only a Super Admin can delete records.';
const CURRENT = todayInCairo().slice(0, 7);
/** The run's month: last month. */
const MONTH = monthsLater(CURRENT, -1);
/** Employed well before the run's month. */
const JOINED = firstDay(monthsLater(CURRENT, -3));
/** Joined on the 12th of the run's month. */
const JOINER = `${MONTH}-12`;

interface Holiday {
  id: string;
  date: string;
  nameEn: string;
  nameAr: string | null;
}

interface Line {
  id: string;
  employeeId: string;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
}

interface Run {
  id: string;
  rules: Record<string, unknown>;
  lines: Line[];
}

interface Person {
  id: string;
  employmentId: string;
}

/** The days from `from` to `to` (YYYY-MM-DD, both included) that are one of `weekdays` (0 = Sunday … 6 = Saturday). */
function daysOn(weekdays: readonly number[], from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (weekdays.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** A ratio as payrollLine rounds it. */
const fraction = (v: number) => Math.round(v * 1e10) / 1e10;

/** A refusal's messages, each once: a value of the wrong type fails each of a field's checks with the same message. */
const messagesOf = (res: request.Response) => [...new Set([res.body.message].flat() as string[])];

describe('Payroll Setup (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let finance: string;
  let ceo: string;
  let superAdmin: string;
  let staff: string;
  let manager: string;
  let departmentId: string;
  let shiftA: { id: string; startTime: string; endTime: string; workingDays: number[] };
  /** Everyone hired here: removed at the end, so the files after this one don't find them (template previews list 50). */
  const hired: string[] = [];
  const api = () => request(app.getHttpServer());

  const holidays = (query = '', session = hr) => api().get(`/api/payroll/holidays${query}`).set('Cookie', session);
  const addHoliday = (body: object, session = hr) => api().post('/api/payroll/holidays').set('Cookie', session).send(body);
  const changeHoliday = (id: string, body: object, session = hr) => api().patch(`/api/payroll/holidays/${id}`).set('Cookie', session).send(body);
  const removeHoliday = (id: string, session = superAdmin) => api().delete(`/api/payroll/holidays/${id}`).set('Cookie', session);
  const settings = (body: object, session = hr) => api().patch('/api/payroll/settings').set('Cookie', session).send(body);
  const contractSettings = (body: object, session = hr) => api().patch('/api/contract-settings').set('Cookie', session).send(body);
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });

  async function hire(name: string, employment: Record<string, unknown> = {}): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const made = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId, ...employment })
      .expect(201);
    hired.push(person.body.id);
    return { id: person.body.id, employmentId: made.body.employment.id };
  }

  const postContract = (p: Person, body: object) => api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send(body);

  async function signed(p: Person, body: object = {}) {
    const draft = (await postContract(p, { grossSalary: 12000, ...body }).expect(201)).body as { id: string; startDate: string; basicPercent: number };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    return draft;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    manager = await signIn(app, await createUser(prisma, ['employee', 'manager']));
    await prisma.payrollRun.deleteMany();
    await prisma.holiday.deleteMany();
    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Setup ${RUN}` }).expect(201)).body.id;
    const shifts = (await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as (typeof shiftA & { code: string })[];
    shiftA = shifts.find((s) => s.code === 'A')!;
  });

  afterAll(async () => {
    // runs keep their people on record: remove them so other test files can delete theirs
    await prisma.payrollRun.deleteMany();
    await prisma.employee.deleteMany({ where: { id: { in: hired } } });
    await prisma.holiday.deleteMany();
    await prisma.shift.deleteMany({ where: { code: FLEXIBLE } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { payday: null, payOvertime: false } });
    await prisma.contractSettings.update({ where: { id: 1 }, data: { basicPercentDefault: 80 } });
    await app.close();
  });

  describe('holidays', () => {
    let eid: Holiday;

    it('HR and Admin add them; Finance, the CEO, a manager and staff don’t', async () => {
      for (const session of [finance, ceo, manager, staff]) await addHoliday({ date: '2031-04-25', nameEn: 'Sinai Liberation Day' }, session).expect(403);
      eid = (await addHoliday({ date: '2031-03-21', nameEn: '  Eid al-Fitr  ', nameAr: ' عيد الفطر ' }).expect(201)).body as Holiday;
      expect(eid).toEqual({ id: expect.any(String), date: '2031-03-21', nameEn: 'Eid al-Fitr', nameAr: 'عيد الفطر' });
      const sinai = (await addHoliday({ date: '2031-04-25', nameEn: 'Sinai Liberation Day', nameAr: '' }, admin).expect(201)).body as Holiday;
      expect(sinai.nameAr).toBeNull();
      await addHoliday({ date: '2030-12-31', nameEn: 'An invented holiday' }).expect(201);
      expect((await auditOf('holiday', eid.id)).map((a) => [a.action, a.diff])).toEqual([['create', { date: '2031-03-21', nameEn: 'Eid al-Fitr', nameAr: 'عيد الفطر' }]]);
    });

    it('every signed-in user reads them, a year’s or all, in date order: the employee and the manager too, for their dashboard', async () => {
      // owner, 17 October 2026: "the dashboard may contain the data he might need such as Holidays"; not sensitive
      for (const session of [hr, finance, ceo, admin, superAdmin, manager, staff]) {
        expect(((await holidays('?year=2031', session).expect(200)).body as Holiday[]).map((h) => h.date)).toEqual(['2031-03-21', '2031-04-25']);
      }
      expect(((await holidays().expect(200)).body as Holiday[]).map((h) => h.date)).toEqual(['2030-12-31', '2031-03-21', '2031-04-25']);
      expect((await holidays('?year=2032').expect(200)).body).toEqual([]);
      // the same day, its names, nothing else
      expect((await holidays('?year=2031', staff).expect(200)).body).toEqual([
        { id: eid.id, date: '2031-03-21', nameEn: 'Eid al-Fitr', nameAr: 'عيد الفطر' },
        { id: expect.any(String), date: '2031-04-25', nameEn: 'Sinai Liberation Day', nameAr: null },
      ]);
      for (const session of [manager, staff]) expect(messagesOf(await holidays('?year=abc', session).expect(400))).toEqual(['Choose a year from 2000 to 2100.']);
      // still a signed-in user's: nobody else
      await api().get('/api/payroll/holidays?year=2031').expect(401);
      for (const year of ['abc', '1999', '2101', '2031.5']) {
        expect(messagesOf(await holidays(`?year=${year}`).expect(400))).toEqual(['Choose a year from 2000 to 2100.']);
      }
    });

    it('refuses a day that isn’t one, a name left out, a year out of range and a second holiday on a day', async () => {
      const refused = async (body: object) => (await addHoliday(body).expect(400)).body.message as string[];
      expect(await refused({ date: '2031-02-30', nameEn: 'Not a day' })).toEqual(["Enter the holiday's date, as YYYY-MM-DD."]);
      expect(await refused({ date: '30/04/2031', nameEn: 'Not a day' })).toEqual(["Enter the holiday's date, as YYYY-MM-DD."]);
      expect(await refused({ date: '2031-05-01', nameEn: '   ' })).toEqual(["Enter the holiday's name in English."]);
      expect(await refused({ date: '2031-05-01' })).toContain("Enter the holiday's name in English.");
      expect(await refused({ date: '2031-05-01', nameEn: 'x'.repeat(101) })).toEqual(['Keep the name to 100 characters or fewer.']);
      expect((await addHoliday({ date: '1999-05-01', nameEn: 'Too early' }).expect(400)).body.message).toBe('Choose a date from 2000 to 2100.');
      await addHoliday({ date: '2031-05-01', nameEn: 'Labour Day', unknown: true }).expect(400);
      expect((await addHoliday({ date: '2031-03-21', nameEn: 'Another' }).expect(409)).body.message).toBe('There is already a holiday on 21/03/2031: Eid al-Fitr.');
    });

    it('HR and Admin change them, each change in the audit log; not onto a day that has one', async () => {
      for (const session of [finance, ceo, manager, staff]) await changeHoliday(eid.id, { nameEn: 'Eid' }, session).expect(403);
      const moved = (await changeHoliday(eid.id, { date: '2031-03-22', nameAr: '' }).expect(200)).body as Holiday;
      expect(moved).toEqual({ id: eid.id, date: '2031-03-22', nameEn: 'Eid al-Fitr', nameAr: null });
      expect((await changeHoliday(eid.id, { nameEn: 'Eid al-Fitr (first day)' }, admin).expect(200)).body.nameEn).toBe('Eid al-Fitr (first day)');
      // sent as it is: no change to record
      await changeHoliday(eid.id, { date: '2031-03-22' }).expect(200);
      expect((await changeHoliday(eid.id, { date: '2031-04-25' }).expect(409)).body.message).toBe('There is already a holiday on 25/04/2031: Sinai Liberation Day.');
      expect((await changeHoliday(eid.id, { nameEn: null }).expect(400)).body.message).toContain("Enter the holiday's name in English.");
      await changeHoliday('00000000-0000-4000-8000-000000000000', { nameEn: 'Nothing' }).expect(404);

      expect((await auditOf('holiday', eid.id)).slice(1).map((a) => [a.action, a.diff])).toEqual([
        ['update', { date: { from: '2031-03-21', to: '2031-03-22' }, nameAr: { from: 'عيد الفطر', to: null } }],
        ['update', { nameEn: { from: 'Eid al-Fitr', to: 'Eid al-Fitr (first day)' } }],
      ]);
    });

    it('a Super Admin removes one; nobody else does', async () => {
      for (const session of [hr, admin, finance, manager, staff]) expect((await removeHoliday(eid.id, session).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_DELETES);
      await removeHoliday(eid.id).expect(204);
      await removeHoliday(eid.id).expect(404);
      expect(((await holidays('?year=2031').expect(200)).body as Holiday[]).map((h) => h.date)).toEqual(['2031-04-25']);
      expect((await auditOf('holiday', eid.id)).map((a) => a.action)).toEqual(['create', 'update', 'update', 'delete']);
    });
  });

  describe('payday', () => {
    const PAYDAY = 'Enter the day of the month salaries are paid, a whole number from 1 to 31, or leave it empty.';

    it('is not set to start with; HR and Admin set it from 1 to 31 or clear it, each change in the audit log', async () => {
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      expect((await api().get('/api/payroll/settings').set('Cookie', finance).expect(200)).body.payday).toBeNull();
      for (const session of [finance, ceo, staff]) await settings({ payday: 25 }, session).expect(403);
      expect((await settings({ payday: 25 }).expect(200)).body.payday).toBe(25);
      expect((await settings({ payday: 31 }, admin).expect(200)).body.payday).toBe(31);
      for (const bad of [0, 32, 1.5, '25', -1]) expect(messagesOf(await settings({ payday: bad }).expect(400))).toEqual([PAYDAY]);
      // leaving it out leaves it as it is
      expect((await settings({ dayDivisor: 30 }).expect(200)).body.payday).toBe(31);
      expect((await settings({ payday: null }).expect(200)).body.payday).toBeNull();

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_settings', id: { gt: since } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([{ payday: { from: null, to: 25 } }, { payday: { from: 25, to: 31 } }, { payday: { from: 31, to: null } }]);
    });
  });

  describe('the basic share of the gross for new contracts', () => {
    const BASIC = 'Enter the basic share of the gross as a whole percent from 1 to 100, e.g. 80.';

    it('is 80 to start with; HR and Admin change it, and a new contract starts with it unless HR sets another', async () => {
      expect((await api().get('/api/contract-settings').set('Cookie', staff).expect(200)).body.basicPercentDefault).toBe(80);
      for (const session of [finance, ceo, staff]) await contractSettings({ basicPercentDefault: 75 }, session).expect(403);
      for (const bad of [0, 101, 80.5, null]) expect(messagesOf(await contractSettings({ basicPercentDefault: bad }).expect(400))).toEqual([BASIC]);
      expect((await contractSettings({ basicPercentDefault: 75 }, admin).expect(200)).body).toMatchObject({ basicPercentDefault: 75, insuranceBasicDefault: 410 });

      const p = await hire('Basic Share');
      const draft = (await postContract(p, { grossSalary: 10000 }).expect(201)).body as { id: string; basicPercent: number };
      expect(draft.basicPercent).toBe(75);
      // HR's own share is kept
      expect((await api().patch(`/api/contracts/${draft.id}`).set('Cookie', hr).send({ basicPercent: 60 }).expect(200)).body.basicPercent).toBe(60);
      expect((await contractSettings({ basicPercentDefault: 80 }).expect(200)).body.basicPercentDefault).toBe(80);
      const versions = (await api().get(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).expect(200)).body as { id: string; basicPercent: number }[];
      expect(versions.find((c) => c.id === draft.id)!.basicPercent).toBe(60);
    });
  });

  describe('a run’s expected hours, from the shift and the holidays', () => {
    let run: Run;
    let regular: Person; // shift A, all month
    let joiner: Person; // shift A, joined on the 12th
    let typed: Person; // shift A, HR tries to type the expected hours (refused since 20 October 2026)
    let noShift: Person;
    let hourly: Person; // shift A, paid by the hour
    /** Shift A's working days in the run's month; and those from the 12th. */
    let monthDays: string[];
    let joinerDays: string[];
    /** A holiday on a working day after the 12th, one on a day off, and one added after the run is made. */
    let workday: string;
    let dayOff: string;
    let later: string;
    let hoursPerDay: number;

    const lineOf = (r: Run, p: Person) => r.lines.find((l) => l.employeeId === p.id)!;
    const patchLines = (lines: object[]) => api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines });

    beforeAll(async () => {
      monthDays = daysOn(shiftA.workingDays, firstDay(MONTH), lastDay(MONTH));
      joinerDays = daysOn(shiftA.workingDays, JOINER, lastDay(MONTH));
      [workday, later] = joinerDays.filter((d) => d >= `${MONTH}-15`);
      dayOff = daysOn([0, 1, 2, 3, 4, 5, 6].filter((d) => !shiftA.workingDays.includes(d)), firstDay(MONTH), lastDay(MONTH))[0];
      const [h, m] = [shiftA.startTime, shiftA.endTime].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
      hoursPerDay = (m - h) / 60;

      regular = await hire('Regular', { shiftId: shiftA.id });
      await signed(regular);
      joiner = await hire('Joiner', { shiftId: shiftA.id, joinDate: JOINER });
      await signed(joiner, { grossSalary: 9000 });
      typed = await hire('Typed', { shiftId: shiftA.id });
      await signed(typed);
      noShift = await hire('No Shift');
      await signed(noShift);
      hourly = await hire('Hourly', { shiftId: shiftA.id, employmentType: 'part_time' });
      await signed(hourly, { payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 20 });

      await addHoliday({ date: workday, nameEn: `Invented workday holiday ${RUN}` }).expect(201);
      await addHoliday({ date: dayOff, nameEn: `Invented day-off holiday ${RUN}` }).expect(201);
    });

    it('a new run works them out for each monthly-paid person: the shift’s days employed, less the holidays on them', async () => {
      run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
      // the holiday on a day off takes nothing away
      expect(lineOf(run, regular).terms).toMatchObject({
        hoursPerDay,
        expectedHours: (monthDays.length - 1) * hoursPerDay,
        expectedDays: { workingDays: monthDays.length, holidays: 1 },
      });
      // from the 12th only
      expect(lineOf(run, joiner).terms).toMatchObject({
        expectedHours: (joinerDays.length - 1) * hoursPerDay,
        expectedDays: { workingDays: joinerDays.length, holidays: 1 },
      });
      // without a shift, and by the hour: none
      expect(lineOf(run, noShift).terms).toMatchObject({ hoursPerDay: null, expectedHours: null, expectedDays: null });
      expect(lineOf(run, hourly).terms).toMatchObject({ payBasis: 'hourly', hoursPerDay, expectedHours: null, expectedDays: null });
      // nothing typed: the shift's hours are no reason for a warning
      expect(lineOf(run, regular).inputs.expectedHours).toBeNull();
      expect(lineOf(run, regular).result).toMatchObject({ attendanceRatio: null, warnings: [] });
    });

    it('attendance is measured on them when HR types the worked hours; HR can’t type others (owner, 20 October 2026: "expected hours to be locked based on shifts and attendance data")', async () => {
      const expected = (monthDays.length - 1) * hoursPerDay;
      const worked = expected - hoursPerDay;
      // a figure of HR's own is refused with why, the worked hours sent with it not saved either
      expect((await patchLines([{ id: lineOf(run, typed).id, inputs: { workedHours: 135, expectedHours: 150 } }]).expect(400)).body.message).toEqual([EXPECTED_HOURS_NOT_TYPED]);
      const notSaved = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run;
      expect(lineOf(notSaved, typed).inputs).toMatchObject({ workedHours: null, expectedHours: null });
      run = (
        await patchLines([
          { id: lineOf(run, regular).id, inputs: { workedHours: worked } },
          { id: lineOf(run, typed).id, inputs: { workedHours: 135 } },
          { id: lineOf(run, noShift).id, inputs: { workedHours: 135 } },
        ]).expect(200)
      ).body as Run;
      expect(lineOf(run, regular).inputs.expectedHours).toBeNull();
      expect(lineOf(run, regular).result.attendanceRatio).toBe(fraction(worked / expected));
      const t = lineOf(run, typed);
      expect(t.inputs).toMatchObject({ workedHours: 135, expectedHours: null });
      expect(t.terms.expectedHours).toBe(expected);
      expect(t.result).toMatchObject({ expectedHours: expected, attendanceRatio: fraction(135 / expected) });
      // without a shift there are none: attendance isn't counted, and the line says how to get them
      const n = lineOf(run, noShift);
      expect(n.result).toMatchObject({ expectedHours: null, attendanceRatio: null, attendanceCut: 0 });
      expect(n.result.warnings).toContain(NO_SHIFT_NO_EXPECTED_HOURS);
    });

    it('a holiday added after the run was made counts once the draft is refreshed; the worked hours HR typed stay', async () => {
      await addHoliday({ date: later, nameEn: `Invented later holiday ${RUN}` }).expect(201);
      // not until it is refreshed
      const before = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run;
      expect(lineOf(before, regular).terms.expectedHours).toBe((monthDays.length - 1) * hoursPerDay);

      run = (await api().post(`/api/payroll/runs/${run.id}/refresh`).set('Cookie', hr).expect(200)).body as Run;
      const expected = (monthDays.length - 2) * hoursPerDay;
      const r = lineOf(run, regular);
      expect(r.terms).toMatchObject({ expectedHours: expected, expectedDays: { workingDays: monthDays.length, holidays: 2 } });
      expect(r.result.attendanceRatio).toBe(fraction(r.inputs.workedHours! / expected));
      expect(lineOf(run, joiner).terms.expectedHours).toBe((joinerDays.length - 2) * hoursPerDay);
      // the shift's hours one holiday fewer: the 135 worked are measured on them
      const t = lineOf(run, typed);
      expect(t.inputs).toMatchObject({ workedHours: 135, expectedHours: null });
      expect(t.terms.expectedHours).toBe(expected);
      expect(t.result).toMatchObject({ expectedHours: expected, attendanceRatio: fraction(135 / expected) });
    });

    it('a holiday removed counts no more once the draft is refreshed', async () => {
      const added = ((await holidays(`?year=${MONTH.slice(0, 4)}`).expect(200)).body as Holiday[]).find((h) => h.date === later)!;
      await removeHoliday(added.id).expect(204);
      run = (await api().post(`/api/payroll/runs/${run.id}/refresh`).set('Cookie', hr).expect(200)).body as Run;
      expect(lineOf(run, regular).terms.expectedDays).toEqual({ workingDays: monthDays.length, holidays: 1 });
    });
  });

  // a shift's hours to work a day (owner, 16 October 2026: "my company shift is to maintain 9 hours within the shift
  // window, its like flexible shift"), the most attendance counts a day ("maximum working hours to be recorded per day
  // is 9 hours between checkin and check out") and no overtime for now ("No overtime for now")
  describe('a flexible shift, the most hours counted a day, and overtime', () => {
    let run: Run;
    let flexible: Person;
    /** The flexible shift's working days in the run's month, and the holidays on them. */
    let workingDays: number;
    let holidaysOn: number;

    const lineOf = (r: Run, p: Person) => r.lines.find((l) => l.employeeId === p.id)!;
    const refresh = async () => (run = (await api().post(`/api/payroll/runs/${run.id}/refresh`).set('Cookie', hr).expect(200)).body as Run);
    const patchLine = async (p: Person, inputs: object) =>
      (run = (await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: lineOf(run, p).id, inputs }] }).expect(200)).body as Run);

    beforeAll(async () => {
      const shift = (
        await api()
          .post('/api/shifts')
          .set('Cookie', hr)
          .send({ code: FLEXIBLE, startTime: '09:00', endTime: '19:00', hoursPerDay: 9, workingDays: [0, 1, 2, 3, 4] })
          .expect(201)
      ).body as { id: string };
      flexible = await hire('Flexible', { shiftId: shift.id });
      await signed(flexible);
      const days = daysOn([0, 1, 2, 3, 4], firstDay(MONTH), lastDay(MONTH));
      const onFile = ((await holidays(`?year=${MONTH.slice(0, 4)}`).expect(200)).body as Holiday[]).map((h) => h.date);
      workingDays = days.length;
      holidaysOn = days.filter((d) => onFile.includes(d)).length;
      // the month's draft: made here unless the tests before made it
      const runs = (await api().get('/api/payroll/runs').set('Cookie', hr).expect(200)).body as { id: string; month: string }[];
      const made = runs.find((r) => r.month === MONTH);
      run = made
        ? ((await api().get(`/api/payroll/runs/${made.id}`).set('Cookie', hr).expect(200)).body as Run)
        : ((await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run);
      await refresh();
    });

    it('a run counts a day of the shift as its hours to work, not its window: the expected hours and a no-show day’s hours', async () => {
      const expected = (workingDays - holidaysOn) * 9;
      expect(lineOf(run, flexible).terms).toMatchObject({ hoursPerDay: 9, expectedHours: expected, expectedDays: { workingDays, holidays: holidaysOn } });
      // a no-show day takes 9 hours out of the expected hours, not the window's 10
      await patchLine(flexible, { workedHours: expected - 9 - 9, noShowDays: 1 });
      expect(lineOf(run, flexible).result).toMatchObject({ absentHours: 9, attendanceRatio: fraction((expected - 18) / (expected - 9)), warnings: [] });
    });

    it('warns when the worked hours are more than 9 a day on the shift’s days, without cutting them', async () => {
      const most = (workingDays - holidaysOn - 1) * 9;
      await patchLine(flexible, { workedHours: most + 1 });
      const line = lineOf(run, flexible);
      expect(line.inputs.workedHours).toBe(most + 1);
      expect(line.result.warnings).toEqual([
        `Worked hours are more than 9:00 a day on the shift's working days (${most}:00 this month): attendance will count at most 9:00 a day`,
      ]);
      await patchLine(flexible, { workedHours: most });
      expect(lineOf(run, flexible).result.warnings).toEqual([]);
    });

    it('the shift’s hours changed count once the draft is refreshed', async () => {
      const shift = (await api().get('/api/shifts').set('Cookie', hr).expect(200)).body.find((x: { code: string }) => x.code === FLEXIBLE) as { id: string };
      await api().patch(`/api/shifts/${shift.id}`).set('Cookie', hr).send({ hoursPerDay: 8 }).expect(200);
      expect(lineOf(run, flexible).terms.hoursPerDay).toBe(9);
      await refresh();
      expect(lineOf(run, flexible).terms).toMatchObject({ hoursPerDay: 8, expectedHours: (workingDays - holidaysOn) * 8 });
      expect(lineOf(run, flexible).result.absentHours).toBe(8);
      // none set: the whole window
      await api().patch(`/api/shifts/${shift.id}`).set('Cookie', hr).send({ hoursPerDay: null }).expect(200);
      await refresh();
      expect(lineOf(run, flexible).terms).toMatchObject({ hoursPerDay: 10, expectedHours: (workingDays - holidaysOn) * 10 });
      await api().patch(`/api/shifts/${shift.id}`).set('Cookie', hr).send({ hoursPerDay: 9 }).expect(200);
      await refresh();
    });

    it('Pay overtime is off to start with; HR and Admin turn it on and off, each change in the audit log', async () => {
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      expect((await api().get('/api/payroll/settings').set('Cookie', finance).expect(200)).body).toMatchObject({ payOvertime: false, overtimeAbovePercent: 110, overtimeRate: 1.5 });
      expect(run.rules).toMatchObject({ payOvertime: false });
      for (const session of [finance, ceo, staff]) await settings({ payOvertime: true }, session).expect(403);
      for (const bad of ['yes', 1, null]) expect(messagesOf(await settings({ payOvertime: bad }).expect(400))).toEqual(['Say whether overtime is paid: true or false.']);
      expect((await settings({ payOvertime: true }, admin).expect(200)).body.payOvertime).toBe(true);
      // leaving it out leaves it as it is
      expect((await settings({ dayDivisor: 30 }).expect(200)).body.payOvertime).toBe(true);
      expect((await settings({ payOvertime: false }).expect(200)).body.payOvertime).toBe(false);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_settings', id: { gt: since } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([{ payOvertime: { from: false, to: true } }, { payOvertime: { from: true, to: false } }]);
    });

    it('a refreshed draft takes the switch: no overtime while it is off, whatever the attendance; paid when it is on', async () => {
      // 120% of the expected hours, typed: above the 110% overtime starts at
      const expected = (workingDays - holidaysOn) * 9;
      await patchLine(flexible, { workedHours: expected * 1.2, noShowDays: null });
      const off = lineOf(run, flexible).result;
      expect(off).toMatchObject({ attendanceRatio: 1.2, overtime: 0 });

      await settings({ payOvertime: true }).expect(200);
      // not until the draft is refreshed: it keeps the rules it was worked out with
      const kept = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run;
      expect(kept.rules).toMatchObject({ payOvertime: false });
      expect(lineOf(kept, flexible).result.overtime).toBe(0);
      await refresh();
      expect(run.rules).toMatchObject({ payOvertime: true });
      // fixed 9,600 × (1.20 − 1.10) × 1.5
      expect(lineOf(run, flexible).result.overtime).toBe(1440);

      await settings({ payOvertime: false }).expect(200);
      await refresh();
      expect(run.rules).toMatchObject({ payOvertime: false });
      expect(lineOf(run, flexible).result).toMatchObject({ attendanceRatio: 1.2, overtime: 0 });
    });
  });

  describe('the payroll setup migration', () => {
    const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    const SCHEMA = 'payroll_setup_migration_check';
    let db: pg.Client;

    beforeAll(async () => {
      db = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      const { rows } = await db.query<{ name: string }>('SELECT current_database() AS name');
      assertTestDatabase(rows[0].name);
    });

    afterAll(async () => {
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await db.end();
    });

    it('leaves the payday empty, starts new contracts at 80% basic as before, and keeps one holiday a day', async () => {
      const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_payroll_setup'))!;
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((x) => /^\d{14}_/.test(x) && x < migration).sort()) {
        await db.query(readFileSync(`${MIGRATIONS}${m}/migration.sql`, 'utf8'));
      }
      await db.query(readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8'));

      expect((await db.query('SELECT payday FROM payroll_settings')).rows).toEqual([{ payday: null }]);
      await expect(db.query('UPDATE payroll_settings SET payday = 32')).rejects.toThrow(/payroll_settings_payday_check/);
      expect((await db.query('SELECT basic_percent_default FROM contract_settings')).rows).toEqual([{ basic_percent_default: 80 }]);
      await expect(db.query('UPDATE contract_settings SET basic_percent_default = 0')).rejects.toThrow(/contract_settings_basic_percent_default_check/);
      await db.query("INSERT INTO holidays (id, date, name_en, updated_at) VALUES (gen_random_uuid(), '2031-04-25', 'Sinai Liberation Day', now())");
      await expect(db.query("INSERT INTO holidays (id, date, name_en, updated_at) VALUES (gen_random_uuid(), '2031-04-25', 'Again', now())")).rejects.toThrow(/holidays_date_key/);
      await expect(db.query("INSERT INTO holidays (id, date, name_en, updated_at) VALUES (gen_random_uuid(), '2031-04-26', ' ', now())")).rejects.toThrow(/holidays_name_en_check/);
    });

    it('flexible shifts: a shift kept from before has no hours to work set (the whole window), and overtime is off', async () => {
      const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_flexible_shifts'))!;
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((x) => /^\d{14}_/.test(x) && x < migration).sort()) {
        await db.query(readFileSync(`${MIGRATIONS}${m}/migration.sql`, 'utf8'));
      }
      await db.query("INSERT INTO shifts (id, code, start_time, end_time, updated_at) VALUES (gen_random_uuid(), 'MORNING', '09:00', '19:00', now())");
      await db.query(readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8'));

      expect((await db.query("SELECT hours_per_day FROM shifts WHERE code = 'MORNING'")).rows).toEqual([{ hours_per_day: null }]);
      expect((await db.query('SELECT pay_overtime FROM payroll_settings')).rows).toEqual([{ pay_overtime: false }]);
      // in half hours, from 0.5 to the window: 10 hours from 9:00 to 19:00; past midnight too
      await db.query("UPDATE shifts SET hours_per_day = 9 WHERE code = 'MORNING'");
      await db.query("UPDATE shifts SET hours_per_day = 10 WHERE code = 'MORNING'");
      for (const hours of ['10.5', '8.25', '0.25', '0']) {
        await expect(db.query(`UPDATE shifts SET hours_per_day = ${hours} WHERE code = 'MORNING'`)).rejects.toThrow(/shifts_hours_per_day_check/);
      }
      await db.query("UPDATE shifts SET start_time = '22:00', end_time = '06:00', hours_per_day = 8 WHERE code = 'MORNING'");
      await expect(db.query("UPDATE shifts SET hours_per_day = 8.5 WHERE code = 'MORNING'")).rejects.toThrow(/shifts_hours_per_day_check/);
    });
  });
});
