import { describe, expect, it } from 'vitest';
import {
  ASSETS_REFUSALS,
  CONNECTOR_TOOLS,
  type AssetDraftImageView,
  type AssetDraftView,
  type AssetRowView,
  type AssetsAccess,
  type AssetView,
  type ConnectorMe,
} from '@trendlix/shared';
import { assetsApi, type ConnectorCall } from './assets-api';
import { fetchProductImage, type ImageFetchDeps } from './image-guard';
import { jpegOf, pngOf, SVG } from './test-images';
import { ASSET_TOOLS, draftBody, RECONNECT, resolvePlace, type ToolContext } from './tools';

// The Claude connector's tools (owner, 21 October 2026: "the connection method"), with the API mocked: each checks the
// person's Assets level first (drafting for a custodian or a manager), the values rule ("CEO and Finance"), finds rooms
// and kits by name, assets by serial, and gives a draft's link; the API's refusals in its words.

const ORIGIN = 'https://people.trendlix.com';
const TOKEN = 'tlxa_test-token';
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const R3 = '33333333-3333-4333-8333-333333333333';
const K1 = '44444444-4444-4444-8444-444444444444';
const DRAFT = '55555555-5555-4555-8555-555555555555';

const ROOMS = [
  { id: R1, name: 'Studio A', notes: null, archived: false, assets: 3 },
  { id: R2, name: 'Storeroom', notes: null, archived: false, assets: 9 },
  { id: R3, name: 'Old studio', notes: null, archived: true, assets: 0 },
];
const KITS = [{ id: K1, code: 'PK-KIT-A', name: 'Interview kit', notes: null, assets: 2 }];

const row = (over: Partial<AssetRowView> = {}): AssetRowView => ({
  id: 'a1',
  code: 'PK-CAM-0003',
  name: 'Sony FX3',
  group: 'kit',
  type: 'CAM',
  status: 'available',
  condition: 'good',
  brand: 'Sony',
  model: 'FX3',
  serial: 'SN-FX3-1',
  room: { id: R1, name: 'Studio A' },
  kit: null,
  holder: null,
  quantity: null,
  unit: null,
  reorder: false,
  photo: null,
  ...over,
});

/** A row without the list's money, as an asset's page has its own. */
function pageBase(): Omit<AssetRowView, 'values'> {
  const base: AssetRowView = row();
  delete base.values;
  return base;
}

const asset = (over: Partial<AssetView> = {}): AssetView => ({
  ...pageBase(),
  assetClass: 'fixed',
  reorderLevel: null,
  purchaseDate: '2026-03-01',
  usefulLifeYears: 5,
  warrantyEnd: null,
  notes: null,
  labeledAt: null,
  photos: [{ id: 'p1', position: 0 }],
  everInCustody: false,
  createdAt: '2026-10-21T10:00:00Z',
  createdBy: { email: 'mona@trendlix.com', name: 'Mona Hassan' },
  updatedAt: '2026-10-21T10:00:00Z',
  can: { edit: true, photos: true, values: false, delete: false },
  ...over,
});

const draft = (over: Partial<AssetDraftView> = {}): AssetDraftView => ({
  id: DRAFT,
  status: 'open',
  source: 'claude',
  fields: {
    name: 'Sony FX3',
    group: 'kit',
    type: 'CAM',
    assetClass: 'fixed',
    brand: 'Sony',
    model: 'FX3',
    serial: null,
    condition: null,
    roomId: R1,
    kitId: null,
    quantity: null,
    unit: null,
    reorderLevel: null,
    purchaseDate: null,
    usefulLifeYears: 5,
    warrantyEnd: null,
    notes: null,
  },
  room: { id: R1, name: 'Studio A' },
  kit: null,
  valuesSet: false,
  createdAt: '2026-10-21T10:00:00Z',
  createdBy: { email: 'mona@trendlix.com', name: 'Mona Hassan' },
  updatedAt: '2026-10-21T10:00:00Z',
  confirmedAt: null,
  confirmedBy: null,
  asset: null,
  discardedAt: null,
  discardedBy: null,
  productImages: [],
  ...over,
});

type Route = (body: unknown) => { status: number; body?: unknown };

/** The API mocked by method and path; every call kept, with its token. */
function fakeApi(routes: Record<string, Route>) {
  const calls: { method: string; path: string; token: string; body: unknown }[] = [];
  const call: ConnectorCall = async (path, token, init = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body instanceof FormData ? init.body : undefined;
    calls.push({ method, path, token, body });
    const route = routes[`${method} ${path}`];
    const answer = route ? route(body) : { status: 404, body: { statusCode: 404, message: 'Not found.' } };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
  return { api: assetsApi(call, TOKEN), calls };
}

const me = (access: AssetsAccess, values = false): ConnectorMe => ({
  userId: 'u1',
  email: 'mona@trendlix.com',
  name: 'Mona Hassan',
  assets: { access, values },
  scope: 'assets',
  resource: `${ORIGIN}/api/mcp`,
  client: 'Claude',
  sessionId: 's1',
});

const BASE: Record<string, Route> = {
  'GET /assets/rooms': () => ({ status: 200, body: ROOMS }),
  'GET /assets/kits': () => ({ status: 200, body: KITS }),
};

function setup(access: AssetsAccess, routes: Record<string, Route> = {}, values = false, images?: ToolContext['images']) {
  const fake = fakeApi({ ...BASE, ...routes });
  const ctx: ToolContext = { api: fake.api, me: me(access, values), origin: ORIGIN, images };
  const run = (name: string, args: Record<string, unknown> = {}) => ASSET_TOOLS.find((t) => t.name === name)!.run(args, ctx);
  return { ...fake, run };
}

const textOf = (result: { content: { type: string; text?: string }[] }) => result.content.map((c) => c.text ?? '').join('\n');

describe('the tools', () => {
  it('are the thirteen the shared list names, each with a strict schema refusing unknown arguments', () => {
    expect(ASSET_TOOLS.map((t) => t.name)).toEqual(CONNECTOR_TOOLS.map((t) => t.name));
    for (const tool of ASSET_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.safeParse({ surprise: 1 }).success).toBe(false);
    }
    const reads = ASSET_TOOLS.filter((t) => CONNECTOR_TOOLS.find((c) => c.name === t.name)!.level === 'viewer');
    expect(reads.every((t) => t.annotations.readOnlyHint === true)).toBe(true);
    for (const name of ['create_asset_draft', 'update_asset_draft']) {
      const tool = ASSET_TOOLS.find((t) => t.name === name)!;
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(tool.description).toContain('Photos can’t be sent through Claude');
    }
  });

  it('refuse someone without Assets access before asking the API', async () => {
    const { run, calls } = setup('none');
    for (const tool of ASSET_TOOLS) {
      const result = await run(tool.name, tool.name === 'get_asset' ? { code_or_serial: 'PK-CAM-0003' } : {});
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(ASSETS_REFUSALS.none);
    }
    expect(calls).toEqual([]);
  });

  it('keep the drafts for a custodian or a manager: a viewer is refused, in the API’s words', async () => {
    const { run, calls } = setup('viewer');
    for (const name of ['list_asset_drafts', 'create_asset_draft', 'update_asset_draft', 'add_product_image']) {
      const result = await run(name, { name: 'X', group: 'kit', type: 'CAM', draft_id: DRAFT });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(ASSETS_REFUSALS.custodian);
    }
    expect(calls).toEqual([]);
  });

  it('check the arguments again for a caller other than the SDK', async () => {
    const { run } = setup('manager');
    const result = await run('create_asset_draft', { name: 'X', group: 'spaceship', type: 'CAM' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('group');
  });
});

describe('search_assets', () => {
  it('finds a room by its name and a kit by its code, passes the text, holder and page, and links each asset', async () => {
    const { run, calls } = setup('viewer', {
      [`GET /assets?q=fx3&roomId=${R1}&kitId=${K1}&holder=Mona&page=2`]: () => ({
        status: 200,
        body: { items: [row({ holder: { id: 'e1', employeeCode: 'EMP-0042', fullNameEn: 'Mona Hassan' } })], total: 51, page: 2, pageSize: 50, counts: {} },
      }),
    });
    const result = await run('search_assets', { text: 'fx3', room: 'studio a', kit: 'pk-kit-a', holder: 'Mona', page: 2 });
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain('51 assets match; page 2 of 2.');
    expect(text).toContain('"holder":"Mona Hassan (EMP-0042)"');
    expect(text).toContain(`"link":"${ORIGIN}/assets/PK-CAM-0003"`);
    expect(text).not.toContain('values');
    expect(calls.every((c) => c.token === TOKEN)).toBe(true);
  });

  it('passes the money on only when the API sent it ("CEO and Finance")', async () => {
    const { run } = setup('viewer', {
      'GET /assets?group=kit': () => ({
        status: 200,
        body: { items: [row({ values: { purchasePrice: 45000, marketValue: 40000, bookValue: 39000, expensed: false } })], total: 1, page: 1, pageSize: 50, counts: {} },
      }),
    }, true);
    expect(textOf(await run('search_assets', { group: 'kit' }))).toContain('"purchasePrice":45000');
  });

  it('says which rooms there are when none matches, and asks which when several do', async () => {
    const { run } = setup('viewer');
    const none = await run('search_assets', { room: 'Garage' });
    expect(none.isError).toBe(true);
    expect(textOf(none)).toBe('No room matches "Garage". The rooms are: Studio A, Storeroom, Old studio.');
    const several = await run('search_assets', { room: 'st' });
    expect(several.isError).toBe(true);
    expect(textOf(several)).toContain('More than one room matches "st"');
  });

  it('asks the person to reconnect when the connection has ended mid-call', async () => {
    const { run } = setup('viewer', { 'GET /assets': () => ({ status: 401, body: { statusCode: 401, message: 'Please sign in.' } }) });
    const result = await run('search_assets', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(RECONNECT);
  });
});

describe('get_asset', () => {
  it('opens an asset by its code as typed or scanned', async () => {
    const { run, calls } = setup('viewer', { 'GET /assets/PK-CAM-0003': () => ({ status: 200, body: asset() }) });
    const text = textOf(await run('get_asset', { code_or_serial: ' pk-cam-0003 ' }));
    expect(calls.map((c) => c.path)).toEqual(['/assets/PK-CAM-0003']);
    expect(text).toContain('PK-CAM-0003: Sony FX3.');
    expect(text).toContain('"photos":1');
    expect(text).toContain('"by":"Mona Hassan"');
  });

  it('finds one by its serial number, exactly (any case)', async () => {
    const { run, calls } = setup('viewer', {
      'GET /assets?q=sn-fx3-1': () => ({ status: 200, body: { items: [row(), row({ code: 'PK-CAM-0004', serial: 'SN-FX3-10' })], total: 2, page: 1, pageSize: 50, counts: {} } }),
      'GET /assets/PK-CAM-0003': () => ({ status: 200, body: asset() }),
    });
    const text = textOf(await run('get_asset', { code_or_serial: 'sn-fx3-1' }));
    expect(calls.map((c) => c.path)).toEqual(['/assets?q=sn-fx3-1', '/assets/PK-CAM-0003']);
    expect(text).toContain('PK-CAM-0003: Sony FX3.');
  });

  it('says so when no asset has it', async () => {
    const { run } = setup('viewer', { 'GET /assets?q=nothing': () => ({ status: 200, body: { items: [], total: 0, page: 1, pageSize: 50, counts: {} } }) });
    const result = await run('get_asset', { code_or_serial: 'nothing' });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe('No asset has the code or serial number "nothing".');
    expect(textOf(await run('get_asset', { code_or_serial: 'PK-CAM-9999' }))).toBe('No asset has the code PK-CAM-9999.');
  });
});

describe('the reports', () => {
  it('who_holds asks by the name or code, and says when nobody matching holds anything', async () => {
    const { run } = setup('viewer', {
      'GET /assets/reports/holders?q=Mona': () => ({
        status: 200,
        body: [
          {
            employee: { id: 'e1', employeeCode: 'EMP-0042', fullNameEn: 'Mona Hassan' },
            assets: [{ code: 'IT-LAP-0001', name: 'MacBook', group: 'it', type: 'LAP', status: 'custody', serial: null, room: null, kit: null }],
            custody: [{ code: 'CUS-0007', kind: 'assignment', dueDate: null }],
          },
        ],
      }),
      'GET /assets/reports/holders?q=Nobody': () => ({ status: 200, body: [] }),
    });
    const text = textOf(await run('who_holds', { employee: 'Mona' }));
    expect(text).toContain('"employee":"Mona Hassan (EMP-0042)"');
    expect(text).toContain(`${ORIGIN}/assets/IT-LAP-0001`);
    // the custody record's page too (Assets step 3, 21 October 2026)
    expect(text).toContain(`${ORIGIN}/assets/custody/CUS-0007`);
    expect(textOf(await run('who_holds', { employee: 'Nobody' }))).toBe('Nobody matching "Nobody" holds any asset.');
  });

  it('overdue_returns, stock_levels and counts_due read their reports', async () => {
    const { run, calls } = setup('viewer', {
      'GET /assets/reports/overdue': () => ({ status: 200, body: [] }),
      'GET /assets/reports/stock?reorder=1': () => ({
        status: 200,
        body: [{ code: 'CS-TAP-0001', name: 'Gaffer tape', type: 'TAP', quantity: 2, unit: 'rolls', reorderLevel: 5, reorder: true, room: { id: R2, name: 'Storeroom' } }],
      }),
      'GET /assets/reports/counts-due': () => ({
        status: 200,
        body: [{ group: 'kit', label: 'Production kit (movable)', everyDays: 30, assets: 4, lastCountedAt: null, dueOn: '2026-10-21', overdue: false, neverCounted: true }],
      }),
    });
    expect(textOf(await run('overdue_returns'))).toBe('Nothing is overdue.');
    expect(textOf(await run('stock_levels', { reorder_only: true }))).toContain('1 consumable; 1 to reorder.');
    expect(textOf(await run('counts_due'))).toContain('No group is overdue a count.');
    expect(calls.map((c) => c.path)).toEqual(['/assets/reports/overdue', '/assets/reports/stock?reorder=1', '/assets/reports/counts-due']);
  });

  it('overdue_returns lists each shoot past its return date with its custody record’s page (Assets step 3, 21 October 2026)', async () => {
    const { run } = setup('viewer', {
      'GET /assets/reports/overdue': () => ({
        status: 200,
        body: [
          {
            code: 'CUS-0042',
            employee: { id: 'e1', employeeCode: 'EMP-0042', fullNameEn: 'Mona Hassan' },
            purpose: 'Ad shoot',
            outAt: '2026-10-15T07:00:00.000Z',
            dueDate: '2026-10-18',
            daysOverdue: 3,
            items: [{ code: 'PK-CAM-0001', name: 'Camera', group: 'kit', type: 'CAM', status: 'custody', serial: null, room: null, kit: null }],
          },
        ],
      }),
    });
    const text = textOf(await run('overdue_returns'));
    expect(text).toContain('1 custody record is overdue.');
    expect(text).toContain(`${ORIGIN}/assets/custody/CUS-0042`);
    expect(text).toContain(`${ORIGIN}/assets/PK-CAM-0001`);
    expect(text).toContain('"employee":"Mona Hassan (EMP-0042)"');
  });

  it('list_rooms leaves archived rooms out unless asked; list_kits lists the kits', async () => {
    const { run } = setup('viewer');
    expect(textOf(await run('list_rooms'))).not.toContain('Old studio');
    expect(textOf(await run('list_rooms', { include_archived: true }))).toContain('Old studio');
    expect(textOf(await run('list_kits'))).toContain('PK-KIT-A');
  });

  it('asset_catalog gives the groups, types and rules, the person’s access and whether they see the values', async () => {
    const { run } = setup('custodian');
    const result = await run('asset_catalog');
    const catalog = JSON.parse(textOf(result).split('\n\n')[1]);
    expect(catalog.your_access).toBe('custodian');
    expect(catalog.values.you_see_and_set_them).toBe(false);
    expect(catalog.groups.map((g: { key: string }) => g.key)).toEqual(['studio', 'kit', 'it', 'office', 'consumable']);
    expect(catalog.groups[1]).toMatchObject({ code_prefix: 'PK', default_class: 'fixed', useful_life_years: 5, counted_every_days: 30 });
    expect(catalog.types.find((t: { code: string }) => t.code === 'CAM')).toEqual({ code: 'CAM', label: 'Camera', usual_group: 'kit' });
    expect(catalog.statuses.find((s: { key: string }) => s.key === 'custody').set_by_hand).toBe(false);
    expect(catalog.rooms.map((r: { name: string }) => r.name)).toEqual(['Studio A', 'Storeroom']);
    expect(catalog.codes).toContain('given by Trendlix People when a person confirms a draft');
  });
});

describe('drafting', () => {
  it('creates a draft (never an asset) with the API’s field names, the room by name, and gives its link', async () => {
    const { run, calls } = setup('custodian', { 'POST /assets/drafts': () => ({ status: 201, body: draft() }) });
    const result = await run('create_asset_draft', { name: ' Sony FX3 ', group: 'kit', type: 'CAM', brand: 'Sony', room: 'Studio A', useful_life_years: 5, purchase_date: '2026-03-01' });
    expect(result.isError).toBeUndefined();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/assets/drafts');
    expect(post.body).toEqual({ name: 'Sony FX3', group: 'kit', type: 'CAM', brand: 'Sony', roomId: R1, usefulLifeYears: 5, purchaseDate: '2026-03-01' });
    const text = textOf(result);
    expect(text).toContain(`${ORIGIN}/assets/new?draft=${DRAFT}`);
    expect(text).toContain('It is not in the register yet');
    expect(text).toContain('Photos can’t be sent through Claude');
  });

  it('takes the values only from the CEO, Finance and a Super Admin', async () => {
    const custodian = setup('custodian', { 'POST /assets/drafts': () => ({ status: 201, body: draft() }) });
    const refusedResult = await custodian.run('create_asset_draft', { name: 'Sony FX3', group: 'kit', type: 'CAM', values: { market_value: 40000 } });
    expect(refusedResult.isError).toBe(true);
    expect(textOf(refusedResult)).toContain(ASSETS_REFUSALS.values);
    expect(custodian.calls.filter((c) => c.method === 'POST')).toEqual([]);

    const finance = setup('custodian', { 'POST /assets/drafts': () => ({ status: 201, body: draft({ valuesSet: true }) }) }, true);
    await finance.run('create_asset_draft', { name: 'Sony FX3', group: 'kit', type: 'CAM', values: { market_value: 40000, price_note: 'Three listings' } });
    expect(finance.calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Sony FX3', group: 'kit', type: 'CAM', values: { marketValue: 40000, priceNote: 'Three listings' } });
  });

  it('refuses an archived room, and says the API’s problems', async () => {
    const { run } = setup('manager', { 'POST /assets/drafts': () => ({ status: 400, body: { statusCode: 400, message: ['Only consumables are kept by quantity.'], error: 'Bad Request' } }) });
    const archived = await run('create_asset_draft', { name: 'Desk', group: 'office', type: 'DSK', room: 'Old studio' });
    expect(archived.isError).toBe(true);
    expect(textOf(archived)).toBe('The room Old studio is archived: choose another (list_rooms).');
    const refusedResult = await run('create_asset_draft', { name: 'Desk', group: 'office', type: 'DSK', quantity: 3 });
    expect(refusedResult.isError).toBe(true);
    expect(textOf(refusedResult)).toBe('Only consumables are kept by quantity.');
  });

  it('changes a waiting draft: only what is sent, null clears; a confirmed one is refused in the API’s words', async () => {
    const { run, calls } = setup('custodian', {
      [`PATCH /assets/drafts/${DRAFT}`]: (body) => ((body as { notes?: string }).notes === 'late' ? { status: 409, body: { statusCode: 409, message: 'This draft was already confirmed.' } } : { status: 200, body: draft() }),
    });
    const changed = await run('update_asset_draft', { draft_id: DRAFT, room: null, serial: 'SN-2' });
    expect(changed.isError).toBeUndefined();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ serial: 'SN-2', roomId: null });
    expect(textOf(changed)).toContain(`${ORIGIN}/assets/new?draft=${DRAFT}`);
    const late = await run('update_asset_draft', { draft_id: DRAFT, notes: 'late' });
    expect(late.isError).toBe(true);
    expect(textOf(late)).toBe('This draft was already confirmed.');
    const nothing = await run('update_asset_draft', { draft_id: DRAFT });
    expect(nothing.isError).toBe(true);
  });

  it('lists the drafts waiting, each with its link', async () => {
    const { run } = setup('manager', { 'GET /assets/drafts': () => ({ status: 200, body: [draft()] }) });
    const text = textOf(await run('list_asset_drafts'));
    expect(text).toContain('1 draft is waiting to be confirmed.');
    expect(text).toContain(`"draft_id":"${DRAFT}"`);
    expect(text).toContain(`${ORIGIN}/assets/new?draft=${DRAFT}`);
  });
});

describe('rooms and kits by what Claude says', () => {
  it('matches the id, a kit’s code, the name in any case, or a part only one has', () => {
    expect(resolvePlace(R2, ROOMS, 'room')).toMatchObject({ ok: true, place: { name: 'Storeroom' } });
    expect(resolvePlace('STUDIO A', ROOMS, 'room')).toMatchObject({ ok: true, place: { id: R1 } });
    expect(resolvePlace('store', ROOMS, 'room')).toMatchObject({ ok: true, place: { id: R2 } });
    expect(resolvePlace('pk-kit-a', KITS, 'kit')).toMatchObject({ ok: true, place: { id: K1 } });
    expect(resolvePlace('interview', KITS, 'kit')).toMatchObject({ ok: true, place: { id: K1 } });
    expect(resolvePlace('Old studio', ROOMS, 'room', true)).toMatchObject({ ok: true, place: { id: R3 } });
    expect(resolvePlace('Old studio', ROOMS, 'room')).toMatchObject({ ok: false });
    expect(resolvePlace('x', [], 'kit')).toEqual({ ok: false, message: 'There are no kits yet in Trendlix People.' });
  });

  it('turns the tool’s words into the API’s fields', () => {
    expect(draftBody({ name: 'A', reorder_level: 2, asset_class: 'current', values: { invoice_no: 'INV-1' } }, { roomId: null })).toEqual({
      name: 'A',
      reorderLevel: 2,
      assetClass: 'current',
      roomId: null,
      values: { invoiceNo: 'INV-1' },
    });
    expect(draftBody({}, {})).toEqual({});
  });

  // owner, 22 October 2026: accessories, "Both kinds"
  it('sends the accessories’ checklist and the main asset’s code; null clears them', () => {
    expect(draftBody({ accessories: [{ name: 'Charger' }, { name: 'Battery', quantity: 2, serial: 'B-1' }], attach_to: 'PK-GMB-0001' }, {})).toEqual({
      accessories: [
        { name: 'Charger', quantity: 1, serial: null },
        { name: 'Battery', quantity: 2, serial: 'B-1' },
      ],
      parentCode: 'PK-GMB-0001',
    });
    expect(draftBody({ accessories: null, attach_to: null }, {})).toEqual({ accessories: [], parentCode: null });
  });
});

// ---------- add_product_image (owner, 21 October 2026: "let the mcp connector fetch the product photo and add it") ----------

describe('add_product_image', () => {
  const PUBLIC = '93.184.216.34';
  const IMG = 'https://www.sony.com/images/fx3-front.png';
  const PAGE = 'https://www.sony.com/en/electronics/fx3';
  const POST_IMAGES = `POST /assets/drafts/${DRAFT}/product-images`;

  const kept = (over: Partial<AssetDraftImageView> = {}): AssetDraftImageView => ({
    id: 'i1',
    position: 0,
    mimeType: 'image/png',
    sizeBytes: 1234,
    width: 800,
    height: 600,
    sourcePageUrl: PAGE,
    sourceHost: 'sony.com',
    imageUrl: IMG,
    caption: 'Sony FX3, front',
    addedAt: '2026-10-21T10:00:00Z',
    addedBy: { email: 'mona@trendlix.com', name: 'Mona Hassan' },
    ...over,
  });

  /** The internet mocked: its hosts and links; every lookup and request kept. The guard's own rules, unchanged. */
  function web(dns: Record<string, string[]>, links: Record<string, () => Response>) {
    const lookups: string[] = [];
    const requests: string[] = [];
    const deps: ImageFetchDeps = {
      lookup: async (host) => {
        lookups.push(host);
        if (!dns[host]) throw new Error(`ENOTFOUND ${host}`);
        return dns[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
      },
      get: async (url) => {
        requests.push(url.href);
        return links[url.href]?.() ?? new Response('Not found', { status: 404 });
      },
    };
    return { images: (url: string) => fetchProductImage(url, deps), lookups, requests };
  }

  const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
    [`GET /assets/drafts/${DRAFT}`]: () => ({ status: 200, body: draft() }),
    [POST_IMAGES]: () => ({ status: 201, body: [kept()] }),
    ...over,
  });

  const ARGS = { draftId: DRAFT, imageUrl: IMG, sourcePageUrl: PAGE, caption: 'Sony FX3, front' };

  it('fetches a good image itself and sends its bytes to the API with the link, the source page and the caption', async () => {
    const internet = web({ 'www.sony.com': [PUBLIC] }, { [IMG]: () => new Response(pngOf(800, 600), { status: 200, headers: { 'content-type': 'image/png' } }) });
    const { run, calls } = setup('custodian', routes(), false, internet.images);
    const result = await run('add_product_image', ARGS);
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain('Product image added to the draft of Sony FX3 (1 of 3), labelled "Product image · from sony.com"');
    expect(text).toContain('It shows the model, not the item itself');
    expect(text).toContain(`${ORIGIN}/assets/new?draft=${DRAFT}`);
    expect(internet.requests).toEqual([IMG]);

    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe(`/assets/drafts/${DRAFT}/product-images`);
    expect(post.token).toBe(TOKEN);
    const form = post.body as FormData;
    expect(form.get('imageUrl')).toBe(IMG);
    expect(form.get('sourcePageUrl')).toBe(PAGE);
    expect(form.get('caption')).toBe('Sony FX3, front');
    const file = form.get('image') as File;
    expect(file.type).toBe('image/png');
    expect([...new Uint8Array(await file.arrayBuffer()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('refuses an SVG, and sends nothing to the API', async () => {
    const internet = web({ 'www.sony.com': [PUBLIC] }, { [IMG]: () => new Response(SVG, { status: 200, headers: { 'content-type': 'image/svg+xml' } }) });
    const { run, calls } = setup('custodian', routes(), false, internet.images);
    const result = await run('add_product_image', ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^The image wasn’t added: The image is an SVG/);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('refuses a host on a private address without connecting to it', async () => {
    const internet = web({ 'www.sony.com': ['10.0.0.12'] }, { [IMG]: () => new Response(pngOf(800, 600), { status: 200 }) });
    const { run, calls } = setup('manager', routes(), false, internet.images);
    const result = await run('add_product_image', ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('www.sony.com points to a private or reserved address (10.0.0.12)');
    expect(internet.requests).toEqual([]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

    const literal = web({}, {});
    const metadata = await setup('manager', routes(), false, literal.images).run('add_product_image', { ...ARGS, imageUrl: 'https://169.254.169.254/latest/meta-data/' });
    expect(textOf(metadata)).toContain('private or reserved address (169.254.169.254)');
    expect(literal.lookups).toEqual([]);
  });

  it('refuses a redirect to a private address', async () => {
    const internet = web(
      { 'www.sony.com': [PUBLIC], 'images.internal': ['192.168.1.20'] },
      { [IMG]: () => new Response(null, { status: 302, headers: { location: 'https://images.internal/fx3.png' } }) },
    );
    const { run, calls } = setup('custodian', routes(), false, internet.images);
    const result = await run('add_product_image', ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('It redirected to https://images.internal/fx3.png: images.internal points to a private or reserved address (192.168.1.20)');
    expect(internet.requests).toEqual([IMG]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('refuses an image larger than 5 MB, cut off while it arrives', async () => {
    let sent = 0;
    const huge = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            sent++;
            controller.enqueue(sent === 1 ? jpegOf(2000, 2000) : new Uint8Array(1024 * 1024));
          },
        }),
        { status: 200, headers: { 'content-type': 'image/jpeg' } },
      );
    const internet = web({ 'www.sony.com': [PUBLIC] }, { [IMG]: huge });
    const { run, calls } = setup('custodian', routes(), false, internet.images);
    const result = await run('add_product_image', ARGS);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('The image is larger than 5 MB.');
    expect(sent).toBeLessThanOrEqual(8);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('checks the draft first: a full, confirmed or unknown one is never fetched for; the page must be https', async () => {
    const internet = web({ 'www.sony.com': [PUBLIC] }, {});
    const full = setup('custodian', routes({ [`GET /assets/drafts/${DRAFT}`]: () => ({ status: 200, body: draft({ productImages: [kept({ imageUrl: 'a' }), kept({ imageUrl: 'b' }), kept({ imageUrl: 'c' })] }) }) }), false, internet.images);
    expect(textOf(await full.run('add_product_image', ARGS))).toMatch(/has 3 product images already/);
    const done = setup('custodian', routes({ [`GET /assets/drafts/${DRAFT}`]: () => ({ status: 200, body: draft({ status: 'confirmed' }) }) }), false, internet.images);
    expect(textOf(await done.run('add_product_image', ARGS))).toBe('This draft was already confirmed: it is in the register.');
    const unknown = setup('custodian', { [`GET /assets/drafts/${DRAFT}`]: () => ({ status: 404, body: { statusCode: 404, message: 'Draft not found.' } }) }, false, internet.images);
    expect(textOf(await unknown.run('add_product_image', ARGS))).toBe('No draft has that id.');
    const twice = setup('custodian', routes({ [`GET /assets/drafts/${DRAFT}`]: () => ({ status: 200, body: draft({ productImages: [kept()] }) }) }), false, internet.images);
    expect(textOf(await twice.run('add_product_image', ARGS))).toMatch(/^This image is already on the draft of Sony FX3/);
    const plain = await setup('custodian', routes(), false, internet.images).run('add_product_image', { ...ARGS, sourcePageUrl: 'http://www.sony.com/fx3' });
    expect(textOf(plain)).toBe('sourcePageUrl must be an https:// link.');
    expect(internet.requests).toEqual([]);
  });

  it('says the API’s refusal in its words, and says when nothing can fetch here', async () => {
    const internet = web({ 'www.sony.com': [PUBLIC] }, { [IMG]: () => new Response(pngOf(800, 600), { status: 200 }) });
    const refusedByApi = setup('custodian', routes({ [POST_IMAGES]: () => ({ status: 409, body: { statusCode: 409, message: 'A draft has at most 3 product images.' } }) }), false, internet.images);
    expect(textOf(await refusedByApi.run('add_product_image', ARGS))).toBe('A draft has at most 3 product images.');
    const offline = await setup('custodian', routes()).run('add_product_image', ARGS);
    expect(offline.isError).toBe(true);
    expect(textOf(offline)).toMatch(/can’t be fetched here/);
  });
});
