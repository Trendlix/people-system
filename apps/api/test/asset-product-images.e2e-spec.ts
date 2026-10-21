import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { AssetDraftImageView, AssetDraftView, AssetListView, AssetView, Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { s256 } from '../src/connector/connector-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { GIF, jpegOf, pngOf, SVG } from './fixtures/images.js';
import { createApp, createUser, signIn } from './helpers.js';

// Product images on a draft from Claude (owner, 21 October 2026: "i want claude to add product image from its specs. is
// this applicable?", then "let the mcp connector fetch the product photo and add it / yes build it"): the API side of
// add_product_image, as the website's MCP endpoint sends the image it fetched with the connector's token. Up to 3 a
// draft still waiting, the connector's alone to add (a custodian's or a manager's connection), checked again by its
// bytes and its links; seen and removed on the website by a custodian or a manager; moved to the asset on confirm as
// product images with their source (a real photo going before them), deleted on discard; audited "via Claude
// connector" with the source page, never the picture.

const RUN = Date.now().toString(36);
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const RESOURCE = 'https://people.trendlix.com/api/mcp';
const IP = '198.51.100.21';
const PAGE = 'https://www.sony.com/en/electronics/interchangeable-lens-cameras/ilme-fx3';
const IMG = (n: number) => `https://www.sony.com/image/fx3-${n}.png`;

describe('Product images on drafts from Claude (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let clientId: string;

  async function account(key: string, roles: Role[], assetsAccess?: string) {
    const email = await createUser(prisma, roles);
    ids[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    if (assetsAccess) await prisma.user.update({ where: { id: ids[key] }, data: { assetsAccess } });
    sessions[key] = await signIn(app, email);
  }

  /** Allow on the consent page, then the code for tokens: the connector's access token, as Claude has it. */
  async function connect(key: string) {
    const verifier = randomBytes(48).toString('base64url');
    const grant = await api()
      .post('/api/connector/oauth/authorize')
      .set('Cookie', sessions[key])
      .send({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: s256(verifier),
        code_challenge_method: 'S256',
        scope: 'assets',
        state: 's',
        resource: RESOURCE,
        expectedResource: RESOURCE,
      })
      .expect(200);
    const res = await api()
      .post('/api/connector/oauth/token')
      .send({ grant_type: 'authorization_code', code: grant.body.code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: clientId, resource: RESOURCE, ip: IP, userAgent: 'Claude-User' })
      .expect(200);
    tokens[key] = res.body.access_token;
  }

  const asConnector = (key: string) => ({
    get: (path: string) => api().get(path).set('Authorization', `Bearer ${tokens[key]}`),
    post: (path: string) => api().post(path).set('Authorization', `Bearer ${tokens[key]}`),
    delete: (path: string) => api().delete(path).set('Authorization', `Bearer ${tokens[key]}`),
  });

  /** What the website's MCP endpoint sends: the image it fetched, its link, the source page and Claude's caption. */
  function sendImage(req: request.Test, image: Buffer, fields: Record<string, string>, type = 'image/png') {
    let r = req;
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('image', image, { filename: 'product-image.png', contentType: type });
  }
  const imagesOf = (draftId: string) => `/api/assets/drafts/${draftId}/product-images`;
  const addAs = (key: string, draftId: string, image: Buffer, fields: Record<string, string>) => sendImage(asConnector(key).post(imagesOf(draftId)), image, fields);

  async function draftFor(name: string): Promise<AssetDraftView> {
    return (await asConnector('custodian').post('/api/assets/drafts').send({ name, group: 'kit', type: 'CAM', brand: 'Sony', model: 'FX3' }).expect(201)).body as AssetDraftView;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('viewer', ['employee'], 'viewer');
    await account('custodian', ['employee'], 'custodian');
    await account('manager', ['employee'], 'manager');
    const res = await api()
      .post('/api/connector/oauth/register')
      .send({ client_name: 'Claude', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none', ip: IP })
      .expect(201);
    clientId = res.body.client_id;
    for (const key of ['viewer', 'custodian', 'manager']) await connect(key);
  });

  afterAll(async () => {
    const assets = await prisma.asset.findMany({ where: { name: { contains: RUN } }, select: { id: true } });
    await prisma.assetDraft.deleteMany({ where: { createdById: { in: Object.values(ids) } } });
    await prisma.asset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
    // the code counter, back as it was when no asset of its kind is left (assets.e2e-spec.ts expects PK-CAM-0001 first)
    if (!(await prisma.asset.count({ where: { code: { startsWith: 'PK-CAM-' } } }))) await prisma.assetCodeCounter.deleteMany({ where: { prefix: 'PK-CAM-' } });
    await prisma.connectorClient.deleteMany({ where: { ip: IP } });
    await app.close();
  });

  it('adds up to 3 to a draft through the connector, each checked by its bytes and links; a 4th refused; audited via Claude', async () => {
    const draft = await draftFor(`FX3 A ${RUN}`);
    expect(draft.productImages).toEqual([]);

    const first = await addAs('custodian', draft.id, pngOf(800, 600), { imageUrl: IMG(1), sourcePageUrl: PAGE, caption: 'Sony FX3, front' }).expect(201);
    expect(first.body).toHaveLength(1);
    expect(first.body[0]).toMatchObject({ position: 0, mimeType: 'image/png', width: 800, height: 600, sourcePageUrl: PAGE, sourceHost: 'sony.com', imageUrl: IMG(1), caption: 'Sony FX3, front' });
    await addAs('custodian', draft.id, pngOf(640, 640), { imageUrl: IMG(2), sourcePageUrl: PAGE }).expect(201);
    const third = await addAs('manager', draft.id, jpegOf(1600, 1200), { imageUrl: IMG(3), sourcePageUrl: PAGE }).expect(201);
    expect((third.body as AssetDraftImageView[]).map((i) => [i.position, i.imageUrl])).toEqual([
      [0, IMG(1)],
      [1, IMG(2)],
      [2, IMG(3)],
    ]);

    // a 4th: refused, none added
    const fourth = await addAs('custodian', draft.id, pngOf(300, 300), { imageUrl: IMG(4), sourcePageUrl: PAGE }).expect(409);
    expect(fourth.body.message).toMatch(/^A draft has at most 3 product images/);
    expect(await prisma.assetDraftImage.count({ where: { draftId: draft.id } })).toBe(3);

    // checked again here, whatever the website did: the bytes, the size, the links
    const other = await draftFor(`FX3 B ${RUN}`);
    const refusedFor = async (image: Buffer, fields: Record<string, string>) => (await addAs('custodian', other.id, image, fields).expect(400)).body.message.join(' ');
    expect(await refusedFor(SVG, { imageUrl: IMG(5), sourcePageUrl: PAGE })).toMatch(/SVG/);
    expect(await refusedFor(GIF, { imageUrl: IMG(5), sourcePageUrl: PAGE })).toBe('The link is not a JPEG, PNG or WebP image.');
    expect(await refusedFor(Buffer.from('<html>no</html>'), { imageUrl: IMG(5), sourcePageUrl: PAGE })).toBe('The link is not a JPEG, PNG or WebP image.');
    expect(await refusedFor(pngOf(60, 400), { imageUrl: IMG(5), sourcePageUrl: PAGE })).toMatch(/at least 100/);
    expect(await refusedFor(jpegOf(9000, 300), { imageUrl: IMG(5), sourcePageUrl: PAGE })).toMatch(/at most 8000/);
    expect(await refusedFor(Buffer.concat([jpegOf(1000, 1000), Buffer.alloc(5 * 1024 * 1024)]), { imageUrl: IMG(5), sourcePageUrl: PAGE })).toBe('The image is larger than 5 MB.');
    expect(await refusedFor(pngOf(300, 300), { imageUrl: 'http://www.sony.com/fx3.png', sourcePageUrl: PAGE })).toBe('The image link must be an https:// link.');
    expect(await refusedFor(pngOf(300, 300), { imageUrl: IMG(5), sourcePageUrl: 'javascript:alert(1)' })).toBe('The source page must be an https:// link.');
    const none = await asConnector('custodian').post(imagesOf(other.id)).field('imageUrl', IMG(5)).field('sourcePageUrl', PAGE).expect(400);
    expect(none.body.message).toEqual(['Send the image.']);
    // the same image twice
    await addAs('custodian', other.id, pngOf(300, 300), { imageUrl: IMG(5), sourcePageUrl: PAGE }).expect(201);
    expect((await addAs('custodian', other.id, pngOf(300, 300), { imageUrl: IMG(5), sourcePageUrl: PAGE }).expect(409)).body.message).toBe('This image is already on the draft.');
    // no such draft
    await addAs('custodian', '00000000-0000-4000-8000-000000000000', pngOf(300, 300), { imageUrl: IMG(5), sourcePageUrl: PAGE }).expect(404);

    // the draft's answer lists them, never their bytes; the website shows each
    const read = (await api().get(`/api/assets/drafts/${draft.id}`).set('Cookie', sessions.custodian).expect(200)).body as AssetDraftView;
    expect(read.productImages.map((i) => i.imageUrl)).toEqual([IMG(1), IMG(2), IMG(3)]);
    expect(read.productImages[0].addedBy).toMatchObject({ email: expect.any(String) });
    expect(JSON.stringify(read)).not.toMatch(/"data"/);
    const shown = await api().get(`${imagesOf(draft.id)}/${read.productImages[0].id}`).set('Cookie', sessions.custodian).expect(200);
    expect(shown.headers['content-type']).toBe('image/png');
    expect(shown.headers['content-security-policy']).toBe("default-src 'none'");
    expect(Buffer.from(shown.body).equals(pngOf(800, 600))).toBe(true);
    // another draft's image isn't this one's
    await api().get(`${imagesOf(other.id)}/${read.productImages[0].id}`).set('Cookie', sessions.custodian).expect(404);

    // audited via Claude, with the source page and the link, never the picture
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'asset_draft', entityId: draft.id, action: 'add_product_image' }, orderBy: { at: 'asc' } });
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.via === 'claude_connector')).toBe(true);
    expect(entries[0].diff).toMatchObject({ sourcePageUrl: PAGE, imageUrl: IMG(1), caption: 'Sony FX3, front', width: 800, height: 600, fileName: 'fx3-1.png' });
    expect(JSON.stringify(entries.map((e) => e.diff)).length).toBeLessThan(2000);
  });

  it('is the connector’s alone to add, for a custodian or a manager; seen and removed on the website only', async () => {
    const draft = await draftFor(`FX3 C ${RUN}`);
    // a viewer's connection can't add
    await addAs('viewer', draft.id, pngOf(300, 300), { imageUrl: IMG(1), sourcePageUrl: PAGE }).expect(403);
    // the website can't add one: only what the connector fetched is labelled a product image
    const site = await sendImage(api().post(imagesOf(draft.id)).set('Cookie', sessions.custodian), pngOf(300, 300), { imageUrl: IMG(1), sourcePageUrl: PAGE }).expect(403);
    expect(site.body.message).toMatch(/added by Claude through the connector/);

    const added = (await addAs('custodian', draft.id, pngOf(300, 300), { imageUrl: IMG(1), sourcePageUrl: PAGE }).expect(201)).body as AssetDraftImageView[];
    const imageId = added[0].id;
    // the connector reads the draft (its images listed), but neither fetches nor removes an image
    expect(((await asConnector('custodian').get(`/api/assets/drafts/${draft.id}`).expect(200)).body as AssetDraftView).productImages).toHaveLength(1);
    expect((await asConnector('custodian').get(`${imagesOf(draft.id)}/${imageId}`).expect(403)).body.message).toMatch(/Claude connector only reads Assets/);
    await asConnector('manager').delete(`${imagesOf(draft.id)}/${imageId}`).expect(403);
    // a viewer neither sees nor removes one
    await api().get(`${imagesOf(draft.id)}/${imageId}`).set('Cookie', sessions.viewer).expect(403);
    await api().delete(`${imagesOf(draft.id)}/${imageId}`).set('Cookie', sessions.viewer).expect(403);
  });

  it('removes one on the website, the others closing up; audited', async () => {
    const draft = await draftFor(`FX3 D ${RUN}`);
    for (const n of [1, 2, 3]) await addAs('custodian', draft.id, pngOf(200 + n, 200), { imageUrl: IMG(n), sourcePageUrl: PAGE }).expect(201);
    const before = ((await api().get(`/api/assets/drafts/${draft.id}`).set('Cookie', sessions.custodian).expect(200)).body as AssetDraftView).productImages;
    await api().delete(`${imagesOf(draft.id)}/${before[0].id}`).set('Cookie', sessions.custodian).expect(204);
    await api().delete(`${imagesOf(draft.id)}/${before[0].id}`).set('Cookie', sessions.custodian).expect(404);
    const after = ((await api().get(`/api/assets/drafts/${draft.id}`).set('Cookie', sessions.manager).expect(200)).body as AssetDraftView).productImages;
    expect(after.map((i) => [i.position, i.imageUrl])).toEqual([
      [0, IMG(2)],
      [1, IMG(3)],
    ]);
    // room again for one more
    await addAs('custodian', draft.id, pngOf(300, 300), { imageUrl: IMG(4), sourcePageUrl: PAGE }).expect(201);
    const removed = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_draft', entityId: draft.id, action: 'remove_product_image' } });
    expect(removed).toMatchObject({ userId: ids.custodian, via: null, diff: { imageId: before[0].id, sourcePageUrl: PAGE, imageUrl: IMG(1) } });
  });

  it('moves them to the asset on confirm, as product images with their source; a real photo then goes before them', async () => {
    const draft = await draftFor(`FX3 E ${RUN}`);
    await addAs('custodian', draft.id, pngOf(800, 600), { imageUrl: IMG(1), sourcePageUrl: PAGE, caption: 'Front' }).expect(201);
    await addAs('custodian', draft.id, pngOf(600, 800), { imageUrl: IMG(2), sourcePageUrl: 'https://store.example.com/fx3' }).expect(201);

    const confirmed = await api()
      .post(`/api/assets/drafts/${draft.id}/confirm`)
      .set('Cookie', sessions.custodian)
      .send({ name: `FX3 E ${RUN}`, group: 'kit', type: 'CAM', brand: 'Sony', model: 'FX3' })
      .expect(201);
    const asset = confirmed.body as AssetView;
    expect(asset.code).toMatch(/^PK-CAM-\d{4}$/);
    expect(asset.photos).toEqual([
      { id: expect.any(String), position: 0, product: { sourcePageUrl: PAGE, sourceHost: 'sony.com', imageUrl: IMG(1), caption: 'Front' } },
      { id: expect.any(String), position: 1, product: { sourcePageUrl: 'https://store.example.com/fx3', sourceHost: 'store.example.com', imageUrl: IMG(2), caption: null } },
    ]);
    // kept as the asset's photos, kind 'product' with their source; gone from the draft
    const rows = await prisma.assetPhoto.findMany({ where: { asset: { code: asset.code } }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => [r.kind, r.sourcePageUrl, r.imageUrl, r.caption, r.uploadedById])).toEqual([
      ['product', PAGE, IMG(1), 'Front', ids.custodian],
      ['product', 'https://store.example.com/fx3', IMG(2), null, ids.custodian],
    ]);
    expect(Buffer.from(rows[0].data).equals(pngOf(800, 600))).toBe(true);
    expect(await prisma.assetDraftImage.count({ where: { draftId: draft.id } })).toBe(0);
    // the first is the list's photo until a real one is added, badged as a product image
    const listed = ((await api().get(`/api/assets?q=${encodeURIComponent(`FX3 E ${RUN}`)}`).set('Cookie', sessions.viewer).expect(200)).body as AssetListView).items[0];
    expect(listed.photo).toEqual(asset.photos[0]);
    const shown = await api().get(`/api/assets/${asset.code}/photos/${asset.photos[0].id}`).set('Cookie', sessions.viewer).expect(200);
    expect(shown.headers['content-type']).toBe('image/png');

    // audited: the confirm with how many came, each photo made from the draft, with its source
    const confirm = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_draft', entityId: draft.id, action: 'confirm' } });
    expect(confirm.diff).toMatchObject({ code: asset.code, productImages: 2 });
    const made = await prisma.auditLog.findMany({ where: { entityType: 'asset_photo', entityId: { in: rows.map((r) => r.id) }, action: 'create' } });
    expect(made).toHaveLength(2);
    expect(made[0].diff).toMatchObject({ code: asset.code, kind: 'product', draftId: draft.id });
    expect(JSON.stringify(made.map((m) => m.diff))).toContain(PAGE);

    // a real photo of the item goes first, as the main one; the product images keep their order after it
    const real = await api().post(`/api/assets/${asset.code}/photos`).set('Cookie', sessions.custodian).attach('photos', pngOf(400, 300, [10, 200, 10]), 'mine.png').expect(201);
    expect(real.body.map((p: { position: number; product?: unknown }) => [p.position, !!p.product])).toEqual([
      [0, false],
      [1, true],
      [2, true],
    ]);
    // another real photo goes after the real one, not first
    const more = await api().post(`/api/assets/${asset.code}/photos`).set('Cookie', sessions.custodian).attach('photos', pngOf(400, 300, [0, 0, 200]), 'back.png').expect(201);
    expect(more.body.map((p: { product?: unknown }) => !!p.product)).toEqual([false, true, true, false]);

    // a product image replaced by the person's own photo is a real photo
    await api().put(`/api/assets/${asset.code}/photos/${asset.photos[1].id}`).set('Cookie', sessions.custodian).attach('photo', pngOf(500, 500), 'own.png').expect(200);
    const page = (await api().get(`/api/assets/${asset.code}`).set('Cookie', sessions.viewer).expect(200)).body as AssetView;
    expect(page.photos.find((p) => p.id === asset.photos[1].id)).toEqual({ id: asset.photos[1].id, position: expect.any(Number) });
    expect((await prisma.assetPhoto.findUniqueOrThrow({ where: { id: asset.photos[1].id } })).kind).toBe('photo');

    // a confirmed draft takes no more
    expect((await addAs('custodian', draft.id, pngOf(300, 300), { imageUrl: IMG(9), sourcePageUrl: PAGE }).expect(409)).body.message).toMatch(/already confirmed/);
  });

  it('deletes them with the draft’s discard', async () => {
    const draft = await draftFor(`FX3 F ${RUN}`);
    await addAs('custodian', draft.id, pngOf(300, 300), { imageUrl: IMG(1), sourcePageUrl: PAGE }).expect(201);
    await addAs('custodian', draft.id, pngOf(300, 300), { imageUrl: IMG(2), sourcePageUrl: PAGE }).expect(201);
    const discarded = (await api().post(`/api/assets/drafts/${draft.id}/discard`).set('Cookie', sessions.custodian).expect(200)).body as AssetDraftView;
    expect(discarded).toMatchObject({ status: 'discarded', productImages: [] });
    expect(await prisma.assetDraftImage.count({ where: { draftId: draft.id } })).toBe(0);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'asset_draft', entityId: draft.id, action: 'discard' } });
    expect(entry.diff).toMatchObject({ productImagesRemoved: 2 });
    expect((await addAs('custodian', draft.id, pngOf(300, 300), { imageUrl: IMG(3), sourcePageUrl: PAGE }).expect(409)).body.message).toMatch(/discarded/);
  });
});
