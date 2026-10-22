import type { INestApplication } from '@nestjs/common';
import type { AssetDraftView, AssetHistoryView, AssetKitView, AssetView, CustodyRecordView, DisposalResult, HandoverChoices, HandoverResult, HoldingsView, Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Assets, step 4 (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal") and accessories (owner,
// 22 October 2026: "and for the assets, i think we might need to add accessories under assets, like laptop charger under
// the charger, DJI ronin accessories , etc..."; "Both kinds"). A laptop gets its checklist (a charger); a gimbal its
// attached plate and battery (one level only); handing the gimbal over takes the plate with it and skips the battery
// under repair; the laptop comes back without its charger, which HR may turn into a deduction; a kit is filled from codes
// and stands Available, Partly out or Out; a consumable is used and restocked, never below 0; the maintenance log by
// hand, the cost only from those who see the values; back from repair in the condition chosen; disposal an Assets
// manager's, leaving its kit and its attached assets; a draft from Claude keeps its accessories and main asset until it
// is confirmed. The test database is emptied at the start of each run; every name is invented; the test deletes what it
// made.

const RUN = `s4${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const TOMORROW = addDays(TODAY, 1);
const NEXT_MONTH = monthsLater(TODAY.slice(0, 7), 1);

describe('Assets step 4: accessories, kits, stock, repairs, disposal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const people: Record<string, string> = {};
  const codes: Record<string, string> = {};

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const put = (as: string, path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const view = async (as: string, key: string) => (await get(as, `/assets/${codes[key]}`).expect(200)).body as AssetView;
  const idOf = async (key: string) => (await prisma.asset.findUniqueOrThrow({ where: { code: codes[key] }, select: { id: true } })).id;
  const audits = async (key: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityType: 'asset', entityId: await idOf(key), action }, orderBy: { at: 'asc' }, select: { userId: true, diff: true } });

  async function account(key: string, roles: Role[], access?: string) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    if (access) await patch('admin', `/users/${users[key]}`, { assetsAccess: access }).expect(200);
    return email;
  }

  async function employee(key: string, name: string, email?: string) {
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: email?.toLowerCase() ?? null,
        employments: { create: { employmentType: 'full_time', joinDate: new Date('2024-01-01') } },
      },
    });
    people[key] = e.id;
  }

  async function asset(key: string, body: object) {
    const made = (await post('custodian', '/assets', { ...body, name: `${(body as { name: string }).name} ${RUN}` }).expect(201)).body as AssetView;
    codes[key] = made.code;
    return made;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    const custodianEmail = await account('custodian', ['employee'], 'custodian');
    await account('manager', ['employee'], 'manager');
    await account('viewer', ['employee'], 'viewer');
    await account('hr', ['hr'], 'custodian');
    await account('finance', ['finance']);
    const monaEmail = await account('mona', ['employee']);
    await employee('kareem', 'Kareem Custodian', custodianEmail);
    await employee('mona', 'Mona Holder', monaEmail);
    await asset('laptop', { name: 'Laptop', group: 'it', type: 'LAP', condition: 'good', purchaseDate: '2025-01-01' });
    await asset('gimbal', { name: 'DJI Ronin', group: 'kit', type: 'GMB', condition: 'good' });
    await asset('plate', { name: 'Ronin plate', group: 'kit', type: 'ACC', condition: 'good' });
    await asset('battery', { name: 'Ronin battery', group: 'kit', type: 'BAT', condition: 'good' });
    await asset('camA', { name: 'Camera A', group: 'kit', type: 'CAM', condition: 'good' });
    await asset('camB', { name: 'Camera B', group: 'kit', type: 'CAM', condition: 'good' });
    await asset('tape', { name: 'Gaffer tape', group: 'consumable', type: 'TAP', unit: 'roll', quantity: 10, reorderLevel: 3 });
  });

  afterAll(async () => {
    const assets = await prisma.asset.findMany({ where: { name: { contains: RUN } }, select: { id: true } });
    const assetIds = assets.map((a) => a.id);
    const employeeIds = Object.values(people);
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.asset.updateMany({ where: { id: { in: assetIds } }, data: { parentAssetId: null } });
    await prisma.asset.updateMany({ where: { id: { in: assetIds }, status: 'custody' }, data: { status: 'available', holderId: null, custodyId: null } });
    const records = await prisma.custodyRecord.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
    await prisma.custodyFile.deleteMany({ where: { custodyId: { in: records.map((r) => r.id) } } });
    await prisma.assetMaintenance.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.custodyItem.deleteMany({ where: { custodyId: { in: records.map((r) => r.id) } } });
    await prisma.custodyRecord.deleteMany({ where: { id: { in: records.map((r) => r.id) } } });
    await prisma.assetDraft.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.assetKit.deleteMany({ where: { name: { contains: RUN } } });
    // the code counters this file used, back as they were when no asset or record of theirs is left (assets.e2e-spec.ts
    // expects the codes to start at 0001 in a run, whichever file runs first)
    for (const prefix of ['IT-LAP-', 'PK-GMB-', 'PK-ACC-', 'PK-BAT-', 'PK-CAM-', 'CS-TAP-']) {
      if (!(await prisma.asset.count({ where: { code: { startsWith: prefix } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix } });
    }
    if (!(await prisma.assetKit.count())) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-KIT-' } });
    if (!(await prisma.custodyRecord.count())) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'CUS-' } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await app.close();
  });

  // ---------- the checklist ----------

  it('a custodian keeps an asset’s accessories’ checklist; a viewer reads it; a consumable has none', async () => {
    const items = [{ name: '  Charger ', serial: 'CH-1' }, { name: 'USB-C cable', quantity: 2 }];
    const saved = (await put('custodian', `/assets/${codes.laptop}/accessories`, { items }).expect(200)).body as AssetView;
    expect(saved.accessories).toEqual([
      { id: expect.any(String), name: 'Charger', quantity: 1, serial: 'CH-1', notes: null },
      { id: expect.any(String), name: 'USB-C cable', quantity: 2, serial: null, notes: null },
    ]);
    expect((await view('viewer', 'laptop')).accessories).toHaveLength(2);
    await put('viewer', `/assets/${codes.laptop}/accessories`, { items }).expect(403);
    expect((await put('custodian', `/assets/${codes.tape}/accessories`, { items }).expect(400)).body.message).toEqual(['A consumable has no accessories: it is kept by quantity.']);
    expect((await put('custodian', `/assets/${codes.laptop}/accessories`, { items: [{ name: 'Cable' }, { name: 'cable' }] }).expect(400)).body.message).toEqual([
      'Accessory 2 (cable): accessory 1 is the same. Count them in one line.',
    ]);
    // the Edit form doesn't change them
    expect((await patch('custodian', `/assets/${codes.laptop}`, { accessories: [] }).expect(400)).body.message).toEqual(['Change its accessories and what it is attached to on the asset’s page.']);
    const [entry] = await audits('laptop', 'accessories');
    expect(entry).toMatchObject({ userId: users.custodian, diff: { code: codes.laptop, accessories: { from: null, to: 'Charger (CH-1), 2 × USB-C cable' } } });
  });

  // ---------- attached assets ----------

  it('attaches valuable accessories to a main asset, one level only, and detaches them', async () => {
    const plate = (await patch('custodian', `/assets/${codes.plate}/parent`, { parentCode: codes.gimbal.toLowerCase() }).expect(200)).body as AssetView;
    expect(plate.parent).toEqual({ id: expect.any(String), code: codes.gimbal, name: `DJI Ronin ${RUN}` });
    await patch('custodian', `/assets/${codes.battery}/parent`, { parentCode: codes.gimbal }).expect(200);
    const gimbal = await view('viewer', 'gimbal');
    expect(gimbal.attached?.map((a) => a.code)).toEqual([codes.battery, codes.plate].sort());

    expect((await patch('custodian', `/assets/${codes.gimbal}/parent`, { parentCode: codes.camA }).expect(409)).body.message).toBe(
      `${codes.gimbal} has assets attached to it: it can’t be attached to another (one level only).`,
    );
    expect((await patch('custodian', `/assets/${codes.camA}/parent`, { parentCode: codes.plate }).expect(409)).body.message).toBe(
      `${codes.plate} is itself attached to another asset: attach to that one instead (one level only).`,
    );
    expect((await patch('custodian', `/assets/${codes.camA}/parent`, { parentCode: codes.camA }).expect(409)).body.message).toBe('An asset can’t be attached to itself.');
    expect((await patch('custodian', `/assets/${codes.tape}/parent`, { parentCode: codes.gimbal }).expect(409)).body.message).toContain('is a consumable');
    expect((await patch('custodian', `/assets/${codes.camA}/parent`, { parentCode: 'PK-GMB-9999' }).expect(400)).body.message).toEqual(['No asset has the code PK-GMB-9999: check the main asset’s code.']);
    await patch('viewer', `/assets/${codes.camA}/parent`, { parentCode: codes.gimbal }).expect(403);

    // a list row says what it is attached to
    const rows = (await get('viewer', `/assets?q=${encodeURIComponent(`Ronin plate ${RUN}`)}`).expect(200)).body.items as AssetView[];
    expect(rows[0].parent?.code).toBe(codes.gimbal);

    // detached, then attached again; both assets' audit logs say so
    expect(((await patch('custodian', `/assets/${codes.battery}/parent`, { parentCode: null }).expect(200)).body as AssetView).parent).toBeNull();
    expect((await patch('custodian', `/assets/${codes.battery}/parent`, { parentCode: null }).expect(409)).body.message).toBe(`${codes.battery} isn’t attached to another asset.`);
    await patch('custodian', `/assets/${codes.battery}/parent`, { parentCode: codes.gimbal }).expect(200);
    expect((await audits('battery', 'detach'))[0].diff).toMatchObject({ code: codes.battery, attachedTo: { from: codes.gimbal, to: null } });
    expect((await audits('gimbal', 'attach')).map((e) => (e.diff as { attached: string }).attached)).toEqual([codes.plate, codes.battery, codes.battery]);
  });

  it('Add takes the accessories and the main asset at once', async () => {
    const made = await asset('monitor', {
      name: 'Ronin monitor',
      group: 'kit',
      type: 'MON',
      parentCode: codes.gimbal,
      accessories: [{ name: 'Sun hood' }, { name: 'Mount', quantity: 2 }],
    });
    expect(made.parent?.code).toBe(codes.gimbal);
    expect(made.accessories?.map((a) => `${a.quantity} ${a.name}`)).toEqual(['1 Sun hood', '2 Mount']);
    expect((await post('custodian', '/assets', { name: `Nested ${RUN}`, group: 'kit', type: 'ACC', parentCode: codes.plate }).expect(400)).body.message).toContain(
      `${codes.plate} is itself attached to another asset: attach to that one instead (one level only).`,
    );
  });

  // ---------- handover and return ----------

  let gimbalRecord: CustodyRecordView;
  let laptopRecord: CustodyRecordView;

  it('handing a main asset over takes its available attached assets with it, and skips the others saying why', async () => {
    await post('custodian', `/assets/${codes.battery}/repair`, { vendor: 'Battery Lab' }).expect(200);
    const choices = (await get('custodian', '/assets/custody/choices').expect(200)).body as HandoverChoices;
    const offered = choices.assets.find((a) => a.code === codes.gimbal)!;
    expect(offered.attached?.map((a) => [a.code, a.why])).toEqual(
      [
        [codes.battery, 'Under repair'],
        [codes.monitor, null],
        [codes.plate, null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(choices.assets.find((a) => a.code === codes.plate)?.parent).toEqual({ code: codes.gimbal, name: `DJI Ronin ${RUN}` });

    const res = (await post('custodian', '/assets/custody', { employeeId: people.mona, kind: 'shoot', dueDate: TOMORROW, items: [{ assetId: await idOf('gimbal') }] }).expect(201)).body as HandoverResult;
    gimbalRecord = res.record;
    expect(res.record.items.map((i) => i.asset.code).sort()).toEqual([codes.gimbal, codes.monitor, codes.plate].sort());
    expect(res.skipped).toEqual([{ code: codes.battery, name: `Ronin battery ${RUN}`, why: 'Under repair' }]);
    // the monitor's own checklist went with it
    expect(res.record.items.find((i) => i.asset.code === codes.monitor)?.accessoriesOut).toEqual([
      { name: 'Sun hood', quantity: 1, serial: null },
      { name: 'Mount', quantity: 2, serial: null },
    ]);
  });

  it('the checklist goes out as a snapshot, all of it unless some stays behind', async () => {
    const laptop = await view('custodian', 'laptop');
    const cable = laptop.accessories!.find((a) => a.name === 'USB-C cable')!;
    const charger = laptop.accessories!.find((a) => a.name === 'Charger')!;
    const res = (await post('custodian', '/assets/custody', { employeeId: people.mona, kind: 'assignment', items: [{ assetId: laptop.id, accessoryIds: [charger.id] }] }).expect(201))
      .body as HandoverResult;
    laptopRecord = res.record;
    expect(res.record.items[0].accessoriesOut).toEqual([{ name: 'Charger', quantity: 1, serial: 'CH-1' }]);
    expect(res.record.items[0].accessoriesMissing).toBeNull();
    // the checklist changing later never changes the record
    await put('custodian', `/assets/${codes.laptop}/accessories`, { items: [{ name: 'Charger', serial: 'CH-2' }, { name: cable.name, quantity: cable.quantity }] }).expect(200);
    expect(((await get('custodian', `/assets/custody/${laptopRecord.code}`).expect(200)).body as CustodyRecordView).items[0].accessoriesOut).toEqual([
      { name: 'Charger', quantity: 1, serial: 'CH-1' },
    ]);
    const holdings = (await get('custodian', `/assets/custody/people/${people.mona}`).expect(200)).body as HoldingsView;
    expect(holdings.current.find((h) => h.asset.code === codes.laptop)?.accessoriesOut).toEqual([{ name: 'Charger', quantity: 1, serial: 'CH-1' }]);
  });

  it('back without its charger: noted on the return, on the person’s record, and HR may make it a deduction', async () => {
    const item = laptopRecord.items[0];
    expect((await post('custodian', `/assets/custody/${laptopRecord.code}/return`, { lines: [{ itemId: item.id, condition: 'good', accessoriesBack: [2] }] }).expect(400)).body.message).toEqual([
      `${codes.laptop}: Charger (CH-1): say how many came back, from 0 to 1.`,
    ]);
    const back = (await post('custodian', `/assets/custody/${laptopRecord.code}/return`, { lines: [{ itemId: item.id, condition: 'good', accessoriesBack: [0] }] }).expect(200))
      .body as CustodyRecordView;
    expect(back.items[0]).toMatchObject({ returnCondition: 'good', accessoriesMissing: [{ name: 'Charger', quantity: 1, serial: 'CH-1' }] });
    expect(back.returns[0].items[0].missingAccessories).toEqual([{ name: 'Charger', quantity: 1, serial: 'CH-1' }]);

    const holdings = (await get('hr', `/assets/custody/people/${people.mona}`).expect(200)).body as HoldingsView;
    expect(holdings.incidents.find((i) => i.itemId === item.id)).toMatchObject({ condition: 'good', missingAccessories: [{ name: 'Charger', quantity: 1, serial: 'CH-1' }], deductions: [] });
    expect(holdings.can.deduction).toBe(true);
    expect(((await get('hr', `/assets/custody/${laptopRecord.code}`).expect(200)).body as CustodyRecordView).can.deduction).toBe(true);

    const body = { employeeId: people.mona, month: NEXT_MONTH, kind: 'deduction', type: 'damage_loss', amount: 350, reason: `Loss: Charger of ${codes.laptop} on ${laptopRecord.code}`, custodyItemId: item.id };
    const made = (await post('hr', '/payroll/adjustments', body).expect(201)).body as { custody: unknown };
    expect(made).toMatchObject({ custody: { itemId: item.id, recordCode: laptopRecord.code, assetCode: codes.laptop } });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset', entityId: await idOf('laptop'), action: 'receive_back' } });
    expect(entry.diff).toMatchObject({ condition: 'good', missingAccessories: 'Charger (CH-1)' });
  });

  it('an item missing has its accessories missing with it; all back leaves an empty list', async () => {
    const plateItem = gimbalRecord.items.find((i) => i.asset.code === codes.plate)!;
    const monitorItem = gimbalRecord.items.find((i) => i.asset.code === codes.monitor)!;
    const gimbalItem = gimbalRecord.items.find((i) => i.asset.code === codes.gimbal)!;
    const back = (
      await post('custodian', `/assets/custody/${gimbalRecord.code}/return`, {
        lines: [
          { itemId: monitorItem.id, condition: 'missing' },
          { itemId: plateItem.id, condition: 'good' },
          { itemId: gimbalItem.id, condition: 'good' },
        ],
      }).expect(200)
    ).body as CustodyRecordView;
    expect(back.items.find((i) => i.id === monitorItem.id)?.accessoriesMissing).toEqual([
      { name: 'Sun hood', quantity: 1, serial: null },
      { name: 'Mount', quantity: 2, serial: null },
    ]);
    expect(back.items.find((i) => i.id === plateItem.id)?.accessoriesMissing).toBeNull(); // nothing went with it
    expect(back.status).toBe('closed');
    // the monitor is lost; found again for the later steps
    await post('custodian', `/assets/${codes.monitor}/found`, {}).expect(200);
  });

  // ---------- kits ----------

  it('a kit is filled from codes (production kit assets only) and stands Available, Partly out or Out', async () => {
    const kit = (await post('custodian', '/assets/kits', { name: `Interview kit ${RUN}` }).expect(201)).body as AssetKitView;
    expect(kit).toMatchObject({ assets: 0, items: [], status: 'empty' });
    expect((await patch('custodian', `/assets/kits/${kit.id}/items`, { addCodes: [codes.camA, codes.laptop] }).expect(400)).body.message).toEqual([
      `${codes.laptop} isn’t a production kit asset: only those go in a kit.`,
    ]);
    await patch('viewer', `/assets/kits/${kit.id}/items`, { addCodes: [codes.camA] }).expect(403);
    const filled = (await patch('custodian', `/assets/kits/${kit.id}/items`, { addCodes: [codes.camA.toLowerCase(), codes.camB] }).expect(200)).body as AssetKitView;
    expect(filled).toMatchObject({ assets: 2, status: 'available' });
    expect(filled.items?.map((i) => i.code)).toEqual([codes.camA, codes.camB]);

    await post('custodian', '/assets/custody', { employeeId: people.mona, kind: 'shoot', dueDate: TOMORROW, items: [{ assetId: await idOf('camA') }] }).expect(201);
    const listed = ((await get('viewer', '/assets/kits').expect(200)).body as AssetKitView[]).find((k) => k.id === kit.id)!;
    expect(listed.status).toBe('partly_out');
    expect(listed.items?.find((i) => i.code === codes.camA)?.holder).toBe(`Mona Holder ${RUN}`);

    const out = (await patch('custodian', `/assets/kits/${kit.id}/items`, { remove: [await idOf('camB')] }).expect(200)).body as AssetKitView;
    expect(out).toMatchObject({ assets: 1, status: 'out' });
    expect((await patch('custodian', `/assets/kits/${kit.id}/items`, { remove: [await idOf('camB')] }).expect(400)).body.message).toEqual([`${codes.camB} isn’t in ${kit.code}.`]);
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'asset_kit', entityId: kit.id, action: 'items' }, orderBy: { at: 'asc' } });
    expect(entries.map((e) => e.diff)).toEqual([
      { code: kit.code, added: [codes.camA, codes.camB] },
      { code: kit.code, removed: [codes.camB] },
    ]);
    // camB goes back in for the disposal below
    await patch('custodian', `/assets/kits/${kit.id}/items`, { add: [await idOf('camB')] }).expect(200);
  });

  // ---------- stock ----------

  it('a consumable is used and restocked, never below 0, each move kept', async () => {
    let tape = (await post('custodian', `/assets/${codes.tape}/stock`, { kind: 'use', amount: 8, note: 'Shoot' }).expect(200)).body as AssetView;
    expect(tape).toMatchObject({ quantity: 2, reorder: true });
    expect((await post('custodian', `/assets/${codes.tape}/stock`, { kind: 'use', amount: 3 }).expect(400)).body.message).toEqual(['Only 2 roll in stock: use at most that.']);
    tape = (await post('custodian', `/assets/${codes.tape}/stock`, { kind: 'restock', amount: 12.5 }).expect(200)).body as AssetView;
    expect(tape).toMatchObject({ quantity: 14.5, reorder: false });
    await post('viewer', `/assets/${codes.tape}/stock`, { kind: 'restock', amount: 1 }).expect(403);
    expect((await post('custodian', `/assets/${codes.camA}/stock`, { kind: 'restock', amount: 1 }).expect(409)).body.message).toBe(`${codes.camA} isn’t a consumable: only consumables are kept by quantity.`);
    // the Edit form's quantity is kept as a move too
    await patch('custodian', `/assets/${codes.tape}`, { quantity: 15 }).expect(200);
    const history = (await get('viewer', `/assets/${codes.tape}/history`).expect(200)).body as AssetHistoryView;
    expect(history.stockMoves?.map((m) => [m.delta, m.quantityAfter, m.note])).toEqual([
      [0.5, 15, 'Quantity changed on the Edit form'],
      [12.5, 14.5, null],
      [-8, 2, 'Shoot'],
    ]);
    expect(history.stockMoves?.[2].by?.name).toBe(`Kareem Custodian ${RUN}`);
    expect((await audits('tape', 'use'))[0].diff).toMatchObject({ code: codes.tape, amount: 8, quantity: { from: 10, to: 2 }, note: 'Shoot' });
  });

  // ---------- the maintenance log and repairs ----------

  it('a maintenance entry by hand; its cost only from those who see the values', async () => {
    await post('custodian', `/assets/${codes.camB}/maintenance`, { kind: 'service', vendor: 'Camera Clinic', cost: 900 }).expect(403);
    await post('custodian', `/assets/${codes.camB}/maintenance`, { kind: 'service', vendor: 'Camera Clinic', notes: 'Sensor clean' }).expect(200);
    await post('superAdmin', `/assets/${codes.camB}/maintenance`, { kind: 'inspection', on: TODAY, vendor: 'Sony', cost: 900 }).expect(200);
    expect((await post('custodian', `/assets/${codes.camB}/maintenance`, { kind: 'service' }).expect(400)).body.message).toEqual(['Say who did it or what was done.']);
    expect((await post('custodian', `/assets/${codes.camB}/maintenance`, { kind: 'service', vendor: 'X', on: TOMORROW }).expect(400)).body.message).toEqual(['The date can’t be in the future.']);
    await post('viewer', `/assets/${codes.camB}/maintenance`, { kind: 'service', vendor: 'X' }).expect(403);
    const forCustodian = (await get('custodian', `/assets/${codes.camB}/history`).expect(200)).body as AssetHistoryView;
    expect(forCustodian.maintenance.map((m) => m.kind)).toEqual(expect.arrayContaining(['service', 'inspection']));
    expect(JSON.stringify(forCustodian.maintenance)).not.toContain('"cost"');
    const forSuper = (await get('superAdmin', `/assets/${codes.camB}/history`).expect(200)).body as AssetHistoryView;
    expect(forSuper.maintenance.find((m) => m.kind === 'inspection')?.cost).toBe(900);
    expect((await audits('camB', 'maintenance')).map((e) => e.diff)).toEqual([
      expect.objectContaining({ kind: 'service', vendor: 'Camera Clinic', notes: 'Sensor clean' }),
      expect.objectContaining({ kind: 'inspection', cost: 'set' }),
    ]);
  });

  it('back from repair in the condition chosen', async () => {
    const back = (await post('custodian', `/assets/${codes.battery}/repair/back`, { condition: 'used', notes: 'Cells replaced' }).expect(200)).body as AssetView;
    expect(back).toMatchObject({ status: 'available', condition: 'used' });
    expect((await post('custodian', `/assets/${codes.camB}/repair`, { condition: 'good' }).expect(400)).body.message).toEqual(['Only Back from repair sets the condition it comes back in.']);
  });

  // ---------- disposal ----------

  it('an Assets manager disposes of an asset: it leaves its kit and its attached assets, its book value kept', async () => {
    await patch('superAdmin', `/assets/${codes.gimbal}/values`, { purchasePrice: 50000 }).expect(200);
    await patch('custodian', `/assets/${codes.gimbal}`, { purchaseDate: '2025-01-01' }).expect(200);
    await post('custodian', `/assets/${codes.gimbal}/dispose`, { method: 'sold', approvedBy: 'The CEO' }).expect(403);
    await post('manager', `/assets/${codes.gimbal}/dispose`, { method: 'sold', approvedBy: 'The CEO', amount: 30000 }).expect(403); // the amount is a value
    expect((await post('manager', `/assets/${codes.camA}/dispose`, { method: 'scrapped', approvedBy: 'The CEO' }).expect(409)).body.message).toBe(
      `${codes.camA} is in custody: receive it back first, then dispose of it.`,
    );
    expect((await post('manager', `/assets/${codes.tape}/dispose`, { method: 'scrapped', approvedBy: 'The CEO' }).expect(409)).body.message).toBe(
      `${codes.tape} is a consumable: it is used up through Stock, not disposed of.`,
    );
    expect((await post('manager', `/assets/${codes.gimbal}/dispose`, { method: 'sold', approvedBy: ' ' }).expect(400)).body.message).toEqual(['Say who approved the disposal.']);

    const res = (await post('manager', `/assets/${codes.gimbal}/dispose`, { method: 'sold', approvedBy: 'The CEO', notes: 'Upgraded' }).expect(200)).body as {
      asset: AssetView;
      result: DisposalResult;
    };
    expect(res.result).toEqual({ leftKit: null, detached: [codes.battery, codes.monitor, codes.plate].sort(), detachedFrom: null });
    expect(res.asset).toMatchObject({ status: 'disposed', attached: [], disposal: { method: 'sold', on: TODAY, approvedBy: 'The CEO', notes: 'Upgraded' } });
    expect(res.asset.disposal).not.toHaveProperty('bookValue'); // a value: not for an Assets manager
    expect((await view('viewer', 'plate')).parent).toBeNull();
    expect((await post('manager', `/assets/${codes.gimbal}/dispose`, { method: 'sold', approvedBy: 'The CEO' }).expect(409)).body.message).toBe(`${codes.gimbal} is disposed already.`);
    expect((await patch('custodian', `/assets/${codes.plate}/parent`, { parentCode: codes.gimbal }).expect(409)).body.message).toBe(`${codes.gimbal} is disposed: nothing can be attached to it.`);

    // the amount received, set later by Finance; the book value on the day for those who see the values
    await patch('manager', `/assets/${codes.gimbal}/disposal`, { amount: 30000 }).expect(403);
    const priced = (await patch('finance', `/assets/${codes.gimbal}/disposal`, { amount: 30000 }).expect(200)).body as AssetView;
    expect(priced.disposal).toMatchObject({ amount: 30000, bookValue: expect.any(Number) });

    // a kit asset leaves its kit
    const kit = ((await get('viewer', '/assets/kits').expect(200)).body as AssetKitView[]).find((k) => k.name === `Interview kit ${RUN}`)!;
    const camB = (await post('superAdmin', `/assets/${codes.camB}/dispose`, { method: 'written_off', approvedBy: 'Finance', amount: 0 }).expect(200)).body as { result: DisposalResult };
    expect(camB.result.leftKit).toBe(kit.code);
    expect(((await get('viewer', '/assets/kits').expect(200)).body as AssetKitView[]).find((k) => k.id === kit.id)?.items?.map((i) => i.code)).toEqual([codes.camA]);

    // out of the register unless asked for
    const listed = (await get('viewer', `/assets?q=${RUN}`).expect(200)).body.items as AssetView[];
    expect(listed.map((a) => a.code)).not.toContain(codes.gimbal);
    expect(((await get('viewer', `/assets?q=${RUN}&status=disposed`).expect(200)).body.items as AssetView[]).map((a) => a.code).sort()).toEqual([codes.camB, codes.gimbal].sort());

    const [entry] = await audits('gimbal', 'dispose');
    expect(entry.diff).toMatchObject({ code: codes.gimbal, status: { from: 'available', to: 'disposed' }, disposalMethod: 'sold', disposalApprovedBy: 'The CEO', detached: expect.any(Array) });
    expect(JSON.stringify(entry.diff)).not.toContain('30000');
  });

  // ---------- drafts from Claude ----------

  it('a draft keeps its accessories and main asset until it is confirmed', async () => {
    const draft = (await post('custodian', '/assets/drafts', {
      name: `Ronin cage ${RUN}`,
      group: 'kit',
      type: 'ACC',
      accessories: [{ name: 'Hex key' }],
      parentCode: codes.camA,
    }).expect(201)).body as AssetDraftView;
    expect(draft.accessories).toEqual([{ name: 'Hex key', quantity: 1, serial: null, notes: null }]);
    expect(draft.attachTo).toEqual({ code: codes.camA, name: `Camera A ${RUN}` });
    expect((await post('custodian', '/assets/drafts', { name: `Bad ${RUN}`, group: 'kit', type: 'ACC', parentCode: codes.gimbal }).expect(400)).body.message).toContain(
      `${codes.gimbal} is disposed: nothing can be attached to it.`,
    );
    const changed = (await patch('custodian', `/assets/drafts/${draft.id}`, { parentCode: null, accessories: [{ name: 'Hex key' }, { name: 'Screws', quantity: 4 }] }).expect(200))
      .body as AssetDraftView;
    expect(changed.attachTo).toBeNull();
    expect(changed.accessories).toHaveLength(2);
    const confirmed = (await post('custodian', `/assets/drafts/${draft.id}/confirm`, {
      name: `Ronin cage ${RUN}`,
      group: 'kit',
      type: 'ACC',
      accessories: changed.accessories,
      parentCode: codes.plate,
    }).expect(201)).body as AssetView;
    codes.cage = confirmed.code;
    expect(confirmed.parent?.code).toBe(codes.plate);
    expect(confirmed.accessories?.map((a) => a.name)).toEqual(['Hex key', 'Screws']);
  });
});
