import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The kinds of allowance (Organization → Allowances; owner's request, 15 October 2026): anyone signed in reads them, HR
// or an Admin adds and changes them, and only a Super Admin deletes one no contract or offer has. Other test files add
// kinds to the same database, so names end with RUN and checks on the whole list only check its order.

const RUN = Date.now().toString(36).toLowerCase();
const ONLY_SUPER_ADMIN_DELETES = 'Only a Super Admin can delete records.';

/** A kind as the API sends it. */
interface Kind {
  id: string;
  nameEn: string;
  nameAr: string;
  taxable: boolean;
  insured: boolean;
  active: boolean;
  sortOrder: number;
  inUse: boolean;
}

describe('Allowance kinds (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  let superAdmin: string;
  let finance: string;
  let staff: string;
  const api = () => request(app.getHttpServer());

  const list = async (session = hr) => (await api().get('/api/allowance-types').set('Cookie', session).expect(200)).body as Kind[];
  const post = (body: object, session = hr) => api().post('/api/allowance-types').set('Cookie', session).send(body);
  const patch = (id: string, body: object, session = hr) => api().patch(`/api/allowance-types/${id}`).set('Cookie', session).send(body);
  const remove = (id: string, session = superAdmin) => api().delete(`/api/allowance-types/${id}`).set('Cookie', session);
  const add = async (nameEn: string, body: object = {}) => (await post({ nameEn: `${nameEn} ${RUN}`, nameAr: 'بدل', ...body }).expect(201)).body as Kind;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
  });

  afterAll(async () => {
    await app.close();
  });

  it('HR or an Admin adds a kind: taxed and not insured unless sent, active, last in the list', async () => {
    const housing = await post({ nameEn: `  Housing ${RUN} `, nameAr: ' بدل سكن ', insured: true }).expect(201);
    expect(housing.body).toEqual({
      id: expect.any(String),
      nameEn: `Housing ${RUN}`,
      nameAr: 'بدل سكن',
      taxable: true,
      insured: true,
      active: true,
      sortOrder: expect.any(Number),
      inUse: false,
    });
    const meals = (await post({ nameEn: `Meals ${RUN}`, nameAr: 'بدل وجبات', taxable: false }, admin).expect(201)).body as Kind;
    expect(meals).toMatchObject({ taxable: false, insured: false, active: true });
    expect(meals.sortOrder).toBeGreaterThan(housing.body.sortOrder);

    for (const session of [finance, staff]) await post({ nameEn: `Refused ${RUN}`, nameAr: 'بدل' }, session).expect(403);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'allowance_type', entityId: housing.body.id } });
    expect(audit.map((a) => [a.action, a.diff])).toEqual([
      ['create', { nameEn: `Housing ${RUN}`, nameAr: 'بدل سكن', taxable: true, insured: true, active: true, sortOrder: housing.body.sortOrder }],
    ]);
  });

  it('anyone signed in reads the kinds, in their order, then by name', async () => {
    const a = await add('Order B');
    const b = await add('Order A');
    const kinds = await list(staff);
    expect(kinds.map((k) => k.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const orders = kinds.map((k) => k.sortOrder);
    expect(orders).toEqual(orders.toSorted((x, y) => x - y));
    // the same order: by name
    await patch(b.id, { sortOrder: a.sortOrder }).expect(200);
    const again = (await list()).filter((k) => k.id === a.id || k.id === b.id);
    expect(again.map((k) => k.nameEn)).toEqual([`Order A ${RUN}`, `Order B ${RUN}`]);
    await api().get('/api/allowance-types').expect(401);
  });

  it('refuses a duplicate English name (whatever the case), and missing names', async () => {
    await add('Duplicate');
    const twice = await post({ nameEn: `DUPLICATE ${RUN}`, nameAr: 'بدل آخر' }).expect(409);
    expect(twice.body.message).toBe(`There is already an allowance called Duplicate ${RUN}. Choose another name.`);
    expect((await post({ nameEn: ' ', nameAr: 'بدل' }).expect(400)).body.message).toEqual(['Enter the name in English (up to 100 characters), e.g. Housing.']);
    expect((await post({ nameEn: `No Arabic ${RUN}` }).expect(400)).body.message).toEqual(['Enter the name in Arabic (up to 100 characters), e.g. بدل سكن.']);
    expect((await post({ nameEn: 'x'.repeat(101), nameAr: 'بدل' }).expect(400)).body.message).toEqual(['Enter the name in English (up to 100 characters), e.g. Housing.']);
    await post({ nameEn: `Flags ${RUN}`, nameAr: 'بدل', taxable: 'yes' }).expect(400);
    await post({ nameEn: `Sorted ${RUN}`, nameAr: 'بدل', sortOrder: 3 }).expect(400); // the order is changed afterwards
  });

  it('HR or an Admin changes a kind, with an audit entry; a rename may not take another kind’s name', async () => {
    const kind = await add('Changing');
    const other = await add('Taken');
    const changed = await patch(kind.id, { nameEn: `Changed ${RUN}`, nameAr: 'بدل معدل', taxable: false, insured: true, active: false, sortOrder: 7 }).expect(200);
    expect(changed.body).toEqual({ ...kind, nameEn: `Changed ${RUN}`, nameAr: 'بدل معدل', taxable: false, insured: true, active: false, sortOrder: 7 });
    expect((await patch(kind.id, { active: true }, admin).expect(200)).body.active).toBe(true);
    // only the case changes: still its own name
    expect((await patch(kind.id, { nameEn: `CHANGED ${RUN}` }).expect(200)).body.nameEn).toBe(`CHANGED ${RUN}`);
    const taken = await patch(kind.id, { nameEn: other.nameEn.toLowerCase() }).expect(409);
    expect(taken.body.message).toBe(`There is already an allowance called ${other.nameEn}. Choose another name.`);

    await patch(kind.id, { active: false }, finance).expect(403);
    await patch(kind.id, { nameEn: '' }).expect(400);
    await patch(kind.id, { nameEn: null }).expect(400);
    await patch(kind.id, { sortOrder: -1 }).expect(400);
    await patch(kind.id, { inUse: false }).expect(400);
    await patch('00000000-0000-4000-8000-000000000000', { active: false }).expect(404);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'allowance_type', entityId: kind.id, action: 'update' }, orderBy: { id: 'asc' } });
    expect(audit[0].diff).toEqual({
      nameEn: { from: `Changing ${RUN}`, to: `Changed ${RUN}` },
      nameAr: { from: 'بدل', to: 'بدل معدل' },
      taxable: { from: true, to: false },
      insured: { from: false, to: true },
      active: { from: true, to: false },
      sortOrder: { from: kind.sortOrder, to: 7 },
    });
  });

  it('only a Super Admin deletes a kind, and only one no contract or offer has: one in use is made inactive', async () => {
    const unused = await add('Unused');
    for (const session of [hr, admin]) expect((await remove(unused.id, session).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_DELETES);
    await remove(unused.id).expect(204);
    expect((await list()).some((k) => k.id === unused.id)).toBe(false);
    await remove(unused.id).expect(404);
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'allowance_type', entityId: unused.id, action: 'delete' } });
    expect(audit[0].diff).toEqual({ nameEn: `Unused ${RUN}`, nameAr: 'بدل' });

    // on a contract: in use, so it stays
    const used = await add('Used');
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Allowance Holder ${RUN}`, fullNameAr: 'موظف' }).expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: '2026-03-01' }).expect(201);
    const contract = await api()
      .post(`/api/employees/${person.body.id}/employments/${hired.body.employment.id}/contracts`)
      .set('Cookie', hr)
      .send({ grossSalary: 10000, allowances: [{ allowanceTypeId: used.id, amount: 500 }] })
      .expect(201);
    expect((await list()).find((k) => k.id === used.id)).toMatchObject({ inUse: true });
    const refused = await remove(used.id).expect(409);
    expect(refused.body.message).toBe(`Used ${RUN} is on contracts or offers: make it inactive instead.`);
    expect((await patch(used.id, { active: false }).expect(200)).body).toMatchObject({ active: false, inUse: true });

    // a draft deleted takes its allowances with it: the kind is free again
    await api().delete(`/api/contracts/${contract.body.id}`).set('Cookie', superAdmin).expect(204);
    expect((await list()).find((k) => k.id === used.id)).toMatchObject({ inUse: false });
    await remove(used.id).expect(204);
  });
});
