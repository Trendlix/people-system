import type { INestApplication } from '@nestjs/common';
import { EXEMPT_CHECK_IN_TEXT, zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { KpiAttendanceService } from '../src/kpis/kpi-attendance.service.js';
import { RemindersService } from '../src/notifications/reminders.service.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"). An exemption added on the profile or for several on Check-in Setup, its days full (not
// absent, short or late, a press kept for reference), the draft line refilled and the KPIs' Attendance full, unpaid leave
// still cut, the days before and after normal; never refused by the GPS lock, no reminders; who sets it (a C-level
// person's the CEO or a Super Admin; never one's own), overlaps and a paid month refused, "End now", the audit, a
// developer's sight. The first day to start with (owner, 26 October 2026: "auto fill his contract start date in the
// exempt from date"): their contract's start, else their join date, on the profile and Check-in Setup's people; saved in
// the past, the draft refilled; several each from their own. These tests look at their own people (names end with RUN),
// put the settings back and delete what they made. Every name, point and reason is invented.

const RUN = `ex${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const MONTH = monthsLater(CURRENT, -4); // its days past; a draft run
const PAID = monthsLater(CURRENT, -7); // a paid run

const MAIN = { name: `Exempt Office ${RUN}`, latitude: 30.212233, longitude: 31.512233, radiusMetres: 150 };
const FAR = { latitude: Math.round((MAIN.latitude + 1500 / 111_195) * 1e6) / 1e6, longitude: MAIN.longitude, accuracy: 10 };

interface Exemption {
  id: string;
  employee: { id: string; fullNameEn: string; department: string | null };
  reason: string;
  startDate: string;
  endDate: string | null;
  state: string;
  canEnd: boolean;
}

interface DayView {
  date: string;
  status: string;
  hoursCounted: number;
  shortHours: number;
  missingCheckIn: boolean;
  missingCheckOut: boolean;
  exempt: boolean;
  flags: string[];
  checkIn: string | null;
}

interface Line {
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null };
  result: { attendanceRatio: number | null; attendanceScore: number; unpaidLeaveCut?: number };
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('People exempt from check-in (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let ceo: string;
  let hrSuper: string;
  let finance: string;
  let developer: string;
  let hrUserId: string;
  let deptId: string;
  let emailDomainBefore: string | null;
  let settingsBefore: { gpsLock: boolean; gpsRoughMetres: number; officeNetworkLock: boolean; refuseWithoutLocation: boolean };
  const locations: string[] = [];
  const shifts: Record<string, string> = {};
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const users: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const contractNumbers: Record<string, string> = {};
  const runs: Record<string, string> = {};
  const work: string[] = []; // MONTH's Sundays to Thursdays, none a holiday
  let reminderDay: string;
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  /** A person hired with a signed contract (`contract`: its terms besides the pay; null: hired with none yet). */
  async function person(
    key: string,
    name: string,
    shiftId: string,
    employment: Record<string, unknown> = {},
    by = () => hr,
    roles: Parameters<typeof createUser>[1] = ['employee'],
    contract: Record<string, unknown> | null = {},
  ) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', by()).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', by())
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(PAID, -2)), departmentId: deptId, shiftId, workArrangement: 'office', ...employment })
      .expect(201);
    employments[key] = hired.body.employment.id;
    if (contract === null) return;
    const draft = (
      await api()
        .post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`)
        .set('Cookie', by())
        .send({ grossSalary: 15000, durationMonths: 36, ...contract })
        .expect(201)
    ).body as { id: string; number: string; startDate: string };
    contractNumbers[key] = draft.number;
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', by()).send({ signedOn: draft.startDate }).expect(200);
  }

  const add = (session: string, body: Record<string, unknown>) => api().post('/api/attendance/check-in-exemptions').set('Cookie', session).send(body);
  const end = (session: string, id: string) => api().post(`/api/attendance/check-in-exemptions/${id}/end`).set('Cookie', session);
  const monthOf = async (key: string, month = MONTH) =>
    (await api().get(`/api/attendance/employees/${ids[key]}?month=${month}`).set('Cookie', hr).expect(200)).body as {
      person: { days: DayView[]; figures: { absentDays: number; exemptDays: number; shortHours: number; daysWorked: number }; exemptions: { startDate: string; endDate: string | null }[] };
      punches: { date: string; kind: string }[];
    };
  const lineOf = async (key: string) => ((await api().get(`/api/payroll/runs/${runs[MONTH]}`).set('Cookie', hrSuper).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;
  const punch = (key: string, body: Record<string, unknown>) => api().post('/api/me/attendance/punches').set('Cookie', sessions[key]).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    admin = await signIn(app, await createUser(prisma, ['admin']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    developer = await signIn(app, await createUser(prisma, ['employee', 'developer']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    settingsBefore = await prisma.payrollSettings.findUniqueOrThrow({ where: { id: 1 }, select: { gpsLock: true, gpsRoughMetres: true, officeNetworkLock: true, refuseWithoutLocation: true } });
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Exempt Dept ${RUN}` }).expect(201)).body.id;
    const shift = async (key: string, workingDays: number[]) => {
      shifts[key] = (
        await prisma.shift.create({
          data: { code: `${key}${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays },
          select: { id: true },
        })
      ).id;
    };
    // the MORNING shift, Sunday to Thursday; and the same every day of the week (so today is a working day)
    await shift('M', [0, 1, 2, 3, 4]);
    await shift('W', [0, 1, 2, 3, 4, 5, 6]);
    await person('ezra', 'Ezra Exempt', shifts.M);
    await person('eva', 'Eva Exemptweek', shifts.M);
    await person('tara', 'Tara Today', shifts.W);
    await person('rhea', 'Rhea Rest', shifts.W);
    await person('ola', 'Ola Office', shifts.W);
    await person('nora', 'Nora Normal', shifts.W);
    await person('uma', 'Uma Upcoming', shifts.W);
    await person('hera', 'Hera Hr', shifts.W, {}, () => hr, ['hr']);
    const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
    await person('cleo', 'Cleo Chief', shifts.M, { gradeId: g9.id, departmentId: null }, () => hrSuper);
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(MONTH); d <= lastDay(MONTH); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work.push(d);
    reminderDay = TODAY;
    while (holidays.has(reminderDay)) reminderDay = addDays(reminderDay, 1);
    // the first day to start with (26 October 2026): Kai and Cora joined months ago, their contracts starting in MONTH;
    // Jade joined in MONTH and has no contract yet
    await person('kai', 'Kai Contractstart', shifts.M, {}, () => hr, ['employee'], { startDate: work[3] });
    await person('cora', 'Cora Ownstart', shifts.M, {}, () => hr, ['employee'], { startDate: work[5] });
    await person('jade', 'Jade Joinonly', shifts.M, { joinDate: work[6] }, () => hr, ['employee'], null);

    // Ezra: a late press, flagged, without a check-out; a day of unpaid leave approved
    await prisma.attendancePunch.create({ data: { employeeId: ids.ezra, date: toDateOnly(work[2]), kind: 'in', at: at(work[2], '11:40'), place: 'remote', expected: 'office', flags: ['outside_office'], source: 'system', userId: users.ezra } });
    await prisma.attendanceDay.create({
      data: { employeeId: ids.ezra, date: toDateOnly(work[2]), status: 'worked', checkIn: at(work[2], '11:40'), checkOut: null, place: 'remote', flags: ['outside_office'], hoursCounted: 0, source: 'system', importedById: hrUserId, pairs: [], openAt: at(work[2], '11:40'), breakMinutes: 0 },
    });
    const unpaid = (await prisma.leaveType.findUniqueOrThrow({ where: { key: 'unpaid' }, select: { id: true } })).id;
    await prisma.leaveRequest.create({ data: { employeeId: ids.ezra, employmentId: employments.ezra, typeId: unpaid, startDate: toDateOnly(work[4]), endDate: toDateOnly(work[4]), days: 1, status: 'approved', createdById: hrUserId } });
    // Eva: a full day on the system at the month's start, so the working days without one are absent
    await prisma.attendanceDay.create({
      data: { employeeId: ids.eva, date: toDateOnly(work[0]), status: 'worked', checkIn: at(work[0], '09:00'), checkOut: at(work[0], '18:00'), place: 'office', hoursCounted: 9, source: 'system', importedById: hrUserId, pairs: [{ in: at(work[0], '09:00').toISOString(), out: at(work[0], '18:00').toISOString() }], breakMinutes: 0 },
    });

    runs[MONTH] = (await api().post('/api/payroll/runs').set('Cookie', hrSuper).send({ month: MONTH }).expect(201)).body.id;
    runs[PAID] = (await api().post('/api/payroll/runs').set('Cookie', hrSuper).send({ month: PAID }).expect(201)).body.id;
    await prisma.payrollRun.update({ where: { id: runs[PAID] }, data: { status: 'paid', submittedAt: new Date(), approvedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.payrollSettings.update({ where: { id: 1 }, data: settingsBefore });
    await prisma.checkInLocation.deleteMany({ where: { id: { in: locations } } });
    await prisma.payrollRun.deleteMany({ where: { id: { in: Object.values(runs) } } });
    await prisma.reminderSent.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.checkInExemption.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: { in: Object.values(shifts) } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('adding one', () => {
    it('needs a reason and its dates in order; HR, an Admin and a Super Admin add it, Finance and an employee don’t', async () => {
      expect(said(await add(hr, { employeeIds: [ids.ezra], reason: ' ', startDate: firstDay(MONTH) }).expect(400))).toEqual(['Write why they are exempt from check-in, e.g. works at the client’s site all month.']);
      expect(said(await add(hr, { employeeIds: [ids.ezra], reason: 'At the client', startDate: lastDay(MONTH), endDate: firstDay(MONTH) }).expect(400))).toEqual(["The last day can't be before the first."]);
      expect(said(await add(hr, { employeeIds: [], reason: 'At the client' }).expect(400))).toEqual(['Choose at least one person to exempt from check-in.']);
      await add(finance, { employeeIds: [ids.ezra], reason: 'At the client' }).expect(403);
      await add(sessions.ola, { employeeIds: [ids.ezra], reason: 'At the client' }).expect(403);
    });

    it('never in a month whose payroll is paid, nor someone’s own', async () => {
      expect(said(await add(hr, { employeeIds: [ids.ezra], reason: 'At the client', startDate: firstDay(PAID) }).expect(409))[0]).toContain(`payroll is paid, so its days can't change`);
      expect(said(await add(sessions.hera, { employeeIds: [ids.hera], reason: 'My own' }).expect(403))[0]).toContain('nobody sets their own');
    });

    it('on the profile: the whole month for Ezra, audited, the draft line refilled at once', async () => {
      const lineBefore = await lineOf('ezra');
      expect(lineBefore.inputs.noShowDays).toBeGreaterThan(0);
      const made = (await add(hr, { employeeIds: [ids.ezra], reason: `Works at the client's site ${RUN}`, startDate: firstDay(MONTH), endDate: lastDay(MONTH) }).expect(201)).body.exemptions as Exemption[];
      expect(made).toEqual([expect.objectContaining({ employee: expect.objectContaining({ id: ids.ezra }), startDate: firstDay(MONTH), endDate: lastDay(MONTH), state: 'ended', canEnd: false })]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'check_in_exemption', entityId: made[0].id } });
      expect(audit).toMatchObject({ action: 'create', userId: hrUserId });
      expect(audit.diff).toMatchObject({ employeeId: ids.ezra, startDate: firstDay(MONTH), endDate: lastDay(MONTH) });
      const profile = (await api().get(`/api/employees/${ids.ezra}/check-in-exemptions`).set('Cookie', hr).expect(200)).body;
      expect(profile).toMatchObject({ canManage: true, current: null, periods: [{ id: made[0].id, state: 'ended' }] });
      // its overlap refused
      expect(said(await add(hr, { employeeIds: [ids.ezra], reason: 'Again', startDate: work[3] }).expect(409))[0]).toContain('is exempt from check-in already');
    });

    it('makes every working day full: not absent, short, late or missing a press; the press kept for reference; leave stays leave', async () => {
      const month = await monthOf('ezra');
      const days = month.person.days;
      expect(month.person.exemptions).toEqual([{ startDate: firstDay(MONTH), endDate: lastDay(MONTH) }]);
      expect(month.person.figures).toMatchObject({ absentDays: 0, shortHours: 0, exemptDays: work.length - 1 });
      for (const d of work.filter((x) => x !== work[4])) expect(days.find((x) => x.date === d)).toMatchObject({ status: 'worked', hoursCounted: 9, exempt: true, shortHours: 0, missingCheckOut: false, missingCheckIn: false });
      // the late press, flagged and without a check-out: kept and shown, never flagged nor missing
      expect(days.find((x) => x.date === work[2])).toMatchObject({ checkIn: at(work[2], '11:40').toISOString(), flags: [], exempt: true, hoursCounted: 9 });
      expect(month.punches.map((p) => `${p.date} ${p.kind}`)).toEqual([`${work[2]} in`]);
      // the unpaid leave approved: leave
      expect(days.find((x) => x.date === work[4])).toMatchObject({ status: 'leave', exempt: false });
      // never late in the history
      const history = (await api().get(`/api/attendance/employees/${ids.ezra}/history?period=custom&from=${firstDay(MONTH)}&to=${lastDay(MONTH)}`).set('Cookie', hr).expect(200)).body;
      expect(history.figures).toMatchObject({ lateDays: 0, absences: 0, exemptDays: work.length - 1 });
      expect(history.log.days.find((d: { date: string }) => d.date === work[2])).toMatchObject({ mode: 'exempt', onTime: true, lateMinutes: 0 });
    });

    it('fills the payroll full, unpaid leave still cut; the KPIs’ Attendance full', async () => {
      const line = await lineOf('ezra');
      expect(line.inputs).toMatchObject({ workedHours: 9 * (work.length - 1), noShowDays: 0 });
      expect(line.result.attendanceScore).toBe(1);
      expect(line.result.attendanceRatio).toBeCloseTo(1, 6);
      expect(line.result.unpaidLeaveCut ?? 0).toBeGreaterThan(0);
      const read = (await app.get(KpiAttendanceService).readMonth(MONTH, [ids.ezra])).get(ids.ezra)!;
      expect(read).toMatchObject({ source: 'payroll', score: 1 });
    });

    it('only within its dates: the days before and after are as before', async () => {
      await add(admin, { employeeIds: [ids.eva], reason: 'A week at the client', startDate: work[5], endDate: work[9] }).expect(201);
      const days = (await monthOf('eva')).person.days;
      expect(days.find((d) => d.date === work[3])).toMatchObject({ status: 'absent', exempt: false });
      expect(days.find((d) => d.date === work[5])).toMatchObject({ status: 'worked', exempt: true, hoursCounted: 9 });
      expect(days.find((d) => d.date === work[9])).toMatchObject({ status: 'worked', exempt: true });
      expect(days.find((d) => d.date === work[10])).toMatchObject({ status: 'absent', exempt: false });
      expect((await lineOf('eva')).inputs.noShowDays).toBe(work.length - 1 - 5);
    });

    it('a C-level person’s only by the CEO or a Super Admin: hidden from HR, the CEO not for anyone else', async () => {
      await add(hr, { employeeIds: [ids.cleo], reason: 'Board work' }).expect(404);
      await api().get(`/api/employees/${ids.cleo}/check-in-exemptions`).set('Cookie', hr).expect(404);
      expect(said(await add(ceo, { employeeIds: [ids.nora], reason: 'Not mine to set' }).expect(403))[0]).toContain('Only HR, an Admin or a Super Admin');
      const made = (await add(ceo, { employeeIds: [ids.cleo], reason: 'Board work', startDate: work[0], endDate: work[1] }).expect(201)).body.exemptions as Exemption[];
      expect(made).toHaveLength(1);
      expect(((await api().get('/api/attendance/check-in-exemptions').set('Cookie', hr).expect(200)).body.exemptions as Exemption[]).map((e) => e.employee.id)).not.toContain(ids.cleo);
    });
  });

  describe('Check-in Setup’s list', () => {
    it('adds several at once with one reason and period, lists them, and ends one now', async () => {
      const made = (await add(hr, { employeeIds: [ids.tara, ids.rhea], reason: `On the field team ${RUN}` }).expect(201)).body.exemptions as Exemption[];
      expect(made.map((e) => e.employee.id).sort()).toEqual([ids.tara, ids.rhea].sort());
      expect(made.every((e) => e.startDate === TODAY && e.endDate === null && e.state === 'current' && e.canEnd)).toBe(true);
      const list = (await api().get('/api/attendance/check-in-exemptions').set('Cookie', hr).expect(200)).body as { exemptions: Exemption[]; canAdd: boolean };
      expect(list.canAdd).toBe(true);
      expect(list.exemptions.filter((e) => [ids.tara, ids.rhea].includes(e.employee.id))).toHaveLength(2);
      // an ended one in the past isn't listed
      expect(list.exemptions.map((e) => e.employee.id)).not.toContain(ids.ezra);
      expect(await prisma.auditLog.count({ where: { entityType: 'check_in_exemption', action: 'create', entityId: { in: made.map((e) => e.id) } } })).toBe(2);
      // a developer sees the list, the reason hidden
      const seen = (await api().get('/api/attendance/check-in-exemptions').set('Cookie', developer).expect(200)).body.exemptions as Exemption[];
      expect(seen.find((e) => e.id === made[0].id)?.reason).toBe('••••');
    });

    it('cancels one not started yet: kept, never read, no longer listed', async () => {
      const [later] = (await add(hr, { employeeIds: [ids.uma], reason: 'Next week at the client', startDate: addDays(TODAY, 7) }).expect(201)).body.exemptions as Exemption[];
      expect(later.state).toBe('upcoming');
      expect((await end(hr, later.id).expect(200)).body).toEqual({ exemption: null, removed: true });
      expect((await prisma.checkInExemption.findUniqueOrThrow({ where: { id: later.id } })).cancelledAt).not.toBeNull();
      expect(((await api().get('/api/attendance/check-in-exemptions').set('Cookie', hr).expect(200)).body.exemptions as Exemption[]).map((e) => e.id)).not.toContain(later.id);
      await end(hr, later.id).expect(404);
      expect(await prisma.auditLog.count({ where: { entityType: 'check_in_exemption', action: 'cancel', entityId: later.id } })).toBe(1);
    });
  });

  // The owner, 26 October 2026: "when exempting someone from attendance auto fill his contract start date in the exempt
  // from date".
  describe('the first day to start with', () => {
    type Suggested = { date: string; source: string; contractNumber: string | null };
    const profileOf = async (key: string, session = hr) =>
      (await api().get(`/api/employees/${ids[key]}/check-in-exemptions`).set('Cookie', session).expect(200)).body as { canManage: boolean; suggestedFrom: Suggested | null };
    const picker = async (session = hr) => (await api().get('/api/attendance/check-in-setup/people').set('Cookie', session).expect(200)).body as { id: string; suggestedFrom: Suggested | null }[];

    it('the profile and Check-in Setup’s people carry their contract’s start, else their join date', async () => {
      expect(contractNumbers.kai).toMatch(/^CON-\d{4}-\d{4}$/);
      expect((await profileOf('kai')).suggestedFrom).toEqual({ date: work[3], source: 'contract', contractNumber: contractNumbers.kai });
      expect((await profileOf('jade')).suggestedFrom).toEqual({ date: work[6], source: 'join', contractNumber: null });
      // the person themself reads their periods but adds none: nothing to start with
      expect(await profileOf('kai', sessions.kai)).toMatchObject({ canManage: false, suggestedFrom: null });
      const people = await picker();
      expect(people.find((p) => p.id === ids.kai)?.suggestedFrom).toEqual({ date: work[3], source: 'contract', contractNumber: contractNumbers.kai });
      expect(people.find((p) => p.id === ids.cora)?.suggestedFrom).toEqual({ date: work[5], source: 'contract', contractNumber: contractNumbers.cora });
      expect(people.find((p) => p.id === ids.jade)?.suggestedFrom).toEqual({ date: work[6], source: 'join', contractNumber: null });
      // a C-level person stays hidden from HR, as today; the Super Admin's list has them, with theirs
      expect(people.map((p) => p.id)).not.toContain(ids.cleo);
      expect((await picker(hrSuper)).find((p) => p.id === ids.cleo)?.suggestedFrom).toEqual({ date: firstDay(monthsLater(PAID, -2)), source: 'contract', contractNumber: contractNumbers.cleo });
    });

    it('a developer never gets it: a contract’s start or a join date is an employment’s', async () => {
      expect((await profileOf('kai', developer)).suggestedFrom).toBeNull();
      const seen = await picker(developer);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((p) => p.suggestedFrom === null)).toBe(true);
    });

    it('a contract’s start in a paid month is refused, as before: those days never change, HR types a later one', async () => {
      const { suggestedFrom } = await profileOf('nora');
      expect(suggestedFrom).toEqual({ date: firstDay(monthsLater(PAID, -2)), source: 'contract', contractNumber: contractNumbers.nora });
      expect(said(await add(hr, { employeeIds: [ids.nora], reason: 'Since her contract started', startDate: suggestedFrom!.date }).expect(409))[0]).toMatch(
        /payroll is (paid|approved|with the CEO), so its days can't change: start the exemption from \d{2}\/\d{2}\/\d{4} or later\.$/,
      );
      expect(await prisma.checkInExemption.count({ where: { employeeId: ids.nora } })).toBe(0);
    });

    it('saved from the contract’s start, in the past: its days full from then, the draft refilled, the days before as they were', async () => {
      // no day of Kai's in the system yet: nothing worked on the draft line
      expect((await lineOf('kai')).inputs.workedHours ?? 0).toBe(0);
      const { suggestedFrom } = await profileOf('kai');
      const made = (await add(hr, { employeeIds: [ids.kai], reason: `Field work since the contract ${RUN}`, startDate: suggestedFrom!.date, endDate: lastDay(MONTH) }).expect(201)).body
        .exemptions as Exemption[];
      expect(made).toEqual([expect.objectContaining({ startDate: work[3], endDate: lastDay(MONTH), state: 'ended' })]);
      const days = (await monthOf('kai')).person.days;
      for (const d of work.slice(3)) expect(days.find((x) => x.date === d)).toMatchObject({ status: 'worked', exempt: true, hoursCounted: 9 });
      expect(days.find((x) => x.date === work[2])?.exempt ?? false).toBe(false);
      const after = await lineOf('kai');
      expect(after.inputs).toMatchObject({ noShowDays: 0, workedHours: 9 * (work.length - 3) });
    });

    it('several at once: each from their own first day unless one is typed, which is everyone’s', async () => {
      // the last day before someone's own first: refused, naming them
      expect(said(await add(hr, { employeeIds: [ids.cora, ids.jade], reason: 'Own days', ownStart: true, endDate: work[5] }).expect(400))).toEqual([
        `The last day can't be before Jade Joinonly ${RUN}’s first, ${shown(work[6])}.`,
      ]);
      // a day typed: everyone's
      const typed = (await add(hr, { employeeIds: [ids.cora, ids.jade], reason: 'A typed day', startDate: work[8], endDate: work[9], ownStart: true }).expect(201)).body.exemptions as Exemption[];
      expect(typed.map((e) => e.startDate)).toEqual([work[8], work[8]]);
      // none typed: each their own, Cora's contract's start and Jade's join date
      const own = (await add(hr, { employeeIds: [ids.cora, ids.jade], reason: `Own days ${RUN}`, ownStart: true, endDate: work[7] }).expect(201)).body.exemptions as Exemption[];
      expect(Object.fromEntries(own.map((e) => [e.employee.id, [e.startDate, e.endDate]]))).toEqual({ [ids.cora]: [work[5], work[7]], [ids.jade]: [work[6], work[7]] });
      const audits = await prisma.auditLog.findMany({ where: { entityType: 'check_in_exemption', action: 'create', entityId: { in: own.map((e) => e.id) } }, select: { diff: true } });
      expect(audits.map((a) => (a.diff as { startDate: string }).startDate).sort()).toEqual([work[5], work[6]].sort());
      // Cora's days from her own first day full; the profile's periods say each one's
      expect((await monthOf('cora')).person.days.find((d) => d.date === work[5])).toMatchObject({ status: 'worked', exempt: true });
      expect(((await api().get(`/api/employees/${ids.jade}/check-in-exemptions`).set('Cookie', hr).expect(200)).body.periods as Exemption[]).map((p) => p.startDate)).toEqual([work[8], work[6]]);
    });
  });

  describe('checking in while exempt', () => {
    beforeAll(async () => {
      const main = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(MAIN).expect(201)).body;
      locations.push(main.id);
      await api().put('/api/attendance/check-in-setup/gps-lock').set('Cookie', hr).send({ lock: true }).expect(200);
    });

    it('stays optional: the GPS lock refuses someone else off the check-in locations, never them, and nothing is flagged', async () => {
      await punch('ola', { kind: 'in', ...FAR }).expect(409);
      const today = (await api().get('/api/me/attendance/today').set('Cookie', sessions.tara).expect(200)).body;
      // never told they are exempt (owner, 31 October 2026: "dont show for the employee that he is exempted from checking
      // in and out"): no lock refuses them, and the screen reads as anyone's
      expect(today).toMatchObject({ exemption: null, gps: { locked: false }, network: { locked: false } });
      expect(today.expectedText ?? '').not.toContain(EXEMPT_CHECK_IN_TEXT);
      expect(today.expectedText ?? '').not.toMatch(/exempt/i);
      const kept = (await punch('tara', { kind: 'in', ...FAR }).expect(200)).body;
      expect(kept.punches.at(-1)).toMatchObject({ kind: 'in', flags: [] });
      expect(kept.day.flags).toEqual([]);
    });

    it('sends them no check-in or check-out reminder', async () => {
      const reminders = app.get(RemindersService);
      await prisma.reminderSent.deleteMany({ where: { userId: { in: Object.values(users) } } });
      await reminders.runOnce(at(reminderDay, '09:05'));
      const sent = async () => prisma.reminderSent.findMany({ where: { userId: { in: [users.rhea, users.ola] }, day: toDateOnly(reminderDay) }, select: { userId: true, kind: true } });
      // Ola, not exempt, is reminded to check in; Rhea, exempt, isn't
      expect((await sent()).map((s) => s.userId)).toEqual([users.ola]);
      // checked in and not out after the window: Nora is asked "Still checked in?", Rhea not
      await prisma.attendancePunch.createMany({
        data: ['nora', 'rhea'].map((key) => ({ employeeId: ids[key], date: toDateOnly(reminderDay), kind: 'in', at: at(reminderDay, '09:10'), place: 'office', expected: 'office', flags: [], source: 'system' })),
      });
      await reminders.runOnce(at(reminderDay, '19:30'));
      const outs = await prisma.reminderSent.findMany({ where: { userId: { in: [users.rhea, users.nora] }, day: toDateOnly(reminderDay), kind: 'check_out_reminder' }, select: { userId: true } });
      expect(outs.map((s) => s.userId)).toEqual([users.nora]);
    });

    it('ends now: today still exempt, ended once, audited', async () => {
      // the person themself sees none of it on their profile (owner, 31 October 2026), nor in their month
      expect((await api().get(`/api/employees/${ids.tara}/check-in-exemptions`).set('Cookie', sessions.tara).expect(200)).body).toEqual({ periods: [], current: null, canManage: false, suggestedFrom: null });
      const month = (await api().get('/api/attendance/me').set('Cookie', sessions.tara).expect(200)).body;
      expect(month.person.exemptions).toEqual([]);
      expect(month.person.figures.exemptDays).toBe(0);
      expect(month.person.days.filter((d: { exempt?: boolean; compensatory?: boolean }) => d.exempt && !d.compensatory)).toEqual([]);
      const mine = (await api().get(`/api/employees/${ids.tara}/check-in-exemptions`).set('Cookie', hr).expect(200)).body;
      expect(mine).toMatchObject({ canManage: true, current: { state: 'current', reason: `On the field team ${RUN}` } });
      const ended = (await end(hr, mine.current.id).expect(200)).body;
      expect(ended).toMatchObject({ removed: false, exemption: { endDate: TODAY, state: 'current' } });
      expect(said(await end(hr, mine.current.id).expect(409))[0]).toContain('ended meanwhile');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'check_in_exemption', action: 'end', entityId: mine.current.id } });
      expect(audit.diff).toMatchObject({ endDate: { from: null, to: TODAY } });
    });
  });
});
