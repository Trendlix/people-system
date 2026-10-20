import type { INestApplication } from '@nestjs/common';
import { APP_LOCATION_NEEDED_MESSAGE, CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, NO_LOCATION_MESSAGE, OFF_NETWORK_MESSAGE } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, signIn } from './helpers.js';

// Where each press was (owner, 20 October 2026, of a Daily Attendance row listing every press: "simplify this, i want to
// view if it is remote or office, and location link"; asked, "Yes, keep the spot", seen by "HR, CEO, Super Admin"): the
// point kept with each press (a mock one too), read only then; given to HR, the CEO, the Super Admin and the employee
// themself, never to a manager or Finance, a C-level person's never to HR; an old office press's map from its location;
// never on a day, in the workbook or in the audit log. And refusing presses without a location (the same day: "i want a
// flag to restrict checkin and out from unknown locations"; asked, "Company switch + exceptions", "Allow as Office"):
// the switch on Check-in Setup, HR's and Admin's, audited; on, a website press without a location refused (409, in the
// audit log as no_location), unless HR exempts the person (audited) or it comes from an office network the website
// signed; inside the app always refused. These tests look at their own people (names end with RUN), put the settings
// back and delete what they made. Every name, point and address is invented.

const RUN = `pl${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const KEY = process.env.WEB_KEY!;

// a check-in location, a point within it, one far from it, and one for a C-level person (6 decimals, easy to look for)
const HEAD = { name: `Head ${RUN}`, latitude: 30.112233, longitude: 31.445566, radiusMetres: 150 };
const NEAR = { latitude: 30.112634, longitude: 31.445867, accuracy: 18.4 };
const FAR = { latitude: 30.021357, longitude: 31.213579, accuracy: 25 };
const CHIEF = { latitude: 30.031468, longitude: 31.224681, accuracy: 9 };
const MOCK = { latitude: 30.041579, longitude: 31.235792, accuracy: 5 };
const COORDINATES = [NEAR, FAR, CHIEF, MOCK].flatMap((p) => [p.latitude, p.longitude]).flatMap((n) => [n.toFixed(6), n.toFixed(4)]);
const coordinatesIn = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  return COORDINATES.filter((c) => text.includes(c));
};

// the office's line and an address on it (made-up public addresses)
const OFFICE_RANGE = '41.33.20.0/24';
const ON_NETWORK = '41.33.20.77';

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1);
const signed = (cookie: string, ip: string) => {
  const at = String(Date.now());
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(KEY, ip, at, tokenOf(cookie)) };
};

interface Press {
  date: string;
  kind: string;
  place: string;
  flags: string[];
  locationName: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMetres?: number | null;
  pointFrom?: string | null;
}

const SPOT_KEYS = ['latitude', 'longitude', 'accuracyMetres', 'pointFrom'];
const withoutSpot = (presses: readonly Press[]) => presses.every((p) => SPOT_KEYS.every((k) => !(k in p)));

describe('Where each press was, and refusing presses without a location (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let hrSuper: string;
  let emailDomainBefore: string | null;
  let settingsBefore: { officeNetworks: unknown; officeNetworkLock: boolean; refuseWithoutLocation: boolean };
  let deptId: string;
  let shiftId: string;
  let locationId: string;
  const started = new Date();
  const people: string[] = [];
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account (a website session and an app one), employed under the shift (`by`: who hires them). */
  async function person(key: string, who: string, roles: Parameters<typeof createUser>[1], employment: Record<string, unknown> = {}, by?: string) {
    const email = await createUser(prisma, roles);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    sessions[`${key}App`] = await signIn(app, email, APP_USER_AGENT);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', by ?? hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, shiftId, workArrangement: 'wfh', ...employment })
      .expect(201);
    employments[key] = hired.body.employment.id;
  }

  const punch = (session: string, body: object, headers: Record<string, string> = {}) => api().post('/api/me/attendance/punches').set('Cookie', session).set(headers).send(body);
  const month = async (session: string, path: string) => (await api().get(`/api${path}${path.includes('?') ? '&' : '?'}month=${CURRENT}`).set('Cookie', session).expect(200)).body;
  const daily = async (session: string) =>
    (await month(session, `/attendance?departmentId=${deptId}`)) as { people: { employee: { id: string }; punches?: Press[]; days: unknown[] }[] };
  const pressesOf = (view: { people: { employee: { id: string }; punches?: Press[] }[] }, key: string) => view.people.find((p) => p.employee.id === ids[key])?.punches;
  const rule = (session: string, body?: object) =>
    body ? api().put('/api/attendance/check-in-setup/location-rule').set('Cookie', session).send(body) : api().get('/api/attendance/check-in-setup/location-rule').set('Cookie', session);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    const s = await prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { officeNetworks: true, officeNetworkLock: true, refuseWithoutLocation: true } });
    settingsBefore = { officeNetworks: s.officeNetworks, officeNetworkLock: s.officeNetworkLock, refuseWithoutLocation: s.refuseWithoutLocation };
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [{ label: 'Main office line', range: OFFICE_RANGE }], officeNetworkLock: false, refuseWithoutLocation: false } });
    const grades = new Map(((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).map((g) => [g.code, g.id]));

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Punch Location Dept ${RUN}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `P${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    locationId = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(HEAD).expect(201)).body.id;

    await person('mona', 'Mona Manager', ['employee', 'manager']);
    await person('rami', 'Rami Report', ['employee'], { managerId: ids.mona });
    await person('omar', 'Omar Old', ['employee'], { managerId: ids.mona });
    await person('walid', 'Walid Web', ['employee']);
    await person('eman', 'Eman Exempt', ['employee']);
    // C-level (G9), reporting to Mona: only HR with Super Admin gives the grade
    await person('cleo', 'Cleo Chief', ['employee'], { gradeId: grades.get('G9'), managerId: ids.mona }, hrSuper);
  });

  afterAll(async () => {
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people }, managerId: { not: null } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.checkInLocation.deleteMany({ where: { id: locationId } });
    await prisma.payrollSettings.update({
      where: { id: 1 },
      data: { officeNetworks: settingsBefore.officeNetworks as object[], officeNetworkLock: settingsBefore.officeNetworkLock, refuseWithoutLocation: settingsBefore.refuseWithoutLocation },
    });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the spot kept', () => {
    beforeAll(async () => {
      // an office press from before the spot was kept: its place and location's name, no point
      await prisma.attendancePunch.create({
        data: { employeeId: ids.omar, date: toDateOnly(TODAY), kind: 'in', at: new Date(Date.now() - 3_600_000), place: 'office', accuracyMetres: 20, expected: 'anywhere', locationName: HEAD.name },
      });
    });

    it('keeps the point where each press was made, a mock one too, and gives the employee their own', async () => {
      const inside = (await punch(sessions.rami, { kind: 'in', ...NEAR }).expect(200)).body as { punches: Press[] };
      expect(inside.punches.at(-1)).toMatchObject({ kind: 'in', place: 'office', locationName: HEAD.name, latitude: NEAR.latitude, longitude: NEAR.longitude, accuracyMetres: 18, pointFrom: 'press' });
      const out = (await punch(sessions.rami, { kind: 'out', ...FAR }).expect(200)).body as { punches: Press[] };
      expect(out.punches.at(-1)).toMatchObject({ kind: 'out', place: 'remote', latitude: FAR.latitude, longitude: FAR.longitude, accuracyMetres: 25, pointFrom: 'press' });
      // fake GPS from the app: flagged, its point kept so HR can see it
      const mocked = (await punch(sessions.walidApp, { kind: 'in', ...MOCK, mock: true }).expect(200)).body as { punches: Press[] };
      expect(mocked.punches.at(-1)).toMatchObject({ flags: ['fake_gps'], latitude: MOCK.latitude, longitude: MOCK.longitude });
      // a press without a location (the website, the switch off): kept, no point
      const unknown = (await punch(sessions.walid, { kind: 'out', locationError: 'denied' }).expect(200)).body as { punches: Press[] };
      expect(unknown.punches.at(-1)).toMatchObject({ place: 'unknown', latitude: null, longitude: null, accuracyMetres: null, pointFrom: null });
      await punch(sessions.cleo, { kind: 'in', ...CHIEF }).expect(200);

      const kept = await prisma.attendancePunch.findMany({ where: { employeeId: ids.rami }, orderBy: { at: 'asc' } });
      expect(kept.map((p) => [p.latitude?.toNumber(), p.longitude?.toNumber()])).toEqual([
        [NEAR.latitude, NEAR.longitude],
        [FAR.latitude, FAR.longitude],
      ]);
      // read again on today's panel and on My Attendance
      const today = (await api().get('/api/me/attendance/today').set('Cookie', sessions.rami).expect(200)).body as { punches: Press[] };
      expect(today.punches.map((p) => p.pointFrom)).toEqual(['press', 'press']);
      const mine = (await month(sessions.rami, '/attendance/me')) as { punches: Press[] };
      expect(mine.punches.map((p) => p.latitude)).toEqual([NEAR.latitude, FAR.latitude]);
    });

    it('gives the spot to HR and the CEO on a person’s month and on Daily Attendance', async () => {
      for (const session of [hr, ceo, hrSuper]) {
        const view = (await month(session, `/attendance/employees/${ids.rami}`)) as { punches: Press[] };
        expect(view.punches.map((p) => [p.kind, p.place, p.latitude, p.longitude, p.accuracyMetres])).toEqual([
          ['in', 'office', NEAR.latitude, NEAR.longitude, 18],
          ['out', 'remote', FAR.latitude, FAR.longitude, 25],
        ]);
        expect(pressesOf(await daily(session), 'rami')?.map((p) => p.latitude)).toEqual([NEAR.latitude, FAR.latitude]);
      }
    });

    it('never gives it to a manager or Finance: the place only', async () => {
      // Finance sees everyone's attendance, without the spot
      const financeView = (await month(finance, `/attendance/employees/${ids.rami}`)) as { punches: Press[] };
      expect(financeView.punches.map((p) => `${p.kind} ${p.place}`)).toEqual(['in office', 'out remote']);
      expect(withoutSpot(financeView.punches)).toBe(true);
      const financeDaily = await daily(finance);
      expect(withoutSpot(pressesOf(financeDaily, 'rami')!)).toBe(true);
      expect(coordinatesIn(financeDaily)).toEqual([]);
      // the manager: the team view and a report's month
      const team = await daily(sessions.mona);
      expect(pressesOf(team, 'rami')?.map((p) => p.place)).toEqual(['office', 'remote']);
      expect(coordinatesIn(team)).toEqual([]);
      const report = (await month(sessions.mona, `/attendance/employees/${ids.rami}`)) as { punches: Press[] };
      expect(withoutSpot(report.punches)).toBe(true);
      expect(coordinatesIn(report)).toEqual([]);
    });

    it('never gives HR a C-level person’s: the CEO, HR with Super Admin and the person themself see it', async () => {
      await api().get(`/api/attendance/employees/${ids.cleo}?month=${CURRENT}`).set('Cookie', hr).expect(404);
      const hrDaily = await daily(hr);
      expect(pressesOf(hrDaily, 'cleo')).toBeUndefined();
      expect(JSON.stringify(hrDaily)).not.toContain(CHIEF.latitude.toFixed(4));
      for (const session of [ceo, hrSuper]) {
        const view = (await month(session, `/attendance/employees/${ids.cleo}`)) as { punches: Press[] };
        expect(view.punches[0]).toMatchObject({ latitude: CHIEF.latitude, longitude: CHIEF.longitude, pointFrom: 'press' });
      }
      expect(((await month(sessions.cleo, '/attendance/me')) as { punches: Press[] }).punches[0]).toMatchObject({ latitude: CHIEF.latitude });
      // their manager doesn't see them at all
      await api().get(`/api/attendance/employees/${ids.cleo}?month=${CURRENT}`).set('Cookie', sessions.mona).expect(404);
    });

    it('shows an office press from before the spot was kept at its location’s point', async () => {
      const view = (await month(hr, `/attendance/employees/${ids.omar}`)) as { punches: Press[] };
      expect(view.punches[0]).toMatchObject({ place: 'office', locationName: HEAD.name, latitude: HEAD.latitude, longitude: HEAD.longitude, accuracyMetres: 20, pointFrom: 'location' });
      expect(withoutSpot(((await month(sessions.mona, `/attendance/employees/${ids.omar}`)) as { punches: Press[] }).punches)).toBe(true);
    });

    it('keeps no point on a day, in the workbook or in the audit log', async () => {
      const days = await prisma.attendanceDay.findMany({ where: { employeeId: { in: people } } });
      expect(days.length).toBeGreaterThan(2);
      expect(coordinatesIn(days)).toEqual([]);
      const audit = await prisma.auditLog.findMany({ where: { at: { gte: started } } });
      expect(coordinatesIn(audit.map((a) => a.diff))).toEqual([]);

      const res = await api()
        .get(`/api/attendance/summary.xlsx?month=${CURRENT}`)
        .set('Cookie', hr)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as never);
      const cells: unknown[] = [];
      wb.eachSheet((sheet) => sheet.eachRow((r) => cells.push(r.values)));
      const text = JSON.stringify(cells);
      expect(text).toContain(`Rami Report ${RUN}`);
      expect(coordinatesIn(cells)).toEqual([]);
    });
  });

  describe('refusing presses without a location', () => {
    it('is a switch HR and Admin turn on and off, audited; Finance, the CEO and employees are refused', async () => {
      for (const session of [finance, ceo, sessions.walid]) {
        await rule(session).expect(403);
        await rule(session, { refuseWithoutLocation: true }).expect(403);
      }
      expect((await rule(hr).expect(200)).body).toEqual({ refuseWithoutLocation: false });
      expect(said(await rule(hr, { refuseWithoutLocation: 'yes' }).expect(400))).toEqual(['Send whether check-ins and check-outs without a location are refused as true or false.']);
      expect((await rule(admin, { refuseWithoutLocation: true }).expect(200)).body).toEqual({ refuseWithoutLocation: true });
      expect((await rule(hr).expect(200)).body).toEqual({ refuseWithoutLocation: true });
      const entry = await prisma.auditLog.findFirst({ where: { entityType: 'check_in_location_rule', at: { gte: started } }, orderBy: { id: 'desc' } });
      expect(entry?.diff).toEqual({ refuseWithoutLocation: { from: false, to: true } });
      // the same again: nothing to log
      await rule(hr, { refuseWithoutLocation: true }).expect(200);
      expect(await prisma.auditLog.count({ where: { entityType: 'check_in_location_rule', at: { gte: started } } })).toBe(1);
    });

    it('tells the person before they press, unless HR exempts them (audited)', async () => {
      expect((await api().get('/api/me/attendance/today').set('Cookie', sessions.walid).expect(200)).body.location).toEqual({ required: true });
      const exempt = (await api().patch(`/api/employees/${ids.eman}/employments/${employments.eman}`).set('Cookie', hr).send({ checkInWithoutLocation: true }).expect(200)).body;
      expect(exempt.employment.checkInWithoutLocation).toBe(true);
      expect(await prisma.auditLog.findFirst({ where: { entityType: 'employment', entityId: employments.eman, action: 'update' }, orderBy: { id: 'desc' } })).toMatchObject({
        diff: { checkInWithoutLocation: { from: false, to: true } },
      });
      expect((await api().get('/api/me/attendance/today').set('Cookie', sessions.eman).expect(200)).body.location).toEqual({ required: false });
      expect(said(await api().patch(`/api/employees/${ids.eman}/employments/${employments.eman}`).set('Cookie', hr).send({ checkInWithoutLocation: 'no' }).expect(400))).toEqual([
        'Send whether they can check in without a location as true or false.',
      ]);
      // a C-level person's: not HR's to change, HR with Super Admin's (the C-level rules)
      await api().patch(`/api/employees/${ids.cleo}/employments/${employments.cleo}`).set('Cookie', hr).send({ checkInWithoutLocation: true }).expect(404);
      await api().patch(`/api/employees/${ids.cleo}/employments/${employments.cleo}`).set('Cookie', hrSuper).send({ checkInWithoutLocation: true }).expect(200);
      await api().patch(`/api/employees/${ids.cleo}/employments/${employments.cleo}`).set('Cookie', hrSuper).send({ checkInWithoutLocation: false }).expect(200);
    });

    it('refuses a website press without a location, in the audit log without a point; one with it is kept', async () => {
      const before = await prisma.attendancePunch.count({ where: { employeeId: ids.walid } });
      expect(said(await punch(sessions.walid, { kind: 'in', locationError: 'denied' }).expect(409))).toEqual([NO_LOCATION_MESSAGE]);
      expect(said(await punch(sessions.walid, { kind: 'out' }).expect(409))).toEqual([NO_LOCATION_MESSAGE]);
      expect(await prisma.attendancePunch.count({ where: { employeeId: ids.walid } })).toBe(before);
      const refused = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: ids.walid, action: 'check_in_refused' }, orderBy: { id: 'asc' } });
      expect(refused.map((r) => r.diff)).toEqual([
        { kind: 'in', date: TODAY, reason: 'no_location' },
        { kind: 'out', date: TODAY, reason: 'no_location' },
      ]);
      await punch(sessions.walid, { kind: 'in', ...FAR }).expect(200);
    });

    it('takes an exempt person’s press without one, as location unknown', async () => {
      const res = (await punch(sessions.eman, { kind: 'in', locationError: 'unavailable' }).expect(200)).body as { punches: Press[] };
      expect(res.punches.at(-1)).toMatchObject({ place: 'unknown', latitude: null });
    });

    it('takes one from an office network the website signed, as Office; not one signed off it, nor with the address unsigned', async () => {
      const office = (await punch(sessions.walid, { kind: 'out', locationError: 'denied' }, signed(sessions.walid, ON_NETWORK)).expect(200)).body as { punches: (Press & { officeNetwork: string | null })[] };
      expect(office.punches.at(-1)).toMatchObject({ kind: 'out', place: 'office', officeNetwork: 'Main office line', latitude: null });
      expect(said(await punch(sessions.walid, { kind: 'in', locationError: 'denied' }, signed(sessions.walid, '197.45.1.9')).expect(409))).toEqual([NO_LOCATION_MESSAGE]);
      expect(said(await punch(sessions.walid, { kind: 'in', locationError: 'denied' }, { [CLIENT_IP_HEADER]: ON_NETWORK }).expect(409))).toEqual([NO_LOCATION_MESSAGE]);
    });

    it('works only with the key: without it the office network isn’t trusted and the press is refused', async () => {
      delete process.env.WEB_KEY;
      try {
        expect(said(await punch(sessions.walid, { kind: 'in', locationError: 'denied' }, signed(sessions.walid, ON_NETWORK)).expect(409))).toEqual([NO_LOCATION_MESSAGE]);
      } finally {
        process.env.WEB_KEY = KEY;
      }
    });

    it('refuses one in the app whatever the switch, the exemption or the network say', async () => {
      expect(said(await punch(sessions.emanApp, { kind: 'out', locationError: 'denied' }).expect(409))).toEqual([APP_LOCATION_NEEDED_MESSAGE]);
      expect(said(await punch(sessions.walidApp, { kind: 'in' }, signed(sessions.walidApp, ON_NETWORK)).expect(409))).toEqual([APP_LOCATION_NEEDED_MESSAGE]);
      await rule(hr, { refuseWithoutLocation: false }).expect(200);
      expect(said(await punch(sessions.walidApp, { kind: 'in' }).expect(409))).toEqual([APP_LOCATION_NEEDED_MESSAGE]);
    });

    it('leaves the office network’s lock first: a locked person off it hears of the network', async () => {
      await rule(hr, { refuseWithoutLocation: true }).expect(200);
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworkLock: true } });
      try {
        await api().patch(`/api/employees/${ids.walid}/employments/${employments.walid}`).set('Cookie', hr).send({ workArrangement: 'office' }).expect(200);
        expect(said(await punch(sessions.walid, { kind: 'in', locationError: 'denied' }, signed(sessions.walid, '197.45.1.9')).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      } finally {
        await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworkLock: false, refuseWithoutLocation: false } });
      }
    });
  });
});
