import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { AssetDraftView, AssetListView, AssetView, ConnectorAuthorizeCheck, ConnectorMe, CountDueView, Role, StockLevelView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { s256, secretHash } from '../src/connector/connector-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, PASSWORD, signIn } from './helpers.js';

// Assets, step 2: the Claude connector (owner, 21 October 2026: "i might link a claude account for the assets section
// only to fetch data and help in the data entry"; then "the connection method" / "option a"). The API side of the
// connector, as the website's /oauth/* and /api/mcp pass requests on: registration with Claude's return addresses only;
// the consent page's check and Allow (Assets access only, never while viewing as someone); a code redeemed once with
// its PKCE verifier; the connector session kind (one a person, the newest wins, no 15 minutes); its token refused on
// everything but the Assets reads and the drafts; the tools' permission and values rules as the website's; drafts kept
// out of every total, confirmed (code given then) or discarded on the website; refresh tokens rotated (used again a
// minute later, the connection ends); revoking, Your Sessions, a password change or reset and deactivating end it; a
// client identified by its metadata document on Claude's hosts; and the audit log marking what came through Claude.

const RUN = Date.now().toString(36);
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const ORIGIN = 'https://people.trendlix.com';
const RESOURCE = `${ORIGIN}/api/mcp`;
const CIMD = 'https://claude.ai/oauth/e2e-client-metadata';

const verifierOf = () => randomBytes(48).toString('base64url');

describe('Claude connector (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const emails: Record<string, string> = {};
  let clientId: string;

  async function account(key: string, roles: Role[], assetsAccess?: string) {
    emails[key] = await createUser(prisma, roles);
    ids[key] = (await prisma.user.findUniqueOrThrow({ where: { email: emails[key] } })).id;
    if (assetsAccess) await prisma.user.update({ where: { id: ids[key] }, data: { assetsAccess } });
    sessions[key] = await signIn(app, emails[key]);
  }

  const register = (body: object) => api().post('/api/connector/oauth/register').send(body);
  const token = (body: object) => api().post('/api/connector/oauth/token').send(body);
  const asConnector = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, accessToken: string) => api()[method](path).set('Authorization', `Bearer ${accessToken}`);

  const authorizeBody = (challenge: string, extra: object = {}) => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'assets',
    state: 'state-1',
    resource: RESOURCE,
    expectedResource: RESOURCE,
    ...extra,
  });

  /** The consent page's check, as the website asks it with the person's session. */
  const check = (as: string, body: object) => api().post('/api/connector/oauth/authorize/check').set('Cookie', sessions[as]).send(body);

  /** Allow, then the code for tokens: what Claude gets. */
  async function connect(as: string, client = clientId): Promise<{ access: string; refresh: string; verifier: string }> {
    const verifier = verifierOf();
    const grant = await api()
      .post('/api/connector/oauth/authorize')
      .set('Cookie', sessions[as])
      .send(authorizeBody(s256(verifier), { client_id: client }))
      .expect(200);
    expect(grant.body.redirectUri).toBe(CALLBACK);
    const res = await token({ grant_type: 'authorization_code', code: grant.body.code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: client, resource: RESOURCE, ip: '203.0.113.9', userAgent: 'Claude-User' }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    return { access: res.body.access_token, refresh: res.body.refresh_token, verifier };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    await account('viewer', ['employee'], 'viewer');
    await account('custodian', ['employee'], 'custodian');
    await account('manager', ['employee'], 'manager');
    await account('financeCustodian', ['finance'], 'custodian');
    await account('none', ['employee']);
    const res = await register({ client_name: 'Claude', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none', ip: '198.51.100.1' }).expect(201);
    clientId = res.body.client_id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const assets = await prisma.asset.findMany({ where: { name: { contains: RUN } }, select: { id: true } });
    await prisma.assetDraft.deleteMany({ where: { OR: [{ createdById: { in: Object.values(ids) } }, { assetId: { in: assets.map((a) => a.id) } }] } });
    await prisma.asset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
    // the code counters this file used, back as they were when no asset of theirs is left (assets.e2e-spec.ts expects
    // the codes to start at 0001 in a run, whichever file runs first)
    for (const prefix of ['PK-CAM-', 'PK-LEN-', 'CS-SUP-']) {
      if (!(await prisma.asset.count({ where: { code: { startsWith: prefix } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix } });
    }
    await prisma.assetRoom.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.connectorClient.deleteMany({ where: { OR: [{ ip: { in: ['198.51.100.1', '198.51.100.2', '198.51.100.3'] } }, { id: CIMD }] } });
    await app.close();
  });

  // ---------- registration ----------

  it('registers Claude as a public client, with Claude’s return addresses only', async () => {
    const res = await register({ client_name: 'Claude', redirect_uris: [CALLBACK, 'https://claude.com/api/mcp/auth_callback'], ip: '198.51.100.1', logo_uri: 'https://claude.ai/logo.png' }).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ client_name: 'Claude', redirect_uris: [CALLBACK, 'https://claude.com/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', response_types: ['code'], scope: 'assets' });
    expect(res.body.client_id).toMatch(/^tlxcl_/);
    expect(res.body.client_secret).toBeUndefined();

    for (const uri of ['https://evil.example/callback', 'http://localhost:3118/callback', 'https://claude.ai.evil.example/api/mcp/auth_callback']) {
      const refused = await register({ client_name: 'Claude', redirect_uris: [uri], ip: '198.51.100.1' }).expect(400);
      expect(refused.body).toEqual({ error: 'invalid_redirect_uri', error_description: expect.any(String) });
    }
    expect((await register({ redirect_uris: [CALLBACK], response_types: ['token'], ip: '198.51.100.1' }).expect(400)).body.error).toBe('invalid_client_metadata');

    // a client asking for a secret gets one, this once; only its SHA-256 is kept
    const confidential = await register({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post', ip: '198.51.100.1' }).expect(201);
    expect(confidential.body.client_secret).toMatch(/^tlxs_/);
    const kept = await prisma.connectorClient.findUniqueOrThrow({ where: { id: confidential.body.client_id } });
    expect(kept.secretHash).toBe(secretHash(confidential.body.client_secret));
  });

  it('allows 20 registrations an hour from one address', async () => {
    for (let i = 0; i < 20; i++) await register({ redirect_uris: [CALLBACK], ip: '198.51.100.2' }).expect(201);
    const res = await register({ redirect_uris: [CALLBACK], ip: '198.51.100.2' }).expect(429);
    expect(res.body.error).toBe('temporarily_unavailable');
  });

  // ---------- the consent page ----------

  it('checks the client and its return address first, said on the page and never sent anywhere', async () => {
    const challenge = s256(verifierOf());
    const unknown = (await check('custodian', authorizeBody(challenge, { client_id: 'tlxcl_unknownunknownunknown12' })).expect(200)).body as ConnectorAuthorizeCheck;
    expect(unknown).toEqual({ kind: 'show', message: expect.stringMatching(/not registered/) });
    const elsewhere = (await check('custodian', authorizeBody(challenge, { redirect_uri: 'https://evil.example/callback' })).expect(200)).body as ConnectorAuthorizeCheck;
    expect(elsewhere.kind).toBe('show');
    expect((await check('custodian', authorizeBody(challenge, { client_id: 'https://evil.example/client.json' })).expect(200)).body.kind).toBe('show');
  });

  it('sends Claude back with the error for anything else: no PKCE, plain PKCE, another scope, another MCP address', async () => {
    const challenge = s256(verifierOf());
    const cases: [object, string][] = [
      [{ code_challenge: '' }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ scope: 'assets payroll' }, 'invalid_scope'],
      [{ resource: 'https://evil.example/mcp' }, 'invalid_target'],
    ];
    for (const [extra, error] of cases) {
      const res = (await check('custodian', authorizeBody(challenge, extra)).expect(200)).body as ConnectorAuthorizeCheck;
      expect(res).toMatchObject({ kind: 'redirect', redirectUri: CALLBACK, error: { error } });
    }
  });

  it('asks the person, at their level; refuses anyone without Assets access, and anyone viewing as someone', async () => {
    const challenge = s256(verifierOf());
    const ok = (await check('custodian', authorizeBody(challenge)).expect(200)).body as ConnectorAuthorizeCheck;
    expect(ok).toEqual({ kind: 'ok', client: { id: clientId, name: 'Claude' }, redirectUri: CALLBACK, redirectHost: 'claude.ai', access: 'custodian', values: false, refusal: null });
    expect((await check('financeCustodian', authorizeBody(challenge)).expect(200)).body).toMatchObject({ access: 'custodian', values: true });

    expect((await check('none', authorizeBody(challenge)).expect(200)).body).toMatchObject({ kind: 'ok', access: 'none', refusal: 'no_access' });
    const noAccess = await api().post('/api/connector/oauth/authorize').set('Cookie', sessions.none).send(authorizeBody(challenge)).expect(403);
    expect(noAccess.body.message).toMatch(/do not have access to Assets/);

    // the Super Admin viewing as the custodian: the check says why, and Allow is refused (view only, or Act as them on)
    const viewing = await api().post('/api/auth/view-as').set('Cookie', sessions.superAdmin).send({ userId: ids.custodian }).expect(200);
    const viewCookie = ([] as string[]).concat(viewing.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
    expect((await api().post('/api/connector/oauth/authorize/check').set('Cookie', viewCookie).send(authorizeBody(challenge)).expect(200)).body).toMatchObject({ kind: 'ok', refusal: 'viewing_as' });
    await api().post('/api/connector/oauth/authorize').set('Cookie', viewCookie).send(authorizeBody(challenge)).expect(403);
    const acting = await api().post('/api/auth/view-as/act').set('Cookie', viewCookie).send({ act: true }).expect(200);
    const actCookie = ([] as string[]).concat(acting.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
    const refused = await api().post('/api/connector/oauth/authorize').set('Cookie', actCookie).send(authorizeBody(challenge)).expect(403);
    expect(refused.body.message).toMatch(/viewing as someone/);
    await api().post('/api/auth/view-as/stop').set('Cookie', actCookie).expect(200);
    sessions.superAdmin = await signIn(app, emails.superAdmin);

    // nobody signed in: the consent page's calls need the person's session
    await api().post('/api/connector/oauth/authorize/check').send(authorizeBody(challenge)).expect(401);
  });

  // ---------- codes and tokens ----------

  it('redeems a code once, by its client, at its return address, with its verifier; Allow is audited', async () => {
    const verifier = verifierOf();
    const grant = await api().post('/api/connector/oauth/authorize').set('Cookie', sessions.viewer).send(authorizeBody(s256(verifier))).expect(200);
    expect(grant.body.code).toMatch(/^tlxc_/);
    const allowed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'connector_allow', entityId: ids.viewer }, orderBy: { id: 'desc' } });
    expect(allowed.diff).toMatchObject({ client: 'Claude', clientId, returnsTo: 'claude.ai', scope: 'assets' });
    const code = grant.body.code as string;
    const kept = await prisma.connectorCode.findUniqueOrThrow({ where: { codeHash: secretHash(code) } });
    expect(kept.codeChallenge).toBe(s256(verifier));

    const base = { grant_type: 'authorization_code', code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: clientId, resource: RESOURCE };
    expect((await token({ ...base, code_verifier: verifierOf() }).expect(400)).body.error).toBe('invalid_grant');
    expect((await token({ ...base, redirect_uri: 'https://claude.com/api/mcp/auth_callback' }).expect(400)).body.error).toBe('invalid_grant');
    expect((await token({ ...base, resource: 'https://evil.example/mcp' }).expect(400)).body.error).toBe('invalid_target');
    expect((await token({ ...base, client_id: 'tlxcl_unknownunknownunknown12' }).expect(401)).body.error).toBe('invalid_client');
    expect((await token({ ...base, grant_type: 'password' }).expect(400)).body.error).toBe('unsupported_grant_type');

    const res = await token(base).expect(200);
    expect(res.body).toEqual({ access_token: expect.stringMatching(/^tlxa_/), token_type: 'Bearer', expires_in: 3600, refresh_token: expect.stringMatching(/^tlxr_/), scope: 'assets' });
    // only the hashes are kept
    const tokens = await prisma.connectorToken.findMany({ where: { tokenHash: { in: [secretHash(res.body.access_token), secretHash(res.body.refresh_token)] } } });
    expect(tokens.map((t) => t.kind).sort()).toEqual(['access', 'refresh']);
    const me = (await asConnector('get', '/api/connector/me', res.body.access_token).expect(200)).body as ConnectorMe;
    expect(me).toMatchObject({ userId: ids.viewer, assets: { access: 'viewer', values: false }, scope: 'assets', resource: RESOURCE, client: 'Claude' });

    // used again: refused, and the connection it started ends
    expect((await token(base).expect(400)).body.error).toBe('invalid_grant');
    await asConnector('get', '/api/connector/me', res.body.access_token).expect(401);
    const safety = await prisma.auditLog.findFirstOrThrow({ where: { action: 'connector_refused', entityId: ids.viewer }, orderBy: { id: 'desc' } });
    expect(safety.diff).toMatchObject({ reason: 'code_reused' });
  });

  it('is a third kind of session: listed on Your Sessions and the Users page, one a person (the newest wins), no 15 minutes', async () => {
    const first = await connect('manager');
    const second = await connect('manager');
    const firstGone = await asConnector('get', '/api/connector/me', first.access).expect(401);
    expect(firstGone.body.reason).toBe('invalid_token');
    await asConnector('get', '/api/connector/me', second.access).expect(200);
    const replaced = await prisma.auditLog.findFirst({ where: { action: 'session_replaced', entityId: ids.manager, diff: { path: ['kind'], equals: 'connector' } } });
    expect(replaced).not.toBeNull();

    // the website session isn't touched by it, and the connector shows beside it
    const own = (await api().get('/api/auth/sessions').set('Cookie', sessions.manager).expect(200)).body as { kind: string; client: string | null; current: boolean }[];
    expect(own.map((s) => s.kind).sort()).toEqual(['connector', 'web']);
    expect(own.find((s) => s.kind === 'connector')).toMatchObject({ client: 'Claude', current: false });
    const forAdmin = (await api().get(`/api/users/${ids.manager}/sessions`).set('Cookie', sessions.admin).expect(200)).body as { kind: string }[];
    expect(forAdmin.some((s) => s.kind === 'connector')).toBe(true);

    // long-lived: 90 days from its last refresh; HR's 15 minutes are never for it
    const session = await prisma.session.findFirstOrThrow({ where: { userId: ids.manager, kind: 'connector', endedAt: null } });
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeGreaterThan(89 * 86_400_000);
    await prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: new Date(Date.now() - 60 * 60_000) } });
    await asConnector('get', '/api/connector/me', second.access).expect(200);
  });

  // ---------- the scope ----------

  it('refuses a connector’s token everywhere but the Assets reads and the drafts', async () => {
    const { access } = await connect('manager');
    const closed: ['get' | 'post' | 'patch' | 'put' | 'delete', string][] = [
      ['get', '/api/auth/me'],
      ['get', '/api/auth/sessions'],
      ['get', '/api/employees'],
      ['get', '/api/users'],
      ['get', '/api/payroll/runs'],
      ['get', '/api/me/notifications'],
      ['get', '/api/assets/settings'],
      ['patch', '/api/assets/settings'],
      ['post', '/api/assets'],
      ['patch', '/api/assets/PK-CAM-0001'],
      ['patch', '/api/assets/PK-CAM-0001/values'],
      ['delete', '/api/assets/PK-CAM-0001'],
      ['post', '/api/assets/PK-CAM-0001/labeled'],
      ['get', '/api/assets/PK-CAM-0001/photos/00000000-0000-4000-8000-000000000000'],
      ['post', '/api/assets/rooms'],
      ['post', '/api/assets/kits'],
      ['post', '/api/assets/drafts/00000000-0000-4000-8000-000000000000/confirm'],
      ['post', '/api/assets/drafts/00000000-0000-4000-8000-000000000000/discard'],
      ['post', '/api/connector/oauth/authorize'],
      ['post', '/api/auth/change-password'],
      ['post', '/api/auth/devices'],
    ];
    for (const [method, path] of closed) {
      const res = await asConnector(method, path, access).send({});
      expect([method, path, res.status]).toEqual([method, path, 403]);
      expect(res.body.message).toMatch(/Claude connector only reads Assets/);
    }
    for (const path of ['/api/assets', '/api/assets/rooms', '/api/assets/kits', '/api/assets/drafts', '/api/assets/reports/overdue', '/api/assets/reports/stock', '/api/assets/reports/counts-due', '/api/connector/me']) {
      await asConnector('get', path, access).expect(200);
    }
    // a website session can't pass for the connector: /connector/me is the connector's alone
    await api().get('/api/connector/me').set('Cookie', sessions.manager).expect(403);
    // anything that only looks like a token is refused as one
    await asConnector('get', '/api/assets', 'tlxa_made-up-token-made-up-token-made-up-tok').expect(401);
  });

  // ---------- the tools' rules: levels, values, drafts ----------

  it('reads at the person’s level, the values only for the CEO, Finance and a Super Admin', async () => {
    const room = await api().post('/api/assets/rooms').set('Cookie', sessions.manager).send({ name: `Studio ${RUN}` }).expect(201);
    const made = await api()
      .post('/api/assets')
      .set('Cookie', sessions.financeCustodian)
      .send({ name: `Camera ${RUN}`, group: 'kit', type: 'CAM', serial: `SER-${RUN}`, roomId: room.body.id, values: { purchasePrice: 45000 } })
      .expect(201);
    const code = made.body.code as string;
    const custodian = await connect('custodian');
    const finance = await connect('financeCustodian');
    const asCustodian = (await asConnector('get', `/api/assets/${code}`, custodian.access).expect(200)).body as AssetView;
    expect(asCustodian.values).toBeUndefined();
    const asFinance = (await asConnector('get', `/api/assets/${code}`, finance.access).expect(200)).body as AssetView;
    expect(asFinance.values?.purchasePrice).toBe(45000);
    const found = (await asConnector('get', `/api/assets?q=${encodeURIComponent(`SER-${RUN}`)}`, custodian.access).expect(200)).body as AssetListView;
    expect(found.items.map((i) => i.code)).toEqual([code]);
    expect(found.items[0].values).toBeUndefined();
    // a viewer reads, but can't draft
    const viewer = await connect('viewer');
    await asConnector('get', '/api/assets', viewer.access).expect(200);
    const refused = await asConnector('post', '/api/assets/drafts', viewer.access).send({ name: `Lens ${RUN}`, group: 'kit', type: 'LEN' }).expect(403);
    expect(refused.body.message).toBe('Only an Assets custodian or manager can do this.');
    await asConnector('get', '/api/assets/drafts', viewer.access).expect(403);
  });

  it('drafts are no assets: no code, in no total or list but the drafts, values only from those who see them; audited via Claude', async () => {
    const custodian = await connect('custodian');
    const finance = await connect('financeCustodian');
    const before = (await api().get('/api/assets').set('Cookie', sessions.manager).expect(200)).body as AssetListView;

    // a custodian can't put values on a draft; Finance (a custodian too) can
    await asConnector('post', '/api/assets/drafts', custodian.access).send({ name: `Tripod ${RUN}`, group: 'kit', type: 'GRP', values: { marketValue: 3000 } }).expect(403);
    // checked as the Add form is: a camera kept by quantity, a purchase date to come, a room that isn't there
    const invalid = await asConnector('post', '/api/assets/drafts', custodian.access).send({ name: `Tape ${RUN}`, group: 'kit', type: 'CAM', quantity: 3, purchaseDate: '2099-01-01' }).expect(400);
    expect(invalid.body.message).toEqual(expect.arrayContaining(['Only consumables are kept by quantity.', 'The purchase date can’t be in the future.']));
    const noRoom = await asConnector('post', '/api/assets/drafts', custodian.access).send({ name: `Tape ${RUN}`, group: 'kit', type: 'CAM', roomId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    expect(noRoom.body.message).toEqual(['Choose a room from the list.']);
    await asConnector('post', '/api/assets/drafts', custodian.access).send({ name: `Lens ${RUN}`, group: 'kit', type: 'LEN', status: 'available' }).expect(400);

    const drafted = (await asConnector('post', '/api/assets/drafts', finance.access).send({ name: `Lens ${RUN}`, group: 'kit', type: 'LEN', brand: 'Sony', values: { marketValue: 30000, priceNote: 'Three listings' } }).expect(201)).body as AssetDraftView;
    expect(drafted).toMatchObject({ status: 'open', source: 'claude', fields: { name: `Lens ${RUN}`, group: 'kit', type: 'LEN', brand: 'Sony', assetClass: 'fixed', usefulLifeYears: 5 }, valuesSet: true, values: { marketValue: 30000 } });
    expect((drafted as unknown as Record<string, unknown>).code).toBeUndefined();
    // the custodian sees it, but not its values; only that there are some
    const forCustodian = (await asConnector('get', `/api/assets/drafts/${drafted.id}`, custodian.access).expect(200)).body as AssetDraftView;
    expect(forCustodian.values).toBeUndefined();
    expect(forCustodian.valuesSet).toBe(true);
    // changed while open (the custodian, without values)
    const changed = (await asConnector('patch', `/api/assets/drafts/${drafted.id}`, custodian.access).send({ model: 'FE 50mm', serial: `LENS-${RUN}` }).expect(200)).body as AssetDraftView;
    expect(changed.fields).toMatchObject({ model: 'FE 50mm', serial: `LENS-${RUN}`, brand: 'Sony' });
    await asConnector('patch', `/api/assets/drafts/${drafted.id}`, custodian.access).send({ values: { marketValue: 1 } }).expect(403);

    // in no total and no list
    const after = (await api().get('/api/assets').set('Cookie', sessions.manager).expect(200)).body as AssetListView;
    expect(after.total).toBe(before.total);
    expect(after.counts).toEqual(before.counts);
    expect(after.items.some((i) => i.name === `Lens ${RUN}`)).toBe(false);
    expect((await api().get(`/api/assets?q=${encodeURIComponent(`Lens ${RUN}`)}`).set('Cookie', sessions.manager).expect(200)).body.total).toBe(0);
    const rooms = (await api().get('/api/assets/rooms').set('Cookie', sessions.manager).expect(200)).body as { assets: number }[];
    expect(rooms.reduce((n, r) => n + r.assets, 0)).toBe(after.items.filter((i) => i.room).length);
    // listed among the drafts
    const drafts = (await api().get('/api/assets/drafts').set('Cookie', sessions.manager).expect(200)).body as AssetDraftView[];
    expect(drafts.map((d) => d.id)).toContain(drafted.id);

    // every change through the connector is the person's, marked via Claude connector; the values only as set or changed
    const made = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_draft', entityId: drafted.id, action: 'create' } });
    expect(made).toMatchObject({ userId: ids.financeCustodian, via: 'claude_connector' });
    expect(made.diff).toMatchObject({ name: `Lens ${RUN}`, marketValue: 'set', priceNote: 'set' });
    const edit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_draft', entityId: drafted.id, action: 'update' } });
    expect(edit).toMatchObject({ userId: ids.custodian, via: 'claude_connector' });
    const page = (await api().get('/api/audit?entityType=asset_draft').set('Cookie', sessions.superAdmin).expect(200)).body as { entries: { entityId: string; who: { text: string; via: string | null } }[] };
    const shown = page.entries.find((i) => i.entityId === drafted.id);
    expect(shown?.who.via).toBe('claude_connector');
    expect(shown?.who.text).toMatch(/via Claude connector$/);
    // the website's own entries are not marked
    const roomEntry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_room', action: 'create' }, orderBy: { id: 'desc' } });
    expect(roomEntry.via).toBeNull();

    // confirmed on the website by the custodian: the code given now, the drafted values kept though they can't see them
    const confirmed = await api()
      .post(`/api/assets/drafts/${drafted.id}/confirm`)
      .set('Cookie', sessions.custodian)
      .send({ name: `Lens ${RUN}`, group: 'kit', type: 'LEN', brand: 'Sony', model: 'FE 50mm', serial: `LENS-${RUN}` })
      .expect(201);
    expect(confirmed.body.code).toMatch(/^PK-LEN-\d{4}$/);
    expect(confirmed.body.values).toBeUndefined();
    const asset = await prisma.asset.findUniqueOrThrow({ where: { code: confirmed.body.code } });
    expect(asset.marketValue?.toNumber()).toBe(30000);
    expect(asset.priceNote).toBe('Three listings');
    const done = await prisma.assetDraft.findUniqueOrThrow({ where: { id: drafted.id } });
    expect(done).toMatchObject({ status: 'confirmed', assetId: asset.id, confirmedById: ids.custodian });
    expect((await api().get('/api/assets').set('Cookie', sessions.manager).expect(200)).body.total).toBe(before.total + 1);
    // once only; then it is out of the drafts, and can't be changed
    const again = await api().post(`/api/assets/drafts/${drafted.id}/confirm`).set('Cookie', sessions.manager).send({ name: `Lens ${RUN}`, group: 'kit', type: 'LEN' }).expect(409);
    expect(again.body.message).toMatch(/already confirmed/);
    await asConnector('patch', `/api/assets/drafts/${drafted.id}`, custodian.access).send({ notes: 'late' }).expect(409);
    expect(((await api().get('/api/assets/drafts').set('Cookie', sessions.manager).expect(200)).body as AssetDraftView[]).some((d) => d.id === drafted.id)).toBe(false);
    const confirmEntry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_draft', entityId: drafted.id, action: 'confirm' } });
    expect(confirmEntry).toMatchObject({ userId: ids.custodian, via: null });

    // discarded on the website: kept, set aside; nothing becomes of it
    const other = (await asConnector('post', '/api/assets/drafts', custodian.access).send({ name: `Gel ${RUN}`, group: 'consumable', type: 'GEL', quantity: 4, unit: 'sheets' }).expect(201)).body as AssetDraftView;
    const discarded = (await api().post(`/api/assets/drafts/${other.id}/discard`).set('Cookie', sessions.custodian).expect(200)).body as AssetDraftView;
    expect(discarded).toMatchObject({ status: 'discarded', asset: null });
    await api().post(`/api/assets/drafts/${other.id}/confirm`).set('Cookie', sessions.custodian).send({ name: `Gel ${RUN}`, group: 'consumable', type: 'GEL', quantity: 4 }).expect(409);
    await api().post(`/api/assets/drafts/${other.id}/discard`).set('Cookie', sessions.viewer).expect(403);
    expect((await api().get('/api/assets').set('Cookie', sessions.manager).expect(200)).body.total).toBe(before.total + 1);
  });

  it('reads who holds what, overdue returns, stock and the counts due, and finds an asset by its holder', async () => {
    const { access } = await connect('viewer');
    await asConnector('get', '/api/assets/reports/holders?q=a', access).expect(400);
    expect((await asConnector('get', `/api/assets/reports/holders?q=${RUN}`, access).expect(200)).body).toEqual([]);
    await api().post('/api/assets').set('Cookie', sessions.manager).send({ name: `Batteries ${RUN}`, group: 'consumable', type: 'SUP', quantity: 2, reorderLevel: 5, unit: 'packs' }).expect(201);
    const stock = (await asConnector('get', '/api/assets/reports/stock?reorder=1', access).expect(200)).body as StockLevelView[];
    expect(stock.find((s) => s.name === `Batteries ${RUN}`)).toMatchObject({ quantity: 2, reorderLevel: 5, reorder: true, unit: 'packs' });
    expect(stock.every((s) => s.reorder)).toBe(true);
    const counts = (await asConnector('get', '/api/assets/reports/counts-due', access).expect(200)).body as CountDueView[];
    expect(counts.map((c) => c.group)).toEqual(['studio', 'kit', 'it', 'office', 'consumable']);
    expect(counts.find((c) => c.group === 'kit')).toMatchObject({ everyDays: 30, neverCounted: true });
    expect(Array.isArray((await asConnector('get', '/api/assets/reports/overdue', access).expect(200)).body)).toBe(true);
    expect((await asConnector('get', `/api/assets?holder=${RUN}`, access).expect(200)).body.total).toBe(0);
  });

  // ---------- refresh, revocation, and what ends a connection ----------

  it('rotates refresh tokens: used again within a minute only refused, later the connection ends', async () => {
    const first = await connect('custodian');
    const rotated = await token({ grant_type: 'refresh_token', refresh_token: first.refresh, client_id: clientId }).expect(200);
    expect(rotated.body.refresh_token).not.toBe(first.refresh);
    await asConnector('get', '/api/connector/me', rotated.body.access_token).expect(200);
    // the old one again, at once: refused, the connection stays
    expect((await token({ grant_type: 'refresh_token', refresh_token: first.refresh, client_id: clientId }).expect(400)).body.error).toBe('invalid_grant');
    await asConnector('get', '/api/connector/me', rotated.body.access_token).expect(200);
    // another client can't use it
    const other = (await register({ redirect_uris: [CALLBACK], ip: '198.51.100.3' }).expect(201)).body.client_id;
    expect((await token({ grant_type: 'refresh_token', refresh_token: rotated.body.refresh_token, client_id: other }).expect(400)).body.error).toBe('invalid_grant');
    // the old one a minute later: whoever has it stole it, so the connection ends
    await prisma.connectorToken.update({ where: { tokenHash: secretHash(first.refresh) }, data: { rotatedAt: new Date(Date.now() - 2 * 60_000) } });
    expect((await token({ grant_type: 'refresh_token', refresh_token: first.refresh, client_id: clientId }).expect(400)).body.error).toBe('invalid_grant');
    await asConnector('get', '/api/connector/me', rotated.body.access_token).expect(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: rotated.body.refresh_token, client_id: clientId }).expect(400)).body.error).toBe('invalid_grant');
    const safety = await prisma.auditLog.findFirstOrThrow({ where: { action: 'connector_refused', entityId: ids.custodian }, orderBy: { id: 'desc' } });
    expect(safety.diff).toMatchObject({ reason: 'refresh_token_reused' });
  });

  it('ends after 90 days without a refresh, and an access token after its hour', async () => {
    const c = await connect('custodian');
    const session = await prisma.session.findFirstOrThrow({ where: { userId: ids.custodian, kind: 'connector', endedAt: null } });
    await prisma.connectorToken.updateMany({ where: { sessionId: session.id, kind: 'access' }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await asConnector('get', '/api/assets', c.access).expect(401)).body.message).toMatch(/expired/);
    const fresh = await token({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: clientId }).expect(200);
    await asConnector('get', '/api/assets', fresh.body.access_token).expect(200);
    await prisma.session.update({ where: { id: session.id }, data: { createdAt: new Date(Date.now() - 100 * 86_400_000), expiresAt: new Date(Date.now() - 1000) } });
    await asConnector('get', '/api/assets', fresh.body.access_token).expect(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: fresh.body.refresh_token, client_id: clientId }).expect(400)).body.error).toBe('invalid_grant');
  });

  it('ends by revocation, Your Sessions’ Sign out, an Admin, a password change or reset, and deactivating the account', async () => {
    // revoking (RFC 7009): either token, always 200
    let c = await connect('manager');
    await api().post('/api/connector/oauth/revoke').send({ token: c.refresh, client_id: clientId }).expect(200, {});
    await asConnector('get', '/api/connector/me', c.access).expect(401);
    await api().post('/api/connector/oauth/revoke').send({ token: 'tlxa_unknown', client_id: clientId }).expect(200, {});

    // Your Sessions' Sign out beside it
    c = await connect('manager');
    const listed = (await api().get('/api/auth/sessions').set('Cookie', sessions.manager).expect(200)).body as { id: string; kind: string }[];
    await api().post(`/api/auth/sessions/${listed.find((s) => s.kind === 'connector')!.id}/end`).set('Cookie', sessions.manager).expect(204);
    await asConnector('get', '/api/connector/me', c.access).expect(401);

    // an Admin on the Users page
    c = await connect('manager');
    await api().post(`/api/users/${ids.manager}/sessions/end`).set('Cookie', sessions.admin).expect(200);
    await asConnector('get', '/api/connector/me', c.access).expect(401);
    sessions.manager = await signIn(app, emails.manager);

    // a password change: as the fingerprint sign-in, it ends
    c = await connect('manager');
    await api().post('/api/auth/change-password').set('Cookie', sessions.manager).send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password-1' }).expect(204);
    await asConnector('get', '/api/connector/me', c.access).expect(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: clientId }).expect(400)).body.error).toBe('invalid_grant');
    await api().put(`/api/users/${ids.manager}/password`).set('Cookie', sessions.admin).send({ password: PASSWORD }).expect(204);

    // an Admin's password reset
    sessions.manager = await signIn(app, emails.manager);
    c = await connect('manager');
    await api().put(`/api/users/${ids.manager}/password`).set('Cookie', sessions.admin).send({ password: PASSWORD }).expect(204);
    await asConnector('get', '/api/connector/me', c.access).expect(401);
    const reset = await prisma.auditLog.findFirstOrThrow({ where: { action: 'password_reset', entityId: ids.manager }, orderBy: { id: 'desc' } });
    expect(reset.diff).toMatchObject({ connectorsEnded: 1 });

    // deactivating the account
    c = await connect('manager');
    await api().patch(`/api/users/${ids.manager}`).set('Cookie', sessions.admin).send({ isActive: false }).expect(200);
    await asConnector('get', '/api/connector/me', c.access).expect(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: clientId }).expect(400)).body.error).toBe('invalid_grant');
    await api().patch(`/api/users/${ids.manager}`).set('Cookie', sessions.admin).send({ isActive: true }).expect(200);
    await asConnector('get', '/api/connector/me', c.access).expect(401);
    sessions.manager = await signIn(app, emails.manager);
  });

  it('refuses tokens once the person has no Assets access, and the code exchange for someone who lost it', async () => {
    const c = await connect('custodian');
    await prisma.user.update({ where: { id: ids.custodian }, data: { assetsAccess: 'none' } });
    const me = await asConnector('get', '/api/connector/me', c.access).expect(403);
    expect(me.body.message).toMatch(/do not have access to Assets/);
    await asConnector('get', '/api/assets', c.access).expect(403);
    expect((await token({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: clientId }).expect(400)).body.error).toBe('invalid_grant');
    await prisma.user.update({ where: { id: ids.custodian }, data: { assetsAccess: 'custodian' } });
  });

  it('a confidential client authenticates with its secret', async () => {
    const res = await register({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic', ip: '198.51.100.3' }).expect(201);
    const { client_id: id, client_secret: secret } = res.body as { client_id: string; client_secret: string };
    const verifier = verifierOf();
    const grant = await api().post('/api/connector/oauth/authorize').set('Cookie', sessions.viewer).send(authorizeBody(s256(verifier), { client_id: id })).expect(200);
    const base = { grant_type: 'authorization_code', code: grant.body.code, redirect_uri: CALLBACK, code_verifier: verifier };
    expect((await token({ ...base, client_id: id }).expect(401)).body.error).toBe('invalid_client');
    expect((await token({ ...base, basic: Buffer.from(`${id}:wrong`).toString('base64') }).expect(401)).body.error).toBe('invalid_client');
    await token({ ...base, basic: Buffer.from(`${id}:${secret}`).toString('base64') }).expect(200);
  });

  it('accepts a client identified by its metadata document on Claude’s own host (read once an hour, never elsewhere)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== CIMD) throw new Error(`unexpected fetch of ${url}`);
      return new Response(JSON.stringify({ client_id: CIMD, client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }), { headers: { 'content-type': 'application/json' } });
    });
    try {
      const verifier = verifierOf();
      expect((await check('viewer', authorizeBody(s256(verifier), { client_id: CIMD })).expect(200)).body).toMatchObject({ kind: 'ok', client: { id: CIMD, name: 'Claude' } });
      const grant = await api().post('/api/connector/oauth/authorize').set('Cookie', sessions.viewer).send(authorizeBody(s256(verifier), { client_id: CIMD })).expect(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const res = await token({ grant_type: 'authorization_code', code: grant.body.code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: CIMD }).expect(200);
      await asConnector('get', '/api/connector/me', res.body.access_token).expect(200);
      // another host is never fetched
      expect((await check('viewer', authorizeBody(s256(verifier), { client_id: 'https://evil.example/claude.json' })).expect(200)).body.kind).toBe('show');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
