import type { INestApplication } from '@nestjs/common';
import {
  APP_LOCATION_NEEDED_MESSAGE,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  LOCK_NEEDS_KEY_MESSAGE,
  NETWORK_NEEDED_TEXT,
  OFF_NETWORK_MESSAGE,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, signIn } from './helpers.js';

// Attendance → Check-in Setup (owner, 20 October 2026: "i cant find in the system where to add the eligable check in
// locations", then "Own page, several locations"): several check-in locations, HR's and Admin's, removed by a Super Admin,
// each change audited; the first the main office, within which a check-in is at the office, and the second a sub-location,
// within which it is remote with its name (owner, 20 October 2026: "main office location is the hero and other locations
// are like sub locations"; the rest in sub-locations.e2e-spec.ts). Check-ins locked to the office network (owner,
// the same day: "allow me to lock checkin's to wifi name or ip, whatever is right"; "Off the office network: refuse it",
// "Office staff, plus exceptions", check-in and check-out both): the networks and the switch, HR's and Admin's; the
// address trusted only as the website signed it (WEB_KEY, set for the tests in vitest.config.e2e.ts), a forged or plain
// one ignored, another session's or a stale one refused; without the key the lock can't be switched on and no one is
// refused; a locked person refused off the network, both in and out, in the audit log without the address; on it, at the
// office whatever the location says; an exempt or a hybrid person anywhere; no employee's address kept anywhere. Inside
// the app (owner, 20 October 2026: "Refuse without location", "App only"): a press without a location is refused; on the
// website it is kept, location unknown (unless the company's switch refuses it: punch-location.e2e-spec.ts). These tests look at their own people (names end with RUN), put the networks'
// setting back and delete what they made. Every name, point and address is invented.

const RUN = Date.now().toString(36).toLowerCase();
const KEY = process.env.WEB_KEY!;

// two locations, and a point within each and one far from both
const HEAD = { name: `Head ${RUN}`, latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
const STUDIO = { name: `Studio ${RUN}`, latitude: 30.0444, longitude: 31.2357, radiusMetres: 100 };
const AT_STUDIO = { latitude: 30.0446, longitude: 31.2359, accuracy: 12 };
const FAR = { latitude: 29.9792, longitude: 31.1342, accuracy: 30 };

// the office's line, an address on it, and one elsewhere (documentation-like, made-up public addresses)
const OFFICE_RANGE = '41.33.10.0/24';
const ON_NETWORK = '41.33.10.77';
const OFF_NETWORK = '197.45.1.9';

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1);

/** The headers the website adds: the address, when, and WEB_KEY's signature for this session's token. */
function signed(cookie: string, ip: string, more: { at?: number; token?: string; key?: string } = {}) {
  const at = String(more.at ?? Date.now());
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(more.key ?? KEY, ip, at, more.token ?? tokenOf(cookie)) };
}

describe('Check-in Setup and the office network (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let superAdmin: string;
  let finance: string;
  let ceo: string;
  let staff: string;
  let emailDomainBefore: string | null;
  let networksBefore: { officeNetworks: unknown; officeNetworkLock: boolean };
  let deptId: string;
  let shiftId: string;
  const started = new Date();
  const people: string[] = [];
  const locations: string[] = [];
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account (a website session, and an app one), employed under the shift. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    sessions[`${key}App`] = await signIn(app, email, APP_USER_AGENT);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, shiftId, ...employment })
      .expect(201);
    employments[key] = hired.body.employment.id;
  }

  const punch = (session: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    api().post('/api/me/attendance/punches').set('Cookie', session).set(headers).send(body);
  const today = async (key: string) => (await api().get('/api/me/attendance/today').set('Cookie', sessions[key]).expect(200)).body;
  const networks = (session: string, headers: Record<string, string> = {}) => api().get('/api/attendance/check-in-setup/networks').set('Cookie', session).set(headers);
  const saveNetworks = (session: string, body: object, headers: Record<string, string> = {}) =>
    api().put('/api/attendance/check-in-setup/networks').set('Cookie', session).set(headers).send(body);
  const LINE = [{ label: 'Main office line', range: OFFICE_RANGE }];

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    const s = await prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { officeNetworks: true, officeNetworkLock: true } });
    networksBefore = { officeNetworks: s.officeNetworks, officeNetworkLock: s.officeNetworkLock };
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false } });

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Check-in Setup Dept ${RUN}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `N${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    await person('olga', 'Olga Office', { workArrangement: 'office' });
    await person('omar', 'Omar Officeexempt', { workArrangement: 'office' });
    await person('hana', 'Hana Hybrid', { workArrangement: 'hybrid', officeDays: [0, 1, 2, 3, 4, 5, 6] });
    await person('walid', 'Walid Wfh', { workArrangement: 'wfh' });
    await person('aya', 'Aya App', { workArrangement: 'wfh' });
    await person('otto', 'Otto Officeapp', { workArrangement: 'office' });
  });

  afterAll(async () => {
    process.env.WEB_KEY = KEY;
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.checkInLocation.deleteMany({ where: { id: { in: locations } } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: networksBefore.officeNetworks as object[], officeNetworkLock: networksBefore.officeNetworkLock } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('check-in locations', () => {
    it('are HR’s and Admin’s to add and change, each change audited; Finance, the CEO and employees are refused', async () => {
      for (const session of [finance, ceo, staff]) {
        await api().get('/api/attendance/check-in-setup/locations').set('Cookie', session).expect(403);
        await api().post('/api/attendance/check-in-setup/locations').set('Cookie', session).send(HEAD).expect(403);
      }
      const head = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(HEAD).expect(201)).body;
      locations.push(head.id);
      // the first added is the main office
      expect(head).toMatchObject({ ...HEAD, isMain: true, people: [] });
      // 150 metres unless sent; an Admin adds too; a sub-location
      const studio = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', admin).send({ ...STUDIO, radiusMetres: undefined }).expect(201)).body;
      locations.push(studio.id);
      expect(studio).toMatchObject({ radiusMetres: 150, isMain: false, people: [] });
      expect(said(await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send({ ...HEAD, name: HEAD.name.toUpperCase() }).expect(400))[0]).toContain(
        'There is a location named',
      );
      expect(said(await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send({ ...HEAD, name: ' ' }).expect(400))).toEqual(['Name the location, e.g. Head office.']);

      const changed = (await api().patch(`/api/attendance/check-in-setup/locations/${studio.id}`).set('Cookie', hr).send({ radiusMetres: STUDIO.radiusMetres }).expect(200)).body;
      expect(changed).toMatchObject(STUDIO);
      await api().patch(`/api/attendance/check-in-setup/locations/${studio.id}`).set('Cookie', finance).send({ radiusMetres: 300 }).expect(403);
      expect(said(await api().patch(`/api/attendance/check-in-setup/locations/${studio.id}`).set('Cookie', hr).send({ radiusMetres: 9000 }).expect(400))[0]).toContain('from 20 to 5,000');

      const listed = (await api().get('/api/attendance/check-in-setup/locations').set('Cookie', admin).expect(200)).body as { id: string }[];
      expect(listed.map((l) => l.id)).toEqual(expect.arrayContaining([head.id, studio.id]));

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'check_in_location', entityId: { in: [head.id, studio.id] } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'create', 'update']);
      expect(audit[2].diff).toEqual({ radiusMetres: { from: 150, to: 100 } });
    });

    it('are removed by a Super Admin only, as every deletion', async () => {
      const spare = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send({ ...HEAD, name: `Spare ${RUN}` }).expect(201)).body;
      locations.push(spare.id);
      await api().delete(`/api/attendance/check-in-setup/locations/${spare.id}`).set('Cookie', hr).expect(403);
      await api().delete(`/api/attendance/check-in-setup/locations/${spare.id}`).set('Cookie', admin).expect(403);
      await api().delete(`/api/attendance/check-in-setup/locations/${spare.id}`).set('Cookie', superAdmin).expect(204);
      expect(await prisma.checkInLocation.count({ where: { id: spare.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityType: 'check_in_location', entityId: spare.id, action: 'delete' } })).toBe(1);
    });

    it('count a check-in within the second one, a sub-location, as remote with its name, flagged for someone not linked to it', async () => {
      const res = (await punch(sessions.walid, { kind: 'in', ...AT_STUDIO }).expect(200)).body;
      expect(res.punches.at(-1)).toMatchObject({ place: 'remote', accuracyMetres: 12, locationName: STUDIO.name, officeNetwork: null, flags: ['not_their_location'] });
      expect(res.messages[0]).toContain(`remote at ${STUDIO.name}`);
      expect(res.officeLocationSet).toBe(true);
    });
  });

  describe('the office networks', () => {
    it('are HR’s and Admin’s; the page learns this request’s signed address, and a plain one is ignored', async () => {
      for (const session of [finance, ceo, staff]) {
        await networks(session).expect(403);
        await saveNetworks(session, { lock: false, networks: LINE }).expect(403);
      }
      const state = (await networks(hr, signed(hr, ON_NETWORK)).expect(200)).body;
      expect(state).toEqual({ lock: false, networks: [], serverKey: true, inForce: false, here: { signed: true, ip: ON_NETWORK, network: null } });
      expect((await networks(admin).expect(200)).body.here).toEqual({ signed: false, problem: 'unsigned' });
      expect((await networks(hr, { [CLIENT_IP_HEADER]: ON_NETWORK, 'x-forwarded-for': ON_NETWORK }).expect(200)).body.here).toEqual({ signed: false, problem: 'malformed' });
    });

    it('take an IPv4 address or range or an IPv6 range, checked, and are audited', async () => {
      expect(said(await saveNetworks(hr, { lock: false, networks: [{ label: 'Wi-Fi', range: '192.168.1.0/24' }] }).expect(400))[0]).toContain('is a private address');
      expect(said(await saveNetworks(hr, { lock: false, networks: [{ label: '', range: OFFICE_RANGE }] }).expect(400))[0]).toContain('Name each network');
      const saved = (
        await saveNetworks(admin, { lock: false, networks: [{ label: 'Main office line', range: '41.33.10.5/24' }, { label: 'Fibre', range: '2001:db8:1234:5678::/64' }] }).expect(200)
      ).body;
      expect(saved.networks).toEqual([...LINE, { label: 'Fibre', range: '2001:db8:1234:5678::/64' }]);
      const entry = await prisma.auditLog.findFirst({ where: { entityType: 'office_networks', at: { gte: started } }, orderBy: { id: 'desc' } });
      expect(entry?.diff).toMatchObject({ officeNetworks: { from: [], to: saved.networks } });
    });

    it('can’t be switched on without the website’s signature, nor without a network', async () => {
      expect(said(await saveNetworks(hr, { lock: true, networks: LINE }).expect(400))[0]).toContain("The lock can't be switched on yet");
      expect(said(await saveNetworks(hr, { lock: true, networks: [] }, signed(hr, ON_NETWORK)).expect(400))[0]).toContain('Add the office network');
      const on = (await saveNetworks(hr, { lock: true, networks: LINE }, signed(hr, ON_NETWORK)).expect(200)).body;
      expect(on).toMatchObject({ lock: true, inForce: true, here: { signed: true, ip: ON_NETWORK, network: 'Main office line' } });
    });
  });

  describe('a locked person (Office, the lock on)', () => {
    it('is told before pressing; one HR exempts, a hybrid and a home worker aren’t locked', async () => {
      expect((await today('olga')).network).toEqual({ locked: true });
      const exempt = (await api().patch(`/api/employees/${ids.omar}/employments/${employments.omar}`).set('Cookie', hr).send({ checkInAnywhere: true }).expect(200)).body;
      expect(exempt.employment.checkInAnywhere).toBe(true);
      expect(await prisma.auditLog.findFirst({ where: { entityType: 'employment', entityId: employments.omar, action: 'update' }, orderBy: { id: 'desc' } })).toMatchObject({
        diff: { checkInAnywhere: { from: false, to: true } },
      });
      expect((await today('omar')).network).toEqual({ locked: false });
      expect((await today('hana')).network).toEqual({ locked: false });
      expect(NETWORK_NEEDED_TEXT).toContain('office network');
    });

    it('is refused off the network, checking in and out alike, in the audit log without the address', async () => {
      expect(said(await punch(sessions.olga, { kind: 'in', ...FAR }, signed(sessions.olga, OFF_NETWORK)).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      expect(said(await punch(sessions.olga, { kind: 'out', ...FAR }, signed(sessions.olga, OFF_NETWORK)).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      expect(await prisma.attendancePunch.count({ where: { employeeId: ids.olga } })).toBe(0);
      const refused = await prisma.auditLog.findMany({ where: { entityType: 'employee', entityId: ids.olga, action: 'check_in_refused' }, orderBy: { id: 'asc' } });
      expect(refused.map((r) => r.diff)).toEqual([
        { kind: 'in', date: expect.any(String), reason: 'off_network' },
        { kind: 'out', date: expect.any(String), reason: 'off_network' },
      ]);
    });

    it('ignores a forged or plain address: refused as off the network', async () => {
      await punch(sessions.olga, { kind: 'in', ...FAR }).expect(409);
      await punch(sessions.olga, { kind: 'in', ...FAR }, { [CLIENT_IP_HEADER]: ON_NETWORK }).expect(409);
      await punch(sessions.olga, { kind: 'in', ...FAR }, { 'x-forwarded-for': ON_NETWORK, 'x-real-ip': ON_NETWORK }).expect(409);
      // signed with another key, or the address changed after signing
      await punch(sessions.olga, { kind: 'in', ...FAR }, signed(sessions.olga, ON_NETWORK, { key: `${KEY}-forged` })).expect(409);
      await punch(sessions.olga, { kind: 'in', ...FAR }, { ...signed(sessions.olga, OFF_NETWORK), [CLIENT_IP_HEADER]: ON_NETWORK }).expect(409);
      const last = await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: ids.olga, action: 'check_in_refused' }, orderBy: { id: 'desc' } });
      expect(last?.diff).toMatchObject({ reason: 'not_signed' });
    });

    it('refuses another session’s signature and a stale one', async () => {
      await punch(sessions.olga, { kind: 'in', ...FAR }, signed(sessions.olga, ON_NETWORK, { token: tokenOf(sessions.hana) })).expect(409);
      await punch(sessions.olga, { kind: 'in', ...FAR }, signed(sessions.olga, ON_NETWORK, { at: Date.now() - 120_000 })).expect(409);
      await punch(sessions.olga, { kind: 'in', ...FAR }, signed(sessions.olga, ON_NETWORK, { at: Date.now() + 120_000 })).expect(409);
      expect(await prisma.attendancePunch.count({ where: { employeeId: ids.olga } })).toBe(0);
    });

    // The Flutter app talks to the API itself (apps/flutter, 30 October 2026): the connection's address, as Caddy
    // writes it in X-Forwarded-For (the last entry), for an app session only; the website's signature still first.
    it('reads the connection’s address inside the app, which talks to People itself; never for a website session', async () => {
      const lastRefusal = async () =>
        (await prisma.auditLog.findFirst({ where: { entityType: 'employee', entityId: ids.otto, action: 'check_in_refused' }, orderBy: { id: 'desc' } }))?.diff;
      expect(said(await punch(sessions.ottoApp, { kind: 'in', ...FAR }, { 'x-forwarded-for': OFF_NETWORK }).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      expect(await lastRefusal()).toMatchObject({ reason: 'off_network' });
      // an address the phone named before Caddy's own counts for nothing
      await punch(sessions.ottoApp, { kind: 'in', ...FAR }, { 'x-forwarded-for': `${ON_NETWORK}, ${OFF_NETWORK}` }).expect(409);
      // the website's session: only what the website signed
      await punch(sessions.otto, { kind: 'in', ...FAR }, { 'x-forwarded-for': ON_NETWORK }).expect(409);
      expect(await lastRefusal()).toMatchObject({ reason: 'not_signed' });
      expect(await prisma.attendancePunch.count({ where: { employeeId: ids.otto } })).toBe(0);
      const inside = (await punch(sessions.ottoApp, { kind: 'in', ...FAR }, { 'x-forwarded-for': `${OFF_NETWORK}, ::ffff:${ON_NETWORK}` }).expect(200)).body;
      expect(inside.punches.at(-1)).toMatchObject({ kind: 'in', place: 'office', officeNetwork: 'Main office line' });
      // the website's signature first: on the network, whatever the connection
      const out = (await punch(sessions.ottoApp, { kind: 'out', ...FAR }, { ...signed(sessions.ottoApp, ON_NETWORK), 'x-forwarded-for': OFF_NETWORK }).expect(200)).body;
      expect(out.punches.at(-1)).toMatchObject({ kind: 'out', place: 'office', officeNetwork: 'Main office line' });
    });

    it('is kept at the office on the network, whatever the location says, in and out', async () => {
      const inside = (await punch(sessions.olga, { kind: 'in', ...FAR }, signed(sessions.olga, ON_NETWORK)).expect(200)).body;
      expect(inside.punches.at(-1)).toMatchObject({ kind: 'in', place: 'office', officeNetwork: 'Main office line', locationName: null, flags: [] });
      const out = (await punch(sessions.olga, { kind: 'out', locationError: 'denied' }, signed(sessions.olga, ON_NETWORK)).expect(200)).body;
      expect(out.punches.at(-1)).toMatchObject({ kind: 'out', place: 'office', officeNetwork: 'Main office line' });
      // a mock location is still flagged, never refused
      const mocked = (await punch(sessions.olgaApp, { kind: 'in', ...FAR, mock: true }, signed(sessions.olgaApp, ON_NETWORK)).expect(200)).body;
      expect(mocked.punches.at(-1).flags).toEqual(['fake_gps']);
    });

    it('lets an exempt person, a hybrid and a home worker check in from anywhere, signed or not', async () => {
      const omar = (await punch(sessions.omar, { kind: 'in', ...FAR }, signed(sessions.omar, OFF_NETWORK)).expect(200)).body;
      expect(omar.punches.at(-1)).toMatchObject({ place: 'remote', officeNetwork: null });
      await punch(sessions.hana, { kind: 'in', ...FAR }).expect(200);
      // a hybrid person on the office network: at the office too
      const hana = (await punch(sessions.hana, { kind: 'out', ...FAR }, signed(sessions.hana, ON_NETWORK)).expect(200)).body;
      expect(hana.punches.at(-1)).toMatchObject({ place: 'office', officeNetwork: 'Main office line' });
      await punch(sessions.walid, { kind: 'out' }).expect(200);
    });
  });

  describe('without the key on the server', () => {
    afterEach(() => {
      process.env.WEB_KEY = KEY;
    });

    it('the lock can’t be switched on, and isn’t in force: no one is refused', async () => {
      delete process.env.WEB_KEY;
      const state = (await networks(hr, signed(hr, ON_NETWORK)).expect(200)).body;
      expect(state).toMatchObject({ lock: true, serverKey: false, inForce: false, here: { signed: false, problem: 'no_server_key' } });
      expect(said(await saveNetworks(hr, { lock: true, networks: LINE }, signed(hr, ON_NETWORK)).expect(400))).toEqual([LOCK_NEEDS_KEY_MESSAGE]);
      expect((await today('olga')).network).toEqual({ locked: false });
      // a forged address isn't trusted either: kept by its location, not at the office
      const res = (await punch(sessions.olga, { kind: 'out', ...FAR }, { [CLIENT_IP_HEADER]: ON_NETWORK }).expect(200)).body;
      expect(res.punches.at(-1)).toMatchObject({ kind: 'out', place: 'remote', officeNetwork: null });
      // switching it off needs no key
      expect((await saveNetworks(hr, { lock: false, networks: LINE }).expect(200)).body).toMatchObject({ lock: false, inForce: false });
    });
  });

  describe('inside the app (owner, 20 October 2026: "Refuse without location", "App only")', () => {
    it('refuses a press without a location, keeps one with it; the website keeps one without it as location unknown', async () => {
      expect(said(await punch(sessions.ayaApp, { kind: 'in', locationError: 'denied' }).expect(409))).toEqual([APP_LOCATION_NEEDED_MESSAGE]);
      expect(said(await punch(sessions.ayaApp, { kind: 'in' }).expect(409))).toEqual([APP_LOCATION_NEEDED_MESSAGE]);
      expect(await prisma.attendancePunch.count({ where: { employeeId: ids.aya } })).toBe(0);
      const app = (await punch(sessions.ayaApp, { kind: 'in', ...AT_STUDIO }).expect(200)).body;
      expect(app.punches.at(-1)).toMatchObject({ place: 'remote', locationName: STUDIO.name });
      const web = (await punch(sessions.aya, { kind: 'out', locationError: 'denied' }).expect(200)).body;
      expect(web.punches.at(-1)).toMatchObject({ kind: 'out', place: 'unknown', accuracyMetres: null });
    });
  });

  it('keeps no employee’s address anywhere, and a reading’s point only on its press: not on the days or in the audit log', async () => {
    const punches = await prisma.attendancePunch.findMany({ where: { employeeId: { in: people } } });
    const days = await prisma.attendanceDay.findMany({ where: { employeeId: { in: people } } });
    const audit = await prisma.auditLog.findMany({ where: { at: { gte: started } } });
    expect(punches.length).toBeGreaterThan(5);
    const kept = JSON.stringify({ punches, days, audit }, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    expect(kept).not.toContain(ON_NETWORK);
    expect(kept).not.toContain(OFF_NETWORK);
    // a reading's point on its press (owner, 20 October 2026: "Yes, keep the spot"), never on a day or in the audit log
    expect(punches.some((p) => p.latitude?.toNumber() === AT_STUDIO.latitude)).toBe(true);
    expect(JSON.stringify({ days, audit }, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('30.0446');
  });
});
