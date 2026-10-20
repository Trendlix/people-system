import type { INestApplication } from '@nestjs/common';
import { zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { zohoWorkbook } from './fixtures/zoho.js';
import { createApp, createUser, signIn } from './helpers.js';

// Checking in on the system (owner, 19 October 2026, "Proceed with those": "Check-in through the system (phone or web
// with the office location check, or a device) to replace Zoho"). The office's point and radius on Payroll Setup; Check
// in and Check out at the server's time, office within the radius, remote outside it, unknown without a location, that,
// the accuracy and (owner, 20 October 2026: "Yes, keep the spot") the point pressed at kept with the press, never on the
// day; the rules by work arrangement flagging, never refusing; the same
// press twice kept once; who can't check in; the day kept from the punches (source 'system') and shown on Daily
// Attendance with its flags; and a draft run's lines filled from the month's attendance days ("from attendance",
// read-only), the working days gone by without a check-in absent, Zoho's days counted before the first check-in, a
// line with Zoho's days only left to Zoho, Refresh from attendance. These tests look at their own people (names end
// with RUN) and delete what they made. Every name and place is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const PAST = monthsLater(CURRENT, -3); // a month gone by: its days are past

// the office, at an invented point, and points near it and far from it (a check-in location since 20 October 2026: owner,
// "Own page, several locations", Attendance → Check-in Setup)
const OFFICE = { name: `Office ${RUN}`, latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
const NEAR = { latitude: 30.0601, longitude: 31.3465, accuracy: 18.4 };
const FAR = { latitude: 30.0444, longitude: 31.2357, accuracy: 25 };

interface Today {
  refusal: string | null;
  date: string;
  now: string;
  next: 'in' | 'out';
  punches: { kind: string; at: string; place: string; accuracyMetres: number | null; flags: string[]; latitude?: number | null; longitude?: number | null; pointFrom?: string | null }[];
  day: { checkIn: string | null; checkOut: string | null; place: string | null; flags: string[]; hoursCounted: number } | null;
  expected: string | null;
  expectedText: string | null;
  officeLocationSet: boolean;
  messages?: string[];
  kept?: boolean;
}

interface Line {
  id: string;
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null; permissionHours: number | null };
  attendanceImport: { source: string; importId?: string; fields: string[]; sources?: string[]; before?: Record<string, number | null> } | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Checking in on the system (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let hrUserId: string;
  let emailDomainBefore: string | null;
  const locations: string[] = [];
  let deptId: string;
  let shiftId: string;
  const runs: string[] = [];
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const work: string[] = []; // PAST's Sundays to Thursdays, none of them a holiday
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account, employed from 6 months before PAST, under a signed contract unless `signed` is false. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, signed = true) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(PAST, -6)), departmentId: deptId, shiftId, ...employment })
      .expect(201);
    if (signed) {
      const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 15000, durationMonths: 24 }).expect(201))
        .body as { id: string; startDate: string };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    }
  }

  const today = async (key: string) => (await api().get('/api/me/attendance/today').set('Cookie', sessions[key]).expect(200)).body as Today;
  const punch = (key: string, body: Record<string, unknown>) => api().post('/api/me/attendance/punches').set('Cookie', sessions[key]).send(body);
  const run = async (id: string, session = hr) => (await api().get(`/api/payroll/runs/${id}`).set('Cookie', session).expect(200)).body as { lines: Line[] };
  const lineOf = async (runId: string, key: string) => (await run(runId)).lines.find((l) => l.employeeId === ids[key])!;

  /** A day kept straight in attendance_days, as a source would keep it: times in Cairo. */
  function kept(key: string, date: string, source: 'zoho' | 'system', status: string, more: { in?: string; out?: string; hours?: number; place?: string } = {}) {
    const at = (t: string | undefined) => (t ? new Date(zonedMoment(date, t)) : null);
    return {
      employeeId: ids[key],
      date: toDateOnly(date),
      status,
      checkIn: at(more.in),
      checkOut: at(more.out),
      place: more.place ?? null,
      hoursCounted: more.hours ?? 0,
      source,
      importedById: hrUserId,
    };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Check-in Dept ${RUN}` }).expect(201)).body.id;
    // the MORNING shift: 9 hours within 9:00–19:00, 15 minutes' grace, Sunday to Thursday
    shiftId = (
      await prisma.shift.create({
        data: { code: `C${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    const wd = weekday(TODAY);
    await person('olga', 'Olga Office', { workArrangement: 'office' });
    await person('hugo', 'Hugo Hybridin', { workArrangement: 'hybrid', officeDays: [wd] }, false);
    await person('hela', 'Hela Hybridhome', { workArrangement: 'hybrid', officeDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== wd) }, false);
    await person('wael', 'Wael Wfh', { workArrangement: 'wfh' }, false);
    await person('fred', 'Fred Freelance', { employmentType: 'freelance' }, false);
    await person('nash', 'Nash Noshift', { shiftId: null }, false);
    await person('sami', 'Sami System');
    await person('zara', 'Zara Zohoonly');

    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(PAST); d <= lastDay(PAST); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work.push(d);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.checkInLocation.deleteMany({ where: { id: { in: locations } } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('Check-in Setup: the office’s location', () => {
    it('is a check-in location, a point and a radius, set by HR (Payroll Setup no longer takes it)', async () => {
      expect(said(await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send({ ...OFFICE, longitude: null }).expect(400))[0]).toContain('longitude');
      expect(said(await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send({ ...OFFICE, radiusMetres: 10 }).expect(400))[0]).toContain('from 20 to 5,000');
      expect(said(await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send({ ...OFFICE, latitude: 95 }).expect(400))[0]).toContain('latitude from -90 to 90');
      await api().post('/api/attendance/check-in-setup/locations').set('Cookie', finance).send(OFFICE).expect(403);
      const saved = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(OFFICE).expect(201)).body;
      locations.push(saved.id);
      expect(saved).toMatchObject(OFFICE);
      // the office's point on Payroll Setup moved here (20 October 2026: "Own page, several locations")
      expect(said(await api().patch('/api/payroll/settings').set('Cookie', hr).send({ officeLatitude: 30.06, officeLongitude: 31.3 }).expect(400))[0]).toContain(
        'Attendance → Check-in Setup',
      );
      expect((await api().get('/api/payroll/settings').set('Cookie', finance).expect(200)).body).not.toHaveProperty('officeLatitude');
    });
  });

  describe('who checks in', () => {
    it('is someone with a current employment under a shift, not a freelancer', async () => {
      expect((await today('olga')).refusal).toBeNull();
      const fred = await today('fred');
      expect(fred.refusal).toContain('A freelancer doesn’t check in');
      expect(said(await punch('fred', { kind: 'in', ...NEAR }).expect(403))[0]).toContain('A freelancer doesn’t check in');
      expect((await today('nash')).refusal).toContain('no shift yet');
      await punch('nash', { kind: 'in', ...NEAR }).expect(403);
      // a sign-in with no employee profile
      const nobody = await signIn(app, await createUser(prisma, ['employee']));
      expect(((await api().get('/api/me/attendance/today').set('Cookie', nobody).expect(200)).body as Today).refusal).toContain('no employee profile');
      await api().post('/api/me/attendance/punches').set('Cookie', nobody).send({ kind: 'in' }).expect(403);
      expect(said(await punch('olga', { kind: 'sideways' }).expect(400))).toEqual(['Choose to check in or check out.']);
    });
  });

  describe('Check in and Check out', () => {
    let monthRun: string;

    beforeAll(async () => {
      // this month's draft run, so a check-in fills Olga's line at once
      const existing = await prisma.payrollRun.findUnique({ where: { month: toDateOnly(firstDay(CURRENT)) }, select: { id: true } });
      if (existing) throw new Error(`A payroll run for ${CURRENT} is left by another test: these tests need its month free.`);
      monthRun = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: CURRENT }).expect(201)).body.id;
      runs.push(monthRun);
    });

    it('tells where they are expected, and that the next press is Check in', async () => {
      const t = await today('olga');
      expect(t).toMatchObject({ next: 'in', punches: [], day: null, expected: 'office', expectedText: 'You work at the office: check in there.', officeLocationSet: true });
      expect(t.date).toBe(TODAY);
      expect((await today('hugo')).expected).toBe('office');
      expect((await today('hela')).expected).toBe('anywhere');
      expect((await today('wael')).expected).toBe('anywhere');
    });

    it('checks in at the server’s time at the office within the radius, keeping the place, the accuracy and the spot', async () => {
      const before = Date.now();
      const res = (await punch('olga', { kind: 'in', ...NEAR }).expect(200)).body as Today;
      expect(res.kept).toBe(true);
      expect(res.next).toBe('out');
      expect(res.punches).toHaveLength(1);
      expect(res.punches[0]).toMatchObject({ kind: 'in', place: 'office', accuracyMetres: 18, flags: [] });
      expect(Date.parse(res.punches[0].at)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(res.punches[0].at)).toBeLessThanOrEqual(Date.now() + 1000);
      expect(res.messages?.[0]).toMatch(/^Checked in at \d{1,2}:\d{2} [AP]M, at the office\.$/);
      // their own press with its spot (owner, 20 October 2026: "Yes, keep the spot")
      expect(res.punches[0]).toMatchObject({ latitude: NEAR.latitude, longitude: NEAR.longitude, pointFrom: 'press' });

      // kept as a punch, with its point, and a day of source 'system', which has none
      const kept = await prisma.attendancePunch.findFirstOrThrow({ where: { employeeId: ids.olga } });
      expect([kept.latitude?.toNumber(), kept.longitude?.toNumber()]).toEqual([NEAR.latitude, NEAR.longitude]);
      const columns = (await prisma.$queryRaw<{ name: string }[]>`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'attendance_days'`).map((c) => c.name);
      expect(columns.some((c) => /lat|lon|coord|point/.test(c))).toBe(false);
      const day = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.olga, date: toDateOnly(TODAY), source: 'system' } } });
      expect(day).toMatchObject({ status: 'worked', place: 'office', flags: [] });
      expect(day.checkIn?.toISOString()).toBe(res.punches[0].at);
      expect(day.checkOut).toBeNull();
    });

    it('keeps the same press twice once, and checks out', async () => {
      const again = (await punch('olga', { kind: 'in', ...NEAR }).expect(200)).body as Today;
      expect(again.kept).toBe(false);
      expect(again.messages).toEqual(['Already checked in a moment ago: that press is kept once.']);
      expect(again.punches).toHaveLength(1);
      const out = (await punch('olga', { kind: 'out', ...FAR }).expect(200)).body as Today;
      expect(out.kept).toBe(true);
      expect(out.next).toBe('in');
      expect(out.punches.map((p) => `${p.kind} ${p.place}`)).toEqual(['in office', 'out remote']);
      // a check-out away from the office isn't flagged: only check-ins are
      expect(out.day).toMatchObject({ place: 'office', flags: [] });
      expect(out.day?.checkOut).toBe(out.punches[1].at);
    });

    it('flags a check-in outside the office on an office day, never refusing it', async () => {
      const res = (await punch('hugo', { kind: 'in', ...FAR }).expect(200)).body as Today;
      expect(res.punches[0]).toMatchObject({ place: 'remote', flags: ['outside_office'] });
      expect(res.messages).toContain('Checked in outside the office on an office day: it is kept, and your manager and HR see it flagged.');
      expect((await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: ids.hugo, source: 'system' } })).flags).toEqual(['outside_office']);
      // on a home day, anywhere
      const home = (await punch('hela', { kind: 'in', ...FAR }).expect(200)).body as Today;
      expect(home.punches[0]).toMatchObject({ place: 'remote', flags: [] });
    });

    it('keeps a check-in without a location as unknown: flagged on an office day only', async () => {
      const wael = (await punch('wael', { kind: 'in', locationError: 'denied' }).expect(200)).body as Today;
      expect(wael.punches[0]).toMatchObject({ place: 'unknown', accuracyMetres: null, flags: [] });
      expect(wael.messages).toContain('You didn’t allow the location: the check-in is kept as location unknown.');
      // Olga checks in again after lunch, the location unavailable: flagged, her day still from the first check-in
      const olga = (await punch('olga', { kind: 'in', locationError: 'unavailable' }).expect(200)).body as Today;
      expect(olga.punches.at(-1)).toMatchObject({ place: 'unknown', flags: ['location_unknown'] });
      expect(olga.messages?.[1]).toContain('Checked in again: your day still starts at');
      expect(olga.day).toMatchObject({ place: 'office', flags: ['location_unknown'] });
      expect(olga.next).toBe('out');
    });

    it('keeps a check-out without a check-in, with no hours, saying to ask for a correction', async () => {
      const res = (await punch('hela', { kind: 'out', ...NEAR }).expect(200)).body as Today;
      expect(res.kept).toBe(true);
      // Hela checked in earlier, so this is her check-out; Wael never checked out, Hugo's day has a check-in only
      const sami = (await punch('sami', { kind: 'out', ...NEAR }).expect(200)).body as Today;
      expect(sami.messages).toContain('You had not checked in today: the check-out is kept, with no hours counted. Ask for a correction to add the time you came in.');
      expect(sami.day).toMatchObject({ checkIn: null, hoursCounted: 0 });
      expect(sami.next).toBe('in');
    });

    it('shows the day on Daily Attendance with where it came from and its flags, and lists the flagged', async () => {
      const view = (await api().get(`/api/attendance?month=${CURRENT}&departmentId=${deptId}`).set('Cookie', hr).expect(200)).body as {
        people: { employee: { id: string }; checksIn: boolean; figures: { flaggedDays: number; missingCheckIns: number }; days: { date: string; source: string; flags: string[]; place: string | null; missingCheckIn: boolean }[] }[];
      };
      const of = (key: string) => view.people.find((p) => p.employee.id === ids[key])!;
      expect(of('hugo').checksIn).toBe(true);
      expect(of('hugo').days.find((d) => d.date === TODAY)).toMatchObject({ source: 'system', flags: ['outside_office'], place: 'remote' });
      expect(of('hugo').figures.flaggedDays).toBe(1);
      expect(of('sami').days.find((d) => d.date === TODAY)).toMatchObject({ missingCheckIn: true });
      expect(of('sami').figures.missingCheckIns).toBe(1);
      const flagged = (await api().get(`/api/attendance?month=${CURRENT}&departmentId=${deptId}&only=flagged`).set('Cookie', hr).expect(200)).body as { people: { employee: { id: string } }[] };
      expect(flagged.people.map((p) => p.employee.id).sort()).toEqual([ids.hugo, ids.olga].sort());
      // the employee sees theirs on My Attendance
      const mine = (await api().get(`/api/attendance/me?month=${CURRENT}`).set('Cookie', sessions.olga).expect(200)).body as {
        person: { days: { date: string; source: string }[] };
        punches: { date: string; kind: string; place: string }[];
      };
      expect(mine.person.days.find((d) => d.date === TODAY)?.source).toBe('system');
      // every press behind the day
      expect(mine.punches.map((p) => `${p.date} ${p.kind} ${p.place}`)).toEqual([`${TODAY} in office`, `${TODAY} out remote`, `${TODAY} in unknown`]);
    });

    it('fills this month’s draft line from the attendance days at once', async () => {
      const line = await lineOf(monthRun, 'olga');
      expect(line.attendanceImport).toMatchObject({ source: 'attendance', fields: ['workedHours', 'noShowDays', 'permissionHours'], sources: ['system'] });
      expect(line.inputs.noShowDays).toBe(0);
    });
  });

  describe('a draft run filled from the attendance days', () => {
    let pastRun: string;
    const at = (n: number) => work[n];

    beforeAll(async () => {
      // Zoho kept the first two working days (one worked, one absent); Sami checks in on the system from the third on,
      // a working day without a check-in absent from then; Zara has Zoho's days only
      await prisma.attendanceDay.createMany({
        data: [
          kept('sami', at(0), 'zoho', 'worked', { in: '09:00', out: '18:00', hours: 9, place: 'office' }),
          kept('sami', at(1), 'zoho', 'absent'),
          kept('sami', at(2), 'system', 'worked', { in: '10:00', out: '18:00', hours: 8, place: 'office' }),
          kept('sami', at(4), 'system', 'worked', { in: '09:00', out: '18:30', hours: 9, place: 'remote' }),
          kept('zara', at(0), 'zoho', 'worked', { in: '09:00', out: '17:00', hours: 8, place: 'office' }),
        ],
      });
      pastRun = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: PAST }).expect(201)).body.id;
      runs.push(pastRun);
    });

    /** The working days from the third on without a day kept: absent. */
    const absentSince = (keptDays: number) => work.slice(2).length - keptDays;

    it('fills the line of someone who checks in when the run is made, Zoho’s days counted before their first check-in', async () => {
      const line = await lineOf(pastRun, 'sami');
      expect(line.attendanceImport).toMatchObject({ source: 'attendance', sources: expect.arrayContaining(['zoho', 'system']) });
      expect(line.inputs.workedHours).toBe(26);
      // Zoho's absent day, and the working days gone by since the first check-in without one
      expect(line.inputs.noShowDays).toBe(1 + absentSince(2));
      expect(line.inputs.permissionHours).toBeNull();
      // someone with Zoho's days only is left to Zoho's import
      expect((await lineOf(pastRun, 'zara')).attendanceImport).toBeNull();
    });

    it('keeps the figures from attendance from being typed over', async () => {
      const line = await lineOf(pastRun, 'sami');
      const refused = await api().patch(`/api/payroll/runs/${pastRun}/lines`).set('Cookie', hr).send({ lines: [{ id: line.id, inputs: { workedHours: 100 } }] }).expect(409);
      expect(said(refused)[0]).toMatch(/^Worked hours for Sami System \S+ come from the attendance days \(filled \d{2}\/\d{2}\/\d{4}\): they change with the attendance itself/);
      // the other inputs are still HR's
      await api().patch(`/api/payroll/runs/${pastRun}/lines`).set('Cookie', hr).send({ lines: [{ id: line.id, inputs: { leaveDays: 0 } }] }).expect(200);
    });

    it('recomputes on Refresh from attendance: HR and the CEO, not Finance', async () => {
      await prisma.attendanceDay.create({ data: kept('sami', at(3), 'system', 'worked', { in: '09:00', out: '13:00', hours: 4, place: 'office' }) });
      await api().post(`/api/payroll/runs/${pastRun}/attendance-refresh`).set('Cookie', finance).expect(403);
      const refreshed = (await api().post(`/api/payroll/runs/${pastRun}/attendance-refresh`).set('Cookie', hr).expect(200)).body as { lines: Line[] };
      const line = refreshed.lines.find((l) => l.employeeId === ids.sami)!;
      expect(line.inputs.workedHours).toBe(30);
      expect(line.inputs.noShowDays).toBe(1 + absentSince(3));
      await api().post(`/api/payroll/runs/${pastRun}/attendance-refresh`).set('Cookie', ceo).expect(200);
      const logged = await prisma.auditLog.findFirst({ where: { action: 'refresh_attendance', entityId: pastRun }, orderBy: { at: 'desc' } });
      expect(logged?.diff).toMatchObject({ month: PAST });
    });

    it('shows the days gone by without a check-in as absent on Daily Attendance', async () => {
      const view = (await api().get(`/api/attendance/employees/${ids.sami}?month=${PAST}`).set('Cookie', hr).expect(200)).body as {
        person: { checksIn: boolean; figures: { absentDays: number; hoursCounted: number }; days: { date: string; status: string; source: string }[] };
      };
      expect(view.person.checksIn).toBe(true);
      expect(view.person.days.find((d) => d.date === at(1))).toMatchObject({ status: 'absent', source: 'zoho' });
      expect(view.person.days.find((d) => d.date === at(5))).toMatchObject({ status: 'absent', source: 'system' });
      expect(view.person.figures).toMatchObject({ absentDays: 1 + absentSince(3), hoursCounted: 30 });
      // the Summary counts them too
      const summary = (await api().get(`/api/attendance/summary?month=${PAST}`).set('Cookie', hr).expect(200)).body as { groups: { id: string | null; figures: { absentDays: number } }[] };
      expect(summary.groups.find((g) => g.id === deptId)?.figures.absentDays).toBe(1 + absentSince(3));
    });

    it('applies a Zoho import keeping the Zoho days of someone who checks in, their line from the attendance days; undone, the days left', async () => {
      // Zoho's file: Sami's first two working days (one worked, one absent) and Zara's
      const file = await zohoWorkbook([
        { id: `81-${RUN}`, name: `Sami System ${RUN}`, days: [{ date: at(0), in: '09:00', out: '18:00' }, { date: at(1), status: 'Absent' }] },
        { id: `82-${RUN}`, name: `Zara Zohoonly ${RUN}`, days: [{ date: at(0), in: '09:00', out: '17:00' }, { date: at(1), status: 'Absent' }] },
      ]);
      // the days kept straight above go: the import keeps its own
      await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: [ids.sami, ids.zara] }, source: 'zoho' } });
      const made = (await api().post(`/api/payroll/runs/${pastRun}/attendance-imports`).set('Cookie', hr).attach('files', file, 'zoho.xlsx').expect(201)).body as {
        id: string;
        people: { zohoName: string; checksIn: boolean; match: string }[];
      };
      expect(made.people.find((p) => p.zohoName.startsWith('Sami'))).toMatchObject({ match: 'exact', checksIn: true });
      expect(made.people.find((p) => p.zohoName.startsWith('Zara'))).toMatchObject({ match: 'exact', checksIn: false });
      await api().post(`/api/payroll/runs/${pastRun}/attendance-imports/${made.id}/apply`).set('Cookie', hr).expect(200);
      const sami = await lineOf(pastRun, 'sami');
      expect(sami.attendanceImport).toMatchObject({ source: 'attendance' });
      expect(sami.inputs).toMatchObject({ workedHours: 30, noShowDays: 1 + absentSince(3) });
      expect(await prisma.attendanceDay.count({ where: { employeeId: ids.sami, source: 'zoho', importId: made.id } })).toBe(2);
      const zara = await lineOf(pastRun, 'zara');
      expect(zara.attendanceImport).toMatchObject({ source: 'zoho', importId: made.id });
      expect(zara.inputs).toMatchObject({ workedHours: 8, noShowDays: 1 });

      const undone = (await api().post(`/api/payroll/runs/${pastRun}/attendance-imports/${made.id}/undo`).set('Cookie', hr).expect(200)).body as { undoable: number };
      expect(undone.undoable).toBe(0);
      // Sami's line without Zoho's days: the system's alone, the days before the first check-in not counted
      expect((await lineOf(pastRun, 'sami')).inputs).toMatchObject({ workedHours: 21, noShowDays: absentSince(3) });
      expect((await lineOf(pastRun, 'zara')).attendanceImport).toBeNull();
    });

    it('leaves a run sent to the CEO as it is', async () => {
      await api().post(`/api/payroll/runs/${pastRun}/submit`).set('Cookie', hr).expect(200);
      expect(said(await api().post(`/api/payroll/runs/${pastRun}/attendance-refresh`).set('Cookie', hr).expect(409))[0]).toContain("can't be refreshed from attendance");
    });
  });

  // The employee app on Android says when a location is a mock one (apps/mobile/README.md Phase 2, owner, 20 October
  // 2026: "Android mock location → mock: true on the punch → flagged ("Fake GPS suspected") on Daily Attendance").
  describe('fake GPS from the employee app', () => {
    beforeAll(async () => {
      await person('mila', 'Mila Mockgps', { workArrangement: 'wfh' }, false);
      await person('omar', 'Omar Officemock', { workArrangement: 'office' }, false);
    });

    it('keeps a check-in on a mock location like any other, with its spot, and flags it', async () => {
      const res = (await punch('mila', { kind: 'in', ...NEAR, mock: true }).expect(200)).body as Today;
      expect(res.kept).toBe(true);
      // the place is still read from the point, which is kept with it so HR can see it (20 October 2026)
      expect(res.punches[0]).toMatchObject({ kind: 'in', place: 'office', accuracyMetres: 18, flags: ['fake_gps'], latitude: NEAR.latitude, longitude: NEAR.longitude });
      expect(res.messages).toContain(
        'Fake GPS suspected: your phone said this location comes from an app that sets a made-up one. The check-in is kept, and your manager and HR see it flagged. Turn such an app off before you check in.',
      );
      expect((await prisma.attendancePunch.findFirstOrThrow({ where: { employeeId: ids.mila } })).flags).toEqual(['fake_gps']);
      expect((await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: ids.mila, source: 'system' } })).flags).toEqual(['fake_gps']);
    });

    it('flags it beside the arrangement’s own flag, on a check-out too; a location that isn’t a mock one isn’t', async () => {
      const omar = (await punch('omar', { kind: 'in', ...FAR, mock: true }).expect(200)).body as Today;
      expect(omar.punches[0]).toMatchObject({ place: 'remote', flags: ['outside_office', 'fake_gps'] });
      // a check-out isn't held to the arrangement, but a mock location on it is suspected all the same
      const out = (await punch('omar', { kind: 'out', ...FAR, mock: true }).expect(200)).body as Today;
      expect(out.punches[1]).toMatchObject({ kind: 'out', place: 'remote', flags: ['fake_gps'] });
      expect(out.day?.flags).toEqual(['outside_office', 'fake_gps']);
      // the phone saying it isn't a mock one: no flag
      const mila = (await punch('mila', { kind: 'out', ...FAR, mock: false }).expect(200)).body as Today;
      expect(mila.punches[1]).toMatchObject({ kind: 'out', flags: [] });
      expect(mila.day?.flags).toEqual(['fake_gps']);
      expect(said(await punch('mila', { kind: 'in', ...NEAR, mock: 'yes' }).expect(400))).toEqual(['Say whether the location is a mock one with true or false.']);
    });

    it('shows on Daily Attendance and under "Only with flagged check-ins"', async () => {
      const view = (await api().get(`/api/attendance?month=${CURRENT}&departmentId=${deptId}&only=flagged`).set('Cookie', hr).expect(200)).body as {
        people: { employee: { id: string }; figures: { flaggedDays: number }; days: { date: string; flags: string[] }[] }[];
      };
      const mila = view.people.find((p) => p.employee.id === ids.mila);
      expect(mila?.figures.flaggedDays).toBe(1);
      expect(mila?.days.find((d) => d.date === TODAY)?.flags).toEqual(['fake_gps']);
      expect(view.people.map((p) => p.employee.id)).toEqual(expect.arrayContaining([ids.mila, ids.omar]));
    });
  });
});
