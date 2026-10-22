import type { INestApplication } from '@nestjs/common';
import type { AssetListView, AssetRowView, AssetView, Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Assets, step 1 (owner, 21 October 2026: "i want to add this module with a special permission to the system"; "3
// levels per user"; values: "CEO and Finance"): each user's Assets access set on the Users page and audited, the four
// levels and none (403), a Super Admin always a manager, the CEO and Finance at least viewers; the values (purchase
// cost, supplier, invoice, market value, book value) only for the CEO, Finance and a Super Admin, never for an Assets
// manager or custodian without those roles, neither in what the API answers nor taken from them; the codes (PK-CAM-0001
// then 0002, never clashing when saved at once, kept after a group or type edit, never given again after a delete);
// deleting (a Super Admin only, and only an asset never in custody); photos with their permissions; rooms, kits and the
// settings; and the audit log. The test database is emptied at the start of each run, so the codes start at 0001; every
// name is invented; the test deletes what it made.

const RUN = Date.now().toString(36);

/** Pictures known by their first bytes only (nothing decodes them). */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const png = (mark: string) => Buffer.concat([PNG, Buffer.from(`MARK:${mark}`)]);
const jpeg = (mark: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from(`MARK:${mark}`)]);

const MONEY_KEYS = ['purchasePrice', 'supplier', 'invoiceNo', 'priceLow', 'marketValue', 'priceHigh', 'priceNote', 'bookValue', 'expensed'];

describe('Assets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const made = { employees: [] as string[] };

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    ids[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** Sets someone's Assets access on the Users page, as an Admin. */
  const setAccess = (key: string, assetsAccess: string, as = 'admin') => api().patch(`/api/users/${ids[key]}`).set('Cookie', sessions[as]).send({ assetsAccess });

  const create = (as: string, body: object) => api().post('/api/assets').set('Cookie', sessions[as]).send(body);
  const get = (as: string, code: string) => api().get(`/api/assets/${code}`).set('Cookie', sessions[as]);
  const list = (as: string, query = '') => api().get(`/api/assets${query}`).set('Cookie', sessions[as]);
  const camera = (name: string, extra: object = {}) => ({ name, group: 'kit', type: 'CAM', brand: 'Sony', model: 'FX3', serial: `SER-${RUN}-${name}`, ...extra });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    await account('manager', ['employee', 'hr']); // an Assets manager, not CEO or Finance
    await account('custodian', ['employee']);
    await account('viewer', ['employee']);
    await account('none', ['employee']);
    await account('finance', ['finance']);
    await account('ceo', ['ceo']);
    await setAccess('manager', 'manager').expect(200);
    await setAccess('custodian', 'custodian').expect(200);
    await setAccess('viewer', 'viewer').expect(200);
  });

  afterAll(async () => {
    const assets = await prisma.asset.findMany({ where: { OR: [{ name: { contains: RUN } }, { serial: { contains: RUN } }] }, select: { id: true } });
    const assetIds = assets.map((a) => a.id);
    await prisma.asset.updateMany({ where: { id: { in: assetIds }, status: 'custody' }, data: { status: 'available', holderId: null, custodyId: null } });
    await prisma.custodyItem.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.custodyRecord.deleteMany({ where: { employeeId: { in: made.employees } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.assetKit.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.assetRoom.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.employee.deleteMany({ where: { id: { in: made.employees } } });
    await app.close();
  });

  // ---------- the access ----------

  it('the Users page sets each user’s Assets access, audited; a Super Admin always a manager, the CEO and Finance at least viewers', async () => {
    const res = await api().get(`/api/users/${ids.custodian}`).set('Cookie', sessions.admin).expect(200);
    expect(res.body).toMatchObject({ assetsAccess: 'custodian', assetsAccessInEffect: 'custodian' });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: ids.custodian, action: 'update', userId: ids.admin } });
    expect(entry.diff).toEqual({ assetsAccess: { from: 'none', to: 'custodian' } });

    const all = (await api().get('/api/users').set('Cookie', sessions.admin).expect(200)).body as { id: string; assetsAccess: string; assetsAccessInEffect: string }[];
    expect(all.find((u) => u.id === ids.superAdmin)).toMatchObject({ assetsAccess: 'none', assetsAccessInEffect: 'manager' });
    expect(all.find((u) => u.id === ids.finance)).toMatchObject({ assetsAccess: 'none', assetsAccessInEffect: 'viewer' });
    expect(all.find((u) => u.id === ids.ceo)).toMatchObject({ assetsAccess: 'none', assetsAccessInEffect: 'viewer' });
    expect(all.find((u) => u.id === ids.none)).toMatchObject({ assetsAccess: 'none', assetsAccessInEffect: 'none' });

    // a level the system doesn't have; an Admin changing a Super Admin's account; only Admins set it
    await setAccess('viewer', 'owner').expect(400);
    await setAccess('superAdmin', 'viewer').expect(403);
    await setAccess('none', 'manager', 'manager').expect(403);
  });

  it('GET /auth/me says each one’s access in effect, whether they see the values, and that the Claude connector is offered to anyone with access (step 2)', async () => {
    const me = async (key: string) => (await api().get('/api/auth/me').set('Cookie', sessions[key]).expect(200)).body.assets;
    expect(await me('none')).toEqual({ access: 'none', values: false, ai: false });
    expect(await me('viewer')).toEqual({ access: 'viewer', values: false, ai: true });
    expect(await me('custodian')).toEqual({ access: 'custodian', values: false, ai: true });
    expect(await me('manager')).toEqual({ access: 'manager', values: false, ai: true });
    expect(await me('finance')).toEqual({ access: 'viewer', values: true, ai: true });
    expect(await me('ceo')).toEqual({ access: 'viewer', values: true, ai: true });
    expect(await me('superAdmin')).toEqual({ access: 'manager', values: true, ai: true });
  });

  it('without access the module answers 403 everywhere', async () => {
    const message = 'You do not have access to Assets.';
    for (const [method, path] of [
      ['get', '/api/assets'],
      ['get', '/api/assets/PK-CAM-0001'],
      ['get', '/api/assets/rooms'],
      ['get', '/api/assets/kits'],
      ['get', '/api/assets/settings'],
      ['post', '/api/assets'],
      ['patch', '/api/assets/PK-CAM-0001/values'],
    ] as const) {
      const res = await api()[method](path).set('Cookie', sessions.none).send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(message);
    }
  });

  // ---------- codes ----------

  it('codes: PK-CAM-0001 then PK-CAM-0002; the class and useful life the group’s', async () => {
    const one = await create('custodian', camera(`Camera A ${RUN}`)).expect(201);
    const two = await create('custodian', camera(`Camera B ${RUN}`)).expect(201);
    expect(one.body).toMatchObject({ code: 'PK-CAM-0001', group: 'kit', type: 'CAM', assetClass: 'fixed', usefulLifeYears: 5, status: 'available', holder: null });
    expect(two.body.code).toBe('PK-CAM-0002');
    // the code as typed or scanned, in lower case
    expect((await get('viewer', 'pk-cam-0001').expect(200)).body.code).toBe('PK-CAM-0001');
    await get('viewer', 'PK-CAM-9999').expect(404);
    await get('viewer', 'not-a-code').expect(404);
  });

  it('concurrent creates never clash: ten laptops saved at once get IT-LAP-0001 to 0010', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => create('custodian', { name: `Laptop ${i} ${RUN}`, group: 'it', type: 'LAP' })));
    for (const r of results) expect(r.status).toBe(201);
    const codes = results.map((r) => r.body.code as string).sort();
    expect(codes).toEqual(Array.from({ length: 10 }, (_, i) => `IT-LAP-${String(i + 1).padStart(4, '0')}`));
    expect((await prisma.assetCodeCounter.findUniqueOrThrow({ where: { prefix: 'IT-LAP-' } })).last).toBe(10);
  });

  it('a code never changes when the group or type does, and is never given again', async () => {
    const lens = await create('custodian', { name: `Lens ${RUN}`, group: 'kit', type: 'LEN' }).expect(201);
    expect(lens.body.code).toBe('PK-LEN-0001');
    const kit = await api().post('/api/assets/kits').set('Cookie', sessions.custodian).send({ name: `Shoot kit ${RUN}` }).expect(201);
    expect(kit.body.code).toMatch(/^PK-KIT-[A-Z]+$/);
    await api().patch('/api/assets/PK-LEN-0001').set('Cookie', sessions.custodian).send({ kitId: kit.body.id }).expect(200);

    const edited = await api().patch('/api/assets/PK-LEN-0001').set('Cookie', sessions.custodian).send({ group: 'it', type: 'LAP' }).expect(200);
    expect(edited.body).toMatchObject({ code: 'PK-LEN-0001', group: 'it', type: 'LAP', kit: null });
    // the counters of the new group and type, and of the old, go on as before
    expect((await create('custodian', { name: `Laptop next ${RUN}`, group: 'it', type: 'LAP' }).expect(201)).body.code).toBe('IT-LAP-0011');
    expect((await create('custodian', { name: `Lens next ${RUN}`, group: 'kit', type: 'LEN' }).expect(201)).body.code).toBe('PK-LEN-0002');
  });

  // ---------- the levels ----------

  it('a viewer reads; a custodian registers and edits; neither keeps the rooms or the settings', async () => {
    expect((await list('viewer').expect(200)).body.total).toBeGreaterThan(0);
    await get('viewer', 'PK-CAM-0001').expect(200);
    const refused = await create('viewer', camera(`Viewer ${RUN}`)).expect(403);
    expect(refused.body.message).toBe('Only an Assets custodian or manager can do this.');
    await api().patch('/api/assets/PK-CAM-0001').set('Cookie', sessions.viewer).send({ notes: 'x' }).expect(403);
    await api().post('/api/assets/kits').set('Cookie', sessions.viewer).send({ name: `Kit ${RUN}` }).expect(403);

    const room = await api().post('/api/assets/rooms').set('Cookie', sessions.custodian).send({ name: `Studio ${RUN}` }).expect(403);
    expect(room.body.message).toBe('Only an Assets manager can do this.');
    await api().get('/api/assets/settings').set('Cookie', sessions.custodian).expect(403);
    await api().patch('/api/assets/settings').set('Cookie', sessions.viewer).send({ capitalizationThreshold: 1 }).expect(403);

    const detail = (await get('custodian', 'PK-CAM-0001').expect(200)).body as AssetView;
    // step 4 (22 October 2026): the accessories, attaching and the maintenance log a custodian's; Use and Restock a consumable's only; disposal a manager's
    expect(detail.can).toEqual({ edit: true, photos: true, values: false, delete: false, accessories: true, attach: true, stock: false, maintenance: true, dispose: false });
    expect((await get('viewer', 'PK-CAM-0001').expect(200)).body.can).toEqual({
      edit: false,
      photos: false,
      values: false,
      delete: false,
      accessories: false,
      attach: false,
      stock: false,
      maintenance: false,
      dispose: false,
    });
  });

  it('a manager keeps the rooms (names once whatever their case, archived ones not offered) and the settings', async () => {
    const room = await api().post('/api/assets/rooms').set('Cookie', sessions.manager).send({ name: `Studio ${RUN}`, notes: 'Ground floor' }).expect(201);
    expect(room.body).toMatchObject({ name: `Studio ${RUN}`, notes: 'Ground floor', archived: false, assets: 0 });
    await api().post('/api/assets/rooms').set('Cookie', sessions.manager).send({ name: `studio ${RUN}`.toUpperCase() }).expect(409);
    const old = await api().post('/api/assets/rooms').set('Cookie', sessions.manager).send({ name: `Old store ${RUN}` }).expect(201);
    await api().patch(`/api/assets/rooms/${old.body.id}`).set('Cookie', sessions.manager).send({ archived: true }).expect(200);
    expect((await api().get('/api/assets/rooms').set('Cookie', sessions.viewer).expect(200)).body.find((r: { id: string }) => r.id === old.body.id).archived).toBe(true);

    const put = await api().patch('/api/assets/PK-CAM-0001').set('Cookie', sessions.custodian).send({ roomId: room.body.id }).expect(200);
    expect(put.body.room).toEqual({ id: room.body.id, name: `Studio ${RUN}` });
    const archived = await api().patch('/api/assets/PK-CAM-0002').set('Cookie', sessions.custodian).send({ roomId: old.body.id }).expect(400);
    expect(archived.body.message).toContain('That room is archived: choose another.');

    // deleting a room: a Super Admin only, and only an empty one
    await api().delete(`/api/assets/rooms/${old.body.id}`).set('Cookie', sessions.manager).expect(403);
    await api().delete(`/api/assets/rooms/${room.body.id}`).set('Cookie', sessions.superAdmin).expect(409);
    await api().delete(`/api/assets/rooms/${old.body.id}`).set('Cookie', sessions.superAdmin).expect(204);

    const settings = await api().patch('/api/assets/settings').set('Cookie', sessions.manager).send({ capitalizationThreshold: 5000 }).expect(200);
    expect(settings.body).toMatchObject({ capitalizationThreshold: 5000 });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_settings', userId: ids.manager }, orderBy: { at: 'desc' } });
    expect(entry.diff).toEqual({ capitalizationThreshold: { from: 0, to: 5000 } });
  });

  // ---------- the values ----------

  it('the values are hidden from an Assets manager or custodian who isn’t CEO, Finance or a Super Admin, and refused from them', async () => {
    // Finance fills a value first, so there is one to hide
    await api().patch('/api/assets/PK-CAM-0001/values').set('Cookie', sessions.finance).send({ purchasePrice: 120000, supplier: 'Camera Shop', invoiceNo: `INV-${RUN}` }).expect(200);

    for (const key of ['manager', 'custodian', 'viewer']) {
      const one = await get(key, 'PK-CAM-0001').expect(200);
      expect(one.body).not.toHaveProperty('values');
      const page = (await list(key).expect(200)).body as AssetListView;
      for (const row of page.items) expect(row).not.toHaveProperty('values');
      for (const word of MONEY_KEYS) {
        expect(JSON.stringify(one.body)).not.toContain(`"${word}"`);
        expect(JSON.stringify(page)).not.toContain(`"${word}"`);
      }
      expect(JSON.stringify(one.body)).not.toContain('Camera Shop');
      expect(JSON.stringify(one.body)).not.toContain('120000');
    }

    // nor taken from them: with the asset, on its own, or the "Needs values" list
    expect((await create('manager', camera(`Priced ${RUN}`, { values: { purchasePrice: 1 } })).expect(403)).body.message).toBe('Only the CEO, Finance and a Super Admin see and set asset values.');
    await api().patch('/api/assets/PK-CAM-0001').set('Cookie', sessions.manager).send({ values: { purchasePrice: 1 } }).expect(403);
    await api().patch('/api/assets/PK-CAM-0001/values').set('Cookie', sessions.manager).send({ purchasePrice: 1 }).expect(403);
    await api().patch('/api/assets/PK-CAM-0001/values').set('Cookie', sessions.custodian).send({ purchasePrice: 1 }).expect(403);
    await list('manager', '?needsValues=1').expect(403);
    // a value sent outside `values` isn't a field of the asset
    await api().patch('/api/assets/PK-CAM-0001').set('Cookie', sessions.custodian).send({ purchasePrice: 1 }).expect(400);
    const kept = await prisma.asset.findUniqueOrThrow({ where: { code: 'PK-CAM-0001' }, select: { purchasePrice: true } });
    expect(kept.purchasePrice?.toNumber()).toBe(120000);
  });

  it('Finance and the CEO see the values and set them (at viewer level), with the book value and Expensed', async () => {
    for (const key of ['finance', 'ceo', 'superAdmin']) {
      const one = (await get(key, 'PK-CAM-0001').expect(200)).body as AssetView;
      expect(one.values).toMatchObject({ purchasePrice: 120000, supplier: 'Camera Shop', invoiceNo: `INV-${RUN}`, marketValue: null, priceUpdatedAt: null });
      // no purchase date yet: the book value says what it needs
      expect(one.values?.bookValue).toEqual({ amount: null, expensed: false, missing: 'purchase_date' });
      expect(one.can.values).toBe(true);
    }
    // the CEO, a viewer, can't register or edit the asset itself
    await create('ceo', camera(`CEO ${RUN}`)).expect(403);
    await api().patch('/api/assets/PK-CAM-0001').set('Cookie', sessions.finance).send({ notes: 'x' }).expect(403);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    await api().patch('/api/assets/PK-CAM-0001').set('Cookie', sessions.custodian).send({ purchaseDate: today }).expect(200);
    const market = await api().patch('/api/assets/PK-CAM-0001/values').set('Cookie', sessions.ceo).send({ priceLow: 90000, marketValue: 100000, priceHigh: 110000, priceNote: 'Used, good condition' }).expect(200);
    expect(market.body.values).toMatchObject({ priceLow: 90000, marketValue: 100000, priceHigh: 110000, bookValue: { amount: 120000, expensed: false, missing: null } });
    expect(market.body.values.priceUpdatedAt).not.toBeNull();
    // low ≤ mid ≤ high
    const range = await api().patch('/api/assets/PK-CAM-0001/values').set('Cookie', sessions.ceo).send({ priceLow: 200000 }).expect(400);
    expect(range.body.message).toContain('The low market value can’t be more than the market value.');

    // under the threshold (5,000 from the settings): Expensed, book value 0
    const cheap = await create('superAdmin', camera(`Cheap ${RUN}`, { values: { purchasePrice: 3000 } })).expect(201);
    expect(cheap.body.values.bookValue).toEqual({ amount: 0, expensed: true, missing: null });
    const row = ((await list('finance', `?q=${encodeURIComponent(`Cheap ${RUN}`)}`).expect(200)).body as AssetListView).items[0];
    expect(row.values).toEqual({ purchasePrice: 3000, marketValue: null, bookValue: 0, expensed: true });
  });

  it('"Needs values": the assets without a purchase cost, for the CEO, Finance and a Super Admin', async () => {
    const needs = (await list('finance', `?needsValues=1&q=${RUN}`).expect(200)).body as AssetListView;
    const codes = needs.items.map((r) => r.code);
    expect(codes).toContain('PK-CAM-0002');
    expect(codes).not.toContain('PK-CAM-0001');
    for (const r of needs.items) expect(r.values?.purchasePrice).toBeNull();
  });

  // ---------- the form's rules ----------

  it('the fields follow the group: consumables by quantity and always available, a kit only for kit assets', async () => {
    const tape = await create('custodian', { name: `Gaffer tape ${RUN}`, group: 'consumable', type: 'TAP', unit: 'roll', quantity: 12, reorderLevel: 12 }).expect(201);
    expect(tape.body).toMatchObject({ code: 'CS-TAP-0001', assetClass: 'current', usefulLifeYears: null, quantity: 12, unit: 'roll', reorderLevel: 12, reorder: true, status: 'available', serial: null });
    const repair = await api().patch(`/api/assets/${tape.body.code}`).set('Cookie', sessions.custodian).send({ status: 'repair' }).expect(400);
    expect(repair.body.message).toContain('Consumables are always available: they are kept by quantity.');

    const kit = (await api().get('/api/assets/kits').set('Cookie', sessions.viewer).expect(200)).body[0];
    expect((await create('custodian', { name: `Laptop in kit ${RUN}`, group: 'it', type: 'LAP', kitId: kit.id }).expect(400)).body.message).toContain('Only a production kit asset goes in a kit.');
    expect((await create('custodian', { name: `Laptop by quantity ${RUN}`, group: 'it', type: 'LAP', quantity: 3 }).expect(400)).body.message).toContain('Only consumables are kept by quantity.');
    expect((await create('custodian', { name: `Camera in custody ${RUN}`, group: 'kit', type: 'CAM', status: 'custody' }).expect(400)).body.message).toContain(
      'Custody is set by a handover only, never by hand.',
    );
    expect((await create('custodian', { name: `Disposed ${RUN}`, group: 'kit', type: 'CAM', status: 'disposed' }).expect(400)).body.message).toContain('Disposal has its own steps, for an Assets manager.');
    await create('custodian', { name: `Unknown type ${RUN}`, group: 'kit', type: 'XYZ' }).expect(400);

    // under repair by hand, and back
    const lent = await api().patch('/api/assets/PK-CAM-0002').set('Cookie', sessions.custodian).send({ status: 'repair' }).expect(200);
    expect(lent.body.status).toBe('repair');
    await api().patch('/api/assets/PK-CAM-0002').set('Cookie', sessions.custodian).send({ status: 'available' }).expect(200);

    // an asset becoming a consumable: one of it, its kit and serial gone, its code kept
    const turned = await api().patch('/api/assets/PK-CAM-0002').set('Cookie', sessions.custodian).send({ group: 'consumable', type: 'SUP' }).expect(200);
    expect(turned.body).toMatchObject({ code: 'PK-CAM-0002', group: 'consumable', assetClass: 'current', quantity: 1, serial: null, usefulLifeYears: null });
    const back = await api().patch('/api/assets/PK-CAM-0002').set('Cookie', sessions.custodian).send({ group: 'kit', type: 'CAM', serial: `SER-${RUN}-back` }).expect(200);
    expect(back.body).toMatchObject({ code: 'PK-CAM-0002', group: 'kit', assetClass: 'fixed', quantity: null, usefulLifeYears: 5 });
  });

  // ---------- custody, search, delete ----------

  it('search by name, code, serial and holder; filters by group, status, room and kit; disposed ones only when asked', async () => {
    // someone holding PK-LEN-0002 in custody (custody itself is step 3: made here as it will be)
    const holder = await prisma.employee.create({ data: { employeeCode: `AST-${RUN}`, fullNameEn: `Holder Person ${RUN}`, fullNameAr: 'شخص' } });
    made.employees.push(holder.id);
    const lens = await prisma.asset.findUniqueOrThrow({ where: { code: 'PK-LEN-0002' } });
    const record = await prisma.custodyRecord.create({ data: { code: `CUS-${String(Date.now() % 10_000).padStart(4, '0')}`, kind: 'assignment', employeeId: holder.id, issuedById: ids.custodian } });
    await prisma.custodyItem.create({ data: { custodyId: record.id, assetId: lens.id } });
    await prisma.asset.update({ where: { id: lens.id }, data: { status: 'custody', holderId: holder.id, custodyId: record.id } });

    const q = async (query: string) => ((await list('viewer', query).expect(200)).body as AssetListView).items.map((r: AssetRowView) => r.code);
    expect(await q(`?q=${encodeURIComponent(`Camera A ${RUN}`)}`)).toEqual(['PK-CAM-0001']);
    expect(await q('?q=pk-cam-000')).toEqual(expect.arrayContaining(['PK-CAM-0001', 'PK-CAM-0002']));
    expect(await q(`?q=SER-${RUN}-Camera A`)).toEqual(['PK-CAM-0001']);
    expect(await q(`?q=${encodeURIComponent(`Holder Person ${RUN}`)}`)).toEqual(['PK-LEN-0002']);
    expect(await q(`?q=AST-${RUN}`)).toEqual(['PK-LEN-0002']);
    const held = ((await list('viewer', `?q=AST-${RUN}`).expect(200)).body as AssetListView).items[0];
    expect(held).toMatchObject({ status: 'custody', holder: { id: holder.id, employeeCode: `AST-${RUN}`, fullNameEn: `Holder Person ${RUN}` } });

    expect(await q(`?status=custody&q=${RUN}`)).toEqual(['PK-LEN-0002']);
    expect(await q(`?group=consumable&q=${RUN}`)).toEqual(['CS-TAP-0001']);
    const room = (await api().get('/api/assets/rooms').set('Cookie', sessions.viewer).expect(200)).body.find((r: { name: string }) => r.name === `Studio ${RUN}`);
    expect(await q(`?roomId=${room.id}`)).toEqual(['PK-CAM-0001']);
    const kit = (await api().get('/api/assets/kits').set('Cookie', sessions.viewer).expect(200)).body.find((k: { name: string }) => k.name === `Shoot kit ${RUN}`);
    await api().patch('/api/assets/PK-CAM-0001').set('Cookie', sessions.custodian).send({ kitId: kit.id }).expect(200);
    expect(await q(`?kitId=${kit.id}`)).toEqual(['PK-CAM-0001']);

    // disposed (step 4's flow, made here): out of the register and its counts, unless asked for
    const old = await create('custodian', { name: `Old laptop ${RUN}`, group: 'it', type: 'LAP' }).expect(201);
    await prisma.asset.update({ where: { code: old.body.code }, data: { status: 'disposed', disposalMethod: 'scrapped', disposedOn: new Date('2026-10-01') } });
    expect(await q(`?q=${encodeURIComponent(`Old laptop ${RUN}`)}`)).toEqual([]);
    expect(await q(`?status=disposed&q=${encodeURIComponent(`Old laptop ${RUN}`)}`)).toEqual([old.body.code]);
    const counts = ((await list('viewer', `?q=${RUN}`).expect(200)).body as AssetListView).counts;
    expect(counts.status).toMatchObject({ custody: 1, disposed: 1 });
    expect(counts.group.consumable).toBe(1);

    // custody is never ended by hand
    expect((await api().patch('/api/assets/PK-LEN-0002').set('Cookie', sessions.custodian).send({ status: 'available' }).expect(400)).body.message).toContain(
      'It is held in custody: it changes when it is received back.',
    );
  });

  it('deleting: a Super Admin only, and only an asset never in custody; its code never given again', async () => {
    const extra = await create('custodian', camera(`To delete ${RUN}`)).expect(201);
    const code = extra.body.code as string;
    expect((await api().delete(`/api/assets/${code}`).set('Cookie', sessions.manager).expect(403)).body.message).toBe('Only a Super Admin can delete records.');
    await api().delete(`/api/assets/${code}`).set('Cookie', sessions.custodian).expect(403);
    await api().delete(`/api/assets/${code}`).set('Cookie', sessions.superAdmin).expect(204);
    await get('viewer', code).expect(404);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset', action: 'delete', entityId: extra.body.id } });
    expect(entry).toMatchObject({ userId: ids.superAdmin, diff: { code, name: `To delete ${RUN}`, group: 'kit', type: 'CAM' } });

    const next = await create('custodian', camera(`After delete ${RUN}`)).expect(201);
    expect(next.body.code).not.toBe(code);
    expect(Number(next.body.code.slice(-4))).toBe(Number(code.slice(-4)) + 1);

    // PK-LEN-0002 is in custody (above); one that came back from custody can't be deleted either
    expect((await api().delete('/api/assets/PK-LEN-0002').set('Cookie', sessions.superAdmin).expect(409)).body.message).toBe('It was in custody: it can’t be deleted. Dispose of it instead.');
    const lens = await prisma.asset.findUniqueOrThrow({ where: { code: 'PK-LEN-0002' } });
    await prisma.custodyItem.updateMany({ where: { assetId: lens.id }, data: { returnedAt: new Date(), returnCondition: 'good', receivedById: ids.custodian } });
    await prisma.asset.update({ where: { id: lens.id }, data: { status: 'available', holderId: null, custodyId: null } });
    await api().delete('/api/assets/PK-LEN-0002').set('Cookie', sessions.superAdmin).expect(409);
    expect((await get('superAdmin', 'PK-LEN-0002').expect(200)).body).toMatchObject({ everInCustody: true, can: { delete: false } });
  });

  // ---------- photos ----------

  it('photos: a custodian adds up to 6, anyone with access sees them, a Super Admin deletes one', async () => {
    const path = '/api/assets/PK-CAM-0001/photos';
    const add = (as: string, files: [Buffer, string][]) => {
      let req = api().post(path).set('Cookie', sessions[as]);
      for (const [data, name] of files) req = req.attach('photos', data, name);
      return req;
    };
    await add('viewer', [[jpeg('V'), 'v.jpg']]).expect(403);
    await add('none', [[jpeg('N'), 'n.jpg']]).expect(403);
    expect((await add('custodian', [[Buffer.from('not a picture'), 'notes.txt']]).expect(400)).body.message).toContain('Each photo must be a JPEG, PNG or WebP picture.');

    const two = await add('custodian', [
      [jpeg('FRONT'), 'front.jpg'],
      [png('BACK'), 'back.png'],
    ]).expect(201);
    expect(two.body).toHaveLength(2);
    expect(two.body.map((p: { position: number }) => p.position)).toEqual([0, 1]);
    const [front, back] = two.body as { id: string }[];

    // 2 + 5 would be 7
    expect((await add('custodian', Array.from({ length: 5 }, (_, i) => [jpeg(`X${i}`), `x${i}.jpg`] as [Buffer, string])).expect(409)).body.message).toBe('An asset has at most 6 photos.');
    expect(await prisma.assetPhoto.count({ where: { asset: { code: 'PK-CAM-0001' } } })).toBe(2);

    const shown = await api().get(`${path}/${front.id}`).set('Cookie', sessions.viewer).expect(200);
    expect(shown.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(shown.body).toString()).toContain('MARK:FRONT');
    await api().get(`${path}/${front.id}`).set('Cookie', sessions.none).expect(403);
    // the photo of another asset isn't this one's
    await api().get(`/api/assets/PK-CAM-0002/photos/${front.id}`).set('Cookie', sessions.viewer).expect(404);

    // the list shows the first; making the back the first
    const first = await api().post(`${path}/${back.id}/first`).set('Cookie', sessions.custodian).expect(200);
    expect(first.body).toEqual([
      { id: back.id, position: 0 },
      { id: front.id, position: 1 },
    ]);
    const row = ((await list('viewer', `?q=${encodeURIComponent(`Camera A ${RUN}`)}`).expect(200)).body as AssetListView).items[0];
    expect(row.photo).toEqual({ id: back.id, position: 0 });

    // replaced in its place
    await api().put(`${path}/${front.id}`).set('Cookie', sessions.custodian).attach('photo', png('NEWER'), 'newer.png').expect(200);
    const newer = await api().get(`${path}/${front.id}`).set('Cookie', sessions.viewer).expect(200);
    expect(newer.headers['content-type']).toBe('image/png');

    // deleting: a Super Admin only; the others close up
    await api().delete(`${path}/${back.id}`).set('Cookie', sessions.manager).expect(403);
    await api().delete(`${path}/${back.id}`).set('Cookie', sessions.superAdmin).expect(204);
    expect((await get('viewer', 'PK-CAM-0001').expect(200)).body.photos).toEqual([{ id: front.id, position: 0 }]);

    const entries = await prisma.auditLog.findMany({ where: { entityType: 'asset_photo', entityId: { in: [front.id, back.id] } }, orderBy: { at: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['create', 'create', 'make_first', 'replace', 'delete']);
    expect(JSON.stringify(entries.map((e) => e.diff))).not.toContain('MARK:');
  });

  // ---------- the audit log ----------

  it('every write is in the audit log, the values only as the fact that they were set or changed', async () => {
    const one = await prisma.asset.findUniqueOrThrow({ where: { code: 'PK-CAM-0001' }, select: { id: true } });
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'asset', entityId: one.id }, orderBy: { at: 'asc' } });
    expect(entries[0]).toMatchObject({ action: 'create', userId: ids.custodian, diff: expect.objectContaining({ code: 'PK-CAM-0001', group: 'kit', type: 'CAM', status: 'available' }) });
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['create', 'update', 'update_values']));
    const valuesEntry = entries.find((e) => e.action === 'update_values' && e.userId === ids.finance);
    expect(valuesEntry?.diff).toEqual({ code: 'PK-CAM-0001', purchasePrice: 'changed', supplier: 'changed', invoiceNo: 'changed' });
    const all = JSON.stringify(entries.map((e) => e.diff));
    expect(all).not.toContain('120000');
    expect(all).not.toContain('Camera Shop');
    expect(all).not.toContain(`INV-${RUN}`);

    const cheap = await prisma.asset.findFirstOrThrow({ where: { name: `Cheap ${RUN}` }, select: { id: true } });
    const created = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset', entityId: cheap.id, action: 'create' } });
    expect(created.diff).toMatchObject({ purchasePrice: 'set' });

    // the Audit Log page reads them in words, with a link to the asset
    const page = await api().get(`/api/audit?entityType=asset&entityId=${one.id}`).set('Cookie', sessions.superAdmin).expect(200);
    const update = page.body.entries.find((e: { action: string; who: { user: { id: string } | null } }) => e.action === 'update_values' && e.who.user?.id === ids.finance);
    expect(update).toMatchObject({ actionLabel: 'Updated the values', entityLabel: 'Asset', reference: 'PK-CAM-0001', link: { href: '/assets/PK-CAM-0001', label: 'Open asset' } });
    expect(update.changes).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Purchase cost', masked: 'changed' })]));

    for (const type of ['asset_room', 'asset_kit', 'asset_settings']) expect(await prisma.auditLog.count({ where: { entityType: type } })).toBeGreaterThan(0);
  });

  it('labels: marking one printed keeps when', async () => {
    const res = await api().post('/api/assets/PK-CAM-0001/labeled').set('Cookie', sessions.custodian).expect(200);
    expect(new Date(res.body.labeledAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    await api().post('/api/assets/PK-CAM-0001/labeled').set('Cookie', sessions.viewer).expect(403);
  });
});
