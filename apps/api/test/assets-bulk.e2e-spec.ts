import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_READ_ONLY, type AssetKitView, type AssetListView, type AssetView, type BulkDeleteResult, type BulkDisposeResult, type Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Delete selected and Dispose selected on All Assets (owner, 25 October 2026: "cant i delete assets as a super admin?",
// then "can i delete multiple assets at one?"; asked, "Never-in-custody only"): a Super Admin deletes those never in
// custody and the others are skipped with the reason, each deletion audited as one deleted on its page and its code never
// given again; nobody else deletes, a developer neither; at most 200 at a time. An Assets manager disposes of several at
// once through the disposal rules: a consumable and one in custody skipped, the rest disposed of with the book value
// kept, out of their kit and their attached assets detached, audited per asset. The test database is emptied at the
// start of each run; every name is invented; the test deletes what it made.

const RUN = `bk${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const PREFIXES = ['PK-LGT-', 'OF-DSK-', 'CS-PAP-'];

describe('Assets: Delete selected and Dispose selected (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const codes: Record<string, string> = {};
  let holderId = '';
  let records = 0;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const row = (key: string) => prisma.asset.findUnique({ where: { code: codes[key] } });

  async function account(key: string, roles: Role[], access?: string) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    if (access) await patch('admin', `/users/${users[key]}`, { assetsAccess: access }).expect(200);
  }

  async function asset(key: string, body: object, as = 'custodian') {
    const made = (await post(as, '/assets', { ...body, name: `${(body as { name: string }).name} ${RUN}` }).expect(201)).body as AssetView;
    codes[key] = made.code;
    return made;
  }

  /** Held in custody (custody itself is step 3's: made here as a handover makes it); `back`: received back since. */
  async function custody(key: string, back: boolean) {
    const a = (await row(key))!;
    const record = await prisma.custodyRecord.create({ data: { code: `CUS-${98_000 + ++records}`, kind: 'assignment', employeeId: holderId, issuedById: users.custodian } });
    if (back) {
      await prisma.custodyItem.create({ data: { custodyId: record.id, assetId: a.id, returnedAt: new Date(), returnCondition: 'good', receivedById: users.custodian } });
    } else {
      await prisma.custodyItem.create({ data: { custodyId: record.id, assetId: a.id } });
      await prisma.asset.update({ where: { id: a.id }, data: { status: 'custody', holderId, custodyId: record.id } });
    }
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    await account('manager', ['employee'], 'manager');
    await account('custodian', ['employee'], 'custodian');
    await account('developer', ['developer']);
    holderId = (await prisma.employee.create({ data: { employeeCode: `BLK-${RUN}`, fullNameEn: `Holder ${RUN}`, fullNameAr: 'شخص' } })).id;
    // to delete: three never in custody, one received back from custody, one in custody now
    await asset('lightA', { name: 'Light A', group: 'kit', type: 'LGT' });
    await asset('lightB', { name: 'Light B', group: 'kit', type: 'LGT' });
    await asset('lightC', { name: 'Light C', group: 'kit', type: 'LGT' });
    await asset('wasHeld', { name: 'Light back from custody', group: 'kit', type: 'LGT' });
    await asset('heldNow', { name: 'Light held now', group: 'kit', type: 'LGT' });
    await custody('wasHeld', true);
    await custody('heldNow', false);
  });

  afterAll(async () => {
    const assets = await prisma.asset.findMany({ where: { name: { contains: RUN } }, select: { id: true } });
    const assetIds = assets.map((a) => a.id);
    await prisma.asset.updateMany({ where: { id: { in: assetIds } }, data: { parentAssetId: null } });
    await prisma.asset.updateMany({ where: { id: { in: assetIds }, status: 'custody' }, data: { status: 'available', holderId: null, custodyId: null } });
    const held = await prisma.custodyRecord.findMany({ where: { employeeId: holderId }, select: { id: true } });
    await prisma.custodyItem.deleteMany({ where: { custodyId: { in: held.map((r) => r.id) } } });
    await prisma.custodyRecord.deleteMany({ where: { employeeId: holderId } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.assetKit.deleteMany({ where: { name: { contains: RUN } } });
    // the code counters this file used, back as they were when no asset of theirs is left (assets.e2e-spec.ts expects
    // the codes to start at 0001 in a run, whichever file runs first)
    for (const prefix of PREFIXES) {
      if (!(await prisma.asset.count({ where: { code: { startsWith: prefix } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix } });
    }
    if (!(await prisma.assetKit.count())) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-KIT-' } });
    await prisma.employee.deleteMany({ where: { id: holderId } });
    await app.close();
  });

  // ---------- Delete selected ----------

  it('the register says of each row whether it was ever in custody, as an asset’s page does', async () => {
    const list = (await get('superAdmin', `/assets?q=${RUN}`).expect(200)).body as AssetListView;
    const ever = Object.fromEntries(list.items.map((r) => [r.code, r.everInCustody]));
    expect(ever).toEqual({ [codes.lightA]: false, [codes.lightB]: false, [codes.lightC]: false, [codes.wasHeld]: true, [codes.heldNow]: true });
  });

  it('only a Super Admin deletes several at once: an Assets manager, a custodian and a developer are refused, nothing deleted', async () => {
    const body = { codes: [codes.lightA, codes.lightB] };
    expect((await post('manager', '/assets/bulk-delete', body).expect(403)).body.message).toBe('Only a Super Admin can delete records.');
    expect((await post('custodian', '/assets/bulk-delete', body).expect(403)).body.message).toBe('Only a Super Admin can delete records.');
    expect((await post('developer', '/assets/bulk-delete', body).expect(403)).body.message).toBe(DEVELOPER_READ_ONLY);
    expect(await row('lightA')).not.toBeNull();
    expect(await row('lightB')).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityType: 'asset', action: 'delete', userId: { in: [users.manager, users.custodian, users.developer] } } })).toBe(0);
  });

  it('at most 200 codes, and at least one', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `PK-LGT-${String(9000 + i).padStart(4, '0')}`);
    expect((await post('superAdmin', '/assets/bulk-delete', { codes: many }).expect(400)).body.message).toEqual(['Choose at most 200 assets at a time.']);
    expect((await post('superAdmin', '/assets/bulk-delete', { codes: [] }).expect(400)).body.message).toEqual(['Choose the assets.']);
    await post('superAdmin', '/assets/bulk-delete', {}).expect(400);
    expect(await row('lightA')).not.toBeNull();
  });

  it('a Super Admin deletes those never in custody; the others skipped with the reason; each deletion audited; the codes never given again', async () => {
    const before = new Date();
    const ids = Object.fromEntries(await Promise.all(['lightA', 'lightB', 'lightC'].map(async (k) => [k, (await row(k))!.id])));
    const res = (
      await post('superAdmin', '/assets/bulk-delete', {
        // as typed or scanned: in lower case, twice, and one that isn't there
        codes: [codes.lightA, codes.wasHeld, codes.lightB.toLowerCase(), codes.heldNow, codes.lightC, codes.lightA, 'PK-LGT-9999'],
      }).expect(200)
    ).body as BulkDeleteResult;
    expect(res.deleted).toEqual([
      { code: codes.lightA, name: `Light A ${RUN}` },
      { code: codes.lightB, name: `Light B ${RUN}` },
      { code: codes.lightC, name: `Light C ${RUN}` },
    ]);
    expect(res.skipped).toEqual([
      { code: codes.wasHeld, reason: 'It was in custody: dispose of it instead.' },
      { code: codes.heldNow, reason: 'In custody now.' },
      { code: 'PK-LGT-9999', reason: 'Not found.' },
    ]);
    for (const k of ['lightA', 'lightB', 'lightC']) await get('superAdmin', `/assets/${codes[k]}`).expect(404);
    expect((await get('superAdmin', `/assets/${codes.wasHeld}`).expect(200)).body).toMatchObject({ status: 'available', everInCustody: true });
    expect((await get('superAdmin', `/assets/${codes.heldNow}`).expect(200)).body).toMatchObject({ status: 'custody' });

    // one entry a deleted asset, as one deleted on its page writes; nothing else
    const entries = await prisma.auditLog.findMany({ where: { userId: users.superAdmin, at: { gte: before } }, orderBy: { at: 'asc' }, select: { action: true, entityType: true, entityId: true, diff: true } });
    expect(entries).toEqual(
      ['lightA', 'lightB', 'lightC'].map((k) => ({
        action: 'delete',
        entityType: 'asset',
        entityId: ids[k],
        diff: { code: codes[k], name: `${{ lightA: 'Light A', lightB: 'Light B', lightC: 'Light C' }[k]} ${RUN}`, group: 'kit', type: 'LGT', photos: 0 },
      })),
    );

    // the counter stays: the next light has a code above every one deleted
    const next = await asset('lightD', { name: 'Light D', group: 'kit', type: 'LGT' });
    const gone = ['lightA', 'lightB', 'lightC'].map((k) => codes[k]);
    expect(gone).not.toContain(next.code);
    expect(Number(next.code.slice(-4))).toBeGreaterThan(Math.max(...gone.map((c) => Number(c.slice(-4)))));
  });

  it('the single Delete keeps its words', async () => {
    expect((await api().delete(`/api/assets/${codes.wasHeld}`).set('Cookie', sessions.superAdmin).expect(409)).body.message).toBe('It was in custody: it can’t be deleted. Dispose of it instead.');
    expect((await api().delete(`/api/assets/${codes.heldNow}`).set('Cookie', sessions.superAdmin).expect(409)).body.message).toBe('It was in custody: it can’t be deleted. Dispose of it instead.');
    expect((await api().delete('/api/assets/PK-LGT-9999').set('Cookie', sessions.superAdmin).expect(404)).body.message).toBe('Asset not found.');
  });

  // ---------- Dispose selected ----------

  it('an Assets manager disposes of several: a consumable and one in custody skipped, the rest disposed with the book value kept, out of their kit, attached assets detached; audited per asset', async () => {
    // a priced light in a kit, a desk with a lamp attached, the light back from custody, and a consumable
    await asset('pricedLight', { name: 'Priced light', group: 'kit', type: 'LGT', condition: 'good', purchaseDate: '2025-01-01', values: { purchasePrice: 60000 } }, 'superAdmin');
    await asset('desk', { name: 'Desk', group: 'office', type: 'DSK', condition: 'good' });
    await asset('lamp', { name: 'Desk lamp', group: 'office', type: 'DSK', condition: 'good' });
    await asset('paper', { name: 'Backdrop paper', group: 'consumable', type: 'PAP', unit: 'roll', quantity: 4 });
    const kit = (await post('custodian', '/assets/kits', { name: `Lights kit ${RUN}` }).expect(201)).body as AssetKitView;
    await patch('custodian', `/assets/kits/${kit.id}/items`, { addCodes: [codes.pricedLight] }).expect(200);
    await patch('custodian', `/assets/${codes.lamp}/parent`, { parentCode: codes.desk }).expect(200);
    const book = ((await get('superAdmin', `/assets/${codes.pricedLight}`).expect(200)).body as AssetView).values!.bookValue.amount;
    expect(book).toEqual(expect.any(Number));

    const body = { codes: [codes.pricedLight, codes.paper, codes.desk, codes.heldNow, codes.wasHeld, 'PK-LGT-9998'], method: 'scrapped', approvedBy: 'The CEO', note: `Water damage ${RUN}` };
    // the same people as one disposal: an Assets manager (a Super Admin is one); never a custodian or a developer
    expect((await post('custodian', '/assets/bulk-dispose', body).expect(403)).body.message).toBe('Only an Assets manager can do this.');
    expect((await post('developer', '/assets/bulk-dispose', body).expect(403)).body.message).toBe(DEVELOPER_READ_ONLY);
    // the fields are checked once, for all: nothing disposed of
    expect((await post('manager', '/assets/bulk-dispose', { ...body, date: addDays(TODAY, 1) }).expect(400)).body.message).toEqual(['The disposal date can’t be in the future.']);
    expect((await post('manager', '/assets/bulk-dispose', { ...body, approvedBy: ' ' }).expect(400)).body.message).toEqual(['Say who approved the disposal.']);
    expect((await post('manager', '/assets/bulk-dispose', { ...body, method: 'lost' }).expect(400)).body.message).toEqual(['Choose how they were disposed of: sold, scrapped, written off or donated.']);
    expect((await post('manager', '/assets/bulk-dispose', { ...body, codes: Array.from({ length: 201 }, (_, i) => `PK-LGT-${8000 + i}`) }).expect(400)).body.message).toEqual([
      'Choose at most 200 assets at a time.',
    ]);
    expect((await row('pricedLight'))!.status).toBe('available');

    const before = new Date();
    const res = (await post('manager', '/assets/bulk-dispose', body).expect(200)).body as BulkDisposeResult;
    expect(res.disposed).toEqual([
      { code: codes.pricedLight, name: `Priced light ${RUN}`, leftKit: kit.code, detached: [], detachedFrom: null },
      { code: codes.desk, name: `Desk ${RUN}`, leftKit: null, detached: [codes.lamp], detachedFrom: null },
      { code: codes.wasHeld, name: `Light back from custody ${RUN}`, leftKit: null, detached: [], detachedFrom: null },
    ]);
    expect(res.skipped).toEqual([
      { code: codes.paper, reason: 'It is a consumable: it is used up through Stock, not disposed of.' },
      { code: codes.heldNow, reason: 'It is in custody: receive it back first, then dispose of it.' },
      { code: 'PK-LGT-9998', reason: 'Not found.' },
    ]);

    // the day today when not given; the book value that day kept; the amount received left for Finance
    const priced = (await row('pricedLight'))!;
    expect(priced).toMatchObject({ status: 'disposed', disposalMethod: 'scrapped', disposalApprovedBy: 'The CEO', disposalNotes: `Water damage ${RUN}`, disposalAmount: null, kitId: null, disposedById: users.manager });
    expect(priced.disposedOn?.toISOString().slice(0, 10)).toBe(TODAY);
    expect(priced.disposalBookValue?.toNumber()).toBe(book);
    expect((await row('lamp'))!.parentAssetId).toBeNull();
    expect((await row('paper'))!.status).toBe('available');
    expect((await row('heldNow'))!.status).toBe('custody');
    expect(((await get('custodian', `/assets/kits`).expect(200)).body as AssetKitView[]).find((k) => k.id === kit.id)).toMatchObject({ assets: 0 });

    // audited per asset, as one disposal on its page: its entry, and the lamp's detach
    const entries = await prisma.auditLog.findMany({ where: { userId: users.manager, at: { gte: before } }, orderBy: { at: 'asc' }, select: { action: true, entityId: true, diff: true } });
    const id = async (k: string) => (await row(k))!.id;
    expect(entries.map((e) => e.action)).toEqual(['dispose', 'dispose', 'detach', 'dispose']);
    expect(entries[0]).toMatchObject({ entityId: await id('pricedLight'), diff: { code: codes.pricedLight, status: { from: 'available', to: 'disposed' }, disposalMethod: 'scrapped', disposedOn: TODAY, leftKit: kit.code, disposalBookValue: 'kept' } });
    expect(entries[1]).toMatchObject({ entityId: await id('desk'), diff: { code: codes.desk, detached: [codes.lamp] } });
    expect(entries[2]).toMatchObject({ entityId: await id('lamp'), diff: { code: codes.lamp, attachedTo: { from: codes.desk, to: null }, reason: 'disposed' } });
    expect(entries[3]).toMatchObject({ entityId: await id('wasHeld'), diff: { code: codes.wasHeld, disposalMethod: 'scrapped' } });
    expect(JSON.stringify(entries)).not.toContain('60000');

    // again: each is disposed already
    const again = (await post('superAdmin', '/assets/bulk-dispose', { codes: [codes.desk], method: 'sold', approvedBy: 'The CEO' }).expect(200)).body as BulkDisposeResult;
    expect(again).toEqual({ disposed: [], skipped: [{ code: codes.desk, reason: 'It is disposed already.' }] });
  });

  it('a day before an asset’s purchase skips that one alone', async () => {
    await asset('newLight', { name: 'New light', group: 'kit', type: 'LGT', purchaseDate: TODAY });
    await asset('oldLight', { name: 'Old light', group: 'kit', type: 'LGT', purchaseDate: '2024-01-01' });
    const res = (await post('manager', '/assets/bulk-dispose', { codes: [codes.newLight, codes.oldLight], method: 'donated', date: addDays(TODAY, -1), approvedBy: 'The CEO' }).expect(200))
      .body as BulkDisposeResult;
    expect(res.disposed.map((d) => d.code)).toEqual([codes.oldLight]);
    expect(res.skipped).toEqual([{ code: codes.newLight, reason: 'The disposal date can’t be before the purchase date.' }]);
    expect((await row('oldLight'))!.disposedOn?.toISOString().slice(0, 10)).toBe(addDays(TODAY, -1));
  });
});
