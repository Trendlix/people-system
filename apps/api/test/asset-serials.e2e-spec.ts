import type { INestApplication } from '@nestjs/common';
import type { AssetDraftView, AssetView, Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// One serial number, one item (owner, 22 October 2026: "same serial number shouldn't be added twice"). An asset's
// serial, an accessory's and a draft's from Claude are compared however they are typed (case, spaces, dashes); one
// found elsewhere is refused, saying where; a serial kept twice before the rule doesn't stop other changes. Audio kit
// (PK-AUD-), which no other test file registers; every name is invented; the test deletes what it made.

const RUN = `sn${Date.now().toString(36)}`;
const SERIAL = `SN-${RUN}-100`;

describe('Asset serial numbers, one item each (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};

  const post = (as: string, path: string, body: object) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const put = (as: string, path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const mic = (name: string, serial?: string) => ({ name: `${name} ${RUN}`, group: 'kit', type: 'AUD', condition: 'good', ...(serial !== undefined && { serial }) });
  const said = (res: { body: { message: unknown } }) => res.body.message;

  async function account(key: string, roles: Role[], access?: string) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    if (access) await patch('admin', `/users/${users[key]}`, { assetsAccess: access }).expect(200);
  }

  let first: AssetView;
  let second: AssetView;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('admin', ['admin']);
    await account('custodian', ['employee'], 'custodian');
    await account('manager', ['employee'], 'manager');
    first = (await post('custodian', '/assets', mic('Mic A', SERIAL)).expect(201)).body as AssetView;
    second = (await post('custodian', '/assets', mic('Mic B', `SN-${RUN}-200`)).expect(201)).body as AssetView;
  });

  afterAll(async () => {
    await prisma.assetDraft.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    await prisma.asset.deleteMany({ where: { name: { contains: RUN } } });
    if (!(await prisma.asset.count({ where: { code: { startsWith: 'PK-AUD-' } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-AUD-' } });
    await app.close();
  });

  it('refuses a new asset with a serial another has, however it is typed, saying where', async () => {
    const typed = SERIAL.toLowerCase().replace(/-/g, ' ');
    expect(said(await post('custodian', '/assets', mic('Mic C', typed)).expect(400))).toEqual([`Serial number ${typed} is already on ${first.code} · Mic A ${RUN}.`]);
    // nothing registered, no code used
    expect(await prisma.asset.count({ where: { name: `Mic C ${RUN}` } })).toBe(0);
    // the key is kept beside the serial
    expect(await prisma.asset.findUniqueOrThrow({ where: { code: first.code }, select: { serialKey: true } })).toEqual({ serialKey: SERIAL.toUpperCase().replace(/-/g, '') });
  });

  it('refuses an edit to another’s serial; other edits, and keeping its own, pass', async () => {
    expect(said(await patch('custodian', `/assets/${second.code}`, { serial: ` ${SERIAL} ` }).expect(400))).toEqual([
      `Serial number ${SERIAL} is already on ${first.code} · Mic A ${RUN}.`,
    ]);
    await patch('custodian', `/assets/${second.code}`, { notes: 'Lavalier' }).expect(200);
    await patch('custodian', `/assets/${first.code}`, { serial: SERIAL.toLowerCase() }).expect(200);
  });

  it('a serial kept twice before the rule doesn’t stop other changes to either', async () => {
    const id = (await prisma.asset.findUniqueOrThrow({ where: { code: second.code }, select: { id: true } })).id;
    const was = await prisma.asset.findUniqueOrThrow({ where: { id }, select: { serial: true, serialKey: true } });
    await prisma.asset.update({ where: { id }, data: { serial: SERIAL, serialKey: SERIAL.toUpperCase().replace(/-/g, '') } });
    await patch('custodian', `/assets/${second.code}`, { condition: 'excellent' }).expect(200);
    await prisma.asset.update({ where: { id }, data: was });
  });

  it('an accessory’s serial: not another asset’s or accessory’s, not its own asset’s, not twice on the list', async () => {
    const path = `/assets/${second.code}/accessories`;
    expect(said(await put('custodian', path, { items: [{ name: 'Clip', serial: SERIAL }] }).expect(400))).toEqual([
      `Accessory 1 (Clip): serial number ${SERIAL} is already on ${first.code} · Mic A ${RUN}.`,
    ]);
    expect(said(await put('custodian', path, { items: [{ name: 'Clip', serial: `SN-${RUN}-200` }] }).expect(400))).toEqual(['Accessory 1 (Clip): its serial number is the asset’s own.']);
    expect(
      said(
        await put('custodian', path, {
          items: [
            { name: 'Clip', serial: `CL-${RUN}` },
            { name: 'Spare clip', serial: `cl ${RUN}` },
          ],
        }).expect(400),
      ),
    ).toEqual(['Accessory 2 (Spare clip): accessory 1 has the same serial number. A serial number is one item’s.']);
    await put('custodian', path, { items: [{ name: 'Clip', serial: `CL-${RUN}` }] }).expect(200);
    // saving its own list again is no clash with itself
    await put('custodian', path, { items: [{ name: 'Clip', serial: `CL-${RUN}` }, { name: 'Windshield' }] }).expect(200);
    // a new asset with that accessory's serial
    expect(said(await post('custodian', '/assets', mic('Mic D', `CL-${RUN}`)).expect(400))).toEqual([
      `Serial number CL-${RUN} is already on ${second.code} · Mic B ${RUN}, as its accessory Clip.`,
    ]);
  });

  it('says when the asset holding it is disposed', async () => {
    const disposed = (await post('custodian', '/assets', mic('Old mic', `OLD-${RUN}`)).expect(201)).body as AssetView;
    await post('manager', `/assets/${disposed.code}/dispose`, { method: 'scrapped', approvedBy: 'The owner' }).expect(200);
    expect(said(await post('custodian', '/assets', mic('Mic E', `OLD-${RUN}`)).expect(400))).toEqual([
      `Serial number OLD-${RUN} is already on ${disposed.code} · Old mic ${RUN} (disposed).`,
    ]);
  });

  it('Claude’s drafts: not an asset’s serial, not another open draft’s; confirming checks again', async () => {
    expect(said(await post('custodian', '/assets/drafts', mic('Draft mic', SERIAL)).expect(400))).toEqual([
      `Serial number ${SERIAL} is already on ${first.code} · Mic A ${RUN}.`,
    ]);
    const draft = (await post('custodian', '/assets/drafts', mic('Draft mic', `DR-${RUN}`)).expect(201)).body as AssetDraftView;
    expect(said(await post('custodian', '/assets/drafts', mic('Other draft', `dr ${RUN}`)).expect(400))).toEqual([
      `Serial number dr ${RUN} is already on another draft from Claude: Draft mic ${RUN}.`,
    ]);
    // changing its own other fields keeps its serial without a clash
    await patch('custodian', `/assets/drafts/${draft.id}`, { notes: 'Shotgun' }).expect(200);
    // an asset registered with the draft's serial meanwhile: confirming it is refused, the draft stays open
    const meanwhile = (await post('custodian', '/assets', mic('Mic F', `DR-${RUN}`)).expect(201)).body as AssetView;
    expect(said(await post('custodian', `/assets/drafts/${draft.id}/confirm`, mic('Draft mic', `DR-${RUN}`)).expect(400))).toEqual([
      `Serial number DR-${RUN} is already on ${meanwhile.code} · Mic F ${RUN}.`,
    ]);
    expect((await prisma.assetDraft.findUniqueOrThrow({ where: { id: draft.id }, select: { status: true } })).status).toBe('open');
  });
});
