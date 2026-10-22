import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { AssetCountSheetView, AssetCountsView, AssetCountView, AssetDashboardView, AssetLabelChoice, AssetView, Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Assets step 5 (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard, exports) …
// work on this"; packages/shared asset-counts.ts). A store room with four cameras (three in a kit), a laptop and a roll
// of tape is counted: the camera handed to Mona and the laptop handed to Clara (C-level, her name left out for those who
// don't see her) are out, what was ticked found, the rest missing; a lost camera ticked is available again; a missing
// one is marked lost on its own, once; a code from elsewhere or not a code is refused; the kit and the IT group are
// counted too, and the group's next count moves on. The dashboard's figures, its values only for the CEO, Finance and a
// Super Admin; the exports, their money columns the same; the label sheets' choices and the labels marked printed; the
// levels (a viewer reads, a custodian counts and marks); the audit log. Every name is invented; the test deletes what it
// made.

const RUN = `s5${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const TOMORROW = addDays(TODAY, 1);

describe('Assets step 5: counts, dashboard, exports, labels (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const people: Record<string, string> = {};
  const codes: Record<string, string> = {};
  let roomId: string;
  let emptyRoomId: string;
  let kit: { id: string; code: string; name: string };

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);

  async function account(key: string, roles: Role[], access?: string) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    if (access) await patch('admin', `/users/${users[key]}`, { assetsAccess: access }).expect(200);
    return email;
  }

  async function employee(key: string, name: string, options: { email?: string; gradeId?: string } = {}) {
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: options.email?.toLowerCase() ?? null,
        employments: { create: { employmentType: 'full_time', joinDate: new Date('2024-01-01'), gradeId: options.gradeId ?? null } },
      },
    });
    people[key] = e.id;
  }

  async function asset(key: string, body: object, purchasePrice: number | null = null) {
    const made = (await post('custodian', '/assets', { roomId, ...body }).expect(201)).body as AssetView;
    if (purchasePrice !== null) await patch('superAdmin', `/assets/${made.code}/values`, { purchasePrice, marketValue: purchasePrice }).expect(200);
    codes[key] = made.code;
    return made;
  }
  const assetId = async (key: string) => (await prisma.asset.findUniqueOrThrow({ where: { code: codes[key] }, select: { id: true } })).id;
  const status = async (key: string) => (await prisma.asset.findUniqueOrThrow({ where: { code: codes[key] }, select: { status: true } })).status;
  const camera = (name: string, inKit = false) => ({ name: `${name} ${RUN}`, group: 'kit', type: 'CAM', brand: 'Sony', condition: 'good', ...(inKit && { kitId: kit.id }) });
  const count = (as: string, body: object) => post(as, '/assets/counts', body);
  const sheetHeaders = async (data: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    return { headers: (ws.getRow(1).values as unknown[]).slice(1).map(String), rows: ws.rowCount - 1, name: ws.name, ws };
  };
  const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  const download = (as: string, kind: string) => api().get(`/api/assets/exports/${kind}`).set('Cookie', sessions[as]).buffer(true).parse(binary);

  let roomCount: AssetCountView;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    const custodianEmail = await account('custodian', ['employee'], 'custodian');
    await account('manager', ['employee'], 'manager');
    await account('viewer', ['employee'], 'viewer');
    await account('none', ['employee']);
    await account('finance', ['finance']);
    const monaEmail = await account('mona', ['employee']);
    const claraEmail = await account('clara', ['employee']);
    const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    await employee('kareem', 'Kareem Custodian', { email: custodianEmail });
    await employee('mona', 'Mona Holder', { email: monaEmail });
    await employee('clara', 'Clara Chief', { email: claraEmail, gradeId: g9 });
    roomId = ((await post('manager', '/assets/rooms', { name: `Store ${RUN}` }).expect(201)).body as { id: string }).id;
    emptyRoomId = ((await post('manager', '/assets/rooms', { name: `Empty ${RUN}` }).expect(201)).body as { id: string }).id;
    kit = (await post('custodian', '/assets/kits', { name: `Count kit ${RUN}` }).expect(201)).body as { id: string; code: string; name: string };
    await asset('camA', camera('Camera A', true), 30000);
    await asset('camB', camera('Camera B', true));
    await asset('camC', camera('Camera C', true));
    await asset('camD', camera('Camera D'));
    await asset('lap', { name: `Laptop ${RUN}`, group: 'it', type: 'LAP', brand: 'Dell', condition: 'good' }, 50000);
    await asset('tape', { name: `Gaffer tape ${RUN}`, group: 'consumable', type: 'TAP', unit: 'roll', quantity: 10 });
    // camera B to Mona for a shoot (by the custodian); the laptop to Clara (C-level: only a Super Admin hands it to her)
    await post('custodian', '/assets/custody', { employeeId: people.mona, kind: 'shoot', dueDate: TOMORROW, purpose: `Shoot ${RUN}`, items: [{ assetId: await assetId('camB') }] }).expect(201);
    await post('superAdmin', '/assets/custody', { employeeId: people.clara, kind: 'assignment', purpose: `Laptop ${RUN}`, items: [{ assetId: await assetId('lap') }] }).expect(201);
  });

  afterAll(async () => {
    const assets = await prisma.asset.findMany({ where: { name: { contains: RUN } }, select: { id: true } });
    const assetIds = assets.map((a) => a.id);
    const employeeIds = Object.values(people);
    await prisma.assetCount.deleteMany({ where: { countedById: { in: Object.values(users) } } });
    await prisma.asset.updateMany({ where: { id: { in: assetIds } }, data: { status: 'available', holderId: null, custodyId: null } });
    const records = await prisma.custodyRecord.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
    await prisma.assetMaintenance.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.custodyItem.deleteMany({ where: { custodyId: { in: records.map((r) => r.id) } } });
    await prisma.custodyRecord.deleteMany({ where: { id: { in: records.map((r) => r.id) } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.assetKit.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.assetRoom.deleteMany({ where: { name: { contains: RUN } } });
    // the code counters, back as they were when no asset or record of theirs is left (assets.e2e-spec.ts expects the codes
    // to start at 0001 in a run), as custody.e2e-spec.ts does
    for (const prefix of ['PK-CAM-', 'IT-LAP-', 'CS-TAP-']) {
      if (!(await prisma.asset.count({ where: { code: { startsWith: prefix } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix } });
    }
    if (!(await prisma.assetKit.count())) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-KIT-' } });
    if (!(await prisma.custodyRecord.count())) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'CUS-' } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await app.close();
  });

  // ---------- who may ----------

  it('without Assets access, none of it; a viewer reads but doesn’t count or mark labels', async () => {
    for (const path of ['/assets/counts', '/assets/dashboard', '/assets/exports/register', '/assets/labels', `/assets/counts/sheet?kind=room&roomId=${roomId}`]) {
      await get('none', path).expect(403);
    }
    await get('viewer', `/assets/counts/sheet?kind=room&roomId=${roomId}`).expect(200);
    await count('viewer', { kind: 'room', roomId, found: [] }).expect(403);
    await post('viewer', '/assets/labels/labelled', { codes: [codes.camA] }).expect(403);
  });

  // ---------- counts ----------

  it('a room\'s sheet lists what it has by code, with who holds those out (a C-level holder\'s name only for those who see them)', async () => {
    const sheet = (await get('custodian', `/assets/counts/sheet?kind=room&roomId=${roomId}`).expect(200)).body as AssetCountSheetView;
    expect(sheet.scope).toMatchObject({ kind: 'room', room: { id: roomId, name: `Store ${RUN}` }, label: `Store ${RUN}` });
    expect(sheet.items.map((i) => i.code)).toEqual([codes.camA, codes.camB, codes.camC, codes.camD, codes.tape, codes.lap].sort());
    expect(sheet.items.find((i) => i.code === codes.camB)).toMatchObject({ status: 'custody', holder: { id: people.mona } });
    expect(sheet.items.find((i) => i.code === codes.lap)).toMatchObject({ status: 'custody', holder: null });
    const asAdmin = (await get('superAdmin', `/assets/counts/sheet?kind=room&roomId=${roomId}`).expect(200)).body as AssetCountSheetView;
    expect(asAdmin.items.find((i) => i.code === codes.lap)?.holder).toMatchObject({ id: people.clara });
    // the scope in words
    expect((await get('custodian', '/assets/counts/sheet?kind=room').expect(400)).body.message).toEqual(['Choose the room to count.']);
    await get('custodian', '/assets/counts/sheet?kind=room&roomId=00000000-0000-4000-8000-000000000000').expect(404);
    await get('custodian', '/assets/counts/sheet?kind=shelf').expect(400);
  });

  it('a count saves each asset\'s result: out in custody, found when ticked, missing else; a lost one found is available again', async () => {
    await post('custodian', `/assets/${codes.camC}/lost`, { notes: 'Not seen since Monday' }).expect(200);
    expect(await status('camC')).toBe('lost');

    // refused: a code from elsewhere, text that isn't a code, a room with nothing to count
    expect((await count('custodian', { kind: 'room', roomId, found: ['IT-LAP-9999'] }).expect(400)).body.message).toEqual([
      `IT-LAP-9999 isn’t counted with Store ${RUN}: untick it, and count it where it is kept.`,
    ]);
    expect((await count('custodian', { kind: 'room', roomId, found: ['hello'] }).expect(400)).body.message).toEqual(['“hello” isn’t an asset’s code.']);
    expect((await count('custodian', { kind: 'room', roomId: emptyRoomId, found: [] }).expect(400)).body.message).toEqual([`Nothing to count: Empty ${RUN} has no assets.`]);

    // ticked by code, by the label's address, by the camera in custody (out whatever is ticked); the laptop not ticked
    const res = await count('custodian', {
      kind: 'room',
      roomId,
      found: [codes.camA.toLowerCase(), `https://people.trendlix.com/assets/${codes.camC}`, codes.tape, codes.camB],
      notes: 'Quarterly check',
    }).expect(201);
    roomCount = res.body as AssetCountView;
    expect(roomCount).toMatchObject({ expected: 6, found: 3, missing: 1, out: 2, lostMarked: 0, notes: 'Quarterly check', foundAgain: [codes.camC] });
    expect(roomCount.scope).toMatchObject({ kind: 'room', label: `Store ${RUN}` });
    expect(roomCount.countedBy).toMatchObject({ name: `Kareem Custodian ${RUN}` });
    expect(roomCount.lines.map((l) => [l.asset.code, l.result])).toEqual([
      [codes.camD, 'missing'],
      ...[codes.camB, codes.lap].sort().map((c) => [c, 'out']),
      ...[codes.camA, codes.camC, codes.tape].sort().map((c) => [c, 'found']),
    ]);
    expect(roomCount.lines.find((l) => l.asset.code === codes.camD)?.canMarkLost).toBe(true);
    expect(roomCount.lines.filter((l) => l.canMarkLost)).toHaveLength(1);
    expect(await status('camC')).toBe('available');
    expect(await status('camD')).toBe('available'); // missing on a count isn't lost (spec §6.5)

    // a viewer reads it, without Mark lost
    const asViewer = (await get('viewer', `/assets/counts/${roomCount.id}`).expect(200)).body as AssetCountView;
    expect(asViewer.lines.some((l) => l.canMarkLost)).toBe(false);
    await get('viewer', '/assets/counts/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('Mark lost is apart, on a missing one only, once', async () => {
    const path = `/assets/counts/${roomCount.id}/lines/${codes.camD}/lost`;
    await post('viewer', path, {}).expect(403);
    await post('custodian', `/assets/counts/${roomCount.id}/lines/${codes.camA}/lost`, {}).expect(409);
    const after = (await post('custodian', path, { notes: 'Searched both stores' }).expect(200)).body as AssetCountView;
    expect(after.lostMarked).toBe(1);
    expect(after.lines.find((l) => l.asset.code === codes.camD)).toMatchObject({ result: 'missing', canMarkLost: false, lostMarkedBy: { name: `Kareem Custodian ${RUN}` } });
    expect(await status('camD')).toBe('lost');
    expect((await post('custodian', path, {}).expect(409)).body.message).toBe(`${codes.camD} was marked lost already.`);
    await post('custodian', `/assets/counts/${roomCount.id}/lines/PK-CAM-9999/lost`, {}).expect(404);
  });

  it('a kit and a group are counted too, and the group\'s next count moves on', async () => {
    const kitCount = (await count('custodian', { kind: 'kit', kitId: kit.id, found: [codes.camA, codes.camC] }).expect(201)).body as AssetCountView;
    expect(kitCount.scope).toMatchObject({ kind: 'kit', kit: { id: kit.id }, label: `${kit.code} · ${kit.name}` });
    const byCode = (a: string[], b: string[]) => a[0].localeCompare(b[0]);
    expect(kitCount.lines.map((l) => [l.asset.code, l.result]).sort(byCode)).toEqual(
      [
        [codes.camA, 'found'],
        [codes.camB, 'out'],
        [codes.camC, 'found'],
      ].sort(byCode),
    );

    const before = ((await get('viewer', '/assets/counts').expect(200)).body as AssetCountsView).schedule.find((s) => s.group === 'it')!;
    const it = (await count('manager', { kind: 'group', group: 'it', found: [] }).expect(201)).body as AssetCountView;
    expect(it.scope).toMatchObject({ kind: 'group', group: 'it', label: 'IT and devices' });
    expect(it.lines.find((l) => l.asset.code === codes.lap)?.result).toBe('out');
    const list = (await get('viewer', '/assets/counts').expect(200)).body as AssetCountsView;
    const after = list.schedule.find((s) => s.group === 'it')!;
    expect(after.neverCounted).toBe(false);
    expect(after.overdue).toBe(false);
    expect(after.lastCountedAt && (!before.lastCountedAt || after.lastCountedAt > before.lastCountedAt)).toBeTruthy();
    // the history, newest first
    expect(list.history.slice(0, 3).map((h) => h.id)).toEqual([it.id, kitCount.id, roomCount.id]);
    expect(list).toMatchObject({ page: 1, pageSize: 30 });
  });

  it('a count is in the audit log, and so is each asset it found again or marked lost', async () => {
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'asset_count', entityId: roomCount.id }, orderBy: { at: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['count', 'mark_lost']);
    expect(entries[0].diff).toMatchObject({ scope: `Store ${RUN}`, expected: 6, found: 3, missing: 1, out: 2, foundAgain: [codes.camC], notes: 'Quarterly check' });
    const onC = (await prisma.auditLog.findMany({ where: { entityType: 'asset', entityId: await assetId('camC') }, orderBy: { at: 'asc' } })).map((e) => [e.action, (e.diff as { count?: string }).count ?? null]);
    expect(onC.slice(-2)).toEqual([
      ['mark_lost', null],
      ['mark_found', `Store ${RUN}`],
    ]);
    const onD = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset', entityId: await assetId('camD'), action: 'mark_lost' } });
    expect(onD.diff).toMatchObject({ code: codes.camD, status: { from: 'available', to: 'lost' }, count: `Store ${RUN}`, notes: 'Searched both stores' });
  });

  // ---------- the dashboard ----------

  it('the dashboard counts what is out, available, under repair and lost; the values only for the CEO, Finance and a Super Admin', async () => {
    const asViewer = (await get('viewer', '/assets/dashboard').expect(200)).body as AssetDashboardView;
    expect(asViewer).not.toHaveProperty('values');
    expect(JSON.stringify(asViewer)).not.toMatch(/marketValue|bookValue|purchaseCost/);
    const t = asViewer.totals;
    expect(t.assets).toBe((await prisma.asset.count({ where: { status: { not: 'disposed' } } })));
    expect(t.available + t.custody + t.repair + t.lost).toBe(t.assets);
    expect(t.custody).toBeGreaterThanOrEqual(2);
    expect(t.lost).toBeGreaterThanOrEqual(1); // camera D
    expect(asViewer.attention.lost).toBe(t.lost);
    expect(asViewer.attention.repair).toBe(t.repair);
    // our two handovers have no signed copy: Clara's (C-level) left out for a viewer, as the Custody list leaves it out
    const unsigned = await prisma.custodyRecord.count({ where: { files: { none: {} } } });
    expect(asViewer.attention.unsigned).toBe(unsigned - 1);
    expect(((await get('superAdmin', '/assets/dashboard').expect(200)).body as AssetDashboardView).attention.unsigned).toBe(unsigned);
    expect(asViewer.byGroup.kit).toBeGreaterThanOrEqual(4);
    expect(asViewer.on).toBe(TODAY);
    expect(asViewer.unlabelled).toBeGreaterThanOrEqual(5);
    expect(['number', 'object']).toContain(typeof asViewer.attention.clearance);

    for (const who of ['finance', 'superAdmin']) {
      const d = (await get(who, '/assets/dashboard').expect(200)).body as AssetDashboardView;
      expect(d.values).toBeDefined();
      expect(d.values!.purchaseCost).toBeGreaterThanOrEqual(80000);
      expect(d.values!.marketValue).toBeGreaterThanOrEqual(80000);
      expect(d.values!.withoutCost).toBeGreaterThanOrEqual(4);
    }
  });

  // ---------- exports ----------

  it('each export is an Excel workbook; the money columns only for those who see the values; downloads audited', async () => {
    for (const kind of ['register', 'custody', 'stock', 'maintenance', 'counts']) {
      const res = await download('viewer', kind).expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain(`${TODAY}.xlsx`);
      expect(res.headers['cache-control']).toContain('no-store');
      const { headers } = await sheetHeaders(res.body as Buffer);
      expect(headers.join(' ')).not.toMatch(/EGP|Cost|Value when out/);
    }
    const viewerRegister = await sheetHeaders((await download('viewer', 'register').expect(200)).body as Buffer);
    expect(viewerRegister.name).toBe('Asset register');
    expect(viewerRegister.headers).toEqual(expect.arrayContaining(['Code', 'Name', 'Status', 'Room', 'Holder']));
    const financeRegister = await sheetHeaders((await download('finance', 'register').expect(200)).body as Buffer);
    expect(financeRegister.headers).toEqual(expect.arrayContaining(['Purchase cost (EGP)', 'Market value (EGP)', `Book value on ${TODAY} (EGP)`]));
    // Clara's name isn't in a viewer's register or custody export
    expect(JSON.stringify(viewerRegister.ws.getSheetValues())).not.toContain('Clara Chief');
    const custody = await sheetHeaders((await download('viewer', 'custody').expect(200)).body as Buffer);
    expect(JSON.stringify(custody.ws.getSheetValues())).not.toContain('Clara Chief');
    expect(JSON.stringify(custody.ws.getSheetValues())).toContain(`Mona Holder ${RUN}`);
    const superCustody = await sheetHeaders((await download('superAdmin', 'custody').expect(200)).body as Buffer);
    expect(JSON.stringify(superCustody.ws.getSheetValues())).toContain(`Clara Chief ${RUN}`);
    expect(superCustody.headers).toContain('Value when out (EGP)');
    const counts = await sheetHeaders((await download('viewer', 'counts').expect(200)).body as Buffer);
    expect(JSON.stringify(counts.ws.getSheetValues())).toContain(`Store ${RUN}`);

    await get('viewer', '/assets/exports/payroll').expect(404);
    await get('none', '/assets/exports/register').expect(403);
    const audited = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_report', userId: users.finance, action: 'asset_file' }, orderBy: { at: 'desc' } });
    expect(audited.diff).toMatchObject({ export: 'register', values: true });
  });

  // ---------- label sheets ----------

  it('the label sheets choose what isn\'t labelled yet, by room, group or kit, or exactly the codes asked; labels marked printed', async () => {
    const unlabelled = (await get('viewer', `/assets/labels?unlabelled=1&roomId=${roomId}`).expect(200)).body as AssetLabelChoice[];
    expect(unlabelled.map((c) => c.code)).toEqual([codes.camA, codes.camB, codes.camC, codes.camD, codes.tape, codes.lap].sort());
    const inKit = (await get('viewer', `/assets/labels?kitId=${kit.id}`).expect(200)).body as AssetLabelChoice[];
    expect(inKit.map((c) => c.code)).toEqual([codes.camA, codes.camB, codes.camC].sort());
    const asked = (await get('viewer', `/assets/labels?codes=${codes.camC},${codes.camA},PK-CAM-9999`).expect(200)).body as AssetLabelChoice[];
    expect(asked.map((c) => c.code)).toEqual([codes.camC, codes.camA]);
    expect(asked[0]).toMatchObject({ name: `Camera C ${RUN}`, group: 'kit', room: { id: roomId }, kit: { id: kit.id }, labeledAt: null });

    expect((await post('custodian', '/assets/labels/labelled', { codes: [codes.camA, 'PK-CAM-9999'] }).expect(400)).body.message).toEqual([
      'PK-CAM-9999 isn’t in the register, or was disposed of.',
    ]);
    const done = (await post('custodian', '/assets/labels/labelled', { codes: [codes.camA, codes.camC.toLowerCase()] }).expect(200)).body as { labelled: string[]; at: string };
    expect(done.labelled).toEqual([codes.camA, codes.camC].sort());
    const after = (await get('viewer', `/assets/labels?unlabelled=1&roomId=${roomId}`).expect(200)).body as AssetLabelChoice[];
    expect(after.map((c) => c.code)).toEqual([codes.camB, codes.camD, codes.tape, codes.lap].sort());
    expect(((await get('viewer', `/assets/${codes.camA}`).expect(200)).body as AssetView).labeledAt).toBe(done.at);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset', entityId: await assetId('camA'), action: 'label' }, orderBy: { at: 'desc' } });
    expect(entry.diff).toMatchObject({ code: codes.camA, sheet: true });
  });
});
