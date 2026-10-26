import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_NO_FILES, zonedMoment } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A person's attendance history on their profile (owner, 23 October 2026: "Attendance history on the profile. Since
// joining: on-time %, average check-in time, late days by weekday and trends; an Excel export"; asked who sees it, "HR,
// CEO and Finance only"): the figures for a seeded person over each period (Zoho's days on time and late, an absence,
// leave, a work from home day, an official duty over an absent day, a corrected day, and a rehire's gap left out); HR,
// the CEO, Finance and the Super Admin see it, a manager and the employee get 404, a C-level person's hidden from HR;
// the log's filter and pages; the Excel (headers and a row), audited, refused to a developer. These tests look at their
// own people (names end with RUN) and delete what they made. Every name is invented.

const RUN = `ah${Date.now().toString(36)}`;
const TODAY = todayInCairo();

/** What a seeded day is: on time, late, absent, from home, on duty, corrected, leave. */
type Kind = 'on_time' | 'late' | 'absent' | 'wfh' | 'od' | 'corrected' | 'leave';

interface History {
  employee: { id: string; confidential: boolean };
  period: string;
  range: { from: string; to: string };
  joinedOn: string | null;
  employments: { joinDate: string; endDate: string | null }[];
  figures: {
    daysOnRecord: number;
    expectedDays: number;
    attendedDays: number;
    attendanceRate: number | null;
    onTimeDays: number;
    lateDays: number;
    onTimeRate: number | null;
    absences: number;
    leaveDays: number;
    wfhDays: number;
    odDays: number;
    lateMinutes: number;
  };
  trend: { by: string; points: { key: string }[] };
  checkIns: { from: number; count: number }[];
  weekdays: { weekday: number; lateDays: number }[];
  log: { only: string | null; page: number; pages: number; pageSize: number; total: number; days: { date: string; mode: string; source: string; onTime: boolean | null; lateMinutes: number; odRequestId: string | null }[] };
}

describe('Attendance history (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let ceo: string;
  let finance: string;
  let superAdmin: string;
  let hrSuper: string;
  let developer: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let shiftId: string;
  let holidays: Set<string>;
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const seeded: { date: string; kind: Kind }[] = [];
  let joined: string;
  let gapDay: string;
  const api = () => request(app.getHttpServer());

  /** The first day from `from` back that isn't an official holiday nor seeded already. */
  const free = (from: string) => {
    let d = from;
    while (holidays.has(d) || seeded.some((s) => s.date === d)) d = addDays(d, -1);
    return d;
  };

  async function person(key: string, who: string, employment: Record<string, unknown> = {}, session = () => hr) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, shiftId, workArrangement: 'office', ...employment })
      .expect(201);
    return hired.body.employment.id as string;
  }

  const history = (key: string, query = '', session = hr) => api().get(`/api/attendance/employees/${ids[key]}/history${query}`).set('Cookie', session);
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  /** A day kept as Zoho's import (or a correction) keeps it. */
  async function keep(date: string, kind: Kind, source: 'zoho' | 'correction' = 'zoho', employeeId = ids.hana) {
    const times: Partial<Record<Kind, [string, string, number]>> = {
      on_time: ['09:05', '18:05', 9],
      // a flexible shift: late past 10:15 AM, the latest check-in that fits its 9 hours (owner, 26 October 2026)
      late: ['10:55', '19:15', 9],
      wfh: ['09:00', '17:00', 8],
      corrected: ['08:55', '18:00', 9],
    };
    const t = times[kind];
    const status = kind === 'absent' || kind === 'od' ? 'absent' : kind === 'leave' ? 'leave' : 'worked';
    await prisma.attendanceDay.create({
      data: {
        employeeId,
        date: toDateOnly(date),
        status,
        checkIn: t ? at(date, t[0]) : null,
        checkOut: t ? at(date, t[1]) : null,
        place: t ? (kind === 'wfh' ? 'remote' : 'office') : null,
        hoursCounted: t ? t[2] : 0,
        source,
        importedById: hrUserId,
      },
    });
    if (employeeId === ids.hana) seeded.push({ date, kind });
  }

  /** The figures the seeded days make between two days, counted by hand. */
  function expected(from: string, to: string) {
    const within = seeded.filter((s) => s.date >= from && s.date <= to && s.date !== gapDay);
    const of = (...k: Kind[]) => within.filter((s) => k.includes(s.kind)).length;
    return {
      daysOnRecord: within.length,
      expectedDays: of('on_time', 'late', 'absent', 'wfh', 'od', 'corrected'),
      attendedDays: of('on_time', 'late', 'wfh', 'od', 'corrected'),
      onTimeDays: of('on_time', 'wfh', 'od', 'corrected'),
      lateDays: of('late'),
      absences: of('absent'),
      leaveDays: of('leave'),
      wfhDays: of('wfh'),
      odDays: of('od'),
      lateMinutes: of('late') * 40,
    };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    developer = await signIn(app, await createUser(prisma, ['developer']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Attendance History ${RUN}` }).expect(201)).body.id;
    // 9 hours within 9:00–19:00, 15 minutes' grace, every day a working day
    shiftId = (
      await prisma.shift.create({
        data: { code: `H${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    await person('mona', 'Mona Manager');
    // Hana: hired 420 days ago for a month, rehired 40 days after that (a gap between the two)
    joined = addDays(TODAY, -420);
    const first = await person('hana', 'Hana History', { managerId: ids.mona, joinDate: joined });
    await prisma.employment.update({ where: { id: first }, data: { endDate: toDateOnly(addDays(joined, 30)), status: 'resigned' } });
    await api()
      .post(`/api/employees/${ids.hana}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: addDays(joined, 70), departmentId: deptId, shiftId, workArrangement: 'office', managerId: ids.mona })
      .expect(201);

    // the days on record: Zoho's, a correction, a work from home day, an official duty over an absent day
    await keep(free(TODAY), 'on_time');
    await keep(free(addDays(TODAY, -1)), 'late');
    await keep(free(addDays(TODAY, -2)), 'absent');
    const wfhDay = free(addDays(TODAY, -3));
    await keep(wfhDay, 'wfh');
    const odDay = free(addDays(TODAY, -4));
    await keep(odDay, 'od');
    await keep(free(addDays(TODAY, -5)), 'leave');
    await keep(free(addDays(TODAY, -10)), 'corrected', 'correction');
    await keep(free(addDays(TODAY, -40)), 'late');
    await keep(free(addDays(TODAY, -100)), 'on_time');
    await keep(free(addDays(joined, 10)), 'on_time');
    // a day kept in the gap between the employments: left out
    gapDay = addDays(joined, 50);
    await keep(gapDay, 'on_time');
    const employment = await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.hana, endDate: null }, select: { id: true } });
    await prisma.wfhRequest.create({ data: { employeeId: ids.hana, employmentId: employment.id, date: toDateOnly(wfhDay), status: 'approved', recordedByHr: true, createdById: hrUserId, reason: 'Asked by phone' } });
    ids.od = (
      await prisma.odRequest.create({
        data: { employeeId: ids.hana, employmentId: employment.id, startDate: toDateOnly(odDay), endDate: toDateOnly(odDay), place: 'Client site', reason: 'Shoot', status: 'approved', createdById: hrUserId },
        select: { id: true },
      })
    ).id;

    // a C-level person, with a day of their own
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Chief', { departmentId: null, gradeId: g9.id }, () => hrSuper);
    await keep(free(addDays(TODAY, -1)), 'on_time', 'zoho', ids.cleo);
  });

  afterAll(async () => {
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('works out the figures for each period from the days on record', async () => {
    const yearStart = `${TODAY.slice(0, 4)}-01-01`;
    const threeMonths = (() => {
      const [y, m] = TODAY.split('-').map(Number);
      const i = y * 12 + m - 1 - 2;
      return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
    })();
    for (const [period, from] of [
      ['this_month', `${TODAY.slice(0, 7)}-01`],
      ['last_3_months', threeMonths],
      ['this_year', yearStart],
      ['since_joining', joined],
    ] as const) {
      const v = (await history('hana', `?period=${period}`).expect(200)).body as History;
      expect(v.range, period).toEqual({ from, to: TODAY });
      const want = expected(from, TODAY);
      expect(v.figures, period).toMatchObject(want);
      expect(v.figures.attendanceRate, period).toBe(want.expectedDays ? want.attendedDays / want.expectedDays : null);
      expect(v.figures.onTimeRate, period).toBe(want.attendedDays ? want.onTimeDays / want.attendedDays : null);
    }
    const since = (await history('hana', '?period=since_joining').expect(200)).body as History;
    // since joining: the first join date, both employments, the gap's day left out; by quarter over a year
    expect(since).toMatchObject({ joinedOn: joined, trend: { by: 'quarter' } });
    expect(since.employments).toEqual([
      { joinDate: joined, endDate: addDays(joined, 30) },
      { joinDate: addDays(joined, 70), endDate: null },
    ]);
    expect(since.figures.daysOnRecord).toBe(seeded.length - 1);
    expect(since.weekdays.reduce((n, w) => n + w.lateDays, 0)).toBe(2);
    expect(since.checkIns.reduce((n, b) => n + b.count, 0)).toBe(since.figures.attendedDays - since.figures.odDays);
    // the official duty over an absent day: attended, on time, its request linked
    const od = since.log.days.find((d) => d.mode === 'od');
    expect(od).toMatchObject({ odRequestId: ids.od, onTime: true });
    // each row's source
    expect(new Set(since.log.days.map((d) => d.source))).toEqual(new Set(['zoho', 'correction']));
    // a custom range needs both days
    expect((await history('hana', '?period=custom').expect(400)).body.message).toEqual(['Choose the first and the last day of the range, e.g. 2026-01-01 and 2026-06-30.']);
  });

  it('filters and pages the daily log, the latest day first', async () => {
    const late = (await history('hana', '?period=since_joining&only=late').expect(200)).body as History;
    expect(late.log).toMatchObject({ only: 'late', page: 1, pages: 1, total: 2 });
    expect(late.log.days.every((d) => d.onTime === false && d.lateMinutes === 40)).toBe(true);
    const all = (await history('hana', '?period=since_joining').expect(200)).body as History;
    const dates = all.log.days.map((d) => d.date);
    expect(dates).toEqual(all.log.days.map((d) => d.date).sort().reverse());
    expect((await history('hana', '?period=since_joining&only=od').expect(200)).body.log.total).toBe(1);
    expect((await history('hana', '?period=since_joining&page=99').expect(200)).body.log.page).toBe(1);
  });

  it('is for HR, the CEO, Finance and the Super Admin; a manager and the employee get 404; a C-level person’s hidden from HR', async () => {
    for (const session of [hr, ceo, finance, superAdmin]) await history('hana', '', session).expect(200);
    await history('hana', '', sessions.mona).expect(404);
    await history('hana', '', sessions.hana).expect(404);
    await history('cleo', '', hr).expect(404);
    await history('cleo', '', finance).expect(404);
    expect((await history('cleo', '', ceo).expect(200)).body.employee).toMatchObject({ confidential: true });
    await history('cleo', '', superAdmin).expect(200);
    await api().get(`/api/attendance/employees/${ids.hana}/history.xlsx`).set('Cookie', sessions.mona).expect(404);
  });

  it('exports the figures and the daily log to Excel, audited; never to a developer', async () => {
    const res = await api()
      .get(`/api/attendance/employees/${ids.hana}/history.xlsx?period=since_joining`)
      .set('Cookie', finance)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(`to ${TODAY}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Figures', 'On-Time Trend', 'Daily Log']);
    const log = wb.getWorksheet('Daily Log')!;
    // the day's pairs and break since 25 October 2026 (owner: "the working hours to be calculated between the checkin and out only")
    expect(log.getRow(1).values).toEqual([undefined, 'Date', 'Day', 'Mode', 'First in', 'Last out', 'Hours', 'Late minutes', 'On time', 'Source', 'Pairs', 'Break']);
    const lateDay = seeded.find((s) => s.kind === 'late')!.date;
    const row = log.getRows(2, log.rowCount - 1)!.find((r) => r.getCell(1).value === lateDay.split('-').reverse().join('/'))!;
    expect([row.getCell(3).value, row.getCell(7).value, row.getCell(8).value, row.getCell(9).value]).toEqual(['Office', 40, 'No', 'Zoho import']);
    expect(row.getCell(4).text).toMatch(/^10:55\sAM$/);
    expect(log.rowCount).toBe(seeded.length - 1 + 1);
    const figures = wb.getWorksheet('Figures')!;
    expect(figures.getRow(1).values).toEqual([undefined, 'Figure', 'Value', 'What it means']);
    expect(figures.getColumn(1).values).toContain('Attendance rate');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'attendance_history_file', entityId: ids.hana }, orderBy: { id: 'desc' } });
    expect(audit).toMatchObject({ entityType: 'employee', diff: { period: 'since_joining', from: joined, to: TODAY, days: seeded.length - 1 } });
    // a developer sees the page (masked), never the file
    await history('hana', '', developer).expect(200);
    const refused = await api().get(`/api/attendance/employees/${ids.hana}/history.xlsx`).set('Cookie', developer).expect(403);
    expect(refused.body.message).toBe(DEVELOPER_NO_FILES);
  });
});
