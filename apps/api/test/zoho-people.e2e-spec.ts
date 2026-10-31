import type { INestApplication } from '@nestjs/common';
import {
  DEVELOPER_NO_FILES,
  ZOHO_PEOPLE_HR_ONLY,
  ZOHO_PEOPLE_RUN_GOING,
  ZOHO_PEOPLE_SCOPES,
  ZOHO_PEOPLE_SUPER_ADMIN_ONLY,
  zonedMoment,
  type ZohoPeopleConnectResult,
  type ZohoPeopleNote,
  type ZohoPeopleTestView,
  type ZohoPeopleView,
  type ZohoRunView,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CorrectionDaysService } from '../src/attendance/correction-days.service.js';
import { addDays, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { ZohoPeopleHttp } from '../src/zoho-people/zoho-people-http.js';
import { ZohoPeopleSyncService } from '../src/zoho-people/zoho-people-sync.service.js';
import { fakeZohoPeople, virtualClock, type FakeZohoPeople } from './fake-zoho-people.js';
import { createApp, createUser, signIn } from './helpers.js';

// Zoho People's check-ins and check-outs pulled in (owner, 25 October 2026: "can i fetch checkin and out transactions
// from zoho people through api?"; asked, "Yes, daily + backfill"; then "but can it fetch historical data?"). Zoho
// Accounts and Zoho People are one fake in ZohoPeopleHttp's place (fake-zoho-people.ts), on a clock of the test's own:
// nothing is ever sent to Zoho, and the throttle's spacing and Zoho's 10-minute lock take no time. A Super Admin saves the
// shared Zoho app and connects Zoho People (at the EU data centre the sign-in comes back from), its token sealed, and
// tests it; the nightly run keeps two people's days the import's way (their pairs, their hours by the pairs); run again
// it adds nothing; a day Zoho changed replaces only its Zoho day, a system check-in and an HR correction staying; a draft
// month's line is filled from the days; an approved month gets its missing days for the record, its payroll unchanged; a
// former employee's months are fetched within their employment; someone Zoho doesn't know is listed, someone known only
// by their Zoho ID is found by it; calls are one a second and a lock waits; 12 months at most; a run is refused while
// another goes and is cancelled; a refused sign-in fails the run and tells the dashboard. Only HR and a Super Admin see
// the page, only a Super Admin connects, never a developer; no token or secret is in an answer or the audit log. Every
// name is invented; this file deletes what it made.

const RUN = `zp${Date.now().toString(36)}`;
const ORIGIN = 'https://people.trendlix.test';
const EU = 'https://accounts.zoho.eu';
const ZOHO = { clientId: `1000.${RUN.toUpperCase()}ZPAPP`, clientSecret: `zoho-people-${RUN}-secret` };
const ADMIN_ZOHO = `zoho.admin.${RUN}@trendlix.test`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const Y = addDays(TODAY, -1);
const DRAFT = monthsLater(CURRENT, -3);
const APPROVED = monthsLater(CURRENT, -4);
const FORMER = monthsLater(CURRENT, -6);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A moment of a Cairo day: "2026-10-24", "09:00" → its Date. */
const at = (date: string, time: string) => new Date(zonedMoment(date, time));
/** Zoho's entry time: "24-Oct-2026 - 09:00 AM". */
const zt = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  const hh = String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0');
  return `${date.slice(8, 10)}-${MON[Number(date.slice(5, 7)) - 1]}-${date.slice(0, 4)} - ${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
/** Zoho's day: its entries (check-in → check-out), at the office. */
const zohoDay = (date: string, pairs: [string, string][], status = 'Present') => ({
  firstIn: pairs.length ? `${date} ${pairs[0][0]}:00` : '-',
  lastOut: pairs.length ? `${date} ${pairs.at(-1)![1]}:00` : '-',
  status,
  entries: pairs.map(([i, o]) => ({ checkIn: zt(date, i), checkOut: zt(date, o), checkIn_Location: 'Trendlix, 15, Al Doctor Al Mahrouqi Street', checkOut_Location: 'Trendlix', sourceOfPunchIn: 'Web', sourceOfPunchOut: 'Web' })),
});

describe('Zoho People’s check-ins pulled in (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sync: ZohoPeopleSyncService;
  let zoho: FakeZohoPeople;
  const clock = virtualClock();
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const runs: Record<string, string> = {};
  /** A note's answer: none (an empty body or null), or the note. */
  const noteOf = (res: request.Response): ZohoPeopleNote => (res.text && res.text !== 'null' ? (JSON.parse(res.text) as ZohoPeopleNote) : null);
  const answers: unknown[] = [];
  let deptId: string;
  let shiftId: string;
  let emailDomainBefore: string | null;

  const kept = (t: request.Test) => t.on('response', (res: request.Response) => answers.push(res.body));
  const as = (who: string) => ({
    get: (path: string) => kept(api().get(`/api${path}`).set('Cookie', sessions[who])),
    put: (path: string, body: object) => kept(api().put(`/api${path}`).set('Cookie', sessions[who]).send(body)),
    post: (path: string, body: object = {}) => kept(api().post(`/api${path}`).set('Cookie', sessions[who]).send(body)),
  });
  const said = (res: request.Response) => ([] as string[]).concat(res.body.message);

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    sessions[key] = await signIn(app, email);
  }

  /** Someone hired through the API, with a signed contract (so they are on the payroll runs). */
  async function hired(key: string, name: string) {
    emails[key] = `${key}.${RUN}@trendlix.test`;
    const res = await api().post('/api/employees').set('Cookie', sessions.hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: emails[key] }).expect(201);
    ids[key] = res.body.id;
    people.push(res.body.id);
    const job = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', sessions.hr)
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(CURRENT, -8)), departmentId: deptId, shiftId, workArrangement: 'office' })
      .expect(201);
    employments[key] = job.body.employment.id;
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${job.body.employment.id}/contracts`).set('Cookie', sessions.hr).send({ grossSalary: 15000, durationMonths: 36 }).expect(201)).body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', sessions.hr).send({ signedOn: draft.startDate }).expect(200);
  }

  /** Someone kept directly: their work email (or none), their Zoho ID, their employment's days. */
  async function direct(key: string, name: string, opts: { email: string | null; zohoId?: string; from: string; to?: string | null }) {
    if (opts.email) emails[key] = opts.email;
    const e = await prisma.employee.create({
      data: {
        employeeCode: `ZP-${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: opts.email,
        zohoPeopleId: opts.zohoId ?? null,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: toDateOnly(opts.from), endDate: opts.to ? toDateOnly(opts.to) : null, departmentId: deptId, shiftId } },
      },
      select: { id: true, employments: { select: { id: true } } },
    });
    ids[key] = e.id;
    employments[key] = e.employments[0].id;
    people.push(e.id);
  }

  /** A fetch through the page, waited for. */
  async function fetchRun(who: string, from: string, to: string, keys: string[] | null): Promise<ZohoRunView> {
    const res = await as(who).post('/zoho-people/runs', { from, to, employeeIds: keys ? keys.map((k) => ids[k]) : [] }).expect(201);
    await sync.whenDone(res.body.id);
    return (await as(who).get(`/zoho-people/runs/${res.body.id}`).expect(200)).body as ZohoRunView;
  }

  const zohoDayOf = (key: string, date: string) => prisma.attendanceDay.findUnique({ where: { employeeId_date_source: { employeeId: ids[key], date: toDateOnly(date), source: 'zoho' } } });
  const lineOf = (month: string, key: string) => prisma.payrollLine.findFirstOrThrow({ where: { runId: runs[month], employeeId: ids[key] }, select: { inputs: true, attendanceImport: true, result: true } });
  const attendanceCalls = () => zoho.calls.filter((c) => c.url.endsWith('/people/api/attendance/getAttendanceEntries'));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    sync = app.get(ZohoPeopleSyncService);
    zoho = fakeZohoPeople(RUN, ZOHO, clock);
    const http = app.get(ZohoPeopleHttp);
    http.fetch = zoho.fetch;
    http.clock = clock;
    http.reset();
    // a test run before this one left nothing; this file's own rows are deleted at the end
    await prisma.attendanceDay.updateMany({ where: { zohoRunId: { not: null } }, data: { zohoRunId: null } });
    await prisma.zohoPeopleRun.deleteMany({});
    await prisma.zohoPeopleConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await account('superAdmin', ['super_admin']);
    await account('hr', ['hr']);
    await account('finance', ['finance']);
    await account('employee', ['employee']);
    await account('developer', ['developer']);
    emailDomainBefore = (await api().get('/api/company').set('Cookie', sessions.hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', sessions.hr).send({ nameEn: `Zoho Dept ${RUN}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `ZP${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    await hired('ana', 'Ana Zoho');
    await hired('ben', 'Ben Both');
    const since = firstDay(monthsLater(CURRENT, -8));
    // Zoho People doesn't know Cy; it knows Dee by the Zoho employee ID the Excel import remembered, not her work email
    await direct('cy', 'Cy Unknown', { email: `cy.${RUN}@trendlix.test`, from: since });
    await direct('dee', 'Dee Byid', { email: `dee.${RUN}@trendlix.test`, zohoId: `Z-DEE-${RUN}`, from: since });
    await direct('nomail', 'Nomail Person', { email: null, from: since });
    // a former employee: joined on the 6th, left on the 20th a month later
    await direct('fay', 'Fay Former', { email: `fay.${RUN}@trendlix.test`, from: addDays(firstDay(monthsLater(FORMER, -1)), 5), to: `${FORMER}-20` });
    zoho.person(ADMIN_ZOHO);
    zoho.person(emails.ana);
    zoho.person(emails.ben);
    zoho.person(`dee.zoho.${RUN}@trendlix.test`, `Z-DEE-${RUN}`);
    zoho.person(emails.fay);
    for (const month of [APPROVED, DRAFT]) runs[month] = (await api().post('/api/payroll/runs').set('Cookie', sessions.hr).send({ month }).expect(201)).body.id;
    await prisma.payrollRun.update({ where: { id: runs[APPROVED] }, data: { status: 'approved', submittedAt: new Date(), approvedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: Object.values(runs) } } });
    await prisma.attendanceCorrection.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.updateMany({ where: { zohoRunId: { not: null } }, data: { zohoRunId: null } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.zohoPeopleRun.deleteMany({});
    await prisma.zohoPeopleConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the page and the connection', () => {
    it('opens to HR and a Super Admin only, never to a developer', async () => {
      expect(said(await as('employee').get('/zoho-people').expect(403))).toEqual([ZOHO_PEOPLE_HR_ONLY]);
      expect(said(await as('finance').get('/zoho-people').expect(403))).toEqual([ZOHO_PEOPLE_HR_ONLY]);
      expect(said(await as('developer').get('/zoho-people').expect(403))).toEqual([DEVELOPER_NO_FILES]);
      const hr = (await as('hr').get('/zoho-people').expect(200)).body as ZohoPeopleView;
      expect(hr).toMatchObject({ app: null, connection: null, canManage: false, canFetch: true, current: null, runs: [] });
      expect(hr.people).toBeGreaterThanOrEqual(4);
      const sa = (await as('superAdmin').get('/zoho-people').expect(200)).body as ZohoPeopleView;
      expect(sa).toMatchObject({ canManage: true, app: { provider: 'zoho', ready: false } });
    });

    it('connects only for a Super Admin: HR can’t sign in, test or disconnect', async () => {
      expect(said(await as('hr').post('/zoho-people/oauth/start', { origin: ORIGIN }).expect(403))).toEqual([ZOHO_PEOPLE_SUPER_ADMIN_ONLY]);
      expect(said(await as('hr').post('/zoho-people/test', {}).expect(403))).toEqual([ZOHO_PEOPLE_SUPER_ADMIN_ONLY]);
      expect(said(await as('hr').post('/zoho-people/disconnect').expect(403))).toEqual([ZOHO_PEOPLE_SUPER_ADMIN_ONLY]);
      // before the shared app is saved: nothing to sign in with
      expect(said(await as('superAdmin').post('/zoho-people/oauth/start', { origin: ORIGIN }).expect(400))[0]).toContain('Zoho app isn’t set up');
    });

    it('signs in with the shared Zoho app at the EU data centre, Zoho People’s scopes asked, its token sealed', async () => {
      await as('superAdmin').put('/calendars/apps/zoho', { clientId: ZOHO.clientId, clientSecret: ZOHO.clientSecret, dataCentre: 'eu' }).expect(200);
      const started = (await as('superAdmin').post('/zoho-people/oauth/start', { origin: ORIGIN }).expect(200)).body as { url: string };
      const url = new URL(started.url);
      expect(url.origin).toBe(EU);
      expect(url.searchParams.get('scope')).toBe(ZOHO_PEOPLE_SCOPES.join(','));
      expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/zoho-people/oauth`);
      expect(url.searchParams.get('access_type')).toBe('offline');
      // a state that isn't the system's: expired, nothing saved
      const bad = (await as('superAdmin').post('/zoho-people/oauth/finish', { code: 'x', state: 'v1:nope', accountsServer: EU }).expect(200)).body as ZohoPeopleConnectResult;
      expect(bad).toMatchObject({ ok: false, problem: 'expired' });
      zoho.code('code-1', ADMIN_ZOHO, EU);
      const done = (await as('superAdmin').post('/zoho-people/oauth/finish', { code: 'code-1', state: url.searchParams.get('state'), accountsServer: EU }).expect(200)).body as ZohoPeopleConnectResult;
      expect(done).toEqual({ back: '/organization/zoho-people', ok: true, problem: null, said: null });
      const row = await prisma.zohoPeopleConnection.findUniqueOrThrow({ where: { id: 1 } });
      expect(row).toMatchObject({ accountEmail: ADMIN_ZOHO, accountsServer: EU, status: 'connected', timeZone: 'Africa/Cairo', dateFormat: 'dd-MMM-yyyy' });
      expect(row.refreshTokenEnc.startsWith('v1:')).toBe(true);
      for (const s of zoho.secrets) expect(row.refreshTokenEnc).not.toContain(s);
      const view = (await as('superAdmin').get('/zoho-people').expect(200)).body as ZohoPeopleView;
      expect(view.connection).toMatchObject({ accountEmail: ADMIN_ZOHO, status: 'connected', dataCentre: 'eu', timeZone: 'Africa/Cairo' });
      expect(await prisma.auditLog.count({ where: { entityType: 'zoho_people_connection', action: 'connect' } })).toBe(1);
    });

    it('tests today’s attendance for the account and a colleague, in counts, never a place', async () => {
      zoho.day(emails.ana, TODAY, zohoDay(TODAY, [['09:00', '13:00'], ['14:00', '18:00']]));
      const test = (await as('superAdmin').post('/zoho-people/test', { email: emails.ana }).expect(200)).body as ZohoPeopleTestView;
      expect(test.ok).toBe(true);
      expect(test.message).toContain(`${emails.ana}: 4 check-ins and check-outs, the first check-in at 9:00 AM (Present)`);
      expect(test.message).toContain(`${ADMIN_ZOHO}: nothing yet today`);
      expect(test.message).toContain('Africa/Cairo');
      expect(test.message).not.toMatch(/Mahrouqi|Trendlix,/);
      expect(await prisma.auditLog.count({ where: { entityType: 'zoho_people_connection', action: 'test_zoho_people' } })).toBe(1);
    });
  });

  describe('the nightly run and fetching again', () => {
    it('keeps yesterday for everyone at 02:00 Cairo, the import’s way: the pairs, the hours from the first check-in to the last', async () => {
      zoho.day(emails.ana, Y, zohoDay(Y, [['09:00', '13:00'], ['14:00', '18:00']]));
      zoho.day(`dee.zoho.${RUN}@trendlix.test`, Y, zohoDay(Y, [['10:00', '19:00']]));
      expect(await sync.nightlyIfDue(at(TODAY, '01:30'))).toBeNull();
      const started = await sync.nightlyIfDue(at(TODAY, '02:30'));
      expect(started).not.toBeNull();
      const id = started!;
      await sync.whenDone(id);
      // once a night
      expect(await sync.nightlyIfDue(at(TODAY, '03:30'))).toBeNull();
      const ana = await zohoDayOf('ana', Y);
      expect(ana).toMatchObject({ source: 'zoho', status: 'worked', place: 'office', zohoStatus: 'Present', zohoRunId: id, importId: null, breakMinutes: 60, openAt: null });
      expect(ana!.checkIn).toEqual(at(Y, '09:00'));
      expect(ana!.checkOut).toEqual(at(Y, '18:00'));
      // 9:00 to 6:00 PM, the break included (owner, 31 October 2026: "9:00, break included")
      expect(ana!.hoursCounted.toNumber()).toBe(9);
      expect(ana!.pairs).toEqual([
        { in: at(Y, '09:00').toISOString(), out: at(Y, '13:00').toISOString() },
        { in: at(Y, '14:00').toISOString(), out: at(Y, '18:00').toISOString() },
      ]);
      // Dee, not known by her work email, found by her Zoho employee ID: 10:00–19:00 within 9:00–19:15 is 9 hours
      expect((await zohoDayOf('dee', Y))!.hoursCounted.toNumber()).toBe(9);
      const run = (await as('hr').get(`/zoho-people/runs/${id}`).expect(200)).body as ZohoRunView;
      expect(run).toMatchObject({ kind: 'nightly', from: Y, to: Y, everyone: true, status: 'finished', startedBy: null, minutesLeft: null });
      expect(run.counts.daysAdded).toBeGreaterThanOrEqual(2);
      expect(run.counts.punchesAdded).toBeGreaterThanOrEqual(6);
      expect(run.notFound.map((p) => p.employeeId)).toContain(ids.cy);
      expect(run.notFound.map((p) => p.employeeId)).not.toContain(ids.dee);
      expect(run.noWorkEmail.map((p) => p.employeeId)).toContain(ids.nomail);
      expect(run.skipped.find((s) => s.reason === 'not_found')?.days).toBeGreaterThanOrEqual(1);
      const audits = await prisma.auditLog.findMany({ where: { entityType: 'zoho_people_run', entityId: id } });
      expect(audits.map((a) => a.action).sort()).toEqual(['create', 'finish']);
      expect(await prisma.auditLog.count({ where: { entityType: 'attendance_day', action: 'zoho_fetch', diff: { path: ['runId'], equals: id } } })).toBeGreaterThanOrEqual(2);
    });

    it('lists those not found in Zoho People on the page', async () => {
      const view = (await as('hr').get('/zoho-people').expect(200)).body as ZohoPeopleView;
      expect(view.notFound.map((p) => p.employeeId)).toContain(ids.cy);
      expect(view.notFound.find((p) => p.employeeId === ids.cy)).toMatchObject({ name: `Cy Unknown ${RUN}`, email: emails.cy, former: false });
      expect(view.notFound.map((p) => p.employeeId)).not.toContain(ids.dee);
      expect(view.nightly).toMatchObject({ time: '02:00', last: { day: Y, status: 'finished' } });
    });

    it('adds nothing when run again: Zoho’s days kept already are matched by their times', async () => {
      const before = await prisma.attendanceDay.count({ where: { employeeId: { in: [ids.ana, ids.dee] } } });
      const run = await fetchRun('hr', Y, Y, ['ana', 'dee']);
      expect(run).toMatchObject({ kind: 'fetch', status: 'finished', everyone: false, chosen: 2 });
      expect(run.counts).toMatchObject({ people: 2, peopleDone: 2, calls: 2, callsDone: 2, daysAdded: 0, daysReplaced: 0, daysUnchanged: 2, punchesAdded: 0 });
      expect(await prisma.attendanceDay.count({ where: { employeeId: { in: [ids.ana, ids.dee] } } })).toBe(before);
    });
  });

  describe('the days kept, and the payroll', () => {
    const d = (n: number) => addDays(firstDay(DRAFT), n);

    it('replaces only a Zoho day Zoho changed: the system’s check-ins and an HR correction stay', async () => {
      // d0: Ben checked in on the system; Zoho has the day too
      await prisma.attendancePunch.createMany({
        data: [
          { employeeId: ids.ben, date: toDateOnly(d(0)), kind: 'in', at: at(d(0), '09:00'), place: 'office', expected: 'office', flags: [], source: 'system' },
          { employeeId: ids.ben, date: toDateOnly(d(0)), kind: 'out', at: at(d(0), '17:00'), place: 'office', expected: 'office', flags: [], source: 'system' },
        ],
      });
      const system = await prisma.attendanceDay.create({
        data: { employeeId: ids.ben, date: toDateOnly(d(0)), status: 'worked', checkIn: at(d(0), '09:00'), checkOut: at(d(0), '17:00'), place: 'office', hoursCounted: 8, source: 'system', pairs: [{ in: at(d(0), '09:00').toISOString(), out: at(d(0), '17:00').toISOString() }] },
      });
      zoho.day(emails.ben, d(0), zohoDay(d(0), [['09:30', '18:00']]));
      // d1: Zoho's day from an Excel import, corrected by HR; Zoho regularised it since
      await prisma.attendanceDay.create({ data: { employeeId: ids.ben, date: toDateOnly(d(1)), status: 'worked', checkIn: at(d(1), '09:00'), checkOut: at(d(1), '18:00'), place: 'office', hoursCounted: 9, source: 'zoho' } });
      await prisma.attendanceCorrection.create({
        data: { employeeId: ids.ben, employmentId: employments.ben, date: toDateOnly(d(1)), kind: 'wrong_time', checkIn: at(d(1), '08:45'), checkOut: at(d(1), '17:45'), reason: 'Badge', status: 'approved', recordedByHr: true, appliedAt: new Date() },
      });
      await app.get(CorrectionDaysService).rebuild(ids.ben, d(1), null);
      zoho.day(emails.ben, d(1), zohoDay(d(1), [['09:00', '13:00'], ['14:00', '19:00']], 'Present / Regularized'));
      // d2: Zoho's day from an Excel import, the same first and last as Zoho's entry now: left as it is
      const excel = await prisma.attendanceDay.create({ data: { employeeId: ids.ben, date: toDateOnly(d(2)), status: 'worked', checkIn: at(d(2), '09:00'), checkOut: at(d(2), '18:00'), place: 'office', hoursCounted: 9, source: 'zoho' } });
      zoho.day(emails.ben, d(2), zohoDay(d(2), [['09:00', '18:00']]));

      const run = await fetchRun('hr', d(0), d(2), ['ben']);
      expect(run.counts).toMatchObject({ calls: 3, daysAdded: 1, daysReplaced: 1, daysUnchanged: 1, daysRecorded: 0 });
      // the system's day as it was
      expect(await prisma.attendanceDay.findUniqueOrThrow({ where: { id: system.id } })).toMatchObject({ checkIn: at(d(0), '09:00'), checkOut: at(d(0), '17:00'), source: 'system' });
      expect((await prisma.attendancePunch.count({ where: { employeeId: ids.ben, date: toDateOnly(d(0)) } }))).toBe(2);
      // Zoho's day kept beside it, under it by the sources' order
      expect((await zohoDayOf('ben', d(0)))!.checkIn).toEqual(at(d(0), '09:30'));
      // the regularised day replaced, only its Zoho day; HR's correction still says 8:45 to 5:45 PM
      const replaced = await zohoDayOf('ben', d(1));
      expect(replaced).toMatchObject({ checkOut: at(d(1), '19:00'), zohoStatus: 'Present / Regularized', zohoRunId: run.id });
      expect(replaced!.hoursCounted.toNumber()).toBe(9);
      const corrected = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.ben, date: toDateOnly(d(1)), source: 'correction' } } });
      expect(corrected).toMatchObject({ checkIn: at(d(1), '08:45'), checkOut: at(d(1), '17:45') });
      expect((corrected.correctedFrom as { checkOut: string }).checkOut).toBe(at(d(1), '19:00').toISOString());
      // the import's day matched by its times: the same row, still without pairs
      expect(await prisma.attendanceDay.findUniqueOrThrow({ where: { id: excel.id } })).toMatchObject({ zohoRunId: null, pairs: null });
    });

    it('fills a draft month’s line from the Zoho days fetched', async () => {
      expect((await lineOf(DRAFT, 'ana')).inputs as { workedHours?: number | null }).not.toHaveProperty('workedHours', 18);
      zoho.day(emails.ana, d(0), zohoDay(d(0), [['09:00', '13:00'], ['14:00', '18:00']]));
      zoho.day(emails.ana, d(1), zohoDay(d(1), [['09:00', '18:00']]));
      const run = await fetchRun('hr', d(0), d(1), ['ana']);
      expect(run.counts).toMatchObject({ daysAdded: 2, linesRefilled: 1 });
      const line = await lineOf(DRAFT, 'ana');
      // 9 (9:00 to 6:00 PM, the break included) and 9
      expect(line.inputs).toMatchObject({ workedHours: 18 });
      expect(line.attendanceImport).toMatchObject({ source: 'attendance', sources: ['zoho'] });
      expect(await prisma.auditLog.count({ where: { entityType: 'payroll_line', action: 'update', diff: { path: ['runId'], equals: runs[DRAFT] } } })).toBeGreaterThan(0);
    });

    it('adds an approved month’s missing days for the record, replaces none there, and leaves its payroll as it was', async () => {
      const [a0, a1] = [addDays(firstDay(APPROVED), 3), addDays(firstDay(APPROVED), 4)];
      await prisma.attendanceDay.create({ data: { employeeId: ids.ana, date: toDateOnly(a0), status: 'worked', checkIn: at(a0, '09:00'), checkOut: at(a0, '17:00'), place: 'office', hoursCounted: 8, source: 'zoho' } });
      zoho.day(emails.ana, a0, zohoDay(a0, [['09:00', '18:00']]));
      zoho.day(emails.ana, a1, zohoDay(a1, [['09:00', '17:00']]));
      const before = await lineOf(APPROVED, 'ana');
      const run = await fetchRun('hr', a0, a1, ['ana']);
      expect(run.counts).toMatchObject({ daysAdded: 0, daysRecorded: 1, daysReplaced: 0, linesRefilled: 0 });
      expect(run.skipped).toContainEqual({ reason: 'payroll_approved', days: 1 });
      expect((await zohoDayOf('ana', a0))!.checkOut).toEqual(at(a0, '17:00'));
      expect((await zohoDayOf('ana', a1))!.checkOut).toEqual(at(a1, '17:00'));
      expect(await lineOf(APPROVED, 'ana')).toEqual(before);
      const logged = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'attendance_day', action: 'zoho_fetch', diff: { path: ['runId'], equals: run.id } } });
      expect(logged.diff).toMatchObject({ month: APPROVED, recorded: 1, payrollUnchanged: true });
    });

    it('fetches a former employee’s months within their employment, the days before and after skipped', async () => {
      const from = firstDay(monthsLater(FORMER, -1));
      const to = lastDay(FORMER);
      const [inside, after] = [`${FORMER}-10`, `${FORMER}-25`];
      zoho.day(emails.fay, inside, zohoDay(inside, [['09:00', '17:00']]));
      zoho.day(emails.fay, after, zohoDay(after, [['09:00', '17:00']]));
      const run = await fetchRun('hr', from, to, ['fay']);
      const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
      expect(run.counts).toMatchObject({ people: 1, calls: days(addDays(from, 5), `${FORMER}-20`), daysAdded: 1 });
      expect(run.skipped).toContainEqual({ reason: 'before_join', days: 5 });
      expect(run.skipped).toContainEqual({ reason: 'after_end', days: days(`${FORMER}-21`, to) });
      expect(await zohoDayOf('fay', inside)).not.toBeNull();
      expect(await zohoDayOf('fay', after)).toBeNull();
      // everyone of a past range: former employees too
      const everyone = await fetchRun('hr', `${FORMER}-18`, `${FORMER}-20`, null);
      expect(everyone.everyone).toBe(true);
      expect(everyone.counts.people).toBeGreaterThanOrEqual(4);
      const plan = (await prisma.zohoPeopleRun.findUniqueOrThrow({ where: { id: everyone.id } })).plan as { employeeId: string }[];
      expect(plan.map((p) => p.employeeId)).toContain(ids.fay);
    });
  });

  describe('colleagues’ times sent without their hour (owner, 26 October 2026: Zoho sent “26-Oct-2026”)', () => {
    const d = (n: number) => addDays(firstDay(monthsLater(CURRENT, -2)), n);
    const bensCalls = (from: number) => attendanceCalls().slice(from).filter((c) => c.who === emails.ben);

    it('asks again without naming the date format, keeps the way that brings them whole, and reads every day after that way', async () => {
      zoho.timeless('named');
      zoho.day(emails.ben, d(9), zohoDay(d(9), [['09:00', '13:00'], ['14:00', '18:00']]));
      zoho.day(emails.ben, d(10), zohoDay(d(10), [['09:00', '13:00'], ['14:00', '18:00']]));
      const from = attendanceCalls().length;
      const run = await fetchRun('hr', d(9), d(10), ['ben']);
      expect(run).toMatchObject({ status: 'finished', errors: [] });
      expect(run.counts).toMatchObject({ calls: 2, callsDone: 2, daysAdded: 2, punchesAdded: 8 });
      expect(run.skipped.find((s) => s.reason === 'unreadable')).toBeUndefined();
      // the first day asked twice (the format named, then not), the next once, the way kept
      expect(bensCalls(from).map((c) => c.dateFormat)).toEqual(['dd-MMM-yyyy', null, null]);
      const day = await zohoDayOf('ben', d(9));
      expect(day!.checkIn).toEqual(at(d(9), '09:00'));
      expect(day!.checkOut).toEqual(at(d(9), '18:00'));
      expect(day!.pairs).toHaveLength(2);
      expect(day!.hoursCounted.toNumber()).toBe(9);
    });

    it('reads the day’s first check-in and last check-out when no way brings them whole, and asks once a day after', async () => {
      zoho.timeless('always');
      zoho.day(emails.ben, d(11), zohoDay(d(11), [['09:00', '13:00'], ['14:00', '18:00']]));
      zoho.day(emails.ben, d(12), zohoDay(d(12), [['10:00', '19:00']]));
      const from = attendanceCalls().length;
      const run = await fetchRun('hr', d(11), d(12), ['ben']);
      expect(run).toMatchObject({ status: 'finished', errors: [] });
      expect(run.counts).toMatchObject({ daysAdded: 2, punchesAdded: 4 });
      // the way kept, then the two others, then none again: the first check-in and last check-out
      expect(bensCalls(from).map((c) => c.dateFormat)).toEqual([null, 'dd-MMM-yyyy', 'dd-MMM-yyyy HH:mm', null]);
      const first = await zohoDayOf('ben', d(11));
      expect(first!.checkIn).toEqual(at(d(11), '09:00'));
      expect(first!.checkOut).toEqual(at(d(11), '18:00'));
      expect(first!.pairs).toEqual([{ in: at(d(11), '09:00').toISOString(), out: at(d(11), '18:00').toISOString() }]);
      expect((await zohoDayOf('ben', d(12)))!.checkOut).toEqual(at(d(12), '19:00'));
      zoho.timeless('off');
    });
  });

  describe('Zoho’s limits, the range, cancelling', () => {
    it('spaces its calls one a second, and waits out Zoho’s lock before trying again', async () => {
      const calls = attendanceCalls();
      for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(1000);
      const from = calls.length;
      zoho.lock(1);
      const run = await fetchRun('hr', Y, Y, ['ana']);
      expect(run.counts).toMatchObject({ callsDone: 1, daysUnchanged: 1 });
      const [locked, again] = attendanceCalls().slice(from);
      expect(again.at - locked.at).toBeGreaterThanOrEqual(10 * 60_000);
      expect(run.waitingUntil).toBeNull();
    });

    it('fetches 12 months at most, up to yesterday', async () => {
      expect(said(await as('hr').post('/zoho-people/runs', { from: addDays(Y, -400), to: Y, employeeIds: [] }).expect(400))[0]).toMatch(/^Fetch 12 months at most at a time/);
      expect(said(await as('hr').post('/zoho-people/runs', { from: Y, to: TODAY, employeeIds: [] }).expect(400))).toEqual(['Fetch up to yesterday: today’s check-ins are fetched tonight.']);
      expect(said(await as('hr').post('/zoho-people/runs', { from: Y, to: Y, employeeIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400))).toEqual(['Employee not found. Choose the people from the list.']);
    });

    it('refuses a run while another goes, and cancels one before its next call', async () => {
      const release = zoho.hold();
      const started = (await as('hr').post('/zoho-people/runs', { from: addDays(Y, -4), to: Y, employeeIds: [ids.ana] }).expect(201)).body as ZohoRunView;
      expect(started).toMatchObject({ status: 'running', counts: { calls: 5 } });
      expect(started.minutesLeft).toBeGreaterThanOrEqual(1);
      expect(said(await as('hr').post('/zoho-people/runs', { from: Y, to: Y, employeeIds: [] }).expect(409))).toEqual([ZOHO_PEOPLE_RUN_GOING]);
      expect(((await as('hr').get('/zoho-people').expect(200)).body as ZohoPeopleView).current?.id).toBe(started.id);
      const cancelling = (await as('hr').post(`/zoho-people/runs/${started.id}/cancel`).expect(200)).body as ZohoRunView;
      expect(cancelling.cancelRequested).toBe(true);
      release();
      await sync.whenDone(started.id);
      const run = (await as('hr').get(`/zoho-people/runs/${started.id}`).expect(200)).body as ZohoRunView;
      expect(run.status).toBe('cancelled');
      expect(run.counts.callsDone).toBeLessThan(5);
      const actions = (await prisma.auditLog.findMany({ where: { entityType: 'zoho_people_run', entityId: started.id } })).map((a) => a.action).sort();
      expect(actions).toEqual(['cancel', 'cancelled', 'create']);
    });
  });

  describe('Zoho down at night', () => {
    it('fails the night’s fetch after trying again, tells HR on the dashboard, and is quiet once the day is fetched again', async () => {
      // the first night moved back a day, so tonight's run is yesterday's again
      await prisma.zohoPeopleRun.updateMany({ where: { kind: 'nightly', nightlyFor: toDateOnly(Y) }, data: { nightlyFor: toDateOnly(addDays(Y, -1)) } });
      zoho.down(true);
      const before = attendanceCalls().length;
      const id = await sync.nightlyIfDue(at(TODAY, '02:10'));
      expect(id).not.toBeNull();
      await sync.whenDone(id!);
      const failed = (await as('hr').get(`/zoho-people/runs/${id}`).expect(200)).body as ZohoRunView;
      expect(failed).toMatchObject({ kind: 'nightly', from: Y, to: Y, status: 'failed' });
      expect(failed.problem).toContain('fetch the rest again later');
      // asked four times: at once, then after 30 seconds, 2 minutes and 5 minutes
      const tries = attendanceCalls().slice(before);
      expect(tries).toHaveLength(4);
      expect(tries[1].at - tries[0].at).toBeGreaterThanOrEqual(30_000);
      expect(tries[3].at - tries[2].at).toBeGreaterThanOrEqual(300_000);
      const note = noteOf(await as('superAdmin').get('/zoho-people/note').expect(200));
      expect(note).toMatchObject({ tone: 'danger' });
      expect(note!.text).toContain(`The nightly fetch from Zoho People for ${Y} failed`);
      zoho.down(false);
      // a test while Zoho's lock holds: said at once
      app.get(ZohoPeopleHttp).holdUntil(clock.now() + 10 * 60_000);
      expect(said(await as('superAdmin').post('/zoho-people/test', {}).expect(409))[0]).toMatch(/^Zoho People asked to wait/);
      await clock.sleep(10 * 60_000);
      const again = await fetchRun('hr', Y, Y, null);
      expect(again.status).toBe('finished');
      expect(noteOf(await as('hr').get('/zoho-people/note').expect(200))).toBeNull();
    });
  });

  describe('a refused sign-in, and disconnecting', () => {
    it('fails the run, marks the connection to connect again, and tells HR on the dashboard', async () => {
      expect(noteOf(await as('hr').get('/zoho-people/note').expect(200))).toBeNull();
      zoho.revoke();
      const run = await fetchRun('hr', Y, Y, ['ana']);
      expect(run.status).toBe('failed');
      expect(run.problem).toContain('connects Zoho People again');
      expect(await prisma.zohoPeopleConnection.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ status: 'needs_reconnecting' });
      const note = noteOf(await as('hr').get('/zoho-people/note').expect(200));
      expect(note).toMatchObject({ tone: 'danger' });
      expect(note!.text).toContain('needs connecting again');
      expect(said(await as('hr').post('/zoho-people/runs', { from: Y, to: Y, employeeIds: [] }).expect(400))[0]).toContain('connect');
      expect(await sync.nightlyIfDue(at(addDays(TODAY, 1), '02:30'))).toBeNull();
    });

    it('disconnects for a Super Admin, audited; no token or secret in any answer or audit entry', async () => {
      const view = (await as('superAdmin').post('/zoho-people/disconnect').expect(200)).body as ZohoPeopleView;
      expect(view.connection).toBeNull();
      expect(await prisma.zohoPeopleConnection.count()).toBe(0);
      const actions = new Set((await prisma.auditLog.findMany({ where: { entityType: 'zoho_people_connection' } })).map((a) => a.action));
      for (const a of ['connect', 'test_zoho_people', 'needs_reconnecting', 'disconnect']) expect(actions).toContain(a);
      const audit = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: { in: ['zoho_people_connection', 'zoho_people_run', 'attendance_day', 'calendar_settings'] } }, select: { action: true, entityType: true, diff: true } }));
      const all = JSON.stringify(answers);
      for (const s of zoho.secrets) {
        expect(audit).not.toContain(s);
        expect(all).not.toContain(s);
      }
      expect(all).not.toContain('Mahrouqi');
    });
  });
});
