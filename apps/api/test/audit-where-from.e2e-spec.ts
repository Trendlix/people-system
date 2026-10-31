import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, CLIENT_META_HEADER, CLIENT_META_SIGNATURE_HEADER, clientMetaPayload } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { AuditService } from '../src/audit/audit.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, PASSWORD, signIn } from './helpers.js';

// The audit log, as on the Trendlix website (owner, 31 October 2026: "i want a log for all actions taken on the system ,,
// same as the one on trendlix website"; chosen: "Sign-ins tab", "Refused attempts (Result)", "Module filter"; "with
// location and ip capture"; the app's position "with each sign-in and action"): every entry keeps where it came from
// (the website's signed address, browser and place, never a forged one; the app's own address and position, never a
// website session's), a change a signed-in person was refused is written (never a public or sign-in request's, never
// what was sent), the sign-ins have their own list with outcomes, the module and result filters work, and only the
// Super Admin and the CEO read it. Every name, address and position is invented.

const RUN = `wf${Date.now().toString(36)}`;
const KEY = process.env.WEB_KEY!;
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const APP_UA = 'Trendlix People/0.6.13 (android) TrendLIXPeople';

interface From {
  ip: string | null;
  ipSource: string | null;
  place: string | null;
  city: string | null;
  browser: string | null;
  userAgent: string | null;
  location: { latitude: number; longitude: number; accuracyMetres: number | null; mock: boolean } | null;
}

interface Entry {
  id: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string | null;
  result: string;
  resultLabel: string;
  module: string | null;
  moduleLabel: string | null;
  from: From;
  changes: { field: string; to: string | null }[];
}

interface SignIn {
  email: string | null;
  outcome: string;
  outcomeLabel: string;
  ok: boolean;
  method: string | null;
  from: From;
}

const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1);

/** What the website adds to a call: the visitor's address and their browser and place, signed with `key` for `token`. */
function website(token: string, ip: string, meta: Record<string, string>, key = KEY): Record<string, string> {
  const at = String(Date.now());
  const encoded = Buffer.from(JSON.stringify({ at: Number(at), ...meta })).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return {
    [CLIENT_IP_HEADER]: ip,
    [CLIENT_IP_AT_HEADER]: at,
    [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(key, ip, at, token),
    [CLIENT_META_HEADER]: encoded,
    [CLIENT_META_SIGNATURE_HEADER]: createHmac('sha256', key).update(clientMetaPayload(encoded, hash)).digest('base64url'),
  };
}

/** Waits for what is written once the answer has gone (a refused attempt). */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 40 && !done(value); i++) {
    await new Promise((r) => setTimeout(r, 50));
    value = await read();
  }
  return value;
}

describe('Audit Log: where from, refused attempts and sign-ins (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrId: string;
  let employee: string;
  let employeeId: string;
  let ceo: string;
  let superAdmin: string;
  const departments: string[] = [];
  const api = () => request(app.getHttpServer());
  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const login = (email: string, password: string, headers: Record<string, string> = {}) => api().post('/api/auth/login').set(headers).send({ email, password });
  const department = async (session: string, headers: Record<string, string>, name = `Dept ${RUN} ${departments.length}`) => {
    const res = await api().post('/api/departments').set('Cookie', session).set(headers).send({ nameEn: name }).expect(201);
    departments.push(res.body.id as string);
    return res.body.id as string;
  };
  const rowOf = (id: string) => prisma.auditLog.findFirstOrThrow({ where: { entityType: 'department', entityId: id, action: 'create' } });
  const refusedBy = (userId: string) => prisma.auditLog.findMany({ where: { userId, action: 'refused' }, orderBy: { id: 'asc' } });
  const signIns = async (query: Record<string, string>, session = superAdmin) =>
    (await api().get(`/api/audit/sign-ins?${new URLSearchParams(query)}`).set('Cookie', session).expect(200)).body as { entries: SignIn[]; total: number };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hrId = await idOf(hrEmail);
    hr = await signIn(app, hrEmail);
    const employeeEmail = await createUser(prisma, ['employee']);
    employeeId = await idOf(employeeEmail);
    employee = await signIn(app, employeeEmail);
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
  });

  afterAll(async () => {
    await prisma.department.deleteMany({ where: { id: { in: departments } } });
    await app.close();
  });

  describe('where each entry came from', () => {
    it('keeps the website’s signed address, browser and place, and shows them', async () => {
      const id = await department(hr, { ...website(tokenOf(hr), '41.33.10.2', { ua: CHROME, country: 'EG', region: 'C', city: 'Cairo' }), 'x-forwarded-for': '76.76.21.9', 'user-agent': 'node' });
      const row = await rowOf(id);
      expect({ ip: row.ip, ipSource: row.ipSource, country: row.country, region: row.region, city: row.city, userAgent: row.userAgent, latitude: row.latitude }).toEqual({
        ip: '41.33.10.2',
        ipSource: 'website',
        country: 'EG',
        region: 'C',
        city: 'Cairo',
        userAgent: CHROME,
        latitude: null,
      });
      const [entry] = ((await api().get(`/api/audit?entityId=${id}`).set('Cookie', superAdmin).expect(200)).body as { entries: Entry[] }).entries;
      expect(entry.from).toMatchObject({ ip: '41.33.10.2', ipSource: 'website', place: 'Cairo, Egypt', browser: 'Chrome 141 on macOS', location: null });
      expect([entry.result, entry.resultLabel, entry.module, entry.moduleLabel]).toEqual(['succeeded', 'Succeeded', 'organisation', 'Organisation']);
    });

    it('ignores a forged signature: the connection’s own address, its own user agent, no place', async () => {
      const id = await department(hr, { ...website(tokenOf(hr), '41.33.10.2', { ua: CHROME, city: 'Cairo' }, 'another-key-of-at-least-thirty-two-characters'), 'x-forwarded-for': '197.55.1.1', 'user-agent': 'curl/8.7.1' });
      const row = await rowOf(id);
      expect([row.ip, row.ipSource, row.city, row.country, row.userAgent]).toEqual(['197.55.1.1', 'connection', null, null, 'curl/8.7.1']);
      // signed for another session
      const other = await department(hr, { ...website(tokenOf(employee), '41.33.10.2', { city: 'Cairo' }), 'x-forwarded-for': '197.55.1.9' });
      expect([(await rowOf(other)).ip, (await rowOf(other)).city]).toEqual(['197.55.1.9', null]);
    });

    it('keeps the app’s position on an app session; never on a website session’s, never garbage', async () => {
      const hrApp = await signIn(app, (await prisma.user.findUniqueOrThrow({ where: { id: hrId } })).email, APP_UA);
      const onApp = await department(hrApp, { 'user-agent': APP_UA, 'x-forwarded-for': '197.55.1.2', 'x-people-location': '30.044420,31.235712,12' });
      const row = await rowOf(onApp);
      expect([row.ip, row.ipSource, Number(row.latitude), Number(row.longitude), row.accuracyMetres, row.locationMock, row.userAgent]).toEqual([
        '197.55.1.2',
        'connection',
        30.04442,
        31.235712,
        12,
        false,
        APP_UA,
      ]);
      const [entry] = ((await api().get(`/api/audit?entityId=${onApp}`).set('Cookie', ceo).expect(200)).body as { entries: Entry[] }).entries;
      expect(entry.from).toMatchObject({ ip: '197.55.1.2', place: null, browser: 'Trendlix People app 0.6.13 on Android', location: { latitude: 30.04442, longitude: 31.235712, accuracyMetres: 12, mock: false } });

      const mock = await rowOf(await department(hrApp, { 'user-agent': APP_UA, 'x-people-location': '30.05,31.24,40,mock' }));
      expect(mock.locationMock).toBe(true);
      const garbage = await rowOf(await department(hrApp, { 'user-agent': APP_UA, 'x-people-location': '95,31.24,40' }));
      expect([garbage.latitude, garbage.longitude, garbage.locationMock]).toEqual([null, null, null]);
      // a website session sending the app's user agent and a position: none kept
      const onWeb = await rowOf(await department(hr, { 'user-agent': APP_UA, 'x-people-location': '30.044420,31.235712,12' }));
      expect([onWeb.latitude, onWeb.accuracyMetres]).toEqual([null, null]);
    });

    it('keeps nothing on an entry no request wrote (a scheduler, the nightly Zoho fetch)', async () => {
      await app.get(AuditService).record({ userId: null, action: 'sync', entityType: 'zoho_people_run', diff: { run: RUN } });
      const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'sync', diff: { path: ['run'], equals: RUN } } });
      expect([row.ip, row.ipSource, row.country, row.city, row.userAgent, row.latitude, row.locationMock]).toEqual([null, null, null, null, null, null, null]);
    });
  });

  describe('refused attempts', () => {
    it('writes a change a signed-in person was refused, with its module, the address’s pattern and the answer; never what was sent', async () => {
      await api().post('/api/departments').set('Cookie', employee).set('x-forwarded-for', '197.55.2.1').send({ nameEn: `Secret ${RUN}` }).expect(403);
      const [refused] = await eventually(() => refusedBy(employeeId), (rows) => rows.length > 0);
      expect(refused).toMatchObject({ action: 'refused', entityType: 'organisation', entityId: null, ip: '197.55.2.1', ipSource: 'connection' });
      expect(refused.diff).toMatchObject({ method: 'POST', path: '/api/departments', status: 403 });
      expect(JSON.stringify(refused.diff)).not.toContain(`Secret ${RUN}`);

      const missing = randomUUID();
      await api().patch(`/api/departments/${missing}`).set('Cookie', hr).send({ nameEn: 'Nowhere' }).expect(404);
      await api().post('/api/departments').set('Cookie', hr).send({ nameEn: '' }).expect(400);
      const rows = await eventually(() => refusedBy(hrId), (r) => r.length >= 2);
      expect(rows.map((r) => [r.entityType, r.entityId, (r.diff as { status: number }).status])).toEqual([
        ['organisation', missing, 404],
        ['organisation', null, 400],
      ]);
      expect((rows[1].diff as { message: string }).message).toContain('Enter the department name in English.');

      // shown as Refused, found by the Result and Module filters
      const page = (await api().get('/api/audit?result=refused&module=organisation').set('Cookie', superAdmin).expect(200)).body as { entries: Entry[] };
      const shown = page.entries.find((e) => e.entityId === missing)!;
      expect([shown.result, shown.resultLabel, shown.actionLabel, shown.moduleLabel]).toEqual(['refused', 'Refused', 'Refused', 'Organisation']);
      expect(page.entries.every((e) => e.result === 'refused' && e.module === 'organisation')).toBe(true);
    });

    it('not a success, a look, or a public or sign-in request', async () => {
      const before = await prisma.auditLog.count({ where: { action: 'refused' } });
      await department(hr, {});
      await api().get('/api/audit').set('Cookie', employee).expect(403);
      await api().post('/api/auth/forgot-password').send({}).expect(400);
      await login(`nobody-${RUN}@test.local`, 'wrong').expect(401);
      await api().post('/api/auth/email-code/sign-in').send({}).expect(400);
      await new Promise((r) => setTimeout(r, 300));
      expect(await prisma.auditLog.count({ where: { action: 'refused' } })).toBe(before);
    });
  });

  describe('the modules', () => {
    it('filters the entries by module', async () => {
      const id = await department(hr, {}, `Module ${RUN}`);
      const of = async (module: string) =>
        ((await api().get(`/api/audit?module=${module}&q=${encodeURIComponent(`Module ${RUN}`)}`).set('Cookie', ceo).expect(200)).body as { entries: Entry[] }).entries.map((e) => e.entityId);
      expect(await of('organisation')).toContain(id);
      expect(await of('leave')).toEqual([]);
      await api().get('/api/audit?module=nothing').set('Cookie', ceo).expect(400);
      const options = (await api().get('/api/audit/options').set('Cookie', ceo).expect(200)).body as { modules: { value: string; label: string }[]; results: unknown[]; outcomes: unknown[] };
      expect(options.modules).toEqual(expect.arrayContaining([{ value: 'attendance', label: 'Attendance' }, { value: 'recruitment', label: 'Recruitment' }]));
      expect(options.results).toHaveLength(2);
    });
  });

  describe('the sign-ins', () => {
    it('lists every sign-in with its outcome, how, address, browser and the app’s position', async () => {
      const email = await createUser(prisma, ['employee']);
      await login(email, PASSWORD, { 'user-agent': APP_UA, 'x-forwarded-for': '197.55.3.1', 'x-people-location': '30.1,31.3,25' }).expect(200);
      await login(email, 'not-the-password', { 'user-agent': CHROME, 'x-forwarded-for': '197.55.3.2' }).expect(401);
      const unknown = `unknown-${RUN}@test.local`;
      await login(unknown, 'whatever').expect(401);
      const off = await createUser(prisma, ['employee']);
      await prisma.user.update({ where: { email: off }, data: { isActive: false } });
      await login(off, PASSWORD).expect(401);

      const mine = await signIns({ q: email });
      expect(mine.entries.map((e) => [e.outcome, e.outcomeLabel, e.ok, e.method])).toEqual([
        ['wrong_password', 'Wrong password', false, 'password'],
        ['signed_in', 'Signed in', true, 'password'],
      ]);
      expect(mine.entries[1].from).toMatchObject({ ip: '197.55.3.1', browser: 'Trendlix People app 0.6.13 on Android', location: { latitude: 30.1, longitude: 31.3, accuracyMetres: 25, mock: false } });
      expect(mine.entries[0].from).toMatchObject({ ip: '197.55.3.2', browser: 'Chrome 141 on macOS', location: null });
      expect((await signIns({ q: unknown })).entries.map((e) => [e.email, e.outcome])).toEqual([[unknown, 'unknown_email']]);
      expect((await signIns({ q: off })).entries.map((e) => e.outcome)).toEqual(['inactive']);
      // by the address, and by the outcome
      expect((await signIns({ q: '197.55.3.1' })).entries.map((e) => e.email)).toEqual([email]);
      const wrong = await signIns({ outcome: 'wrong_password' });
      expect(wrong.entries.length).toBeGreaterThan(0);
      expect(wrong.entries.every((e) => e.outcome === 'wrong_password')).toBe(true);
    });

    it('writes a sign-in refused while locked out, at most once a minute; and a sign-out', async () => {
      const email = await createUser(prisma, ['employee']);
      for (let i = 0; i < 10; i++) await login(email, 'wrong').expect(401);
      await login(email, PASSWORD).expect(429);
      await login(email, PASSWORD).expect(429);
      expect((await signIns({ q: email, outcome: 'locked_out' })).entries.map((e) => [e.outcomeLabel, e.method])).toEqual([['Locked out', 'password']]);
      // the lockout isn't made longer by it: still ten failures counted
      expect(await prisma.auditLog.count({ where: { action: 'login_failed', diff: { path: ['email'], equals: email } } })).toBe(10);

      const other = await createUser(prisma, ['employee']);
      const session = await signIn(app, other);
      await api().post('/api/auth/logout').set('Cookie', session).expect(204);
      expect((await signIns({ q: other })).entries.map((e) => e.outcome)).toEqual(['signed_out', 'signed_in']);
    });

    it('only for the Super Admin and the CEO; exported to Excel with where each came from', async () => {
      await api().get('/api/audit/sign-ins').set('Cookie', hr).expect(403);
      await api().get('/api/audit/sign-ins').set('Cookie', employee).expect(403);
      await api().get('/api/audit/sign-ins').set('Cookie', ceo).expect(200);
      await api().get('/api/audit/sign-ins?outcome=nothing').set('Cookie', ceo).expect(400);
      const res = await api()
        .get('/api/audit/sign-ins/export?q=197.55.3')
        .set('Cookie', superAdmin)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-disposition']).toContain('Sign-ins');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      const sheet = wb.getWorksheet('Sign-ins')!;
      const headers = (sheet.getRow(1).values as unknown[]).filter(Boolean);
      expect(headers).toEqual(expect.arrayContaining(['When', 'Email', 'Outcome', 'How', 'IP address', 'Location', 'Browser or app', 'Latitude', 'Longitude']));
      expect(sheet.rowCount).toBeGreaterThan(1);
      expect(JSON.stringify(sheet.getSheetValues())).toContain('197.55.3.1');

      // the activity's workbook has them too
      const activity = await api()
        .get(`/api/audit/export?module=organisation&q=${encodeURIComponent(RUN)}`)
        .set('Cookie', superAdmin)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(activity.body as ArrayBuffer);
      const text = JSON.stringify(book.getWorksheet('Audit Log')!.getSheetValues());
      for (const word of ['Result', 'Module', 'IP address', 'Location', 'Browser or app', 'Cairo, Egypt', 'Chrome 141 on macOS', 'Organisation']) expect(text).toContain(word);
    });
  });
});
