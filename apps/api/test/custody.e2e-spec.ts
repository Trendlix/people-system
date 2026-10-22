import type { INestApplication } from '@nestjs/common';
import {
  CUSTODY_TERMS_STANDARD,
  type AssetHistoryView,
  type AssetView,
  type CustodyListView,
  type CustodyRecordView,
  type HandoverChoices,
  type HandoverResult,
  type HolderCardView,
  type HoldingsView,
  type MyCustodyView,
  type Role,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CustodySchedulerService } from '../src/assets/custody-scheduler.service.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Assets, step 3: custody (owner, 21 October 2026: the "Asset Register" spec's custody, built the People System's way;
// "Yes, My custody"; "Record it; HR decides a deduction"). A custodian hands three cameras to Mona for a shoot: they go
// into custody under her, the record gets its CUS code, the terms and the values when they went out; consumables and
// assets not available are refused; the kit quick-add skips what is out or under repair; they come back damaged
// (under repair, with its maintenance entry), missing (lost) and good, the record partly returned then closed; the
// signed copy takes it off Not signed; a shoot past its return date is overdue, told once a day; the levels (a viewer
// reads, a custodian and up act); the values only for the CEO, Finance and a Super Admin; Clara (C-level) hidden from HR
// as everywhere; My custody only one's own; HR alone links a deduction to a damaged item; the notifications and the
// audit log. The test database is emptied at the start of each run; every name is invented; the test deletes what it made.

const RUN = `cu${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const TOMORROW = addDays(TODAY, 1);
const NEXT_MONTH = monthsLater(TODAY.slice(0, 7), 1);
const PDF = Buffer.from('%PDF-1.4\n% signed custody form\n%%EOF\n');
const VALUE_KEYS = ['valueAtOut', '"value"', '"cost"'];

describe('Custody (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: CustodySchedulerService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const people: Record<string, string> = {};
  const codes: Record<string, string> = {};
  let g9: string;

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

  /** An employee with an employment (ended on `ended`, or current), signing in with `email` when given. */
  async function employee(key: string, name: string, options: { email?: string; gradeId?: string; ended?: string } = {}) {
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: options.email?.toLowerCase() ?? null,
        employments: { create: { employmentType: 'full_time', joinDate: new Date('2024-01-01'), gradeId: options.gradeId ?? null, ...(options.ended && { endDate: new Date(options.ended), endReason: 'resigned' }) } },
      },
    });
    people[key] = e.id;
  }

  /** Registers an asset as the custodian, its market value set by a Super Admin (a value). */
  async function asset(key: string, body: object, marketValue: number | null = 40000) {
    const made = (await post('custodian', '/assets', body).expect(201)).body as AssetView;
    if (marketValue !== null) await patch('superAdmin', `/assets/${made.code}/values`, { marketValue }).expect(200);
    codes[key] = made.code;
    return made;
  }
  const assetId = async (key: string) => (await prisma.asset.findUniqueOrThrow({ where: { code: codes[key] }, select: { id: true } })).id;
  const camera = (name: string, kitId?: string) => ({ name: `${name} ${RUN}`, group: 'kit', type: 'CAM', brand: 'Sony', serial: `SER-${RUN}-${name}`, condition: 'good', ...(kitId && { kitId }) });
  const handOver = (as: string, body: object) => post(as, '/assets/custody', body);
  const record = (as: string, code: string) => get(as, `/assets/custody/${code}`);
  const notices = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: users[key], kind }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true, link: true } });

  let first: CustodyRecordView; // Mona's shoot: three cameras

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    scheduler = app.get(CustodySchedulerService);
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    const custodianEmail = await account('custodian', ['employee'], 'custodian');
    await account('manager', ['employee'], 'manager');
    await account('viewer', ['employee'], 'viewer');
    await account('none', ['employee']);
    await account('hr', ['hr'], 'custodian'); // HR with Assets custodian access: doesn't see C-level people
    await account('finance', ['finance']);
    await account('ceo', ['ceo']);
    const monaEmail = await account('mona', ['employee']);
    const claraEmail = await account('clara', ['employee']);
    g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true, confidential: true } })).id;
    expect((await prisma.grade.findUniqueOrThrow({ where: { id: g9 } })).confidential).toBe(true);
    await employee('kareem', 'Kareem Custodian', { email: custodianEmail });
    await employee('mona', 'Mona Holder', { email: monaEmail });
    await employee('clara', 'Clara Chief', { email: claraEmail, gradeId: g9 });
    await employee('fred', 'Fred Former', { ended: '2025-06-30' });
    for (const n of ['A', 'B', 'C', 'D', 'E']) await asset(`cam${n}`, camera(`Camera ${n}`));
    await asset('tape', { name: `Gaffer tape ${RUN}`, group: 'consumable', type: 'TAP', unit: 'roll', quantity: 10 }, null);
  });

  afterAll(async () => {
    const assets = await prisma.asset.findMany({ where: { name: { contains: RUN } }, select: { id: true } });
    const assetIds = assets.map((a) => a.id);
    const employeeIds = Object.values(people);
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.asset.updateMany({ where: { id: { in: assetIds } }, data: { status: 'available', holderId: null, custodyId: null } });
    const records = await prisma.custodyRecord.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
    await prisma.custodyFile.deleteMany({ where: { custodyId: { in: records.map((r) => r.id) } } });
    await prisma.assetMaintenance.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.custodyItem.deleteMany({ where: { custodyId: { in: records.map((r) => r.id) } } });
    await prisma.custodyRecord.deleteMany({ where: { id: { in: records.map((r) => r.id) } } });
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.assetKit.deleteMany({ where: { name: { contains: RUN } } });
    // the code counters this file used, back as they were when no asset or record of theirs is left (assets.e2e-spec.ts
    // expects the codes to start at 0001 in a run, whichever file runs first), as connector.e2e-spec.ts does
    for (const prefix of ['PK-CAM-', 'IT-LAP-', 'CS-TAP-']) {
      if (!(await prisma.asset.count({ where: { code: { startsWith: prefix } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix } });
    }
    if (!(await prisma.assetKit.count())) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-KIT-' } });
    if (!(await prisma.custodyRecord.count())) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'CUS-' } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.assetSettings.updateMany({ data: { custodyTerms: [] } });
    await app.close();
  });

  // ---------- handing over ----------

  it('a handover of 3 assets puts them in custody under the employee, with its CUS code, the terms and the values then', async () => {
    const choices = (await get('custodian', '/assets/custody/choices').expect(200)).body as HandoverChoices;
    expect(choices.handedOverBy).toBe(`Kareem Custodian ${RUN}`);
    expect(choices.terms).toEqual([...CUSTODY_TERMS_STANDARD]);
    const offered = choices.assets.map((a) => a.code);
    expect(offered).toEqual(expect.arrayContaining([codes.camA, codes.camB, codes.camC]));
    expect(offered).not.toContain(codes.tape); // a consumable is never offered
    expect(choices.people.map((p) => p.id)).toContain(people.mona);
    expect(choices.people.map((p) => p.id)).not.toContain(people.fred); // only current employees
    expect(choices.people.map((p) => p.id)).not.toContain(people.clara); // C-level: only for those who see them
    expect(((await get('superAdmin', '/assets/custody/choices').expect(200)).body as HandoverChoices).people.map((p) => p.id)).toContain(people.clara);

    const items = await Promise.all(['camA', 'camB', 'camC'].map(async (k) => ({ assetId: await assetId(k), accessories: k === 'camA' ? 'Charger, 2 batteries' : null })));
    const res = await handOver('custodian', { employeeId: people.mona, kind: 'shoot', dueDate: TOMORROW, purpose: `Ad shoot ${RUN}`, items }).expect(201);
    const { record: made, skipped } = res.body as HandoverResult;
    first = made;
    expect(skipped).toEqual([]);
    expect(made).toMatchObject({
      code: expect.stringMatching(/^CUS-\d{4,}$/),
      kind: 'shoot',
      status: 'open',
      dueDate: TOMORROW,
      purpose: `Ad shoot ${RUN}`,
      handedOverBy: `Kareem Custodian ${RUN}`,
      employee: { id: people.mona, fullNameEn: `Mona Holder ${RUN}` },
      terms: [...CUSTODY_TERMS_STANDARD],
      signed: false,
      overdue: false,
      can: { receive: true, attach: true, deduction: false },
    });
    expect(made.items.map((i) => i.asset.code)).toEqual([codes.camA, codes.camB, codes.camC]);
    expect(made.items.find((i) => i.asset.code === codes.camA)).toMatchObject({ conditionOut: 'good', accessories: 'Charger, 2 batteries', returnedAt: null });
    for (const k of ['camA', 'camB', 'camC']) {
      const a = (await get('viewer', `/assets/${codes[k]}`).expect(200)).body as AssetView;
      expect(a).toMatchObject({ status: 'custody', holder: { id: people.mona }, everInCustody: true });
    }
    // the market value when they went out, kept on each item; the person handing over is the custodian's profile
    const kept = await prisma.custodyRecord.findUniqueOrThrow({ where: { code: made.code }, select: { handedOverById: true, items: { select: { valueAtOut: true } } } });
    expect(kept.handedOverById).toBe(people.kareem);
    expect(kept.items.map((i) => i.valueAtOut?.toNumber())).toEqual([40000, 40000, 40000]);
  });

  it('consumables and assets that aren’t available are refused, and nothing is saved', async () => {
    const before = await prisma.custodyRecord.count();
    const consumable = await handOver('custodian', { employeeId: people.mona, kind: 'assignment', items: [{ assetId: await assetId('tape') }] }).expect(400);
    expect(consumable.body.message).toContain(`${codes.tape} is a consumable: consumables are kept by quantity, not handed over.`);
    const out = await handOver('custodian', { employeeId: people.mona, kind: 'assignment', items: [{ assetId: await assetId('camD') }, { assetId: await assetId('camA') }] }).expect(400);
    expect(out.body.message).toEqual([`${codes.camA} is in custody: only available assets are handed over.`]);
    expect((await get('viewer', `/assets/${codes.camD}`).expect(200)).body.status).toBe('available');
    // a shoot needs its return date; an assignment has none; a former employee receives nothing
    expect((await handOver('custodian', { employeeId: people.mona, kind: 'shoot', items: [{ assetId: await assetId('camD') }] }).expect(400)).body.message).toContain('A shoot needs its return date.');
    expect((await handOver('custodian', { employeeId: people.mona, kind: 'assignment', dueDate: TOMORROW, items: [{ assetId: await assetId('camD') }] }).expect(400)).body.message).toContain(
      'A long-term assignment has no return date: it comes back at clearance.',
    );
    expect((await handOver('custodian', { employeeId: people.fred, kind: 'assignment', items: [{ assetId: await assetId('camD') }] }).expect(400)).body.message).toContain(
      `Fred Former ${RUN} has no current employment: only current employees receive assets.`,
    );
    await handOver('custodian', { employeeId: people.mona, kind: 'assignment', items: [] }).expect(400);
    expect(await prisma.custodyRecord.count()).toBe(before);
  });

  it('two handovers of the same asset at once: one takes it, the other is refused; their codes never clash', async () => {
    const body = async (kind: string) => ({ employeeId: people.mona, kind, ...(kind === 'shoot' && { dueDate: TOMORROW }), items: [{ assetId: await assetId('camD') }] });
    const [one, two] = await Promise.all([handOver('custodian', await body('assignment')), handOver('manager', await body('shoot'))]);
    expect([one.status, two.status].sort((a, b) => a - b)).toEqual([201, 400]);
    const won = (one.status === 201 ? one : two).body as HandoverResult;
    codes.recordD = won.record.code;
    // the next record gets the next number
    const next = await handOver('custodian', { employeeId: people.mona, kind: 'assignment', items: [{ assetId: await assetId('camE') }] }).expect(201);
    codes.recordE = (next.body as HandoverResult).record.code;
    expect(Number(codes.recordE.slice(4))).toBeGreaterThan(Number(codes.recordD.slice(4)));
  });

  it('the kit quick-add takes a kit’s available assets and skips those out or under repair, saying why', async () => {
    const kit = (await post('custodian', '/assets/kits', { name: `Interview kit ${RUN}` }).expect(201)).body as { id: string; code: string };
    await asset('kitFree', camera('Kit camera', kit.id));
    await asset('kitOut', camera('Kit lens', kit.id));
    await asset('kitRepair', camera('Kit light', kit.id));
    await handOver('custodian', { employeeId: people.kareem, kind: 'assignment', items: [{ assetId: await assetId('kitOut') }] }).expect(201);
    await post('custodian', `/assets/${codes.kitRepair}/repair`, { notes: 'Flickering' }).expect(200);

    const res = await handOver('custodian', { employeeId: people.mona, kind: 'shoot', dueDate: TOMORROW, kitIds: [kit.id] }).expect(201);
    const { record: made, skipped } = res.body as HandoverResult;
    expect(made.items.map((i) => i.asset.code)).toEqual([codes.kitFree]);
    expect(skipped).toEqual([
      { code: codes.kitOut, name: `Kit lens ${RUN}`, why: expect.stringMatching(new RegExp(`^Out with Kareem Custodian ${RUN} on CUS-\\d{4,}$`)) },
      { code: codes.kitRepair, name: `Kit light ${RUN}`, why: 'Under repair' },
    ]);
    codes.kitRecord = made.code;
    // the choices show the same, and a kit with nothing available is refused with why
    const choices = (await get('custodian', '/assets/custody/choices').expect(200)).body as HandoverChoices;
    expect(choices.kits.find((k) => k.id === kit.id)?.items.map((i) => i.why)).toEqual([expect.stringContaining('Out with'), expect.stringContaining('Out with'), 'Under repair']);
    const none = await handOver('custodian', { employeeId: people.mona, kind: 'assignment', kitIds: [kit.id] }).expect(400);
    expect(none.body.message[0]).toMatch(/^None of the kit’s assets is available to hand over: /);
  });

  // ---------- receiving back ----------

  it('returned damaged: under repair with its maintenance entry, the record partly returned', async () => {
    const item = first.items.find((i) => i.asset.code === codes.camA)!;
    const res = await post('custodian', `/assets/custody/${first.code}/return`, { lines: [{ itemId: item.id, condition: 'damaged', notes: 'Cracked screen' }] }).expect(200);
    const after = res.body as CustodyRecordView;
    expect(after.status).toBe('partial');
    expect(after.items.find((i) => i.id === item.id)).toMatchObject({ returnCondition: 'damaged', returnNotes: 'Cracked screen', returnedAt: expect.any(String), receivedBy: { name: `Kareem Custodian ${RUN}` } });
    expect(after.returns).toHaveLength(1);
    const a = (await get('viewer', `/assets/${codes.camA}`).expect(200)).body as AssetView;
    expect(a).toMatchObject({ status: 'repair', holder: null });
    const history = (await get('viewer', `/assets/${codes.camA}/history`).expect(200)).body as AssetHistoryView;
    expect(history.maintenance[0]).toMatchObject({ kind: 'repair', event: 'returned_damaged', notes: `Returned damaged on ${first.code} by Mona Holder ${RUN}: Cracked screen`, custodyCode: first.code });
    expect(history.custody[0]).toMatchObject({ code: first.code, returnCondition: 'damaged', employee: { id: people.mona } });
    // the same item again: back already; one not on the record: refused
    expect((await post('custodian', `/assets/custody/${first.code}/return`, { lines: [{ itemId: item.id, condition: 'good' }] }).expect(409)).body.message).toBe(`${codes.camA} is back already.`);
    const other = (await record('custodian', codes.recordE).expect(200)).body as CustodyRecordView;
    await post('custodian', `/assets/custody/${first.code}/return`, { lines: [{ itemId: other.items[0].id, condition: 'good' }] }).expect(400);
  });

  it('returned missing: lost; the last one back good closes the record', async () => {
    const b = first.items.find((i) => i.asset.code === codes.camB)!;
    const c = first.items.find((i) => i.asset.code === codes.camC)!;
    const res = await post('custodian', `/assets/custody/${first.code}/return`, {
      lines: [
        { itemId: b.id, condition: 'missing', notes: 'Left at the location' },
        { itemId: c.id, condition: 'good' },
      ],
    }).expect(200);
    const after = res.body as CustodyRecordView;
    expect(after.status).toBe('closed');
    expect(after.closedAt).not.toBeNull();
    expect(after.returns).toHaveLength(2);
    expect(after.returns[1].items.map((i) => [i.code, i.condition])).toEqual([
      [codes.camB, 'missing'],
      [codes.camC, 'good'],
    ]);
    expect((await get('viewer', `/assets/${codes.camB}`).expect(200)).body).toMatchObject({ status: 'lost', holder: null });
    expect((await get('viewer', `/assets/${codes.camC}`).expect(200)).body).toMatchObject({ status: 'available', holder: null });
    expect((await post('custodian', `/assets/custody/${first.code}/return`, { lines: [{ itemId: c.id, condition: 'good' }] }).expect(409)).body.message).toBe(`${first.code} is closed: everything on it is back.`);
    // damaged and missing stay on her record
    const holdings = (await get('viewer', `/assets/custody/people/${people.mona}`).expect(200)).body as HoldingsView;
    expect(holdings.incidents.map((i) => [i.asset.code, i.condition])).toEqual(expect.arrayContaining([
      [codes.camA, 'damaged'],
      [codes.camB, 'missing'],
    ]));
  });

  // ---------- the signed copy ----------

  it('the signed copy takes a record off Not signed', async () => {
    const unsigned = async () => ((await get('viewer', `/assets/custody?filter=unsigned&q=${RUN}`).expect(200)).body as CustodyListView).items.map((r) => r.code);
    expect(await unsigned()).toContain(codes.recordE);
    const before = ((await get('viewer', `/assets/custody?q=${RUN}`).expect(200)).body as CustodyListView).counts.unsigned;

    await api().post(`/api/assets/custody/${codes.recordE}/signed`).set('Cookie', sessions.viewer).attach('file', PDF, 'signed.pdf').expect(403);
    expect((await api().post(`/api/assets/custody/${codes.recordE}/signed`).set('Cookie', sessions.custodian).attach('file', Buffer.from('not a scan'), 'notes.txt').expect(400)).body.message).toEqual([
      'Attach a photo (JPEG, PNG or WebP) or a PDF of the signed form.',
    ]);
    const res = await api().post(`/api/assets/custody/${codes.recordE}/signed`).set('Cookie', sessions.custodian).attach('file', PDF, 'signed form.pdf').expect(201);
    const after = res.body as CustodyRecordView;
    expect(after.signed).toBe(true);
    expect(after.files).toEqual([expect.objectContaining({ fileName: 'signed form.pdf', mimeType: 'application/pdf', uploadedBy: { email: expect.any(String), name: `Kareem Custodian ${RUN}` } })]);
    codes.recordEFile = after.files[0].id;
    expect(await unsigned()).not.toContain(codes.recordE);
    expect(((await get('viewer', `/assets/custody?q=${RUN}`).expect(200)).body as CustodyListView).counts.unsigned).toBe(before - 1);
    const file = await get('viewer', `/assets/custody/${codes.recordE}/signed/${codes.recordEFile}`).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain('inline');
  });

  // ---------- overdue ----------

  it('overdue: a shoot past its return date and not closed; told once a day to the employee and the custodians', async () => {
    const late = (await handOver('custodian', { employeeId: people.mona, kind: 'shoot', dueDate: TOMORROW, items: [{ assetId: await assetId('camC') }] }).expect(201)).body as HandoverResult;
    codes.late = late.record.code;
    await prisma.custodyRecord.update({ where: { code: codes.late }, data: { dueDate: new Date(`${addDays(TODAY, -3)}T00:00:00Z`) } });
    const view = (await record('viewer', codes.late).expect(200)).body as CustodyRecordView;
    expect(view).toMatchObject({ overdue: true, daysOverdue: 3 });
    const overdue = ((await get('viewer', `/assets/custody?filter=overdue&q=${RUN}`).expect(200)).body as CustodyListView).items.map((r) => r.code);
    expect(overdue).toContain(codes.late);
    expect(overdue).not.toContain(first.code); // closed
    expect(overdue).not.toContain(codes.recordE); // a long-term assignment
    // what the connector reads (who_holds and overdue_returns), from the same records
    const report = (await get('viewer', '/assets/reports/overdue').expect(200)).body as { code: string; daysOverdue: number }[];
    expect(report.find((r) => r.code === codes.late)).toMatchObject({ daysOverdue: 3 });

    const round = await scheduler.runOnce(new Date());
    expect(round?.overdue).toContain((await prisma.custodyRecord.findUniqueOrThrow({ where: { code: codes.late } })).id);
    const mine = await notices('mona', 'custody_overdue');
    expect(mine).toEqual([{ title: `Return overdue: ${codes.late}`, body: expect.stringMatching(/^It was due \d{2}\/\d{2}\/\d{4}$/), link: '/my-custody' }]);
    for (const key of ['custodian', 'manager', 'superAdmin']) {
      expect(await notices(key, 'custody_overdue')).toEqual(expect.arrayContaining([{ title: `Return overdue: ${codes.late}`, body: expect.stringContaining(`Mona Holder ${RUN}, due `), link: `/assets/custody/${codes.late}` }]));
    }
    expect(await notices('viewer', 'custody_overdue')).toEqual([]);
    // once a day: the same day again tells nobody; the next day again
    await scheduler.runOnce(new Date());
    expect(await notices('mona', 'custody_overdue')).toHaveLength(1);
    await scheduler.runOnce(new Date(Date.now() + 86_400_000));
    expect(await notices('mona', 'custody_overdue')).toHaveLength(2);
  });

  it('not signed after 3 days: the custodians are told, once', async () => {
    await prisma.custodyRecord.update({ where: { code: codes.late }, data: { outAt: new Date(Date.now() - 4 * 86_400_000) } });
    await prisma.custodyRecord.update({ where: { code: codes.recordE }, data: { outAt: new Date(Date.now() - 4 * 86_400_000) } });
    await scheduler.runOnce(new Date());
    const told = await notices('custodian', 'custody_unsigned');
    expect(told.filter((n) => n.title === `Signed copy not attached: ${codes.late}`)).toHaveLength(1);
    expect(told.map((n) => n.title)).not.toContain(`Signed copy not attached: ${codes.recordE}`); // signed
    expect(await notices('mona', 'custody_unsigned')).toEqual([]);
    await scheduler.runOnce(new Date());
    expect((await notices('custodian', 'custody_unsigned')).filter((n) => n.title === `Signed copy not attached: ${codes.late}`)).toHaveLength(1);
  });

  // ---------- who may do what ----------

  it('a viewer reads; a custodian and a manager act; without access nothing', async () => {
    await get('viewer', '/assets/custody').expect(200);
    await record('viewer', first.code).expect(200);
    await get('viewer', `/assets/custody/people?q=${RUN}`).expect(200);
    for (const [path, body] of [
      ['/assets/custody', { employeeId: people.mona, kind: 'assignment', items: [{ assetId: await assetId('camD') }] }],
      [`/assets/custody/${codes.late}/return`, { lines: [] }],
      [`/assets/${codes.camD}/repair`, {}],
      [`/assets/${codes.camB}/found`, {}],
    ] as const) {
      expect((await post('viewer', path, body).expect(403)).body.message).toBe('Only an Assets custodian or manager can do this.');
    }
    await get('viewer', '/assets/custody/choices').expect(403);
    expect((await record('viewer', first.code).expect(200)).body.can).toEqual({ receive: false, attach: false, deduction: false });
    for (const path of ['/assets/custody', `/assets/custody/${first.code}`, '/assets/custody/people', `/assets/${codes.camA}/history`]) {
      expect((await get('none', path).expect(403)).body.message).toBe('You do not have access to Assets.');
    }
    // the terms: an Assets manager's alone; each record keeps those it was printed with
    await patch('custodian', '/assets/settings/terms', { terms: ['x'] }).expect(403);
    const terms = [`The custodian’s term ${RUN}.`, 'I return it when asked.'];
    expect((await patch('manager', '/assets/settings/terms', { terms }).expect(200)).body).toMatchObject({ custodyTerms: terms, custodyTermsStandard: false });
    await asset('camF', camera('Camera F'));
    const withTerms = (await handOver('manager', { employeeId: people.kareem, kind: 'assignment', items: [{ assetId: await assetId('camF') }] }).expect(201)).body as HandoverResult;
    expect(withTerms.record.terms).toEqual(terms);
    expect(((await record('viewer', first.code).expect(200)).body as CustodyRecordView).terms).toEqual([...CUSTODY_TERMS_STANDARD]);
    expect((await patch('manager', '/assets/settings/terms', { standard: true }).expect(200)).body).toMatchObject({ custodyTerms: [...CUSTODY_TERMS_STANDARD], custodyTermsStandard: true });
  });

  it('repairs, lost and found from the asset’s page: the status rules, a maintenance entry, the cost a value', async () => {
    // camA came back damaged (under repair): back from repair, its cost a value (a custodian can't send one)
    expect((await post('custodian', `/assets/${codes.camA}/repair/back`, { cost: 800 }).expect(403)).body.message).toBe('Only the CEO, Finance and a Super Admin see and set asset values.');
    await post('superAdmin', `/assets/${codes.camA}/repair/back`, { vendor: 'Camera Clinic', cost: 800, notes: 'Screen replaced' }).expect(200);
    expect((await get('viewer', `/assets/${codes.camA}`).expect(200)).body.status).toBe('available');
    expect((await post('custodian', `/assets/${codes.camA}/repair/back`, {}).expect(409)).body.message).toBe(`${codes.camA} isn’t under repair.`);
    // camB was lost: found again; an asset in custody isn't marked lost by hand
    await post('custodian', `/assets/${codes.camB}/found`, { notes: 'Found in the van' }).expect(200);
    expect((await get('viewer', `/assets/${codes.camB}`).expect(200)).body.status).toBe('available');
    expect((await post('custodian', `/assets/${codes.camC}/lost`, {}).expect(409)).body.message).toBe(`${codes.camC} is in custody: receive it back missing to mark it lost.`);
    // the cost only for those who see the values
    const forFinance = (await get('finance', `/assets/${codes.camA}/history`).expect(200)).body as AssetHistoryView;
    expect(forFinance.maintenance[0]).toMatchObject({ event: 'back_from_repair', vendor: 'Camera Clinic', cost: 800, notes: 'Screen replaced' });
    const forCustodian = (await get('custodian', `/assets/${codes.camA}/history`).expect(200)).body as AssetHistoryView;
    expect(forCustodian.maintenance[0]).not.toHaveProperty('cost');
    expect(forCustodian.can).toEqual({ hand_over: true, send_to_repair: true, back_from_repair: false, mark_lost: true, mark_found: false });
    expect(((await get('viewer', `/assets/${codes.camA}/history`).expect(200)).body as AssetHistoryView).can).toEqual({
      hand_over: false,
      send_to_repair: false,
      back_from_repair: false,
      mark_lost: false,
      mark_found: false,
    });
  });

  // ---------- the values ----------

  it('the values (when they went out, what someone holds, a repair’s cost) only for the CEO, Finance and a Super Admin', async () => {
    const paths = [`/assets/custody/${first.code}`, `/assets/custody/${codes.late}`, `/assets/custody/people/${people.mona}`, `/assets/custody/people?q=${RUN}`, `/assets/${codes.camA}/history`, '/assets/custody/choices'];
    for (const key of ['custodian', 'manager', 'hr']) {
      for (const path of paths) {
        const text = JSON.stringify((await get(key, path).expect(200)).body);
        for (const word of VALUE_KEYS) expect(text).not.toContain(word);
        expect(text).not.toContain('40000');
      }
    }
    await get('viewer', `/assets/custody/people/${people.mona}`).expect(200);
    for (const key of ['finance', 'ceo', 'superAdmin']) {
      const r = (await record(key, codes.late).expect(200)).body as CustodyRecordView;
      expect(r.valueAtOut).toBe(40000);
      expect(r.items[0].valueAtOut).toBe(40000);
      const cards = (await get(key, `/assets/custody/people?q=${encodeURIComponent(`Mona Holder ${RUN}`)}`).expect(200)).body as HolderCardView[];
      expect(cards[0]).toMatchObject({ employee: { id: people.mona }, value: expect.any(Number) });
    }
  });

  // ---------- C-level ----------

  it('C-level people are hidden from HR as everywhere: not offered, not handed over to, their records 404', async () => {
    // HR can't hand over to Clara; a Super Admin can
    expect(((await get('hr', '/assets/custody/choices').expect(200)).body as HandoverChoices).people.map((p) => p.id)).not.toContain(people.clara);
    await asset('claraLaptop', { name: `Clara laptop ${RUN}`, group: 'it', type: 'LAP' });
    expect((await handOver('hr', { employeeId: people.clara, kind: 'assignment', items: [{ assetId: await assetId('claraLaptop') }] }).expect(404)).body.message).toBe('Employee not found.');
    const made = (await handOver('superAdmin', { employeeId: people.clara, kind: 'assignment', items: [{ assetId: await assetId('claraLaptop') }] }).expect(201)).body as HandoverResult;
    codes.clara = made.record.code;

    await record('hr', codes.clara).expect(404);
    await record('custodian', codes.clara).expect(404);
    await record('ceo', codes.clara).expect(200);
    expect(((await get('hr', `/assets/custody?filter=all&q=${RUN}`).expect(200)).body as CustodyListView).items.map((r) => r.code)).not.toContain(codes.clara);
    expect(((await get('superAdmin', `/assets/custody?filter=all&q=${RUN}`).expect(200)).body as CustodyListView).items.map((r) => r.code)).toContain(codes.clara);
    expect((await get('hr', `/assets/custody/people?q=${encodeURIComponent('Clara Chief')}`).expect(200)).body).toEqual([]);
    await get('hr', `/assets/custody/people/${people.clara}`).expect(404);
    expect(((await get('ceo', `/assets/custody/people/${people.clara}`).expect(200)).body as HoldingsView).current.map((h) => h.asset.code)).toEqual([codes.claraLaptop]);
    const claraItem = await prisma.custodyItem.findFirstOrThrow({ where: { custody: { code: codes.clara } }, select: { id: true } });
    await post('hr', `/assets/custody/${codes.clara}/return`, { lines: [{ itemId: claraItem.id, condition: 'good' }] }).expect(404);
    // the connector's who_holds leaves her out for HR; the asset's history counts her record as left out
    expect((await get('hr', '/assets/reports/holders?q=Clara').expect(200)).body).toEqual([]);
    expect(((await get('superAdmin', '/assets/reports/holders?q=Clara').expect(200)).body as { employee: { id: string } }[]).map((h) => h.employee.id)).toEqual([people.clara]);
    const history = (await get('hr', `/assets/${codes.claraLaptop}/history`).expect(200)).body as AssetHistoryView;
    expect(history).toMatchObject({ custody: [], hiddenRecords: 1 });
    // her own notice: only those custodians who see C-level people would be told of her record
    expect(await notices('clara', 'custody_handover')).toEqual([{ title: `You received 1 item: ${codes.clara}`, body: 'A long-term assignment', link: '/my-custody' }]);
  });

  // ---------- My custody ----------

  it('My custody shows only one’s own: what they hold, since when, the return dates, overdue, their signed forms', async () => {
    const mine = (await get('mona', '/me/custody').expect(200)).body as MyCustodyView;
    expect(mine.employeeId).toBe(people.mona);
    expect(mine.current.map((h) => h.asset.code).sort()).toEqual([codes.camC, codes.kitFree, codes.camD, codes.camE].sort());
    expect(mine.current.find((h) => h.custody.code === codes.late)).toMatchObject({ overdue: true, daysOverdue: 3, since: expect.any(String) });
    expect(mine.overdue).toBe(1);
    expect(mine.records.map((r) => r.code)).toEqual(expect.arrayContaining([first.code, codes.late, codes.recordE]));
    expect(mine.records.map((r) => r.code)).not.toContain(codes.clara);
    const text = JSON.stringify(mine);
    for (const word of VALUE_KEYS) expect(text).not.toContain(word);
    // her own signed form opens; Clara's records aren't hers
    const signed = mine.records.find((r) => r.code === codes.recordE)!;
    expect(signed.files.map((f) => f.id)).toEqual([codes.recordEFile]);
    await get('mona', `/me/custody/${codes.recordE}/files/${codes.recordEFile}`).expect(200);
    await get('clara', `/me/custody/${codes.recordE}/files/${codes.recordEFile}`).expect(404);
    const claras = (await get('clara', '/me/custody').expect(200)).body as MyCustodyView;
    expect(claras.current.map((h) => h.asset.code)).toEqual([codes.claraLaptop]);
    // without a profile: nothing; and no Assets access is needed for one's own
    expect((await get('viewer', '/me/custody').expect(200)).body).toEqual({ employeeId: null, current: [], records: [], overdue: 0 });
    await get('mona', '/assets/custody').expect(403);
  });

  // ---------- damages to deductions ----------

  it('HR alone turns a damaged or missing item into a deduction, linked to it; none is ever made by itself', async () => {
    const r = (await record('hr', first.code).expect(200)).body as CustodyRecordView;
    const damaged = r.items.find((i) => i.asset.code === codes.camA)!;
    const good = r.items.find((i) => i.asset.code === codes.camC)!;
    expect(r.can.deduction).toBe(true);
    expect(damaged.deductions).toEqual([]);
    expect(((await record('custodian', first.code).expect(200)).body as CustodyRecordView).can.deduction).toBe(false);
    expect(((await record('custodian', first.code).expect(200)).body as CustodyRecordView).items[0]).not.toHaveProperty('deductions');
    expect(await prisma.payrollAdjustment.count({ where: { employeeId: people.mona } })).toBe(0); // nothing by itself

    const body = { employeeId: people.mona, month: NEXT_MONTH, kind: 'deduction', type: 'damage_loss', amount: 500, reason: `Damage: ${codes.camA} on ${first.code}`, custodyItemId: damaged.id };
    await post('custodian', '/payroll/adjustments', body).expect(403);
    expect((await post('hr', '/payroll/adjustments', { ...body, custodyItemId: good.id }).expect(400)).body.message).toBe('Only an item returned damaged or missing, or without some of its accessories, becomes a deduction.');
    expect((await post('hr', '/payroll/adjustments', { ...body, type: 'penalty' }).expect(400)).body.message).toBe('Only a Damage or loss deduction is linked to a custody item.');
    expect((await post('hr', '/payroll/adjustments', { ...body, employeeId: people.kareem }).expect(400)).body.message).toBe('Choose a damaged or missing item of this employee’s custody.');
    const made = (await post('hr', '/payroll/adjustments', body).expect(201)).body as { id: string; custody: unknown; status: string };
    expect(made).toMatchObject({ status: 'pending', custody: { itemId: damaged.id, recordCode: first.code, assetCode: codes.camA } });
    const linked = ((await record('hr', first.code).expect(200)).body as CustodyRecordView).items.find((i) => i.id === damaged.id)!;
    expect(linked.deductions).toEqual([{ id: made.id, month: NEXT_MONTH, status: 'pending', amount: 500 }]);
    const holdings = (await get('hr', `/assets/custody/people/${people.mona}`).expect(200)).body as HoldingsView;
    expect(holdings.can.deduction).toBe(true);
    expect(holdings.incidents.find((i) => i.itemId === damaged.id)?.deductions).toHaveLength(1);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'payroll_adjustment', entityId: made.id, action: 'create' } });
    expect(entry.diff).toMatchObject({ amount: 'set', custodyItemId: damaged.id, custody: first.code, asset: codes.camA });
  });

  // ---------- notifications and the audit log ----------

  it('the employee is told of the handover and each return', async () => {
    const handovers = await notices('mona', 'custody_handover');
    expect(handovers[0]).toEqual({ title: `You received 3 items: ${first.code}`, body: expect.stringMatching(/^To return by \d{2}\/\d{2}\/\d{4}$/), link: '/my-custody' });
    const returns = await notices('mona', 'custody_return');
    expect(returns.slice(0, 2)).toEqual([
      { title: `1 item received back: ${first.code}`, body: '2 items still with you', link: '/my-custody' },
      { title: `2 items received back: ${first.code}`, body: 'All items are back', link: '/my-custody' },
    ]);
  });

  it('every step is in the audit log, the values only as the fact that they were kept', async () => {
    const r = await prisma.custodyRecord.findUniqueOrThrow({ where: { code: first.code }, select: { id: true } });
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'custody_record', entityId: r.id }, orderBy: { at: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['hand_over', 'receive_back', 'receive_back']);
    expect(entries[0]).toMatchObject({ userId: users.custodian, diff: expect.objectContaining({ code: first.code, kind: 'shoot', items: [codes.camA, codes.camB, codes.camC], valueAtOut: 'set' }) });
    expect(entries[2].diff).toMatchObject({ status: { from: 'partial', to: 'closed' } });
    expect(JSON.stringify(entries.map((e) => e.diff))).not.toContain('40000');
    const signed = await prisma.custodyRecord.findUniqueOrThrow({ where: { code: codes.recordE }, select: { id: true } });
    expect(await prisma.auditLog.count({ where: { entityType: 'custody_record', entityId: signed.id, action: 'attach_signed' } })).toBe(1);
    const a = await prisma.asset.findUniqueOrThrow({ where: { code: codes.camA }, select: { id: true } });
    const onAsset = (await prisma.auditLog.findMany({ where: { entityType: 'asset', entityId: a.id }, orderBy: { at: 'asc' } })).map((e) => e.action);
    expect(onAsset).toEqual(expect.arrayContaining(['hand_over', 'receive_back', 'back_from_repair']));
    // the Audit Log page reads them in words, with a link to the record
    const page = await get('superAdmin', `/audit?entityType=custody_record&entityId=${r.id}`).expect(200);
    expect(page.body.entries[0]).toMatchObject({ entityLabel: 'Custody record', reference: first.code, link: { href: `/assets/custody/${first.code}`, label: 'Open custody record' } });
    expect(page.body.entries.map((e: { actionLabel: string }) => e.actionLabel)).toEqual(expect.arrayContaining(['Handed over', 'Received back']));
  });
});
