import type { INestApplication } from '@nestjs/common';
import {
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  GPS_LOCK_NEEDS_OFFICE,
  GPS_TOO_ROUGH_MESSAGE,
  LOCATION_REASON_NEEDED,
  NO_LOCATION_MESSAGE,
  OFF_NETWORK_MESSAGE,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CheckInLocationEndingsService } from '../src/attendance/check-in-location-endings.service.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, addMonths, toDateOnly, todayInCairo } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, signIn } from './helpers.js';

// Office staff's check-ins locked to the check-in locations by GPS (owner, 24 October 2026, on a profile with both
// exceptions unticked: "while these aare not checked, people can still check in and out from anywhere"; asked, "Yes, add
// a GPS lock too"; packages/shared gps-lock.ts): the switch, HR's and Admin's, audited, never on without the main office;
// an Office person refused outside the circles (in and out alike), with how far they are, and let in inside them with the
// accuracy allowed for; a reading too rough refused; no location refused unless "Can check in without a location"; never
// for HR's "Can check in from anywhere", a work from home day, an official duty, their approved places, nor a Hybrid
// person; with the office network's lock on too, either passing is enough. And requested check-in locations (the same day:
// "allow the employee to request adding this location to his profile ... (Home Location - Remote Site - Client
// Location) with a comment reason", "HR → CEO for all three", "allow the HR to add an end date or lik it to the contract
// date. if renewed renew the due date", "location to be allowed only to the requested employee not all of them if home or
// remote, all employees if a customer location"): asked from a refusal and from My Requests, decided by HR then the CEO,
// rejected and withdrawn; a remote site passing the lock for its person only, until its end; "until the contract ends"
// following a renewal; a client location for everyone, on Check-in Setup, ended there; a C-level person's to the CEO; the
// overlaps; the notice of an end; the audit; a developer's sight. These tests look at their own people (names end with
// RUN), put the settings back and delete what they made. Every name, point and address is invented.

const RUN = `gl${Date.now().toString(36).toLowerCase()}`;
const KEY = process.env.WEB_KEY!;
const TODAY = todayInCairo();

const MAIN = { name: `Mahrouki ${RUN}`, latitude: 30.112233, longitude: 31.412233, radiusMetres: 150 };
/** A point `metres` north of another (a degree of latitude is about 111,195 m), read with `accuracy`. */
const north = (metres: number, accuracy: number | null = 10, from: { latitude: number; longitude: number } = MAIN) => ({
  latitude: Math.round((from.latitude + metres / 111_195) * 1e6) / 1e6,
  longitude: from.longitude,
  ...(accuracy !== null && { accuracy }),
});
const FAR = north(1200);
const SITE = north(-4000, null);
const CLIENT = north(3000, null);
const HOME = north(6000, null);

const LINE = [{ label: 'Main office line', range: '41.33.60.0/24' }];
const ON_NETWORK = '41.33.60.77';
const OFF_NETWORK = '197.45.6.9';

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1);
const signed = (cookie: string, ip: string) => {
  const at = String(Date.now());
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(KEY, ip, at, tokenOf(cookie)) };
};

describe('The GPS lock and requested check-in locations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let ceo: string;
  let hrSuper: string;
  let finance: string;
  let developer: string;
  let hrUserId: string;
  let emailDomainBefore: string | null;
  let settingsBefore: { officeNetworks: unknown; officeNetworkLock: boolean; refuseWithoutLocation: boolean; gpsLock: boolean; gpsRoughMetres: number };
  let deptId: string;
  let shiftId: string;
  let mainId: string;
  const started = new Date();
  const people: string[] = [];
  const locations: string[] = [];
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account (a website session and an app one), employed under the shift. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, by?: string) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    sessions[`${key}App`] = await signIn(app, email, APP_USER_AGENT);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', by ?? hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, shiftId, ...employment })
      .expect(201);
    employments[key] = hired.body.employment.id;
  }

  const punch = (session: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    api().post('/api/me/attendance/punches').set('Cookie', session).set(headers).send(body);
  const today = async (key: string) => (await api().get('/api/me/attendance/today').set('Cookie', sessions[key]).expect(200)).body;
  const gpsLock = (session: string, body: object) => api().put('/api/attendance/check-in-setup/gps-lock').set('Cookie', session).send(body);
  const ask = (key: string, body: object) => api().post('/api/me/home-locations').set('Cookie', sessions[key]).send(body);
  const decide = (session: string, id: string, body: object) => api().post(`/api/home-locations/${id}/decide`).set('Cookie', session).send(body);
  const refusals = (key: string) => prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: ids[key], action: 'check_in_refused' }, orderBy: { id: 'asc' } });
  const punches = (key: string) => prisma.attendancePunch.count({ where: { employeeId: ids[key] } });
  /** An approved place asked by `key` (HR then the CEO), and its id. */
  async function approved(key: string, body: object, hrStep: object = {}, deciders: [string, string] = [hr, ceo]) {
    const made = (await ask(key, body).expect(201)).body;
    await decide(deciders[0], made.id, { decision: 'approve', ...hrStep }).expect(200);
    const done = (await decide(deciders[1], made.id, { decision: 'approve' }).expect(200)).body;
    expect(done.status).toBe('approved');
    return done;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail }, select: { id: true } })).id;
    admin = await signIn(app, await createUser(prisma, ['admin']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    developer = await signIn(app, await createUser(prisma, ['developer']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    const s = await prisma.payrollSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
      select: { officeNetworks: true, officeNetworkLock: true, refuseWithoutLocation: true, gpsLock: true, gpsRoughMetres: true },
    });
    settingsBefore = { ...s };
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false, refuseWithoutLocation: false, gpsLock: false, gpsRoughMetres: 200 } });
    const grades = new Map(((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).map((g) => [g.code, g.id]));

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `GPS Lock Dept ${RUN}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `G${RUN}`.slice(0, 20), startTime: toTimeOfDay('00:00'), endTime: toTimeOfDay('23:59'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    await person('olga', 'Olga Office', { workArrangement: 'office' });
    await person('omar', 'Omar Exempt', { workArrangement: 'office' });
    await person('nina', 'Nina Nolocation', { workArrangement: 'office' });
    await person('wafa', 'Wafa Wfhday', { workArrangement: 'office' });
    await person('odette', 'Odette Duty', { workArrangement: 'office' });
    await person('hamid', 'Hamid Home', { workArrangement: 'office' });
    await person('hana', 'Hana Hybrid', { workArrangement: 'hybrid', officeDays: [0, 1, 2, 3, 4, 5, 6] });
    await person('rami', 'Rami Remote', { workArrangement: 'office' });
    await person('cora', 'Cora Contract', { workArrangement: 'office' });
    await person('cleo', 'Cleo Chief', { workArrangement: 'office', gradeId: grades.get('G9') }, hrSuper);
    // the main office: the first check-in location
    expect(await prisma.checkInLocation.count()).toBe(0);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { createdAt: { gte: started }, kind: { in: ['check_in_location_ending', 'home_location_waiting', 'home_location_decided'] } } });
    await prisma.homeLocationRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.checkInLocation.deleteMany({ where: { id: { in: locations } } });
    await prisma.checkInLocation.deleteMany({ where: { kind: 'client', name: { contains: RUN } } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { ...settingsBefore, officeNetworks: settingsBefore.officeNetworks as object[] } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the switch', () => {
    it('is HR’s and Admin’s; not on without the main office; the limit 50 to 500 m; audited', async () => {
      for (const session of [finance, ceo, sessions.olga]) {
        await api().get('/api/attendance/check-in-setup/gps-lock').set('Cookie', session).expect(403);
        await gpsLock(session, { lock: true }).expect(403);
      }
      expect((await api().get('/api/attendance/check-in-setup/gps-lock').set('Cookie', hr).expect(200)).body).toEqual({ lock: false, roughMetres: 200, inForce: false });
      expect(said(await gpsLock(hr, { lock: true }).expect(400))).toEqual([GPS_LOCK_NEEDS_OFFICE]);
      const main = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(MAIN).expect(201)).body;
      locations.push(main.id);
      mainId = main.id;
      expect(main).toMatchObject({ isMain: true, kind: 'office', validUntil: null, inForce: true });
      expect(said(await gpsLock(hr, { lock: true, roughMetres: 49 }).expect(400))[0]).toContain('from 50 to 500');
      expect(said(await gpsLock(hr, { lock: true, roughMetres: 501 }).expect(400))[0]).toContain('from 50 to 500');
      expect((await gpsLock(admin, { lock: true, roughMetres: 150 }).expect(200)).body).toEqual({ lock: true, roughMetres: 150, inForce: true });
      expect((await gpsLock(hr, { lock: true, roughMetres: 200 }).expect(200)).body).toEqual({ lock: true, roughMetres: 200, inForce: true });
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'check_in_gps_lock', at: { gte: started } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([{ gpsLock: { from: false, to: true }, gpsRoughMetres: { from: 200, to: 150 } }, { gpsRoughMetres: { from: 150, to: 200 } }]);
    });

    it('tells an Office person before they press; not HR’s exception nor a Hybrid person', async () => {
      expect((await today('olga')).gps).toEqual({ locked: true });
      expect((await today('olga')).location).toEqual({ required: true });
      await api().patch(`/api/employees/${ids.omar}/employments/${employments.omar}`).set('Cookie', hr).send({ checkInAnywhere: true }).expect(200);
      expect((await today('omar')).gps).toEqual({ locked: false });
      expect((await today('hana')).gps).toEqual({ locked: false });
    });
  });

  describe('an Office person', () => {
    it('is refused outside the circles, checking in and out alike, with how far they are; nothing kept; audited without the point', async () => {
      const message = "You're about 1.2 km from " + MAIN.name + '; check in at the office, or ask HR for an attendance correction.';
      expect(said(await punch(sessions.olga, { kind: 'in', ...FAR }).expect(409))).toEqual([message]);
      expect(said(await punch(sessions.olgaApp, { kind: 'out', ...FAR }).expect(409))).toEqual([message]);
      expect(await punches('olga')).toBe(0);
      expect((await refusals('olga')).map((r) => r.diff)).toEqual([
        { kind: 'in', date: expect.any(String), reason: 'outside_locations', lock: 'locations' },
        { kind: 'out', date: expect.any(String), reason: 'outside_locations', lock: 'locations' },
      ]);
    });

    it('is let in inside a circle, the reading’s accuracy allowed for (up to 100 m), in and out', async () => {
      // 200 m out with ±60 m: 200 − 60 ≤ 150
      const inside = (await punch(sessions.olga, { kind: 'in', ...north(200, 60) }).expect(200)).body;
      expect(inside.punches.at(-1)).toMatchObject({ kind: 'in', accuracyMetres: 60 });
      // 200 m out with ±40 m: refused
      await punch(sessions.olga, { kind: 'out', ...north(200, 40) }).expect(409);
      const out = (await punch(sessions.olga, { kind: 'out', ...north(20, 15) }).expect(200)).body;
      expect(out.punches.at(-1)).toMatchObject({ kind: 'out', place: 'office' });
    });

    it('is refused on a reading too rough to tell', async () => {
      expect(said(await punch(sessions.olga, { kind: 'in', ...north(0, 250) }).expect(409))).toEqual([GPS_TOO_ROUGH_MESSAGE]);
      expect((await refusals('olga')).at(-1)?.diff).toMatchObject({ reason: 'too_rough', lock: 'locations' });
    });

    it('is refused without a location, even on the website, unless HR lets them check in without one', async () => {
      expect(said(await punch(sessions.nina, { kind: 'in', locationError: 'denied' }).expect(409))).toEqual([NO_LOCATION_MESSAGE]);
      expect((await refusals('nina')).at(-1)?.diff).toMatchObject({ reason: 'no_location', lock: 'locations' });
      await api().patch(`/api/employees/${ids.nina}/employments/${employments.nina}`).set('Cookie', hr).send({ checkInWithoutLocation: true }).expect(200);
      const kept = (await punch(sessions.nina, { kind: 'in', locationError: 'denied' }).expect(200)).body;
      expect(kept.punches.at(-1)).toMatchObject({ place: 'unknown' });
      // with a reading, they are held to the circles as anyone
      await punch(sessions.nina, { kind: 'out', ...FAR }).expect(409);
    });
  });

  describe('never locked', () => {
    it('HR’s "Can check in from anywhere", and a Hybrid person', async () => {
      await punch(sessions.omar, { kind: 'in', ...FAR }).expect(200);
      await punch(sessions.hana, { kind: 'in', ...FAR }).expect(200);
      await punch(sessions.hana, { kind: 'out', ...FAR }).expect(200);
    });

    it('an approved work from home day, and an approved official duty', async () => {
      const wfhDay = (await today('wafa')).date as string;
      await punch(sessions.wafa, { kind: 'in', ...FAR }).expect(409);
      await prisma.wfhRequest.create({ data: { employeeId: ids.wafa, employmentId: employments.wafa, date: toDateOnly(wfhDay), status: 'approved', recordedByHr: true, createdById: hrUserId, reason: 'By phone' } });
      expect((await today('wafa')).gps).toEqual({ locked: false });
      await punch(sessions.wafa, { kind: 'in', ...FAR }).expect(200);

      const odDay = (await today('odette')).date as string;
      await punch(sessions.odette, { kind: 'in', ...FAR }).expect(409);
      await prisma.odRequest.create({
        data: { employeeId: ids.odette, employmentId: employments.odette, startDate: toDateOnly(odDay), endDate: toDateOnly(odDay), place: 'Client site', reason: 'Shoot', status: 'approved', createdById: hrUserId },
      });
      await punch(sessions.odette, { kind: 'in', ...FAR }).expect(200);
      await punch(sessions.odette, { kind: 'out', ...FAR }).expect(200);
    });

    it('a press within their approved home', async () => {
      await punch(sessions.hamid, { kind: 'in', ...HOME, accuracy: 10 }).expect(409);
      const home = await approved('hamid', { type: 'home', ...HOME, accuracy: 12, reason: 'I work from home on Thursdays' });
      expect(home).toMatchObject({ type: 'home', validity: 'contract', inForce: true, forEveryone: false });
      const kept = (await punch(sessions.hamid, { kind: 'in', ...HOME, accuracy: 10 }).expect(200)).body;
      expect(kept.punches.at(-1)).toMatchObject({ place: 'home' });
      // anywhere else, still refused
      await punch(sessions.hamid, { kind: 'out', ...FAR }).expect(409);
    });
  });

  describe('with the office network’s lock on too: either passing is enough', () => {
    beforeAll(async () => {
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: LINE, officeNetworkLock: true } });
    });
    afterAll(async () => {
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false } });
    });

    it('lets a rough or far reading through on the office network, and a press inside a circle off it', async () => {
      expect((await today('olga')).network).toEqual({ locked: true });
      await punch(sessions.olga, { kind: 'in', ...north(0, 400) }, signed(sessions.olga, ON_NETWORK)).expect(200);
      await punch(sessions.olga, { kind: 'out', ...FAR }, signed(sessions.olga, ON_NETWORK)).expect(200);
      await punch(sessions.olga, { kind: 'in', ...north(30) }, signed(sessions.olga, OFF_NETWORK)).expect(200);
    });

    it('refuses when both fail, saying both, in the audit log with the network’s reason', async () => {
      const res = said(await punch(sessions.olga, { kind: 'out', ...FAR }, signed(sessions.olga, OFF_NETWORK)).expect(409));
      expect(res).toEqual([`You're about 1.2 km from ${MAIN.name} and not on the office network; check in at the office, or ask HR for an attendance correction.`]);
      expect((await refusals('olga')).at(-1)?.diff).toMatchObject({ reason: 'outside_locations', lock: 'locations', network: 'off_network' });
      expect(said(await punch(sessions.olga, { kind: 'out', locationError: 'denied' }).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
    });
  });

  describe('requested check-in locations', () => {
    let siteId: string;

    it('are asked with a reason, a remote site’s or a client location’s name, 25 to 500 m; one of each type at a time', async () => {
      expect(said(await ask('rami', { type: 'remote_site', ...SITE, label: 'Studio', radiusMetres: 100 }).expect(400))).toEqual([LOCATION_REASON_NEEDED]);
      expect(said(await ask('rami', { type: 'client', ...CLIENT, reason: 'Visits' }).expect(400))[0]).toContain('Name the place');
      expect(said(await ask('rami', { type: 'client', ...CLIENT, label: 'Acme', reason: 'Visits', radiusMetres: 600 }).expect(400))[0]).toContain('from 25 to 500');
      // from a refusal: the reading refused, sent as it was
      await punch(sessions.rami, { kind: 'in', ...SITE, accuracy: 14 }).expect(409);
      const site = (await ask('rami', { type: 'remote_site', ...SITE, accuracy: 14, label: `Studio ${RUN}`, reason: 'Our shoots are at the studio', radiusMetres: 120, wishedEndDate: addDays(TODAY, 20) }).expect(201)).body;
      siteId = site.id;
      expect(site).toMatchObject({ type: 'remote_site', status: 'with_hr', radiusMetres: 120, accuracyMetres: 14, reason: 'Our shoots are at the studio', wishedEndDate: addDays(TODAY, 20), inForce: false });
      expect(said(await ask('rami', { type: 'remote_site', ...SITE, label: 'Other', reason: 'Again' }).expect(409))[0]).toContain('remote site request is being decided already');
      // HR is told; a request of another type goes alongside
      expect(await prisma.notification.count({ where: { kind: 'home_location_waiting', link: `/home-locations/${site.id}`, title: 'A remote site is waiting for you' } })).toBeGreaterThan(0);
    });

    it('are rejected with a comment and withdrawn while waiting', async () => {
      const client = (await ask('rami', { type: 'client', ...CLIENT, label: `Acme ${RUN}`, reason: 'Weekly visits' }).expect(201)).body;
      expect(said(await decide(hr, client.id, { decision: 'reject' }).expect(400))[0]).toContain('Write a comment');
      expect((await decide(hr, client.id, { decision: 'reject', comment: 'Not a client of ours' }).expect(200)).body).toMatchObject({ status: 'rejected', latitude: null, label: null });
      const again = (await ask('rami', { type: 'client', ...CLIENT, label: `Acme ${RUN}`, reason: 'Weekly visits' }).expect(201)).body;
      expect((await api().post(`/api/me/home-locations/${again.id}/withdraw`).set('Cookie', sessions.rami).expect(200)).body.status).toBe('withdrawn');
    });

    it('go to HR, then the CEO; HR sets how long one lasts; a press inside it then passes the lock, until its end', async () => {
      // the CEO can't take HR's step
      expect(said(await decide(ceo, siteId, { decision: 'approve' }).expect(409))[0]).toContain('waiting for your decision');
      // the wished date to start with; a date in the past refused
      expect(said(await decide(hr, siteId, { decision: 'approve', validity: 'until_date', validUntil: addDays(TODAY, -1) }).expect(400))).toEqual(['Choose an end date of today or later.']);
      expect(said(await decide(hr, siteId, { decision: 'approve', validity: 'no_end' }).expect(400))[0]).toContain('until a date or until the contract ends');
      const hrStep = (await decide(hr, siteId, { decision: 'approve' }).expect(200)).body;
      expect(hrStep).toMatchObject({ status: 'with_ceo', validity: 'until_date', validUntil: addDays(TODAY, 20) });
      await punch(sessions.rami, { kind: 'in', ...SITE }).expect(409);
      const done = (await decide(ceo, siteId, { decision: 'approve' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'approved', inForce: true, endsOn: addDays(TODAY, 20) });
      const kept = (await punch(sessions.rami, { kind: 'in', ...SITE }).expect(200)).body;
      expect(kept.punches.at(-1)).toMatchObject({ place: 'remote', locationName: `Studio ${RUN}`, locationKind: 'remote_site', flags: [] });
      // only theirs: someone else at the same place is refused
      await punch(sessions.olga, { kind: 'in', ...SITE }, signed(sessions.olga, OFF_NETWORK)).expect(409);
      // past its end it no longer counts
      await prisma.homeLocationRequest.update({ where: { id: siteId }, data: { validUntil: toDateOnly(addDays(TODAY, -1)) } });
      expect((await api().get(`/api/home-locations/${siteId}`).set('Cookie', hr).expect(200)).body).toMatchObject({ inForce: false, endsOn: addDays(TODAY, -1) });
      await punch(sessions.rami, { kind: 'out', ...SITE }).expect(409);
      // HR gives it another date: in force again, a step and an audit entry
      const extended = (await api().post(`/api/home-locations/${siteId}/validity`).set('Cookie', hr).send({ validity: 'until_date', validUntil: addDays(TODAY, 5), comment: 'Shoots go on' }).expect(200)).body;
      expect(extended).toMatchObject({ inForce: true, validUntil: addDays(TODAY, 5) });
      expect(extended.steps.at(-1)).toMatchObject({ kind: 'validity_changed', comment: 'Shoots go on' });
      await api().post(`/api/home-locations/${siteId}/validity`).set('Cookie', sessions.rami).send({ validity: 'contract' }).expect(403);
      await punch(sessions.rami, { kind: 'out', ...SITE }).expect(200);
    });

    it('tell the employee and HR 7 days before an end that is a date, once', async () => {
      const endings = app.get(CheckInLocationEndingsService);
      const round = await endings.runOnce(new Date());
      expect(round?.requests).toContain(siteId);
      const told = await prisma.notification.findMany({ where: { kind: 'check_in_location_ending', link: `/home-locations/${siteId}` } });
      expect(told.map((n) => n.title).sort()).toEqual(expect.arrayContaining(['Your remote site ends soon', `Remote site of Rami Remote ${RUN} ends soon`]));
      expect((await endings.runOnce(new Date()))?.requests).not.toContain(siteId);
    });

    it('"until the contract ends" follows the signed contract: a renewal moves it, and it ends without one in force', async () => {
      const start = '2026-01-01';
      const first = await prisma.contract.create({
        data: { number: `GL-${RUN}-1`, employmentId: employments.cora, version: 1, form: 'fixed', startDate: toDateOnly(start), endDate: toDateOnly(addDays(TODAY, 10)), durationMonths: 12, grossSalary: 10_000, insuredSalary: 10_000, status: 'active', signedOn: toDateOnly(start) },
      });
      const home = await approved('cora', { type: 'home', ...north(500, 10), reason: 'Home on Sundays' }, { validity: 'contract' });
      expect(home).toMatchObject({ validity: 'contract', endsOn: addDays(TODAY, 10), inForce: true });
      await punch(sessions.cora, { kind: 'in', ...north(500, 10) }).expect(200);
      // the contract ended without a renewal (its end passed): the place ends with it
      await prisma.contract.update({ where: { id: first.id }, data: { endDate: toDateOnly(addDays(TODAY, -2)) } });
      expect((await api().get(`/api/home-locations/${home.id}`).set('Cookie', hr).expect(200)).body).toMatchObject({ endsOn: addDays(TODAY, -2), inForce: false });
      await punch(sessions.cora, { kind: 'out', ...north(500, 10) }).expect(409);
      // renewed: a new signed version to a later end
      await prisma.contract.update({ where: { id: first.id }, data: { status: 'ended' } });
      await prisma.contract.create({
        data: { number: `GL-${RUN}-2`, employmentId: employments.cora, version: 2, form: 'fixed', startDate: toDateOnly(addDays(TODAY, -1)), endDate: toDateOnly(addDays(addMonths(TODAY, 12), -1)), durationMonths: 12, grossSalary: 10_000, insuredSalary: 10_000, status: 'active', signedOn: toDateOnly(TODAY) },
      });
      expect((await api().get(`/api/home-locations/${home.id}`).set('Cookie', hr).expect(200)).body).toMatchObject({ endsOn: addDays(addMonths(TODAY, 12), -1), inForce: true });
      await punch(sessions.cora, { kind: 'out', ...north(500, 10) }).expect(200);
    });

    it('a client location, approved for one person, counts for everyone, on Check-in Setup, where HR ends it', async () => {
      const asked = (await ask('rami', { type: 'client', ...CLIENT, label: `Acme ${RUN}`, reason: 'Weekly visits', wishedEndDate: addDays(TODAY, 60) }).expect(201)).body;
      expect(asked.forEveryone).toBe(true);
      await punch(sessions.olga, { kind: 'in', ...CLIENT }, signed(sessions.olga, OFF_NETWORK)).expect(409);
      await decide(hr, asked.id, { decision: 'approve', validity: 'no_end' }).expect(200);
      const done = (await decide(ceo, asked.id, { decision: 'approve' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'approved', validity: 'no_end', inForce: true, location: { name: `Acme ${RUN}`, endedAt: null }, canRemove: false });
      const place = (await api().get('/api/attendance/check-in-setup/locations').set('Cookie', hr).expect(200)).body.find((l: { id: string }) => l.id === done.location.id);
      expect(place).toMatchObject({ kind: 'client', isMain: false, validUntil: null, inForce: true, requestId: asked.id, people: [] });
      // another employee passes within it, both locks on; it shows as Client · Acme
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: LINE, officeNetworkLock: true } });
      const other = (await punch(sessions.olga, { kind: 'out', ...CLIENT }, signed(sessions.olga, OFF_NETWORK)).expect(200)).body;
      expect(other.punches.at(-1)).toMatchObject({ place: 'remote', locationName: `Acme ${RUN}`, locationKind: 'client' });
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false } });
      // never the main office, nor linked to people; the request isn't removed: it is ended on Check-in Setup
      expect(said(await api().post(`/api/attendance/check-in-setup/locations/${place.id}/make-main`).set('Cookie', hr).expect(400))[0]).toContain('can’t be the main office');
      expect(said(await api().post(`/api/home-locations/${asked.id}/remove`).set('Cookie', hr).send({}).expect(409))[0]).toContain('Check-in Setup');
      // HR gives it an end date, then ends it now: no longer counts
      expect((await api().patch(`/api/attendance/check-in-setup/locations/${place.id}`).set('Cookie', hr).send({ validUntil: addDays(TODAY, 3) }).expect(200)).body).toMatchObject({ validUntil: addDays(TODAY, 3), inForce: true });
      expect((await app.get(CheckInLocationEndingsService).runOnce(new Date()))?.clients).toContain(place.id);
      const ended = (await api().post(`/api/attendance/check-in-setup/locations/${place.id}/end`).set('Cookie', hr).expect(200)).body;
      expect(ended).toMatchObject({ inForce: false, endedAt: expect.any(String) });
      await punch(sessions.olga, { kind: 'in', ...CLIENT }).expect(409);
      expect((await api().get(`/api/home-locations/${asked.id}`).set('Cookie', hr).expect(200)).body.inForce).toBe(false);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'check_in_location', entityId: place.id }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'end']);
    });

    it('warn HR and the CEO of an overlap, never the employee, and never block it', async () => {
      const near = (await ask('olga', { type: 'remote_site', ...north(100, 10), label: `Café ${RUN}`, reason: 'Meetings next door' }).expect(201)).body;
      expect(near.overlaps).toBeNull();
      const seen = (await api().get(`/api/home-locations/${near.id}`).set('Cookie', hr).expect(200)).body;
      expect(seen.overlaps).toEqual([{ label: MAIN.name, kind: 'office', radiusMetres: 150, distanceMetres: expect.any(Number) }]);
      await decide(hr, near.id, { decision: 'approve' }).expect(200);
    });

    it('a C-level person’s go to the CEO at both steps, never seen by HR', async () => {
      const mine = (await ask('cleo', { type: 'remote_site', ...north(-9000, 10), label: `Board room ${RUN}`, reason: 'Board meetings' }).expect(201)).body;
      await api().get(`/api/home-locations/${mine.id}`).set('Cookie', hr).expect(404);
      await decide(hr, mine.id, { decision: 'approve' }).expect(404);
      expect((await decide(ceo, mine.id, { decision: 'approve', validity: 'contract' }).expect(200)).body.status).toBe('with_ceo');
      expect((await decide(ceo, mine.id, { decision: 'approve' }).expect(200)).body).toMatchObject({ status: 'approved', validity: 'contract' });
      await api().post(`/api/home-locations/${mine.id}/validity`).set('Cookie', hr).send({ validity: 'until_date', validUntil: addDays(TODAY, 9) }).expect(404);
    });

    it('are audited, never with the point, the name or the reason', async () => {
      const entries = await prisma.auditLog.findMany({ where: { entityType: 'home_location', entityId: siteId }, orderBy: { id: 'asc' } });
      expect(entries.map((e) => e.action)).toEqual(['create', 'approve', 'approve', 'update']);
      expect(entries[0].diff).toMatchObject({ type: 'remote_site', radiusMetres: 120, status: 'with_hr', wishedEndDate: addDays(TODAY, 20) });
      expect(entries[1].diff).toMatchObject({ stage: 'hr', validity: 'until_date', validUntil: addDays(TODAY, 20) });
      expect(entries[3].diff).toMatchObject({ validity: { from: 'until_date', to: 'until_date' }, validUntil: { from: addDays(TODAY, -1), to: addDays(TODAY, 5) } });
      const all = JSON.stringify(await prisma.auditLog.findMany({ where: { at: { gte: started } } }), (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
      expect(all).not.toContain(String(SITE.latitude));
      expect(all).not.toContain('Our shoots are at the studio');
      expect(all).not.toContain(String(FAR.latitude));
    });

    it('hide a request’s point, name and reason from a developer', async () => {
      const res = await api().get(`/api/home-locations/${siteId}`).set('Cookie', developer);
      if (res.status === 200) {
        expect(res.body).toMatchObject({ latitude: null, longitude: null, label: null });
        expect(res.body.reason).not.toBe('Our shoots are at the studio');
      } else {
        expect([403, 404]).toContain(res.status);
      }
    });
  });

  it('kept the main office as the main', async () => {
    expect((await prisma.checkInLocation.findUniqueOrThrow({ where: { id: mainId } })).isMain).toBe(true);
  });
});
