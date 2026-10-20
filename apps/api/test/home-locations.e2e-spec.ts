import type { INestApplication } from '@nestjs/common';
import { HOME_OPEN_ALREADY, OFF_NETWORK_MESSAGE } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; then "Label Home, flag elsewhere", "then approved by the HR and CEO", everyone may ask). Anyone with a profile
// asks, one being decided at a time; HR approves (changing the radius if it wants) or rejects with a comment, then the
// CEO; a C-level person's both by the CEO and kept from HR; a CEO's own CEO step by a Super Admin; a newly approved home
// replaces the old; withdrawn, rejected, replaced or removed, the point is deleted. A check-in within the approved home
// is Home, a remote one elsewhere flagged "Not at home or the office", someone without a home as before; Daily
// Attendance, its filters and the workbook show both. Seen only by the employee, HR, the CEO and the Super Admin:
// managers and Finance are refused. Never a coordinate on a punch, a day or the audit log. These tests look at their own
// people (names end with RUN) and delete what they made. Every name and point is invented.

const RUN = `hl${Date.now().toString(36).toLowerCase()}`;
const CURRENT = todayInCairo().slice(0, 7);

// an office far from the homes, and the homes (6 decimals, so a coordinate is easy to look for)
const OFFICE = { name: `Office ${RUN}`, latitude: 29.960013, longitude: 31.250024, radiusMetres: 150 };
const HOME = { latitude: 30.101234, longitude: 31.380123 };
const AT_HOME = { latitude: 30.102321, longitude: 31.380123, accuracy: 12.4 }; // about 121 m from HOME: outside 100 m, inside 150 m
const NEW_HOME = { latitude: 30.070456, longitude: 31.280789 };
const OLGA_HOME = { latitude: 30.090567, longitude: 31.330678 };
const CLARA_HOME = { latitude: 30.050789, longitude: 31.360891 };
const CHIEF_HOME = { latitude: 30.060912, longitude: 31.370934 };
const MONA_HOME = { latitude: 30.080135, longitude: 31.300246 };
const HANA_HOME = { latitude: 30.085357, longitude: 31.305468 };
const NADIA_HOME = { latitude: 30.095579, longitude: 31.315791 };
const CAFE = { latitude: 30.013146, longitude: 31.208957, accuracy: 30 }; // far from every office and home
const POINTS = [HOME, AT_HOME, NEW_HOME, OLGA_HOME, CLARA_HOME, CHIEF_HOME, MONA_HOME, HANA_HOME, NADIA_HOME, CAFE];

/** Every coordinate sent, as text to 6 and to 4 decimals: none may show up where only a place is kept. */
const COORDINATES = POINTS.flatMap((p) => [p.latitude, p.longitude]).flatMap((n) => [n.toFixed(6), n.toFixed(4)]);
const withoutCoordinates = (value: unknown) => {
  const text = JSON.stringify(value);
  return COORDINATES.filter((c) => text.includes(c));
};

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

interface Home {
  id: string;
  status: string;
  stage: string | null;
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  radiusMetres: number;
  accuracyMetres: number | null;
  waitingForYou: boolean;
  confidential: boolean;
  canWithdraw: boolean;
  canRemove: boolean;
  approvedAt: string | null;
  rejectReason: string | null;
  employee: { id: string; fullNameEn: string };
  steps: { kind: string; decision: string | null; radiusMetres: number | null; comment: string | null; actor: string | null }[];
}

describe('Home locations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let hrSuper: string;
  let noProfile: string;
  let emailDomainBefore: string | null;
  let networksBefore: { officeNetworks: unknown; officeNetworkLock: boolean };
  let deptId: string;
  let shiftId: string;
  let locationId: string;
  const started = new Date();
  const people: string[] = [];
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const homes: Record<string, string> = {};
  const grades = new Map<string, string>();
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account of these roles, employed under the shift (`by`: who hires them). */
  async function person(key: string, who: string, roles: Parameters<typeof createUser>[1], employment: Record<string, unknown> = {}, by?: string) {
    const email = await createUser(prisma, roles);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', by ?? hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, shiftId, workArrangement: 'wfh', ...employment })
      .expect(201);
  }

  const ask = (key: string, body: object) => api().post('/api/me/home-locations').set('Cookie', sessions[key]).send(body);
  const one = (id: string, session: string) => api().get(`/api/home-locations/${id}`).set('Cookie', session);
  const list = (session: string, query = '') => api().get(`/api/home-locations${query}`).set('Cookie', session);
  const decide = (id: string, session: string, body: object) => api().post(`/api/home-locations/${id}/decide`).set('Cookie', session).send(body);
  const waiting = async (session: string) => (await api().get('/api/home-locations/counts').set('Cookie', session).expect(200)).body.waiting as number;
  const punch = (key: string, body: object) => api().post('/api/me/attendance/punches').set('Cookie', sessions[key]).send(body);
  const row = (id: string) => prisma.homeLocationRequest.findUniqueOrThrow({ where: { id } });

  /** Asks for a home and has HR then the CEO approve it. */
  async function approvedHome(key: string, point: object): Promise<string> {
    const made = (await ask(key, point).expect(201)).body as Home;
    await decide(made.id, hr, { decision: 'approve' }).expect(200);
    await decide(made.id, ceo, { decision: 'approve' }).expect(200);
    return made.id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    noProfile = await signIn(app, await createUser(prisma, ['employee']));
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    const s = await prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { officeNetworks: true, officeNetworkLock: true } });
    networksBefore = { officeNetworks: s.officeNetworks, officeNetworkLock: s.officeNetworkLock };
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false } });
    for (const g of (await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]) grades.set(g.code, g.id);

    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Home Locations Dept ${RUN}` }).expect(201)).body.id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `H${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    locationId = (await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(OFFICE).expect(201)).body.id;

    await person('mona', 'Mona Manager', ['manager']);
    await person('walid', 'Walid Wfh', ['employee'], { managerId: ids.mona });
    await person('olga', 'Olga Office', ['employee'], { workArrangement: 'office', managerId: ids.mona });
    await person('nadia', 'Nadia Nohome', ['employee']);
    await person('hana', 'Hana Hr', ['hr']);
    // C-level (G9): only HR with Super Admin gives the grade
    await person('clara', 'Clara Chief', ['employee'], { gradeId: grades.get('G9') }, hrSuper);
    await person('chief', 'Cyrus Ceo', ['ceo'], { gradeId: grades.get('G9') }, hrSuper);
  });

  afterAll(async () => {
    await prisma.homeLocationRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.checkInLocation.deleteMany({ where: { id: locationId } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: networksBefore.officeNetworks as object[], officeNetworkLock: networksBefore.officeNetworkLock } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('asking', () => {
    it('is for anyone with a profile, one being decided at a time; a sign-in without a profile is refused', async () => {
      const made = (await ask('walid', { ...HOME, accuracy: 12.4, label: '  Home,   Nasr City ' }).expect(201)).body as Home;
      homes.walidFirst = made.id;
      expect(made).toMatchObject({
        status: 'with_hr',
        stage: 'hr',
        ...HOME,
        label: 'Home, Nasr City',
        radiusMetres: 100,
        accuracyMetres: 12,
        confidential: false,
        canWithdraw: true,
        canRemove: false,
        waitingForYou: false,
        employee: { id: ids.walid },
      });
      expect(made.steps).toEqual([expect.objectContaining({ kind: 'submitted', decision: null, radiusMetres: 100 })]);
      expect(said(await ask('walid', NEW_HOME).expect(409))).toEqual([HOME_OPEN_ALREADY]);
      // everyone: a manager and someone in HR ask for theirs too
      homes.mona = ((await ask('mona', MONA_HOME).expect(201)).body as Home).id;
      homes.hana = ((await ask('hana', HANA_HOME).expect(201)).body as Home).id;
      expect(said(await api().post('/api/me/home-locations').set('Cookie', noProfile).send(HOME).expect(403))[0]).toContain('no employee profile');
    });

    it('needs the point, and a label of up to 200 characters', async () => {
      expect(said(await ask('nadia', { label: 'Home' }).expect(400))).toEqual(['Put your home on the map, or use your current location while at home.']);
      expect(said(await ask('nadia', { latitude: 95, longitude: 31 }).expect(400))).toEqual(['That point isn’t on the map: put your home on the map again.']);
      expect(said(await ask('nadia', { ...NADIA_HOME, label: 'x'.repeat(201) }).expect(400))).toEqual(['Keep the label to 200 characters or fewer.']);
      expect(await prisma.homeLocationRequest.count({ where: { employeeId: ids.nadia } })).toBe(0);
    });

    it('lists the employee’s own requests, newest first', async () => {
      const mine = (await api().get('/api/me/home-locations').set('Cookie', sessions.walid).expect(200)).body as Home[];
      expect(mine.map((h) => h.id)).toEqual([homes.walidFirst]);
      expect((await one(homes.walidFirst, sessions.walid).expect(200)).body).toMatchObject({ id: homes.walidFirst, ...HOME });
      expect((await api().get('/api/me/home-locations').set('Cookie', noProfile).expect(200)).body).toEqual([]);
    });
  });

  describe('who sees them', () => {
    it('are HR’s, the CEO’s and the Super Admin’s; managers, Finance and an Admin are refused', async () => {
      for (const session of [hr, ceo, superAdmin]) {
        const shown = (await list(session).expect(200)).body as Home[];
        expect(shown.map((h) => h.id)).toEqual(expect.arrayContaining([homes.walidFirst, homes.mona]));
      }
      for (const session of [finance, admin, sessions.mona]) {
        await list(session).expect(403);
        await api().get('/api/home-locations/counts').set('Cookie', session).expect(403);
        await one(homes.walidFirst, session).expect(404);
        await decide(homes.walidFirst, session, { decision: 'approve' }).expect(404);
        await api().post(`/api/home-locations/${homes.walidFirst}/remove`).set('Cookie', session).send({}).expect(404);
      }
      // one employee doesn't see another's
      await one(homes.walidFirst, sessions.nadia).expect(404);
    });
  });

  describe('the steps', () => {
    it('go to HR, then the CEO: HR may change the radius; neither takes the other’s step; nobody decides their own', async () => {
      // HR's waiting: the three; Hana (HR) doesn't decide her own
      expect(await waiting(hr)).toBe(3);
      expect(await waiting(sessions.hana)).toBe(2);
      expect((await one(homes.hana, sessions.hana).expect(200)).body.waitingForYou).toBe(false);
      expect(said(await decide(homes.hana, sessions.hana, { decision: 'approve' }).expect(403))).toEqual(['Someone else has to decide your own home location.']);
      expect(await waiting(ceo)).toBe(0);
      expect(said(await decide(homes.walidFirst, ceo, { decision: 'approve' }).expect(409))[0]).toContain('is with HR now');
      expect(said(await decide(homes.walidFirst, superAdmin, { decision: 'approve' }).expect(403))).toEqual(['HR decides a home location first, then the CEO.']);
      expect(said(await decide(homes.walidFirst, hr, { decision: 'reject' }).expect(400))).toEqual(['Write a comment: why the home location is rejected.']);
      expect(said(await decide(homes.walidFirst, hr, { decision: 'approve', radiusMetres: 9000 }).expect(400))).toEqual(['Enter the radius in whole metres from 20 to 5,000, e.g. 100.']);

      const byHr = (await decide(homes.walidFirst, hr, { decision: 'approve', radiusMetres: 150, comment: 'Checked with the address on file' }).expect(200)).body as Home;
      expect(byHr).toMatchObject({ status: 'with_ceo', stage: 'ceo', radiusMetres: 150, waitingForYou: false });
      expect(byHr.steps.at(-1)).toMatchObject({ kind: 'hr_decision', decision: 'approve', radiusMetres: 150, comment: 'Checked with the address on file' });
      expect(said(await decide(homes.walidFirst, hr, { decision: 'approve' }).expect(409))[0]).toContain('is with the CEO now');
      expect(await waiting(ceo)).toBe(1);
      expect(said(await decide(homes.walidFirst, ceo, { decision: 'approve', radiusMetres: 200 }).expect(400))[0]).toContain('set at HR’s step');

      const byCeo = (await decide(homes.walidFirst, ceo, { decision: 'approve', comment: 'Fine' }).expect(200)).body as Home;
      expect(byCeo).toMatchObject({ status: 'approved', stage: null, radiusMetres: 150, ...HOME, canRemove: true });
      expect(byCeo.approvedAt).not.toBeNull();
      expect(byCeo.steps.map((s) => s.kind)).toEqual(['submitted', 'hr_decision', 'ceo_decision']);
      expect(said(await decide(homes.walidFirst, ceo, { decision: 'approve' }).expect(409))[0]).toContain('nothing left to decide');

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'home_location', entityId: homes.walidFirst }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['create', 'approve', 'approve']);
      expect(audit[1].diff).toMatchObject({ stage: 'hr', decision: 'approve', status: { from: 'with_hr', to: 'with_ceo' }, radiusMetres: { from: 100, to: 150 } });
      expect(audit[2].diff).toMatchObject({ stage: 'ceo', status: { from: 'with_ceo', to: 'approved' } });
    });

    it('rejected with a comment at either step, its point deleted', async () => {
      const rejected = (await decide(homes.mona, hr, { decision: 'reject', comment: 'That is the office’s street, not a home' }).expect(200)).body as Home;
      expect(rejected).toMatchObject({ status: 'rejected', latitude: null, longitude: null, label: null, rejectReason: 'That is the office’s street, not a home' });
      expect(await row(homes.mona)).toMatchObject({ latitude: null, longitude: null, label: null, rejectedStage: 'hr' });
      // Hana's, by another HR then the CEO, who rejects it
      await decide(homes.hana, hr, { decision: 'approve' }).expect(200);
      expect((await decide(homes.hana, ceo, { decision: 'reject', comment: 'Not needed' }).expect(200)).body).toMatchObject({ status: 'rejected', latitude: null });
      expect(await row(homes.hana)).toMatchObject({ latitude: null, rejectedStage: 'ceo' });
    });
  });

  describe('a C-level person’s', () => {
    it('has both steps taken by the CEO, and is kept from HR', async () => {
      homes.clara = ((await ask('clara', CLARA_HOME).expect(201)).body as Home).id;
      expect((await list(hr).expect(200)).body.map((h: Home) => h.id)).not.toContain(homes.clara);
      await list(hr, `?employeeId=${ids.clara}`).expect(404);
      await one(homes.clara, hr).expect(404);
      await decide(homes.clara, hr, { decision: 'approve' }).expect(404);
      expect(await waiting(hr)).toBe(0);
      expect((await one(homes.clara, hrSuper).expect(200)).body).toMatchObject({ confidential: true });

      expect(await waiting(ceo)).toBe(1);
      const first = (await decide(homes.clara, ceo, { decision: 'approve', radiusMetres: 80 }).expect(200)).body as Home;
      expect(first).toMatchObject({ status: 'with_ceo', radiusMetres: 80, confidential: true });
      const second = (await decide(homes.clara, ceo, { decision: 'approve' }).expect(200)).body as Home;
      expect(second).toMatchObject({ status: 'approved', ...CLARA_HOME, radiusMetres: 80 });
      expect((await list(ceo, `?employeeId=${ids.clara}&status=approved`).expect(200)).body.map((h: Home) => h.id)).toEqual([homes.clara]);
    });

    it('a CEO’s own: HR’s step by HR with Super Admin, the CEO’s by a Super Admin', async () => {
      homes.chief = ((await ask('chief', CHIEF_HOME).expect(201)).body as Home).id;
      expect(said(await decide(homes.chief, sessions.chief, { decision: 'approve' }).expect(403))).toEqual(['Someone else has to decide your own home location.']);
      await decide(homes.chief, hr, { decision: 'approve' }).expect(404);
      await decide(homes.chief, hrSuper, { decision: 'approve' }).expect(200);
      expect(await waiting(superAdmin)).toBe(1);
      expect((await decide(homes.chief, superAdmin, { decision: 'approve' }).expect(200)).body).toMatchObject({ status: 'approved' });
    });
  });

  describe('checking in', () => {
    it('within the approved home is Home; elsewhere remote, flagged; a check-out never flagged', async () => {
      const atHome = (await punch('walid', { kind: 'in', ...AT_HOME }).expect(200)).body;
      expect(atHome.punches.at(-1)).toMatchObject({ kind: 'in', place: 'home', accuracyMetres: 12, flags: [], locationName: null });
      expect(atHome.messages[0]).toContain('at home');
      const out = (await punch('walid', { kind: 'out', ...CAFE }).expect(200)).body;
      expect(out.punches.at(-1)).toMatchObject({ kind: 'out', place: 'remote', flags: [] });
      const again = (await punch('walid', { kind: 'in', ...CAFE }).expect(200)).body;
      expect(again.punches.at(-1)).toMatchObject({ kind: 'in', place: 'remote', flags: ['not_home_or_office'] });
      expect(again.messages.join(' ')).toContain('Not at home or the office');
      expect(again.day).toMatchObject({ place: 'home', flags: ['not_home_or_office'] });
      expect(withoutCoordinates([atHome, out, again])).toEqual([]);
    });

    it('is as before for someone without a home', async () => {
      const res = (await punch('nadia', { kind: 'in', ...AT_HOME }).expect(200)).body;
      expect(res.punches.at(-1)).toMatchObject({ place: 'remote', flags: [] });
    });

    it('at home on an office day is outside the office: home counts as remote', async () => {
      homes.olga = await approvedHome('olga', OLGA_HOME);
      const res = (await punch('olga', { kind: 'in', ...OLGA_HOME, accuracy: 8 }).expect(200)).body;
      expect(res.punches.at(-1)).toMatchObject({ place: 'home', flags: ['outside_office'] });
    });

    it('leaves the office network’s lock as it was: a locked Office person is refused at home too', async () => {
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [{ label: 'Main office line', range: '41.33.10.0/24' }], officeNetworkLock: true } });
      try {
        expect(said(await punch('olga', { kind: 'out', ...OLGA_HOME, accuracy: 8 }).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
        // someone who isn't Office staff isn't locked: at home as before
        expect((await punch('nadia', { kind: 'out', ...AT_HOME }).expect(200)).body.punches.at(-1)).toMatchObject({ kind: 'out', place: 'remote' });
      } finally {
        await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [], officeNetworkLock: false } });
      }
    });

    it('shows on Daily Attendance, its filters and the workbook', async () => {
      const shown = async (only: string) =>
        ((await api().get(`/api/attendance?month=${CURRENT}&departmentId=${deptId}&only=${only}`).set('Cookie', hr).expect(200)).body as { people: { employee: { id: string } }[] }).people.map(
          (p) => p.employee.id,
        );
      expect(await shown('flagged')).toEqual(expect.arrayContaining([ids.walid, ids.olga]));
      expect(await shown('flagged')).not.toContain(ids.nadia);
      expect(await shown('remote')).toEqual(expect.arrayContaining([ids.walid, ids.olga, ids.nadia]));
      const daily = (await api().get(`/api/attendance?month=${CURRENT}&departmentId=${deptId}`).set('Cookie', hr).expect(200)).body;
      expect(withoutCoordinates(daily)).toEqual([]);

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
      const days: { name: unknown; where: unknown; flagged: unknown }[] = [];
      wb.getWorksheet('Days')!.eachRow((r) => days.push({ name: r.getCell(3).value, where: r.getCell(10).value, flagged: r.getCell(14).value }));
      expect(days).toContainEqual({ name: `Walid Wfh ${RUN}`, where: 'Home', flagged: 'Not at home or the office' });
      expect(days).toContainEqual({ name: `Olga Office ${RUN}`, where: 'Home', flagged: 'Checked in outside the office on an office day' });
    });
  });

  describe('replacing and removing', () => {
    it('a newly approved home replaces the old one, whose point is deleted', async () => {
      homes.walidNew = ((await ask('walid', { ...NEW_HOME, label: 'New flat' }).expect(201)).body as Home).id;
      // the first still counts while the new one is decided
      expect((await row(homes.walidFirst)).status).toBe('approved');
      await decide(homes.walidNew, hr, { decision: 'approve' }).expect(200);
      expect((await decide(homes.walidNew, ceo, { decision: 'approve' }).expect(200)).body).toMatchObject({ status: 'approved', ...NEW_HOME, radiusMetres: 100 });
      expect(await row(homes.walidFirst)).toMatchObject({ status: 'replaced', latitude: null, longitude: null, label: null });
      const old = (await one(homes.walidFirst, sessions.walid).expect(200)).body as Home;
      expect(old).toMatchObject({ status: 'replaced', latitude: null, longitude: null, label: null, canRemove: false });
      expect(old.steps.at(-1)).toMatchObject({ kind: 'replaced' });
      expect(await prisma.homeLocationRequest.count({ where: { employeeId: ids.walid, status: 'approved' } })).toBe(1);
      const replaced = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'home_location', entityId: homes.walidFirst, action: 'replace' } });
      expect(replaced.diff).toMatchObject({ status: { from: 'approved', to: 'replaced' }, by: homes.walidNew });
      // the old home no longer counts, the new one does
      expect((await punch('walid', { kind: 'out', ...AT_HOME }).expect(200)).body.punches.at(-1)).toMatchObject({ place: 'remote' });
      expect((await punch('walid', { kind: 'in', ...NEW_HOME, accuracy: 10 }).expect(200)).body.punches.at(-1)).toMatchObject({ place: 'home', flags: [] });
    });

    it('the employee removes their approved home at any time: its point deleted, the removal audited without it', async () => {
      const removed = (await api().post(`/api/me/home-locations/${homes.walidNew}/remove`).set('Cookie', sessions.walid).expect(200)).body as Home;
      expect(removed).toMatchObject({ status: 'removed', latitude: null, longitude: null, label: null, canRemove: false });
      expect(removed.steps.at(-1)).toMatchObject({ kind: 'removed', comment: null });
      expect(await row(homes.walidNew)).toMatchObject({ status: 'removed', latitude: null, longitude: null, label: null });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'home_location', entityId: homes.walidNew, action: 'remove' } });
      expect(audit.diff).toMatchObject({ by: 'employee', status: { from: 'approved', to: 'removed' } });
      await api().post(`/api/me/home-locations/${homes.walidNew}/remove`).set('Cookie', sessions.walid).expect(409);
      // without a home, as before: remote, not flagged
      expect((await punch('walid', { kind: 'out', ...NEW_HOME }).expect(200)).body.punches.at(-1)).toMatchObject({ place: 'remote', flags: [] });
    });

    it('HR removes one too, with a comment; managers and Finance can’t', async () => {
      for (const session of [sessions.mona, finance]) await api().post(`/api/home-locations/${homes.olga}/remove`).set('Cookie', session).send({}).expect(404);
      const removed = (await api().post(`/api/home-locations/${homes.olga}/remove`).set('Cookie', hr).send({ comment: 'She moved' }).expect(200)).body as Home;
      expect(removed).toMatchObject({ status: 'removed', latitude: null });
      expect(removed.steps.at(-1)).toMatchObject({ kind: 'removed', comment: 'She moved' });
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'home_location', entityId: homes.olga, action: 'remove' } })).diff).toMatchObject({ by: 'staff', comment: 'She moved' });
      // a C-level person's is the CEO's or the Super Admin's to remove, not HR's
      await api().post(`/api/home-locations/${homes.clara}/remove`).set('Cookie', hr).send({}).expect(404);
      expect((await api().post(`/api/home-locations/${homes.clara}/remove`).set('Cookie', superAdmin).send({}).expect(200)).body).toMatchObject({ status: 'removed' });
    });

    it('withdrawn by its employee while it is being decided, its point deleted; not by anyone else', async () => {
      const made = (await ask('nadia', NADIA_HOME).expect(201)).body as Home;
      expect(said(await api().post(`/api/me/home-locations/${made.id}/withdraw`).set('Cookie', hr).expect(403))[0]).toContain('Only the employee');
      const withdrawn = (await api().post(`/api/me/home-locations/${made.id}/withdraw`).set('Cookie', sessions.nadia).expect(200)).body as Home;
      expect(withdrawn).toMatchObject({ status: 'withdrawn', latitude: null, canWithdraw: false });
      expect(await row(made.id)).toMatchObject({ status: 'withdrawn', latitude: null, longitude: null });
      await api().post(`/api/me/home-locations/${made.id}/withdraw`).set('Cookie', sessions.nadia).expect(409);
      // and asked again: one being decided at a time, so a new one may go now
      await ask('nadia', NADIA_HOME).expect(201);
    });
  });

  describe('the coordinates', () => {
    it('are on no punch, no day, no step and nowhere in the audit log', async () => {
      const punches = await prisma.attendancePunch.findMany({ where: { employeeId: { in: people } } });
      const days = await prisma.attendanceDay.findMany({ where: { employeeId: { in: people } } });
      const steps = await prisma.homeLocationStep.findMany({ where: { request: { employeeId: { in: people } } } });
      const audit = await prisma.auditLog.findMany({ where: { at: { gte: started } } });
      expect(punches.length).toBeGreaterThan(5);
      expect(withoutCoordinates(punches.map((p) => ({ ...p, accuracyMetres: null })))).toEqual([]);
      expect(withoutCoordinates(days)).toEqual([]);
      expect(withoutCoordinates(steps.map((s) => ({ ...s, id: s.id.toString() })))).toEqual([]);
      expect(audit.filter((a) => a.entityType === 'home_location').length).toBeGreaterThan(10);
      expect(withoutCoordinates(audit.map((a) => a.diff))).toEqual([]);
      // the only points kept: the requests still being decided or in force
      const kept = await prisma.homeLocationRequest.findMany({ where: { employeeId: { in: people }, latitude: { not: null } }, select: { status: true } });
      expect(kept.map((k) => k.status).sort()).toEqual(['approved', 'with_hr']);
    });
  });
});
