import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Audit Log (owner, 19 October 2026: "an Audit Log page showing who changed what and when"): every change written to
// audit_log, for the Super Admin and the CEO only; HR, Finance, Admin and employees get 403. Filtered by the days, who,
// the action, the kind of record and one record, one person's everything (their History) and text in what changed;
// paginated newest first; exported to Excel. The restricted values the services masked stay masked. Mona has a profile,
// bank details, a national ID, an employment and a signed contract; Omar has a profile. Every name and number is invented.

const RUN = `al${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const ACCOUNT = `${Date.now()}`.padEnd(19, '3').slice(0, 19);
const NATIONAL_ID = '28501011234567';

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** Every cell's text in a workbook, sheet by sheet. */
async function workbookText(data: Buffer): Promise<{ sheets: string[]; text: string }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: string[] = [];
  const sheets: string[] = [];
  const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v ?? ''));
  wb.eachSheet((ws) => {
    sheets.push(ws.name);
    ws.eachRow((row) => out.push(...(row.values as unknown[]).map(text)));
  });
  return { sheets, text: out.join(' ') };
}

interface Change {
  field: string;
  label: string;
  kind: 'change' | 'value';
  from: string | null;
  to: string | null;
  masked: 'changed' | 'set' | null;
}

interface Entry {
  id: string;
  at: string;
  when: string;
  who: { text: string; user: { id: string; email: string } | null; by: { id: string; email: string } | null };
  action: string;
  actionLabel: string;
  entityType: string;
  entityLabel: string;
  entityId: string | null;
  reference: string | null;
  employee: { id: string; employeeCode: string; fullNameEn: string } | null;
  link: { href: string; label: string } | null;
  changes: Change[];
}

interface Page {
  entries: Entry[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  next: string | null;
}

describe('Audit Log (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrId: string;
  let hrEmail: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let employee: string;
  let superAdmin: string;
  let superId: string;
  let superEmail: string;
  let mona: { id: string; employeeCode: string; employmentId: string; contractId: string };
  let omar: { id: string; employeeCode: string };
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const patch = (path: string, session: string, body: object) => api().patch(`/api${path}`).set('Cookie', session).send(body);
  const log = async (query: Record<string, string | number>, session = ceo): Promise<Page> =>
    (await get(`/audit?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`, session).expect(200)).body as Page;
  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hrEmail = await createUser(prisma, ['hr']);
    hrId = await idOf(hrEmail);
    hr = await signIn(app, hrEmail);
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    employee = await signIn(app, await createUser(prisma, ['employee']));
    superEmail = await createUser(prisma, ['super_admin']);
    superId = await idOf(superEmail);
    superAdmin = await signIn(app, superEmail);

    const m = (await post('/employees', hr, { fullNameEn: `Mona Audit ${RUN}`, fullNameAr: 'منى تجريبية' }).expect(201)).body as { id: string; employeeCode: string };
    people.push(m.id);
    const hired = await post(`/employees/${m.id}/employments`, hr, { employmentType: 'full_time', joinDate: '2024-01-01' }).expect(201);
    const employmentId = hired.body.employment.id as string;
    const draft = (await post(`/employees/${m.id}/employments/${employmentId}/contracts`, hr, { grossSalary: 30000, form: 'open_ended' }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await post(`/contracts/${draft.id}/sign`, hr, { signedOn: draft.startDate }).expect(200);
    await patch(`/employees/${m.id}/bank`, hr, { bankName: 'National Bank of Egypt', accountNo: ACCOUNT, holderName: 'MONA AUDIT' }).expect(200);
    await patch(`/employees/${m.id}/identity`, hr, { nationalId: NATIONAL_ID }).expect(200);
    // restricted data viewed: written to the log
    await get(`/employees/${m.id}/bank`, hr).expect(200);
    mona = { id: m.id, employeeCode: m.employeeCode, employmentId, contractId: draft.id };

    const o = (await post('/employees', hr, { fullNameEn: `Omar Audit ${RUN}`, fullNameAr: 'عمر تجريبي' }).expect(201)).body as { id: string; employeeCode: string };
    people.push(o.id);
    await patch(`/employees/${o.id}`, hr, { fullNameEn: `Omar Audited ${RUN}` }).expect(200);
    omar = o;
  });

  afterAll(async () => {
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.raiseRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  describe('who may read it', () => {
    it('is the Super Admin and the CEO only: HR, Finance, Admin and employees get 403', async () => {
      for (const session of [hr, finance, admin, employee]) {
        await get('/audit', session).expect(403);
        await get('/audit/options', session).expect(403);
        await get('/audit/export', session).expect(403);
      }
      await get('/audit', ceo).expect(200);
      await get('/audit', superAdmin).expect(200);
      await api().get('/api/audit').expect(401);
    });
  });

  describe('the entries', () => {
    it('are newest first, each with who, when, the action and the record in words', async () => {
      const page = await log({ entityType: 'employee', entityId: mona.id });
      expect(page.entries.length).toBeGreaterThanOrEqual(4);
      const ids = page.entries.map((e) => BigInt(e.id));
      expect([...ids].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))).toEqual(ids);
      const created = page.entries.find((e) => e.action === 'create')!;
      expect(created).toMatchObject({
        actionLabel: 'Created',
        entityType: 'employee',
        entityLabel: 'Employee',
        entityId: mona.id,
        reference: null,
        employee: { id: mona.id, employeeCode: mona.employeeCode, fullNameEn: `Mona Audit ${RUN}` },
        who: { text: hrEmail, user: { id: hrId, email: hrEmail }, by: null },
        // the CEO opens every profile
        link: { href: `/employees/${mona.id}`, label: 'Open profile' },
      });
      expect(created.when).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} (AM|PM)$/);
      expect(created.changes.find((c) => c.field === 'fullNameEn')).toMatchObject({ kind: 'value', to: `Mona Audit ${RUN}` });
    });

    it('give the Super Admin as such no link to a profile they can’t open, but to the user accounts', async () => {
      const page = await log({ entityType: 'employee', entityId: mona.id }, superAdmin);
      expect(page.entries.every((e) => e.link === null)).toBe(true);
      const logins = await log({ action: 'login', userId: hrId }, superAdmin);
      expect(logins.entries[0]).toMatchObject({ actionLabel: 'Signed in', entityLabel: 'User account', link: { href: `/users/${hrId}` } });
      const forCeo = await log({ action: 'login', userId: hrId });
      expect(forCeo.entries[0].link).toBeNull();
    });

    it('show a change from → to, and the restricted values only as changed', async () => {
      const page = await log({ entityType: 'employee', entityId: mona.id, action: 'update' });
      const bank = page.entries.find((e) => e.changes.some((c) => c.field.startsWith('bank.')))!;
      expect(bank.changes.find((c) => c.field === 'bank.accountNo')).toEqual({ field: 'bank.accountNo', label: 'Bank · Account number', kind: 'change', from: null, to: null, masked: 'changed' });
      expect(bank.changes.find((c) => c.field === 'bank.bankName')).toMatchObject({ kind: 'change', from: null, to: 'National Bank of Egypt', masked: null });
      const identity = page.entries.find((e) => e.changes.some((c) => c.field === 'identity.nationalId'))!;
      expect(identity.changes.find((c) => c.field === 'identity.nationalId')?.masked).toBe('changed');
      // the numbers themselves are nowhere in the answer, nor found by a search
      const all = JSON.stringify(await log({ employeeId: mona.id, limit: 100 }));
      expect(all).not.toContain(ACCOUNT);
      expect(all).not.toContain(NATIONAL_ID);
      expect((await log({ q: ACCOUNT })).total).toBe(0);
      // the contract's salary, written as changed
      const contract = (await log({ entityType: 'contract', entityId: mona.contractId, action: 'create' })).entries[0];
      expect(contract.changes.find((c) => c.field === 'grossSalary')).toMatchObject({ from: null, to: null, masked: 'changed' });
      expect(contract.changes.filter((c) => c.from === '30000' || c.to === '30000')).toEqual([]);
    });

    it('name the contract by its number and link the CEO to it on the profile', async () => {
      const page = await log({ entityType: 'contract', entityId: mona.contractId });
      expect(page.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['create', 'sign']));
      for (const e of page.entries) {
        expect(e.reference).toMatch(/^CON-\d{4}-\d{4}$/);
        expect(e.employee?.id).toBe(mona.id);
        expect(e.link).toEqual({ href: `/employees/${mona.id}?tab=employment#contract`, label: 'Open contract' });
      }
    });
  });

  describe('the filters', () => {
    it('find what someone did', async () => {
      const page = await log({ userId: hrId, limit: 100 });
      expect(page.total).toBeGreaterThanOrEqual(8);
      expect(page.entries.every((e) => e.who.user?.id === hrId)).toBe(true);
    });

    it('find an action, and the restricted data viewed', async () => {
      const page = await log({ action: 'view_restricted', entityId: mona.id });
      expect(page.total).toBe(1);
      expect(page.entries[0]).toMatchObject({ actionLabel: 'Viewed restricted data', who: { user: { id: hrId } } });
      expect(page.entries[0].changes).toEqual([expect.objectContaining({ field: 'fields', kind: 'value', to: 'accountNo, iban' })]);
    });

    it('find the days asked, in Cairo', async () => {
      expect((await log({ entityId: mona.id, from: TODAY, to: TODAY })).total).toBeGreaterThanOrEqual(4);
      expect((await log({ entityId: mona.id, from: addDays(TODAY, 1) })).total).toBe(0);
      expect((await log({ entityId: mona.id, to: addDays(TODAY, -1) })).total).toBe(0);
      await get(`/audit?from=${TODAY}&to=${addDays(TODAY, -1)}`, ceo).expect(400);
      await get('/audit?from=2026-02-30', ceo).expect(400);
      await get('/audit?userId=not-an-id', ceo).expect(400);
      await get('/audit?action=DROP%20TABLE', ceo).expect(400);
      await get('/audit?limit=500', ceo).expect(400);
    });

    it('find text in what changed, whatever the case', async () => {
      const page = await log({ q: `omar audited ${RUN}`.toUpperCase() });
      expect(page.total).toBe(1);
      expect(page.entries[0]).toMatchObject({ action: 'update', entityId: omar.id });
      expect(page.entries[0].changes[0]).toMatchObject({ field: 'fullNameEn', kind: 'change', from: `Omar Audit ${RUN}`, to: `Omar Audited ${RUN}` });
    });

    it('page through the newest first', async () => {
      const first = await log({ userId: hrId, limit: 2 });
      expect(first.entries).toHaveLength(2);
      expect(first).toMatchObject({ page: 1, pageSize: 2, pages: Math.ceil(first.total / 2) });
      expect(first.next).toBe(first.entries[1].id);
      const second = await log({ userId: hrId, limit: 2, page: 2 });
      expect(second.page).toBe(2);
      expect(BigInt(second.entries[0].id)).toBeLessThan(BigInt(first.entries[1].id));
      const after = await log({ userId: hrId, limit: 2, before: first.next! });
      expect(after.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id));
    });
  });

  describe('one person’s History', () => {
    it('is everything about them: their profile, employment and contract, nobody else’s', async () => {
      const page = await log({ employeeId: mona.id, limit: 100 });
      const kinds = new Set(page.entries.map((e) => e.entityType));
      for (const kind of ['employee', 'employment', 'contract']) expect(kinds).toContain(kind);
      expect(page.entries.every((e) => e.employee?.id === mona.id)).toBe(true);
      expect(page.entries.some((e) => e.entityId === omar.id)).toBe(false);
      const omars = await log({ employeeId: omar.id });
      expect(omars.entries.map((e) => e.action).sort()).toEqual(['create', 'update']);
    });

    it('is 404 for someone not on record', async () => {
      await get('/audit?employeeId=0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e', ceo).expect(404);
    });
  });

  describe('a Super Admin viewing as someone', () => {
    it('is named on what they did in the user’s name: "Super Admin X acting as Y", and found by either', async () => {
      const cookie = (res: request.Response) =>
        ([] as string[])
          .concat(res.headers['set-cookie'] ?? [])
          .find((c) => c.startsWith('ps_session='))!
          .split(';')[0];
      const viewing = cookie(await post('/auth/view-as', superAdmin, { userId: hrId }).expect(200));
      const acting = cookie(await post('/auth/view-as/act', viewing, { act: true }).expect(200));
      await patch(`/employees/${omar.id}`, acting, { fullNameEn: `Omar Acted ${RUN}` }).expect(200);
      await post('/auth/view-as/stop', acting).expect(200);

      const page = await log({ q: `Omar Acted ${RUN}` });
      expect(page.total).toBe(1);
      expect(page.entries[0].who).toEqual({
        text: `Super Admin ${superEmail} acting as ${hrEmail}`,
        user: { id: hrId, email: hrEmail, name: null },
        by: { id: superId, email: superEmail, name: null },
        via: null,
      });
      expect((await log({ userId: superId, q: `Omar Acted ${RUN}` })).total).toBe(1);
    });
  });

  describe('the filters’ choices', () => {
    it('list who, the actions, the kinds of record and the people, in words', async () => {
      const options = (await get('/audit/options', ceo).expect(200)).body as {
        users: { id: string; email: string; active: boolean }[];
        actions: { value: string; label: string }[];
        entityTypes: { value: string; label: string }[];
        employees: { id: string; employeeCode: string; fullNameEn: string }[];
      };
      expect(options.users).toContainEqual(expect.objectContaining({ id: hrId, email: hrEmail, active: true }));
      expect(options.actions).toContainEqual({ value: 'update', label: 'Updated' });
      expect(options.entityTypes).toContainEqual({ value: 'payroll_line', label: 'Payroll line' });
      expect(options.employees).toContainEqual({ id: mona.id, employeeCode: mona.employeeCode, fullNameEn: `Mona Audit ${RUN}` });
    });
  });

  describe('the Excel export', () => {
    it('has the same entries, masked as on the page, and is itself in the log', async () => {
      const res = await get(`/audit/export?employeeId=${mona.id}`, ceo).buffer(true).parse(bytes).expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="Audit log \d{4}-\d{2}-\d{2}\.xlsx"/);
      const { sheets, text } = await workbookText(res.body as Buffer);
      expect(sheets).toEqual(['Audit Log', 'About']);
      expect(text).toContain(mona.employeeCode);
      expect(text).toContain(`Mona Audit ${RUN}`);
      expect(text).toContain('Bank · Account number: changed (not shown)');
      expect(text).toContain(`Mona Audit ${RUN} (${mona.employeeCode})`);
      expect(text).not.toContain(ACCOUNT);
      expect(text).not.toContain(NATIONAL_ID);
      expect(text).not.toContain(`Omar Audit ${RUN}`);

      const downloads = await log({ action: 'audit_log_file' });
      expect(downloads.entries[0]).toMatchObject({ actionLabel: 'Downloaded the audit log', entityLabel: 'Audit log', link: null });
      expect(downloads.entries[0].changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'employeeId', to: `Mona Audit ${RUN} (${mona.employeeCode})` })]));
    });

    it('takes the same filters, and refuses a wrong one', async () => {
      await get(`/audit/export?from=${TODAY}&to=${addDays(TODAY, -1)}`, superAdmin).expect(400);
      const res = await get(`/audit/export?q=${encodeURIComponent(`Omar Audited ${RUN}`)}`, superAdmin).buffer(true).parse(bytes).expect(200);
      const { text } = await workbookText(res.body as Buffer);
      expect(text).toContain(`Omar Audited ${RUN}`);
      expect(text).not.toContain(`Mona Audit ${RUN}`);
    });
  });
});
