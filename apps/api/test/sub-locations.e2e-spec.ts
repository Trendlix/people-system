import type { INestApplication } from '@nestjs/common';
import {
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  MAIN_OFFICE_LINK_REFUSED,
  MAIN_OFFICE_REMOVE_REFUSED,
  OFF_NETWORK_MESSAGE,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { todayInCairo } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, signIn } from './helpers.js';

// The main office and its sub-locations (owner, 20 October 2026, of Check-in Setup's Check-in Locations: "main office
// location is the hero and other locations are like sub locations. shown with their name and linked users"; asked, "own
// sublocation shows the sub location name", "will check it and shows remote too / any checkin rather than the office
// location counts remote and named with the location name (Remote - Location name)"): one main office, the first added,
// never two (the database's partial unique index too), Make main swapping it, the main removed only last; the people
// linked to a sub-location, HR's and Admin's, each link audited on the person's History, a C-level person neither shown
// to nor linked by HR and Admin; a person's check-in places; and the presses: Office at the main office, remote with the
// name within a sub-location, flagged "Not their location" for someone not linked to it, not "outside the office" on an
// office day at one's own; the office network's lock waived at one's own sub-location only (Claude's default). These
// tests look at their own people (names end with RUN), put the settings back and delete what they made. Every name,
// point and address is invented.

const RUN = `sl${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const KEY = process.env.WEB_KEY!;

// the main office, a studio and a client's site, a point within each and one far from them all
const MAIN = { name: `Main ${RUN}`, latitude: 30.123456, longitude: 31.456789, radiusMetres: 150 };
const STUDIO = { name: `Studio ${RUN}`, latitude: 30.054321, longitude: 31.234567, radiusMetres: 100 };
const CLIENT = { name: `Client ${RUN}`, latitude: 30.013579, longitude: 31.208642, radiusMetres: 200 };
const AT_MAIN = { latitude: 30.123756, longitude: 31.456989, accuracy: 14 };
const AT_STUDIO = { latitude: 30.054521, longitude: 31.234667, accuracy: 11 };
const AT_CLIENT = { latitude: 30.013779, longitude: 31.208842, accuracy: 16 };
const FAR = { latitude: 29.979234, longitude: 31.134202, accuracy: 30 };

// the office's line, an address on it, and one elsewhere (made-up public addresses)
const LINE = [{ label: 'Main office line', range: '41.33.30.0/24' }];
const ON_NETWORK = '41.33.30.77';
const OFF_NETWORK = '197.45.3.9';

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1);
const signed = (cookie: string, ip: string) => {
  const at = String(Date.now());
  return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(KEY, ip, at, tokenOf(cookie)) };
};

interface LocationView {
  id: string;
  name: string;
  isMain: boolean;
  people: { id: string; fullNameEn: string; employeeCode: string }[];
}

interface Press {
  kind: string;
  place: string;
  flags: string[];
  locationName: string | null;
  officeNetwork: string | null;
}

describe('The main office and its sub-locations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let superAdmin: string;
  let hrSuper: string;
  let ceo: string;
  let finance: string;
  let staff: string;
  let emailDomainBefore: string | null;
  let settingsBefore: { officeNetworks: unknown; officeNetworkLock: boolean; refuseWithoutLocation: boolean };
  let deptId: string;
  let shiftId: string;
  const started = new Date();
  const people: string[] = [];
  const locations: string[] = [];
  const loc: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account (a website session and an app one), employed under the shift (`by`: who hires them). */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, by?: string) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    sessions[`${key}App`] = await signIn(app, email, APP_USER_AGENT);
    await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', by ?? hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, shiftId, workArrangement: 'wfh', ...employment })
      .expect(201);
  }

  const list = async (session: string) => (await api().get('/api/attendance/check-in-setup/locations').set('Cookie', session).expect(200)).body as LocationView[];
  const located = async (session: string, key: string) => (await list(session)).find((l) => l.id === loc[key])!;
  const link = (session: string, key: string, employeeIds: string[]) => api().post(`/api/attendance/check-in-setup/locations/${loc[key]}/people`).set('Cookie', session).send({ employeeIds });
  const unlink = (session: string, key: string, employeeId: string) => api().post(`/api/attendance/check-in-setup/locations/${loc[key]}/people/${employeeId}/unlink`).set('Cookie', session);
  const makeMain = (session: string, key: string) => api().post(`/api/attendance/check-in-setup/locations/${loc[key]}/make-main`).set('Cookie', session);
  const placesOf = (session: string, key: string) => api().get(`/api/employees/${ids[key]}/check-in-places`).set('Cookie', session);
  const punch = (session: string, body: object, headers: Record<string, string> = {}) => api().post('/api/me/attendance/punches').set('Cookie', session).set(headers).send(body);
  const mains = () => prisma.checkInLocation.count({ where: { isMain: true } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    const s = await prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { officeNetworks: true, officeNetworkLock: true, refuseWithoutLocation: true } });
    settingsBefore = { officeNetworks: s.officeNetworks, officeNetworkLock: s.officeNetworkLock, refuseWithoutLocation: s.refuseWithoutLocation };
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false, refuseWithoutLocation: false } });
    const grades = new Map(((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).map((g) => [g.code, g.id]));

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Sub-locations Dept ${RUN}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `S${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    // Lina works at the office and is linked to the studio; Omar works at the office, linked nowhere; Walid works from
    // home and is linked to the studio; Cleo is C-level (G9), whose grade only HR with Super Admin gives
    await person('lina', 'Lina Linked', { workArrangement: 'office' });
    await person('omar', 'Omar Office', { workArrangement: 'office' });
    await person('walid', 'Walid Wfh');
    await person('cleo', 'Cleo Chief', { gradeId: grades.get('G9') }, hrSuper);
  });

  afterAll(async () => {
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.checkInLocation.deleteMany({ where: { id: { in: locations } } });
    await prisma.payrollSettings.update({
      where: { id: 1 },
      data: { officeNetworks: settingsBefore.officeNetworks as object[], officeNetworkLock: settingsBefore.officeNetworkLock, refuseWithoutLocation: settingsBefore.refuseWithoutLocation },
    });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('one main office', () => {
    it('is the first location added; every later one a sub-location, listed after it', async () => {
      expect(await prisma.checkInLocation.count()).toBe(0);
      for (const [key, body, session] of [
        ['main', MAIN, hr],
        ['studio', STUDIO, admin],
        ['client', CLIENT, hr],
      ] as const) {
        const made = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', session).send(body).expect(201)).body as LocationView;
        locations.push(made.id);
        loc[key] = made.id;
      }
      const listed = await list(hr);
      expect(listed.map((l) => [l.name, l.isMain, l.people])).toEqual([
        [MAIN.name, true, []],
        [STUDIO.name, false, []],
        [CLIENT.name, false, []],
      ]);
      expect((await prisma.auditLog.findFirst({ where: { entityType: 'check_in_location', entityId: loc.main, action: 'create' } }))?.diff).toMatchObject({ isMain: true });
    });

    it('is one only: the database refuses a second', async () => {
      await expect(prisma.checkInLocation.update({ where: { id: loc.studio }, data: { isMain: true } })).rejects.toThrow();
      expect(await mains()).toBe(1);
    });

    it('is swapped by Make main (HR and Admin), audited; a no-op on the main itself; refused for Finance, the CEO and employees', async () => {
      for (const session of [finance, ceo, staff]) await makeMain(session, 'client').expect(403);
      const swapped = (await makeMain(hr, 'client').expect(200)).body as LocationView[];
      expect(swapped.map((l) => [l.name, l.isMain])).toEqual([
        [CLIENT.name, true],
        [MAIN.name, false],
        [STUDIO.name, false],
      ]);
      expect(await mains()).toBe(1);
      const entry = await prisma.auditLog.findFirst({ where: { entityType: 'check_in_location', entityId: loc.client, action: 'make_main' }, orderBy: { id: 'desc' } });
      expect(entry?.diff).toEqual({ mainOffice: { from: MAIN.name, to: CLIENT.name }, formerMainId: loc.main });
      // back, by an Admin; then again on the main: nothing changes, nothing more audited
      await makeMain(admin, 'main').expect(200);
      expect((await list(hr))[0].id).toBe(loc.main);
      const before = await prisma.auditLog.count({ where: { action: 'make_main', at: { gte: started } } });
      await makeMain(hr, 'main').expect(200);
      expect(await prisma.auditLog.count({ where: { action: 'make_main', at: { gte: started } } })).toBe(before);
      await api().post('/api/attendance/check-in-setup/locations/00000000-0000-4000-8000-000000000000/make-main').set('Cookie', hr).expect(404);
    });

    it('is removed only last; a sub-location is removed (a Super Admin) with its links', async () => {
      expect(said(await api().delete(`/api/attendance/check-in-setup/locations/${loc.main}`).set('Cookie', superAdmin).expect(400))).toEqual([MAIN_OFFICE_REMOVE_REFUSED]);
      const spare = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send({ ...STUDIO, name: `Spare ${RUN}`, latitude: 30.2 }).expect(201)).body as LocationView;
      locations.push(spare.id);
      loc.spare = spare.id;
      await link(hr, 'spare', [ids.walid]).expect(200);
      await api().delete(`/api/attendance/check-in-setup/locations/${spare.id}`).set('Cookie', hr).expect(403);
      await api().delete(`/api/attendance/check-in-setup/locations/${spare.id}`).set('Cookie', superAdmin).expect(204);
      expect(await prisma.checkInLocationPerson.count({ where: { locationId: spare.id } })).toBe(0);
      expect((await prisma.auditLog.findFirst({ where: { entityType: 'check_in_location', entityId: spare.id, action: 'delete' } }))?.diff).toMatchObject({ isMain: false, linkedPeople: 1 });
      expect(await mains()).toBe(1);
    });
  });

  describe('the people linked to a sub-location', () => {
    it('are linked and unlinked by HR and Admin, each audited on the person’s History; Finance, the CEO and employees are refused', async () => {
      for (const session of [finance, ceo, staff]) {
        await link(session, 'studio', [ids.lina]).expect(403);
        await unlink(session, 'studio', ids.lina).expect(403);
        await api().get('/api/attendance/check-in-setup/people').set('Cookie', session).expect(403);
      }
      const linked = (await link(hr, 'studio', [ids.walid, ids.lina, ids.lina]).expect(200)).body as LocationView;
      expect(linked.people.map((p) => p.id)).toEqual([ids.lina, ids.walid]);
      // again: those already linked stay as they are, nothing more audited
      await link(admin, 'studio', [ids.lina]).expect(200);
      const entries = await prisma.auditLog.findMany({ where: { entityType: 'check_in_location', entityId: loc.studio, action: 'link_person' }, orderBy: { id: 'asc' } });
      expect(entries.map((e) => (e.diff as { employeeId: string }).employeeId).sort()).toEqual([ids.lina, ids.walid].sort());
      expect(entries[0].diff).toMatchObject({ location: STUDIO.name, employee: expect.stringContaining(RUN) });
      // on Lina's History
      const history = (await api().get(`/api/audit?employeeId=${ids.lina}`).set('Cookie', superAdmin).expect(200)).body as { entries: { action: string }[] };
      expect(history.entries.map((e) => e.action)).toContain('link_person');

      // an Admin links Omar to the client's site, then unlinks him
      expect(((await link(admin, 'client', [ids.omar]).expect(200)).body as LocationView).people.map((p) => p.id)).toEqual([ids.omar]);
      expect(((await unlink(admin, 'client', ids.omar).expect(200)).body as LocationView).people).toEqual([]);
      expect(await prisma.auditLog.count({ where: { entityId: loc.client, action: 'unlink_person', diff: { path: ['employeeId'], equals: ids.omar } } })).toBe(1);
      await unlink(hr, 'client', ids.omar).expect(404);
    });

    it('are never linked to the main office; an unknown person or a bad id is refused', async () => {
      expect(said(await link(hr, 'main', [ids.lina]).expect(400))).toEqual([MAIN_OFFICE_LINK_REFUSED]);
      await link(hr, 'studio', ['00000000-0000-4000-8000-000000000000']).expect(404);
      await link(hr, 'studio', ['not-an-id']).expect(400);
      await link(hr, 'studio', []).expect(400);
    });

    it('never show a C-level person to HR or Admin, who can’t link or unlink them; the Super Admin can', async () => {
      for (const session of [hr, admin]) {
        const linkable = (await api().get('/api/attendance/check-in-setup/people').set('Cookie', session).expect(200)).body as { id: string }[];
        expect(linkable.map((p) => p.id)).toEqual(expect.arrayContaining([ids.lina, ids.omar, ids.walid]));
        expect(linkable.map((p) => p.id)).not.toContain(ids.cleo);
        await link(session, 'studio', [ids.cleo]).expect(404);
        await link(session, 'studio', [ids.omar, ids.cleo]).expect(404);
      }
      expect(await prisma.checkInLocationPerson.count({ where: { locationId: loc.studio, employeeId: { in: [ids.cleo, ids.omar] } } })).toBe(0);
      const linkable = (await api().get('/api/attendance/check-in-setup/people').set('Cookie', superAdmin).expect(200)).body as { id: string }[];
      expect(linkable.map((p) => p.id)).toContain(ids.cleo);
      expect(((await link(superAdmin, 'studio', [ids.cleo]).expect(200)).body as LocationView).people.map((p) => p.id)).toContain(ids.cleo);
      // HR's list leaves her out, the Super Admin's has her
      expect((await located(hr, 'studio')).people.map((p) => p.id)).toEqual([ids.lina, ids.walid]);
      expect((await located(superAdmin, 'studio')).people.map((p) => p.id)).toContain(ids.cleo);
      await unlink(hr, 'studio', ids.cleo).expect(404);
      expect(await prisma.checkInLocationPerson.count({ where: { locationId: loc.studio, employeeId: ids.cleo } })).toBe(1);
      await unlink(superAdmin, 'studio', ids.cleo).expect(200);
    });
  });

  describe('a person’s check-in places', () => {
    it('are seen by HR, Admin, the CEO and the person themself; others refused, a C-level person’s 404 for HR', async () => {
      expect((await placesOf(hr, 'walid').expect(200)).body).toEqual({ places: [{ id: loc.studio, name: STUDIO.name }] });
      for (const session of [admin, ceo, sessions.walid]) expect((await placesOf(session, 'walid').expect(200)).body.places).toHaveLength(1);
      await placesOf(sessions.omar, 'walid').expect(403);
      await placesOf(finance, 'walid').expect(403);
      expect((await placesOf(hr, 'omar').expect(200)).body).toEqual({ places: [] });
      await placesOf(hr, 'cleo').expect(404);
      expect((await placesOf(superAdmin, 'cleo').expect(200)).body).toEqual({ places: [] });
    });

    it('leave out the main office: a link doesn’t count while it is the main, and counts again once it is a sub-location', async () => {
      await link(hr, 'client', [ids.walid]).expect(200);
      expect((await placesOf(hr, 'walid').expect(200)).body.places.map((p: { name: string }) => p.name)).toEqual([CLIENT.name, STUDIO.name]);
      await makeMain(hr, 'client').expect(200);
      expect((await placesOf(hr, 'walid').expect(200)).body.places.map((p: { name: string }) => p.name)).toEqual([STUDIO.name]);
      expect((await located(hr, 'client')).people).toEqual([]);
      await makeMain(hr, 'main').expect(200);
      expect((await located(hr, 'client')).people.map((p) => p.id)).toEqual([ids.walid]);
      await unlink(hr, 'client', ids.walid).expect(200);
    });
  });

  describe('the presses', () => {
    it('are Office at the main office, for anyone', async () => {
      const res = (await punch(sessions.lina, { kind: 'in', ...AT_MAIN }).expect(200)).body as { punches: Press[]; messages: string[] };
      expect(res.punches.at(-1)).toMatchObject({ place: 'office', locationName: MAIN.name, flags: [] });
      expect(res.messages[0]).toContain('at the office');
      await punch(sessions.lina, { kind: 'out', ...AT_MAIN }).expect(200);
    });

    it('are remote with the name at one’s own sub-location, not flagged, not outside the office on an office day', async () => {
      const res = (await punch(sessions.lina, { kind: 'in', ...AT_STUDIO }).expect(200)).body as { punches: Press[]; messages: string[]; ownPlaces: string[] };
      expect(res.punches.at(-1)).toMatchObject({ kind: 'in', place: 'remote', locationName: STUDIO.name, flags: [] });
      expect(res.messages[0]).toContain(`remote at ${STUDIO.name}`);
      expect(res.ownPlaces).toEqual([STUDIO.name]);
      const walid = (await punch(sessions.walid, { kind: 'in', ...AT_STUDIO }).expect(200)).body as { punches: Press[] };
      expect(walid.punches.at(-1)).toMatchObject({ place: 'remote', locationName: STUDIO.name, flags: [] });
    });

    it('are remote with the name at another’s sub-location, flagged "Not their location" (and outside the office on an office day)', async () => {
      const omar = (await punch(sessions.omar, { kind: 'in', ...AT_STUDIO }).expect(200)).body as { punches: Press[]; messages: string[] };
      expect(omar.punches.at(-1)).toMatchObject({ place: 'remote', locationName: STUDIO.name, flags: ['outside_office', 'not_their_location'] });
      expect(omar.messages.join(' ')).toContain('Not their location');
      await punch(sessions.walid, { kind: 'out', ...AT_CLIENT }).expect(200);
      const walid = (await punch(sessions.walid, { kind: 'in', ...AT_CLIENT }).expect(200)).body as { punches: Press[] };
      expect(walid.punches.at(-1)).toMatchObject({ place: 'remote', locationName: CLIENT.name, flags: ['not_their_location'] });
      // the day keeps the flag; Daily Attendance has the presses with the place and the name (the page says "Remote - Client …")
      const day = await prisma.attendanceDay.findFirst({ where: { employeeId: ids.omar, source: 'system' } });
      expect(day).toMatchObject({ place: 'remote', flags: ['outside_office', 'not_their_location'] });
      const daily = (await api().get(`/api/attendance?departmentId=${deptId}&month=${CURRENT}`).set('Cookie', hr).expect(200)).body as {
        people: { employee: { id: string }; punches?: Press[]; figures: { remoteDays: number; flaggedDays: number } }[];
      };
      const row = daily.people.find((p) => p.employee.id === ids.walid)!;
      expect(row.punches?.map((p) => [p.kind, p.place, p.locationName])).toEqual([
        ['in', 'remote', STUDIO.name],
        ['out', 'remote', CLIENT.name],
        ['in', 'remote', CLIENT.name],
      ]);
      // remote for every other rule: a remote day, flagged
      expect(daily.people.find((p) => p.employee.id === ids.omar)?.figures).toMatchObject({ remoteDays: 1, flaggedDays: 1 });
    });

    it('are remote elsewhere, as before', async () => {
      await punch(sessions.omar, { kind: 'out', ...FAR }).expect(200);
      const res = (await punch(sessions.omar, { kind: 'in', ...FAR }).expect(200)).body as { punches: Press[] };
      expect(res.punches.at(-1)).toMatchObject({ place: 'remote', locationName: null, flags: ['outside_office'] });
    });
  });

  describe('the office network’s lock (Claude’s default)', () => {
    beforeAll(async () => {
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: LINE, officeNetworkLock: true } });
    });
    afterAll(async () => {
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false } });
    });

    it('lets a locked Office person linked to a sub-location check in there off the network, as remote with its name', async () => {
      const today = (await api().get('/api/me/attendance/today').set('Cookie', sessions.lina).expect(200)).body as { network: { locked: boolean }; ownPlaces: string[] };
      expect(today).toMatchObject({ network: { locked: true }, ownPlaces: [STUDIO.name] });
      const out = (await punch(sessions.lina, { kind: 'out', ...AT_STUDIO }, signed(sessions.lina, OFF_NETWORK)).expect(200)).body as { punches: Press[] };
      expect(out.punches.at(-1)).toMatchObject({ kind: 'out', place: 'remote', locationName: STUDIO.name, officeNetwork: null });
      // in the app too, unsigned
      const app = (await punch(sessions.linaApp, { kind: 'in', ...AT_STUDIO }).expect(200)).body as { punches: Press[] };
      expect(app.punches.at(-1)).toMatchObject({ kind: 'in', place: 'remote', locationName: STUDIO.name, flags: [] });
    });

    it('still refuses them elsewhere off the network, and on a mock location at their own; and anyone not linked to it', async () => {
      for (const where of [AT_CLIENT, FAR, AT_MAIN]) {
        expect(said(await punch(sessions.lina, { kind: 'out', ...where }, signed(sessions.lina, OFF_NETWORK)).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      }
      expect(said(await punch(sessions.linaApp, { kind: 'out', ...AT_STUDIO, mock: true }).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      expect(said(await punch(sessions.omar, { kind: 'out', ...AT_STUDIO }, signed(sessions.omar, OFF_NETWORK)).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
    });

    it('keeps a press on the office network at the office, whatever sub-location the location says', async () => {
      const res = (await punch(sessions.omar, { kind: 'out', ...AT_STUDIO }, signed(sessions.omar, ON_NETWORK)).expect(200)).body as { punches: Press[] };
      expect(res.punches.at(-1)).toMatchObject({ kind: 'out', place: 'office', officeNetwork: 'Main office line', locationName: null, flags: [] });
    });
  });
});
