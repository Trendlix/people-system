import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_NO_FILES, DEVELOPER_READ_ONLY, MAPS_KEY_NOT_YOURS, MAPS_KEY_PROBLEM, MAPS_SETTINGS_OWN_ACCOUNT, MAPS_SETTINGS_SUPER_ADMIN_ONLY } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo, toDateOnly } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Google Maps for every map (owner, 24 October 2026, on Check-in Setup's map: "is there another map provider?", then
// "Google Maps"; told the key "is pasted in the system by a Super Admin (no server or Vercel step), as Email Settings
// does" and "until a key is set, today's map keeps working"). A Super Admin saves the browser key and reads it back as
// its last four characters only; everyone else is refused (HR, Admin, the CEO, an employee, a developer, a Super Admin
// viewing as someone); every save audited, the key only as "changed". The key at runtime goes to the staff whose pages
// show a map (an employee with a profile, HR, Admin, the CEO, the Super Admin), never to a developer nor to someone with
// no map page; OpenStreetMap without a key. And, found the same day, people's points on a map (a home location, where a
// check-in was pressed) hidden from a developer, while the company's check-in locations keep theirs. The key is made up;
// this file deletes the settings and everything it made.

const RUN = `mp${Date.now().toString(36)}`;
/** A made-up key of Google's shape, distinctive so every answer and audit entry can be searched for it. */
const KEY = `AIzaSyD-${RUN}`.padEnd(35, 'q') + 'Ab3x';
const KEY_2 = `AIzaSyD-${RUN}-two`.padEnd(35, 'z') + 'Zz9y';
const MAP_ID = '8f348c1e4e8b0e6a';
const TODAY = todayInCairo();

describe('Google Maps settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sessions: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const ids: Record<string, string> = {};
  /** Every answer outside GET /maps/key, to search for the key. */
  const answers: unknown[] = [];
  let employeeId: string;
  let homeId: string;
  let locationId: string;

  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => api().get(`/api${path}`).set('Cookie', sessions[who]),
    put: (path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[who]).send(body),
    delete: (path: string) => api().delete(`/api${path}`).set('Cookie', sessions[who]),
    post: (path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[who]).send(body),
  });
  const kept = (res: request.Response) => {
    answers.push(res.body);
    return res;
  };
  const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // none saved to start with (a run stopped halfway may have left them)
    await prisma.mapsSettings.deleteMany();

    // an employee with a profile (their own home location's map), and the people of every other kind
    employeeId = (await prisma.employee.create({ data: { employeeCode: `MP-${RUN}`, fullNameEn: `Mira Maps ${RUN}`, fullNameAr: 'ميرا' }, select: { id: true } })).id;
    for (const [who, roles] of [
      ['superAdmin', ['super_admin']],
      ['otherSuperAdmin', ['super_admin']],
      ['hr', ['hr']],
      ['admin', ['admin']],
      ['ceo', ['ceo']],
      ['finance', ['finance']],
      ['employee', ['employee']],
      ['developer', ['employee', 'developer']],
    ] as const) {
      emails[who] = await createUser(prisma, [...roles]);
      ids[who] = (await prisma.user.findUniqueOrThrow({ where: { email: emails[who] }, select: { id: true } })).id;
    }
    await prisma.user.update({ where: { id: ids.employee }, data: { employeeId } });
    for (const who of Object.keys(emails)) sessions[who] = await signIn(app, emails[who]);

    // the employee's approved home, a check-in they pressed today, and a company location (every point invented)
    homeId = (
      await prisma.homeLocationRequest.create({
        data: { employeeId, latitude: 30.123457, longitude: 31.654322, radiusMetres: 100, label: `Home ${RUN}, 12 Nile Street`, accuracyMetres: 14, status: 'approved', approvedAt: new Date() },
        select: { id: true },
      })
    ).id;
    await prisma.attendancePunch.create({
      data: { employeeId, date: toDateOnly(TODAY), kind: 'in', place: 'home', accuracyMetres: 11, latitude: 30.123461, longitude: 31.654318, expected: 'anywhere', flags: [] },
    });
    locationId = (await as('hr').post('/attendance/check-in-setup/locations', { name: `Office ${RUN}`, latitude: 30.059611, longitude: 31.346222, radiusMetres: 150 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.mapsSettings.deleteMany();
    await prisma.auditLog.deleteMany({ where: { entityType: 'maps_settings' } });
    if (employeeId) {
      await prisma.attendancePunch.deleteMany({ where: { employeeId } });
      await prisma.homeLocationRequest.deleteMany({ where: { employeeId } });
      await prisma.user.updateMany({ where: { employeeId }, data: { employeeId: null } });
      await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
    if (locationId) await prisma.checkInLocation.deleteMany({ where: { id: locationId } });
    await app.close();
  });

  it('with no key saved, every map is OpenStreetMap’s', async () => {
    expect(kept(await as('superAdmin').get('/maps-settings').expect(200)).body).toEqual({ keySet: false, keyEnding: null, mapId: null, updatedAt: null, updatedBy: null });
    for (const who of ['employee', 'hr', 'admin', 'ceo', 'superAdmin']) {
      expect((await as(who).get('/maps/key').expect(200)).body).toEqual({ provider: 'openstreetmap' });
    }
  });

  it('refuses everyone but a Super Admin in their own session', async () => {
    for (const who of ['hr', 'admin', 'ceo', 'employee', 'finance']) {
      for (const res of [await as(who).get('/maps-settings'), await as(who).put('/maps-settings', { browserKey: KEY, mapId: null }), await as(who).delete('/maps-settings/key')]) {
        expect(res.status).toBe(403);
        expect(kept(res).body.message).toBe(MAPS_SETTINGS_SUPER_ADMIN_ONLY);
      }
    }
    // a developer: not even to read, and no change
    expect(kept(await as('developer').get('/maps-settings').expect(403)).body.message).toBe(DEVELOPER_NO_FILES);
    expect(kept(await as('developer').put('/maps-settings', { browserKey: KEY, mapId: null }).expect(403)).body.message).toBe(DEVELOPER_READ_ONLY);
    expect(kept(await as('developer').delete('/maps-settings/key').expect(403)).body.message).toBe(DEVELOPER_READ_ONLY);

    // a Super Admin viewing as another Super Admin, even acting in their name
    sessions.viewing = cookieOf(await as('superAdmin').post('/auth/view-as', { userId: ids.otherSuperAdmin }).expect(200));
    expect(kept(await as('viewing').get('/maps-settings').expect(403)).body.message).toBe(MAPS_SETTINGS_OWN_ACCOUNT);
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/act', { act: true }).expect(200));
    expect(kept(await as('viewing').put('/maps-settings', { browserKey: KEY, mapId: null }).expect(403)).body.message).toBe(MAPS_SETTINGS_OWN_ACCOUNT);
    expect(kept(await as('viewing').delete('/maps-settings/key').expect(403)).body.message).toBe(MAPS_SETTINGS_OWN_ACCOUNT);
    await as('viewing').post('/auth/view-as/stop').expect(200);
    sessions.superAdmin = await signIn(app, emails.superAdmin);

    expect(await prisma.mapsSettings.count()).toBe(0);
  });

  it('a Super Admin saves the key and reads it back as its last four characters only, audited as "changed"', async () => {
    const saved = kept(await as('superAdmin').put('/maps-settings', { browserKey: `  ${KEY} `, mapId: MAP_ID }).expect(200)).body;
    expect(saved).toMatchObject({ keySet: true, keyEnding: 'Ab3x', mapId: MAP_ID, updatedBy: { id: ids.superAdmin } });
    expect(kept(await as('superAdmin').get('/maps-settings').expect(200)).body).toEqual(saved);
    expect((await prisma.mapsSettings.findUniqueOrThrow({ where: { id: 1 } })).browserKey).toBe(KEY);

    const entries = await prisma.auditLog.findMany({ where: { entityType: 'maps_settings' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: ids.superAdmin, action: 'update', entityId: null, diff: { browserKey: 'changed', mapId: { from: null, to: MAP_ID } } });

    // saved again with the key box empty: the saved key stays, and nothing is written
    expect(kept(await as('superAdmin').put('/maps-settings', { browserKey: '', mapId: MAP_ID }).expect(200)).body).toMatchObject({ keySet: true, keyEnding: 'Ab3x' });
    expect(await prisma.auditLog.count({ where: { entityType: 'maps_settings' } })).toBe(1);

    // the Audit Log page, as a Super Admin reads it, never holds the key either
    kept(await as('superAdmin').get('/audit?entityType=maps_settings').expect(200));
  });

  it('refuses a key that isn’t one, in plain words that never repeat it', async () => {
    const res = kept(await as('superAdmin').put('/maps-settings', { browserKey: 'AIza-not-a-real-key', mapId: 'has spaces' }).expect(400));
    expect(res.body.message).toEqual(expect.arrayContaining([MAPS_KEY_PROBLEM]));
    expect(JSON.stringify(res.body)).not.toContain('AIza-not-a-real-key');
    expect((await prisma.mapsSettings.findUniqueOrThrow({ where: { id: 1 } })).browserKey).toBe(KEY);
  });

  it('gives the key to the staff whose pages show a map, never to a developer or someone with no map page', async () => {
    for (const who of ['employee', 'hr', 'admin', 'ceo', 'superAdmin']) {
      const res = await as(who).get('/maps/key').expect(200);
      expect(res.body).toEqual({ provider: 'google', key: KEY, mapId: MAP_ID });
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
    expect(kept(await as('finance').get('/maps/key').expect(403)).body.message).toBe(MAPS_KEY_NOT_YOURS);
    expect(kept(await as('developer').get('/maps/key').expect(403)).body.message).toBe(DEVELOPER_NO_FILES);
    // signed out: nothing
    expect((await api().get('/api/maps/key').expect(401)).body).not.toHaveProperty('key');
  });

  it('a replaced key is "changed" in the audit log again; removing it puts every map back on OpenStreetMap', async () => {
    expect(kept(await as('superAdmin').put('/maps-settings', { browserKey: KEY_2, mapId: '' }).expect(200)).body).toMatchObject({ keySet: true, keyEnding: 'Zz9y', mapId: null });
    const [replaced] = await prisma.auditLog.findMany({ where: { entityType: 'maps_settings' }, orderBy: { at: 'desc' }, take: 1 });
    expect(replaced.diff).toEqual({ browserKey: 'changed', mapId: { from: MAP_ID, to: null } });

    expect(kept(await as('superAdmin').delete('/maps-settings/key').expect(200)).body).toMatchObject({ keySet: false, keyEnding: null, mapId: null });
    const [removed] = await prisma.auditLog.findMany({ where: { entityType: 'maps_settings' }, orderBy: { at: 'desc' }, take: 1 });
    expect(removed).toMatchObject({ action: 'remove_key', userId: ids.superAdmin, diff: { browserKey: 'changed' } });
    expect((await as('employee').get('/maps/key').expect(200)).body).toEqual({ provider: 'openstreetmap' });
    // removing it again changes nothing
    kept(await as('superAdmin').delete('/maps-settings/key').expect(200));
    expect(await prisma.auditLog.count({ where: { entityType: 'maps_settings', action: 'remove_key' } })).toBe(1);
  });

  it('no answer but GET /maps/key, and no audit entry, ever held a key', async () => {
    const text = JSON.stringify(answers);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY_2);
    const audit = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: 'maps_settings' }, select: { diff: true } }));
    expect(audit).not.toContain(KEY);
    expect(audit).not.toContain(KEY_2);
  });

  it('hides people’s points on a map from a developer: a home location’s and where a check-in was pressed', async () => {
    // HR sees them, as before
    const home = (await as('hr').get(`/home-locations/${homeId}`).expect(200)).body;
    expect(home).toMatchObject({ latitude: 30.123457, longitude: 31.654322, label: `Home ${RUN}, 12 Nile Street`, accuracyMetres: 14 });
    const month = (await as('hr').get(`/attendance/employees/${employeeId}?month=${TODAY.slice(0, 7)}`).expect(200)).body;
    expect(month.punches[0]).toMatchObject({ latitude: 30.123461, longitude: 31.654318, accuracyMetres: 11 });

    // a developer: the request and the press as they are, without where
    const devHome = (await as('developer').get(`/home-locations/${homeId}`).expect(200)).body;
    expect(devHome).toMatchObject({ id: homeId, status: 'approved', radiusMetres: 100, latitude: null, longitude: null, label: null, accuracyMetres: null });
    const devList = (await as('developer').get('/home-locations?status=approved').expect(200)).body as { id: string; latitude: unknown; label: unknown }[];
    expect(devList.find((r) => r.id === homeId)).toMatchObject({ latitude: null, longitude: null, label: null });
    const devMonth = (await as('developer').get(`/attendance/employees/${employeeId}?month=${TODAY.slice(0, 7)}`).expect(200)).body;
    expect(devMonth.punches[0]).toMatchObject({ kind: 'in', place: 'home', latitude: null, longitude: null, accuracyMetres: null });
    const text = JSON.stringify([devHome, devList, devMonth]);
    for (const n of ['30.123457', '31.654322', '30.123461', '31.654318', '12 Nile Street']) expect(text).not.toContain(n);

    // the company's own check-in locations keep their points
    const locations = (await as('developer').get('/attendance/check-in-setup/locations').expect(200)).body as { id: string; latitude: number; longitude: number }[];
    expect(locations.find((l) => l.id === locationId)).toMatchObject({ latitude: 30.059611, longitude: 31.346222 });
  });
});
