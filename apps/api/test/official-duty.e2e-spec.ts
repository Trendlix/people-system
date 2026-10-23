import type { INestApplication } from '@nestjs/common';
import { HIDDEN, OD_CHECK_IN_TEXT, OFF_NETWORK_MESSAGE, zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Official duty (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode beside
// Office and WFH, needing an approved request"; asked, "Manager, then HR", "Ahead or up to 3 days after", "Check in from
// anywhere"): asked ahead, the same day and 2 days after (marked requested after), refused 4 days after; refused over
// leave, a work from home day or another official duty; decided by the direct manager then HR, rejected with a comment,
// cancelled while being decided and by HR once approved; a check-in from outside the office on an approved day taken
// (the network's lock and the office's rule waived, the press marked), refused without one; a day gone by without a
// press attended for its hours, never absent, and the payroll counting it; a C-level person's HR stage the CEO's; the
// notifications; a developer's view masked. These tests look at their own people (names end with RUN) and delete what
// they made. Every name, point and address is invented.

const RUN = `od${Date.now().toString(36)}`;
const TODAY = todayInCairo();

const OFFICE = { name: `Head ${RUN}`, latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
const FAR = { latitude: 29.9792, longitude: 31.1342, accuracy: 30 };

interface View {
  id: string;
  kind: 'od';
  employee: { id: string; fullNameEn: string };
  type: { nameEn: string };
  startDate: string;
  endDate: string;
  fullDay: boolean;
  fromTime: string | null;
  toTime: string | null;
  dutyPlace: string;
  reason: string;
  late: boolean;
  status: string;
  stage: string | null;
  waitingForYou: boolean;
  confidential: boolean;
  canCancel: boolean;
  hrCanCancel: boolean;
  manager: { id: string; fullNameEn: string; role: string } | null;
  rejectedStage: string | null;
  rejectReason: string | null;
  steps: { kind: string; decision: string | null; comment: string | null; actor: string | null }[];
}

interface Line {
  id: string;
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null };
  result: { attendanceScore: number } | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const kinds = (v: View) => v.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('Official duty (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let ceo: string;
  let ceoUserId: string;
  let hrSuper: string;
  let developer: string;
  let emailDomainBefore: string | null;
  let networksBefore: { officeNetworks: unknown; officeNetworkLock: boolean };
  let deptId: string;
  let shiftId: string;
  let holidays: Set<string>;
  const locations: string[] = [];
  const runs: string[] = [];
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  /** The first day from `from` on (or back, with `step` -1) that isn't an official holiday. */
  const free = (from: string, step = 1) => {
    let d = from;
    while (holidays.has(d)) d = addDays(d, step);
    return d;
  };

  /** A profile with a sign-in account, hired from 2024 under the every-day shift unless said; a signed contract if `signed`. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, opts: { session?: () => string; signed?: boolean } = {}) {
    const session = opts.session ?? (() => hr);
    const email = await createUser(prisma, ['employee']);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, shiftId, workArrangement: 'office', ...employment })
      .expect(201);
    if (opts.signed) {
      const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', session()).send({ grossSalary: 15000, durationMonths: 24 }).expect(201))
        .body as { id: string; startDate: string };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session()).send({ signedOn: draft.startDate }).expect(200);
    }
  }

  const ask = (key: string, body: Record<string, unknown>) => api().post('/api/me/official-duty').set('Cookie', sessions[key]).send({ place: 'Client office, New Cairo', reason: 'Launch shoot', ...body });
  const decide = (id: string, session: string, body: object = { decision: 'approve' }) => api().post(`/api/official-duty/${id}/decide`).set('Cookie', session).send(body);
  const one = async (id: string, session = hr) => (await api().get(`/api/official-duty/${id}`).set('Cookie', session).expect(200)).body as View;
  const inbox = (key: string | { userId: string }) =>
    prisma.notification.findMany({ where: { userId: typeof key === 'string' ? users[key] : key.userId, kind: { startsWith: 'od_' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { kind: true, title: true, body: true, link: true } });
  const punch = (key: string, body: Record<string, unknown>) => api().post('/api/me/attendance/punches').set('Cookie', sessions[key]).send(body);
  const lineOf = async (runId: string, key: string) => ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body as { lines: Line[] }).lines.find((l) => l.employeeId === ids[key])!;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    ceoUserId = (await prisma.user.findUniqueOrThrow({ where: { email: ceoEmail } })).id;
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    // a developer account (22 October 2026): a Super Admin's sight, read only, personal data hidden
    developer = await signIn(app, await createUser(prisma, ['developer']));

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    const s = await prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { officeNetworks: true, officeNetworkLock: true } });
    networksBefore = { officeNetworks: s.officeNetworks, officeNetworkLock: s.officeNetworkLock };
    holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Official Duty ${RUN}` }).expect(201)).body.id;
    // a shift working every day, so the days these tests pick are working days whatever the weekday
    shiftId = (
      await prisma.shift.create({
        data: { code: `O${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    await person('mona', 'Mona Manager');
    // under a signed contract from 6 months ago, so the month's payroll run has his line
    await person('ben', 'Ben Away', { managerId: ids.mona, joinDate: firstDay(monthsLater(TODAY.slice(0, 7), -6)) }, { signed: true });
    await person('nora', 'Nora Alone', { departmentId: null });
    await person('lina', 'Lina Leave', { managerId: ids.mona });
    await person('olga', 'Olga Office', { managerId: ids.mona });
    await person('omar', 'Omar Office', { managerId: ids.mona });
    // a free month for the payroll run below: none left by another test
    await api().patch('/api/wfh/settings').set('Cookie', hr).send({ daysPerMonth: 2, minGapDays: 7 }).expect(200);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.checkInLocation.deleteMany({ where: { id: { in: locations } } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: networksBefore.officeNetworks as object[], officeNetworkLock: networksBefore.officeNetworkLock } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('asking for an official duty', () => {
    it('reads the form: today, 3 days back, the shift', async () => {
      expect((await api().get('/api/me/official-duty/form').set('Cookie', sessions.ben).expect(200)).body).toEqual({
        today: TODAY,
        earliest: addDays(TODAY, -3),
        shift: { startTime: '09:00', endTime: '19:00', graceMinutes: 15 },
        refusal: null,
        toCeo: false,
      });
    });

    it('is asked ahead, the same day, and up to 3 days after (requested after); 4 days after is refused', async () => {
      const ahead = free(addDays(TODAY, 5));
      const sent = (await ask('ben', { startDate: ahead }).expect(201)).body as View;
      expect(sent).toMatchObject({
        kind: 'od',
        type: { nameEn: 'Official duty' },
        startDate: ahead,
        endDate: ahead,
        fullDay: true,
        fromTime: null,
        toTime: null,
        dutyPlace: 'Client office, New Cairo',
        reason: 'Launch shoot',
        late: false,
        status: 'with_manager',
        stage: 'manager',
        canCancel: true,
        hrCanCancel: false,
        manager: { id: ids.mona, role: 'direct_manager' },
      });
      expect(kinds(sent)).toEqual(['submitted']);
      // Mona is told, and sees it waiting for her
      expect(await inbox('mona')).toEqual([{ kind: 'od_waiting', title: 'An official duty request is waiting for you', body: `Ben Away ${RUN}, ${shown(ahead)}`, link: `/attendance/official-duty/${sent.id}` }]);
      expect(((await api().get('/api/official-duty?status=waiting').set('Cookie', sessions.mona).expect(200)).body as View[]).map((r) => r.id)).toEqual([sent.id]);
      expect((await api().get('/api/official-duty/counts').set('Cookie', sessions.mona).expect(200)).body).toEqual({ waiting: 1 });

      // the same day, part of it
      const today = free(TODAY);
      if (today === TODAY) {
        const part = (await ask('ben', { startDate: TODAY, fullDay: false, fromTime: '10:00', toTime: '12:00' }).expect(201)).body as View;
        expect(part).toMatchObject({ fullDay: false, fromTime: '10:00', toTime: '12:00', late: false });
        ids.benToday = part.id;
      }
      // 2 days after (or 1 or 3, should it be a holiday): requested after
      const after = [-2, -1, -3].map((n) => addDays(TODAY, n)).find((d) => !holidays.has(d))!;
      const late = (await ask('ben', { startDate: after, reason: 'Forgot to ask before the visit' }).expect(201)).body as View;
      expect(late).toMatchObject({ startDate: after, late: true, status: 'with_manager' });
      ids.benAfter = late.id;
      ids.benAhead = sent.id;
      // 4 days after: refused
      const four = addDays(TODAY, -4);
      expect(said(await ask('ben', { startDate: four }).expect(400))[0]).toBe(
        `${shown(four)} is more than 3 days ago: ask for an official duty ahead, or within 3 days after the day (from ${shown(addDays(TODAY, -3))}).`,
      );
      // the reason and the place are required; part of a day is one day, inside the shift
      expect(said(await ask('ben', { startDate: free(addDays(TODAY, 20)), reason: '', place: '' }).expect(400))).toEqual([
        'Write where the official duty is, e.g. the client’s office in New Cairo.',
        'Write what the official duty is for, e.g. a site visit for the client’s launch.',
      ]);
      expect(said(await ask('ben', { startDate: free(addDays(TODAY, 20)), fullDay: false, fromTime: '07:00', toTime: '08:00' }).expect(400))).toEqual([
        'Choose times within your shift, 9:00 AM to 7:00 PM.',
      ]);
      // the audit log has it
      expect((await prisma.auditLog.findFirst({ where: { entityType: 'od_request', entityId: sent.id } }))?.action).toBe('create');
    });

    it('isn’t over leave, a work from home day or another official duty', async () => {
      const types = Object.fromEntries(((await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]).map((t) => [t.key, t.id]));
      const leaveDay = free(addDays(TODAY, 10));
      await api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids.lina).field('typeId', types.annual).field('startDate', leaveDay).field('endDate', leaveDay).expect(201);
      expect(said(await ask('lina', { startDate: leaveDay }).expect(400))).toEqual([`You have Annual leave on ${shown(leaveDay)} (approved): an official duty can't be on a day of leave.`]);
      const wfhDay = free(addDays(TODAY, 12));
      await api().post('/api/wfh').set('Cookie', hr).send({ employeeId: ids.lina, date: wfhDay, reason: 'Asked by phone' }).expect(201);
      expect(said(await ask('lina', { startDate: wfhDay }).expect(400))).toEqual([`You have a work from home day on ${shown(wfhDay)} (approved): ask for one or the other.`]);
      // several days over both: each said
      const [from, to] = [leaveDay < wfhDay ? leaveDay : wfhDay, leaveDay < wfhDay ? wfhDay : leaveDay];
      expect(said(await ask('lina', { startDate: from, endDate: to }).expect(400))).toHaveLength(2);
      // another official duty on the same day
      const [ahead] = ((await api().get(`/api/official-duty?employeeId=${ids.ben}`).set('Cookie', hr).expect(200)).body as View[]).filter((r) => r.id === ids.benAhead);
      expect(said(await ask('ben', { startDate: ahead.startDate }).expect(400))).toEqual([`You have an official duty on ${shown(ahead.startDate)} already (with the manager).`]);
    });
  });

  describe('deciding it', () => {
    it('goes to the direct manager, then HR; the employee told of the decision', async () => {
      const id = ids.benAhead;
      await decide(id, hr).expect(409);
      await decide(id, sessions.ben).expect(403);
      await decide(id, sessions.nora).expect(404);
      expect((await decide(id, sessions.mona).expect(200)).body).toMatchObject({ status: 'with_hr', stage: 'hr' });
      expect((await inbox({ userId: hrUserId })).map((n) => n.link)).toContain(`/attendance/official-duty/${id}`);
      const approved = (await decide(id, hr).expect(200)).body as View;
      expect(approved).toMatchObject({ status: 'approved', stage: null, canCancel: false, hrCanCancel: true });
      expect(kinds(approved)).toEqual(['submitted', 'manager_decision:approve', 'hr_decision:approve']);
      expect((await inbox('ben')).at(-1)).toEqual({ kind: 'od_decided', title: 'Official duty request approved', body: shown(approved.startDate), link: `/attendance/official-duty/${id}` });
      expect((await prisma.auditLog.findMany({ where: { entityType: 'od_request', entityId: id }, orderBy: { id: 'asc' } })).map((l) => l.action)).toEqual(['create', 'approve', 'approve']);
      // in Ben's own, in HR's list, and on the calendar
      expect(((await api().get('/api/me/official-duty').set('Cookie', sessions.ben).expect(200)).body as View[]).map((r) => r.id)).toContain(id);
      const calendar = (await api().get(`/api/official-duty/calendar?from=${approved.startDate}&to=${approved.endDate}`).set('Cookie', sessions.mona).expect(200)).body as { id: string; kind: string }[];
      expect(calendar.find((c) => c.id === id)).toMatchObject({ kind: 'od', startDate: approved.startDate, status: 'approved', fullDay: true, type: { nameEn: 'Official duty' } });
      // the employee may no longer cancel it; HR does, saying why
      expect(said(await api().post(`/api/me/official-duty/${id}/cancel`).set('Cookie', sessions.ben).expect(409))).toEqual([
        'This official duty is approved, so it can no longer be cancelled here. Ask HR to cancel it.',
      ]);
    });

    it('without a manager goes straight to HR; rejected with a comment; cancelled while being decided', async () => {
      const day = free(addDays(TODAY, 6));
      const nora = (await ask('nora', { startDate: day, endDate: free(addDays(day, 2)) }).expect(201)).body as View;
      expect(nora).toMatchObject({ status: 'with_hr', manager: null });
      expect(kinds(nora)).toEqual(['submitted', 'no_manager']);
      expect(said(await decide(nora.id, hr, { decision: 'reject' }).expect(400))).toEqual(['Write a comment: why the official duty is rejected.']);
      expect((await decide(nora.id, hr, { decision: 'reject', comment: 'The client moved the visit' }).expect(200)).body).toMatchObject({
        status: 'rejected',
        rejectedStage: 'hr',
        rejectReason: 'The client moved the visit',
      });
      expect((await inbox('nora')).at(-1)).toMatchObject({ kind: 'od_decided', title: 'Official duty request rejected' });
      // cancelled by its employee while being decided, once; nobody else
      const again = (await ask('nora', { startDate: free(addDays(TODAY, 15)) }).expect(201)).body as View;
      await api().post(`/api/me/official-duty/${again.id}/cancel`).set('Cookie', sessions.ben).expect(404);
      const cancelled = (await api().post(`/api/me/official-duty/${again.id}/cancel`).set('Cookie', sessions.nora).expect(200)).body as View;
      expect(cancelled).toMatchObject({ status: 'cancelled', canCancel: false });
      expect(kinds(cancelled)).toEqual(['submitted', 'no_manager', 'cancelled']);
      await api().post(`/api/me/official-duty/${again.id}/cancel`).set('Cookie', sessions.nora).expect(409);
    });

    it('a C-level person’s HR stage is the CEO’s: HR neither sees, decides nor is told of it', async () => {
      const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
      await person('cleo', 'Cleo Chief', { departmentId: null, gradeId: g9.id }, { session: () => hrSuper });
      const asked = (await ask('cleo', { startDate: free(addDays(TODAY, 4)) }).expect(201)).body as View;
      expect(asked).toMatchObject({ status: 'with_hr', confidential: true });
      await api().get(`/api/official-duty/${asked.id}`).set('Cookie', hr).expect(404);
      await decide(asked.id, hr).expect(404);
      expect(((await api().get('/api/official-duty').set('Cookie', hr).expect(200)).body as View[]).map((r) => r.id)).not.toContain(asked.id);
      expect((await inbox({ userId: hrUserId })).map((n) => n.link)).not.toContain(`/attendance/official-duty/${asked.id}`);
      expect((await inbox({ userId: ceoUserId })).map((n) => n.link)).toContain(`/attendance/official-duty/${asked.id}`);
      expect((await decide(asked.id, ceo).expect(200)).body).toMatchObject({ status: 'approved', confidential: true });
    });

    it('shows a developer the request with its place and reason hidden, and changes nothing', async () => {
      const seen = (await api().get(`/api/official-duty/${ids.benAhead}`).set('Cookie', developer).expect(200)).body as View;
      expect(seen).toMatchObject({ dutyPlace: HIDDEN, reason: HIDDEN, status: 'approved' });
      expect(seen.employee.fullNameEn).not.toContain('Ben Away');
      await decide(ids.benAfter, developer).expect(403);
    });
  });

  describe('an approved day at check-in', () => {
    it('takes a check-in from outside the office off the office network, marked; without one it is refused as today', async () => {
      locations.push((await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(OFFICE).expect(201)).body.id);
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [{ label: 'Main office line', range: '41.33.10.0/24' }], officeNetworkLock: true } });
      // Olga's official duty today, approved by Mona then HR
      const od = (await ask('olga', { startDate: TODAY }).expect(201)).body as View;
      await decide(od.id, sessions.mona).expect(200);
      await decide(od.id, hr).expect(200);
      const view = (await api().get('/api/me/attendance/today').set('Cookie', sessions.olga).expect(200)).body;
      expect(view).toMatchObject({
        officialDuty: { requestId: od.id, fullDay: true, now: true },
        network: { locked: false },
        expected: 'anywhere',
        expectedText: OD_CHECK_IN_TEXT,
        workingFromHome: false,
      });
      // off the office network, far from the office: kept, not flagged, the spot kept, marked with the duty
      const kept = (await punch('olga', { kind: 'in', ...FAR }).expect(200)).body;
      expect(kept.punches.at(-1)).toMatchObject({ place: 'remote', flags: [], odRequestId: od.id, latitude: FAR.latitude });
      // Omar, without one, is locked out off the network, as today
      expect((await api().get('/api/me/attendance/today').set('Cookie', sessions.omar).expect(200)).body).toMatchObject({ officialDuty: null, network: { locked: true }, expected: 'office' });
      expect(said(await punch('omar', { kind: 'in', ...FAR }).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworkLock: false } });
      // Olga's month shows the duty day with its request
      const month = (await api().get(`/api/attendance/employees/${ids.olga}?month=${TODAY.slice(0, 7)}`).set('Cookie', hr).expect(200)).body;
      expect(month.person.odDays).toEqual([{ date: TODAY, requestId: od.id, fullDay: true, fromTime: null, toTime: null }]);
      expect(month.person.days.find((d: { date: string }) => d.date === TODAY)).toMatchObject({ status: 'worked', flags: [], od: { requestId: od.id, fullDay: true } });
    });
  });

  describe('a day gone by without a press', () => {
    it('is attended for the duty’s hours, never absent, and the payroll counts it', async () => {
      const id = ids.benAfter;
      const day = (await one(id)).startDate;
      const month = day.slice(0, 7);
      // Ben checks in on the system from 5 days before it: from then on a working day with no press is absent
      const first = addDays(day, -5);
      const at = (d: string, h: number) => new Date(zonedMoment(d, `${String(h).padStart(2, '0')}:00`));
      await prisma.attendanceDay.create({
        data: { employeeId: ids.ben, date: toDateOnly(first), status: 'worked', checkIn: at(first, 9), checkOut: at(first, 18), place: 'office', hoursCounted: 9, source: 'system', importedById: hrUserId },
      });
      const before = (await api().get(`/api/attendance/employees/${ids.ben}?month=${month}`).set('Cookie', hr).expect(200)).body;
      expect(before.person.days.find((d: { date: string }) => d.date === day)).toMatchObject({ status: 'absent' });
      // the month's draft payroll run, filled from the attendance
      const existing = await prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(month)) }, select: { id: true } });
      if (existing) throw new Error(`A payroll run for ${month} is left by another test: these tests need its month free.`);
      const runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body.id as string;
      runs.push(runId);
      const was = await lineOf(runId, 'ben');

      // approved: the day is attended for 9 hours, no longer a no-show
      await decide(id, sessions.mona).expect(200);
      await decide(id, hr).expect(200);
      const after = (await api().get(`/api/attendance/employees/${ids.ben}?month=${month}`).set('Cookie', hr).expect(200)).body;
      expect(after.person.days.find((d: { date: string }) => d.date === day)).toMatchObject({ status: 'worked', hoursCounted: 9, od: { requestId: id, fullDay: true }, missingCheckIn: false, missingCheckOut: false });
      expect(after.person.figures.absentDays).toBe(before.person.figures.absentDays - 1);
      expect(after.person.figures.hoursCounted).toBe(before.person.figures.hoursCounted + 9);
      const now = await lineOf(runId, 'ben');
      expect(now.inputs.noShowDays).toBe((was.inputs.noShowDays ?? 0) - 1);
      expect(now.inputs.workedHours).toBe((was.inputs.workedHours ?? 0) + 9);
      expect(now.result!.attendanceScore).toBeGreaterThan(was.result!.attendanceScore);

      // HR cancels it, saying why: absent again, the employee told
      expect(said(await api().post(`/api/official-duty/${id}/cancel`).set('Cookie', hr).send({ comment: '' }).expect(400))).toEqual(['Write why the official duty is cancelled.']);
      const cancelled = (await api().post(`/api/official-duty/${id}/cancel`).set('Cookie', hr).send({ comment: 'Recorded by mistake' }).expect(200)).body as View;
      expect(cancelled.steps.at(-1)).toMatchObject({ kind: 'cancelled', comment: 'Recorded by mistake' });
      expect((await inbox('ben')).at(-1)).toMatchObject({ kind: 'od_decided', title: 'Official duty cancelled by HR' });
      expect((await lineOf(runId, 'ben')).inputs.noShowDays).toBe(was.inputs.noShowDays);
    });
  });
});
