import {
  ASSET_CLASS_LABELS,
  ASSET_CLASSES,
  ASSET_CONDITION_LABELS,
  ASSET_CONDITIONS,
  ASSET_CUSTODY_HOLDER_LABELS,
  ASSET_GROUP_LABELS,
  ASSET_GROUP_RULES,
  ASSET_GROUPS,
  ASSET_MONEY_MAX,
  ASSET_QUANTITY_MAX,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  ASSET_STATUSES_BY_HAND,
  ASSET_TEXT_LIMITS,
  ASSET_TYPES,
  ASSET_USEFUL_LIFE_MAX,
  ASSETS_REFUSALS,
  assetDraftPath,
  assetFieldsOf,
  assetsAccessAtLeast,
  CONNECTOR_TOOLS,
  isAssetCode,
  normalAssetCode,
  type AssetDraftView,
  type AssetHolderReport,
  type AssetKitView,
  type AssetListView,
  type AssetRoomView,
  type AssetRowView,
  type AssetType,
  type AssetView,
  type ConnectorMe,
  type ConnectorToolName,
  type CountDueView,
  type OverdueReturnView,
  type StockLevelView,
} from '@trendlix/shared';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ASSET_API, ASSET_PATHS, CUSTODY_PATHS } from '../asset-paths';
import type { ApiAnswer, AssetsApi } from './assets-api';

// The Claude connector's tools (owner, 21 October 2026: "i might link a claude account for the assets section only to
// fetch data and help in the data entry"; then "the connection method"): reading the register, who holds what, overdue
// returns, stock, the counts due, the rooms, the kits and the catalog of groups and types; and, for an Assets custodian
// or manager, drafting assets that a person confirms in the system (the spec: "nothing is saved until a person presses
// Save"). Each tool checks the person's Assets level first and answers in the API's words; every call goes to the API
// with the connector's token, so the API checks the level and the values rule ("CEO and Finance") again and leaves the
// money out for everyone else. Not offered at all: disposal, deleting, custody handover and return, counts, settings,
// and anything outside Assets. Photos can't come through the connector: a draft's link is where the person adds them.
// Pure code (no "@/" imports): tested with a mocked API.

/** What a tool call has at hand: the API with the connector's token, whose connection it is, and the site's origin. */
export interface ToolContext {
  api: AssetsApi;
  me: ConnectorMe;
  origin: string;
}

export interface ConnectorTool {
  name: ConnectorToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: ToolAnnotations;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<CallToolResult>;
}

// ---------- answers ----------

/** A result: a sentence for the person, then the data as JSON (compact: a page of 50 assets stays small). */
export function said(summary: string, data?: unknown): CallToolResult {
  return { content: [{ type: 'text', text: data === undefined ? summary : `${summary}\n\n${JSON.stringify(data)}` }] };
}

/** A refusal or a failure, in words (isError: Claude says it to the person). */
export function refused(...messages: string[]): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: messages.filter(Boolean).join(' ') }] };
}

export const RECONNECT = 'The connection to Trendlix People has ended. Reconnect it in Claude (Customize → Connectors → Trendlix People → Connect).';

/** The API's refusal of a call, in its words. */
function apiRefusal(answer: ApiAnswer<unknown>, notFound: string): CallToolResult {
  if (answer.status === 401) return refused(RECONNECT);
  if (answer.status === 404) return refused(notFound);
  return refused(...(answer.messages.length ? answer.messages : [`Trendlix People refused the request (${answer.status}).`]));
}

/** The person's Assets level allows the tool, or the refusal (the API checks again). */
function levelRefusal(ctx: ToolContext, level: 'viewer' | 'custodian'): CallToolResult | null {
  const access = ctx.me.assets.access;
  if (access === 'none') return refused(ASSETS_REFUSALS.none);
  if (!assetsAccessAtLeast(access, level)) return refused(ASSETS_REFUSALS.custodian);
  return null;
}

const levelOf = (name: ConnectorToolName) => CONNECTOR_TOOLS.find((t) => t.name === name)!.level;

// ---------- in words ----------

const assetLink = (ctx: ToolContext, code: string) => `${ctx.origin}${ASSET_PATHS.asset(code)}`;
/** A custody record's page on the site (Assets step 3, 21 October 2026): who_holds and overdue_returns link each. */
const custodyLink = (ctx: ToolContext, code: string) => `${ctx.origin}${CUSTODY_PATHS.record(code)}`;
const draftLink = (ctx: ToolContext, id: string) => `${ctx.origin}${assetDraftPath(id)}`;

/** A row of the register for Claude: the keys as the API has them, the room, kit and holder in words, its page. */
export function rowFor(r: AssetRowView, ctx: ToolContext) {
  return {
    code: r.code,
    name: r.name,
    group: r.group,
    type: r.type,
    status: r.status,
    condition: r.condition,
    brand: r.brand,
    model: r.model,
    serial: r.serial,
    room: r.room?.name ?? null,
    kit: r.kit ? `${r.kit.code} ${r.kit.name}` : null,
    holder: r.holder ? `${r.holder.fullNameEn} (${r.holder.employeeCode})` : null,
    ...(r.group === 'consumable' && { quantity: r.quantity, unit: r.unit, reorder: r.reorder }),
    ...(r.values && { values: r.values }),
    link: assetLink(ctx, r.code),
  };
}

/** An asset's page for Claude: every field the person may see (the money only when the API sent it), and its address. */
export function assetFor(a: AssetView, ctx: ToolContext) {
  return {
    code: a.code,
    name: a.name,
    group: a.group,
    type: a.type,
    asset_class: a.assetClass,
    status: a.status,
    condition: a.condition,
    brand: a.brand,
    model: a.model,
    serial: a.serial,
    room: a.room?.name ?? null,
    kit: a.kit ? `${a.kit.code} ${a.kit.name}` : null,
    holder: a.holder ? `${a.holder.fullNameEn} (${a.holder.employeeCode})` : null,
    ...(a.group === 'consumable' && { quantity: a.quantity, unit: a.unit, reorder_level: a.reorderLevel, reorder: a.reorder }),
    purchase_date: a.purchaseDate,
    useful_life_years: a.usefulLifeYears,
    warranty_end: a.warrantyEnd,
    notes: a.notes,
    labelled_at: a.labeledAt,
    photos: a.photos.length,
    ever_in_custody: a.everInCustody,
    registered: { at: a.createdAt, by: a.createdBy?.name ?? a.createdBy?.email ?? null },
    updated_at: a.updatedAt,
    ...(a.values && { values: a.values }),
    link: assetLink(ctx, a.code),
  };
}

/** A draft for Claude: its fields, the room and kit by name, the values when the API sent them, and its page. */
export function draftFor(d: AssetDraftView, ctx: ToolContext) {
  return {
    draft_id: d.id,
    status: d.status,
    fields: { ...d.fields, roomId: undefined, kitId: undefined, room: d.room?.name ?? null, kit: d.kit ? `${d.kit.code} ${d.kit.name}` : null },
    ...(d.values && { values: d.values }),
    values_drafted: d.valuesSet,
    drafted: { at: d.createdAt, by: d.createdBy?.name ?? d.createdBy?.email ?? null },
    updated_at: d.updatedAt,
    ...(d.asset && { asset: { code: d.asset.code, link: assetLink(ctx, d.asset.code) } }),
    link: draftLink(ctx, d.id),
  };
}

// ---------- rooms and kits by name ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Place = { id: string; name: string; code?: string; archived?: boolean };

/**
 * A room or a kit from what Claude says of it: its id, a kit's code (PK-KIT-A), its name (any case), or a part of its
 * name that only one has. Archived rooms only when `archivedToo` (a search; never for a draft). Else what to say.
 */
export function resolvePlace<T extends Place>(said: string, list: readonly T[], what: 'room' | 'kit', archivedToo = false): { ok: true; place: T } | { ok: false; message: string } {
  const wanted = said.trim();
  const lower = wanted.toLowerCase();
  const pickable = list.filter((p) => archivedToo || !p.archived);
  const byId = UUID.test(wanted) ? list.find((p) => p.id.toLowerCase() === lower) : undefined;
  const exact = byId ?? list.find((p) => p.code?.toLowerCase() === lower) ?? list.find((p) => p.name.toLowerCase() === lower);
  if (exact) {
    if (!archivedToo && exact.archived) return { ok: false, message: `The ${what} ${exact.name} is archived: choose another (list_rooms).` };
    return { ok: true, place: exact };
  }
  const partial = pickable.filter((p) => p.name.toLowerCase().includes(lower) || (p.code?.toLowerCase().includes(lower) ?? false));
  if (partial.length === 1) return { ok: true, place: partial[0] };
  const names = (ps: readonly T[]) => ps.map((p) => (p.code ? `${p.code} ${p.name}` : p.name)).join(', ');
  if (partial.length > 1) return { ok: false, message: `More than one ${what} matches "${wanted}": ${names(partial)}. Say which one.` };
  return {
    ok: false,
    message: pickable.length ? `No ${what} matches "${wanted}". The ${what}s are: ${names(pickable)}.` : `There are no ${what}s yet in Trendlix People.`,
  };
}

async function loadRooms(ctx: ToolContext) {
  return ctx.api.get<AssetRoomView[]>(ASSET_API.rooms);
}

async function loadKits(ctx: ToolContext) {
  return ctx.api.get<AssetKitView[]>(ASSET_API.kits);
}

/** The room and kit Claude named, as ids for the API; null clears (an update), undefined leaves it. */
async function placesFor(ctx: ToolContext, args: { room?: string | null; kit?: string | null }, archivedToo: boolean): Promise<{ roomId?: string | null; kitId?: string | null } | CallToolResult> {
  const out: { roomId?: string | null; kitId?: string | null } = {};
  if (typeof args.room === 'string') {
    const rooms = await loadRooms(ctx);
    if (!rooms.ok || !rooms.body) return apiRefusal(rooms, 'The rooms could not be read.');
    const found = resolvePlace(args.room, rooms.body, 'room', archivedToo);
    if (!found.ok) return refused(found.message);
    out.roomId = found.place.id;
  } else if (args.room === null) out.roomId = null;
  if (typeof args.kit === 'string') {
    const kits = await loadKits(ctx);
    if (!kits.ok || !kits.body) return apiRefusal(kits, 'The kits could not be read.');
    const found = resolvePlace(args.kit, kits.body, 'kit', true);
    if (!found.ok) return refused(found.message);
    out.kitId = found.place.id;
  } else if (args.kit === null) out.kitId = null;
  return out;
}

const isResult = (value: unknown): value is CallToolResult => !!value && typeof value === 'object' && 'content' in value;

// ---------- the schemas ----------

const TYPE_CODES = ASSET_TYPES.map((t) => t.code) as [AssetType, ...AssetType[]];

const text = (max: number) => z.string().trim().min(1).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date as YYYY-MM-DD.');
const money = z.number().min(0).max(ASSET_MONEY_MAX);
const amount = z.number().min(0).max(ASSET_QUANTITY_MAX);
const placeName = z.string().trim().min(1).max(120);

/** The draft's fields; `edit`: each may also be null, to clear it. */
function draftShape(edit: boolean) {
  const opt = <T extends z.ZodType>(schema: T) => (edit ? schema.nullable().optional() : schema.optional());
  const values = z
    .object({
      purchase_price: opt(money).describe('Purchase cost in EGP, from the invoice.'),
      supplier: opt(text(ASSET_TEXT_LIMITS.supplier)),
      invoice_no: opt(text(ASSET_TEXT_LIMITS.invoiceNo)),
      price_low: opt(money).describe('Market value, low (EGP).'),
      market_value: opt(money).describe('What it would fetch now in Egypt, in its condition (EGP).'),
      price_high: opt(money).describe('Market value, high (EGP).'),
      price_note: opt(text(ASSET_TEXT_LIMITS.priceNote)).describe('How the market value was reached, in a sentence or two.'),
    })
    .strict();
  return {
    name: (edit ? text(ASSET_TEXT_LIMITS.name).optional() : text(ASSET_TEXT_LIMITS.name)).describe('What people call it, e.g. "Sony FX3 camera body".'),
    group: (edit ? z.enum(ASSET_GROUPS).optional() : z.enum(ASSET_GROUPS)).describe('How it is managed: studio, kit, it, office or consumable (see asset_catalog).'),
    type: (edit ? z.enum(TYPE_CODES).optional() : z.enum(TYPE_CODES)).describe('Its type code, e.g. CAM for a camera (see asset_catalog).'),
    asset_class: z.enum(ASSET_CLASSES).optional().describe('fixed or current; left out, the group’s own.'),
    brand: opt(text(ASSET_TEXT_LIMITS.brand)),
    model: opt(text(ASSET_TEXT_LIMITS.model)),
    serial: opt(text(ASSET_TEXT_LIMITS.serial)).describe('Exactly as on its label. Not for consumables.'),
    condition: opt(z.enum(ASSET_CONDITIONS)).describe('new, excellent, good, used or needs_repair. Not for consumables.'),
    room: opt(placeName).describe('The room it is kept in: its name or id (list_rooms).'),
    kit: opt(placeName).describe('Production kit assets only: the kit’s code (PK-KIT-A), name or id (list_kits).'),
    quantity: opt(amount).describe('Consumables only: how many there are now.'),
    unit: opt(text(ASSET_TEXT_LIMITS.unit)).describe('Consumables only: rolls, packs, sheets, m …'),
    reorder_level: opt(amount).describe('Consumables only: flagged to reorder at or under it.'),
    purchase_date: opt(day).describe('YYYY-MM-DD, not after today.'),
    useful_life_years: opt(z.number().int().min(1).max(ASSET_USEFUL_LIFE_MAX)).describe('Whole years; left out, the group’s own.'),
    warranty_end: opt(day).describe('YYYY-MM-DD.'),
    notes: opt(text(ASSET_TEXT_LIMITS.notes)).describe('Visible specs, colour, accessories, defects.'),
    values: values.optional().describe(
      'The money, only for the CEO, Finance and a Super Admin (EGP). Anyone else: leave it out, or the draft is refused.',
    ),
  };
}

const FIELD_KEYS = {
  name: 'name',
  group: 'group',
  type: 'type',
  asset_class: 'assetClass',
  brand: 'brand',
  model: 'model',
  serial: 'serial',
  condition: 'condition',
  quantity: 'quantity',
  unit: 'unit',
  reorder_level: 'reorderLevel',
  purchase_date: 'purchaseDate',
  useful_life_years: 'usefulLifeYears',
  warranty_end: 'warrantyEnd',
  notes: 'notes',
} as const;

const VALUE_KEYS = {
  purchase_price: 'purchasePrice',
  supplier: 'supplier',
  invoice_no: 'invoiceNo',
  price_low: 'priceLow',
  market_value: 'marketValue',
  price_high: 'priceHigh',
  price_note: 'priceNote',
} as const;

/** What POST or PATCH /assets/drafts is sent: Claude's words as the API's fields (what isn't sent stays as it is). */
export function draftBody(args: Record<string, unknown>, places: { roomId?: string | null; kitId?: string | null }): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(FIELD_KEYS)) if (args[from] !== undefined) body[to] = args[from];
  if (places.roomId !== undefined) body.roomId = places.roomId;
  if (places.kitId !== undefined) body.kitId = places.kitId;
  const values = args.values as Record<string, unknown> | undefined;
  if (values) {
    const v: Record<string, unknown> = {};
    for (const [from, to] of Object.entries(VALUE_KEYS)) if (values[from] !== undefined) v[to] = values[from];
    if (Object.keys(v).length) body.values = v;
  }
  return body;
}

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DRAFT: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const CANT = 'It can’t delete, dispose of, hand over or receive assets, count them or change settings.';

const PHOTOS_NOTE = 'Photos can’t be sent through Claude: the person adds them on the draft’s page before confirming it.';

// ---------- the tools ----------

function tool<S extends z.ZodRawShape>(def: {
  name: ConnectorToolName;
  title: string;
  description: string;
  shape: S;
  annotations: ToolAnnotations;
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<CallToolResult>;
}): ConnectorTool {
  const level = levelOf(def.name);
  const schema = z.object(def.shape).strict();
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: schema as unknown as z.ZodObject,
    annotations: def.annotations,
    // the SDK checks the arguments against the schema before calling; checked here again for any other caller
    run: async (args, ctx) => {
      const refusal = levelRefusal(ctx, level);
      if (refusal) return refusal;
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) return refused(...parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}.`));
      return def.run(parsed.data as z.infer<z.ZodObject<S>>, ctx);
    },
  };
}

export const ASSET_TOOLS: ConnectorTool[] = [
  tool({
    name: 'search_assets',
    title: 'Search assets',
    description:
      'Search the Trendlix People asset register (read only). Filter by free text (name, code, serial or holder), group, status, room, kit or who holds it; 50 a page, by code. Disposed assets only when status is "disposed". Money (purchase cost, market and book value) is shown only to the CEO, Finance and a Super Admin. ' +
      CANT,
    shape: {
      text: z.string().trim().max(100).optional().describe('Words to find in the name, code, serial number or holder.'),
      group: z.enum(ASSET_GROUPS).optional(),
      status: z.enum(ASSET_STATUSES).optional(),
      room: placeName.optional().describe('A room’s name or id.'),
      kit: placeName.optional().describe('A kit’s code (PK-KIT-A), name or id.'),
      holder: z.string().trim().min(2).max(100).optional().describe('Who holds it: an employee’s name or code.'),
      page: z.number().int().min(1).max(1000).optional(),
    },
    annotations: READ,
    run: async (args, ctx) => {
      const places = await placesFor(ctx, { room: args.room, kit: args.kit }, true);
      if (isResult(places)) return places;
      const path = ASSET_API.list({ q: args.text, group: args.group, status: args.status, roomId: places.roomId, kitId: places.kitId, holder: args.holder, page: args.page });
      const found = await ctx.api.get<AssetListView>(path);
      if (!found.ok || !found.body) return apiRefusal(found, 'The register could not be read.');
      const list = found.body;
      const pages = Math.max(1, Math.ceil(list.total / (list.pageSize || 50)));
      const summary = list.total
        ? `${list.total} ${list.total === 1 ? 'asset matches' : 'assets match'}${pages > 1 ? `; page ${list.page} of ${pages}` : ''}.`
        : 'No asset matches.';
      return said(summary, { total: list.total, page: list.page, pages, assets: list.items.map((r) => rowFor(r, ctx)) });
    },
  }),

  tool({
    name: 'get_asset',
    title: 'Get an asset',
    description:
      'One asset of the register by its code (e.g. PK-CAM-0003, as on its QR label) or its serial number (read only): every field the person may see, how many photos it has, and the link to its page. Money only for the CEO, Finance and a Super Admin.',
    shape: { code_or_serial: z.string().trim().min(1).max(ASSET_TEXT_LIMITS.serial).describe('The asset’s code, or its serial number.') },
    annotations: READ,
    run: async (args, ctx) => {
      const wanted = args.code_or_serial;
      const code = normalAssetCode(wanted);
      if (isAssetCode(code)) {
        const one = await ctx.api.get<AssetView>(ASSET_API.asset(code));
        if (one.status === 404) return said(`No asset has the code ${code}.`);
        if (!one.ok || !one.body) return apiRefusal(one, `No asset has the code ${code}.`);
        return said(`${one.body.code}: ${one.body.name}.`, assetFor(one.body, ctx));
      }
      const found = await ctx.api.get<AssetListView>(ASSET_API.list({ q: wanted }));
      if (!found.ok || !found.body) return apiRefusal(found, 'The register could not be read.');
      const lower = wanted.toLowerCase();
      const matches = found.body.items.filter((r) => r.serial?.toLowerCase() === lower).slice(0, 5);
      if (!matches.length) return said(`No asset has the code or serial number "${wanted}".`);
      const assets = [];
      for (const m of matches) {
        const one = await ctx.api.get<AssetView>(ASSET_API.asset(m.code));
        if (one.ok && one.body) assets.push(assetFor(one.body, ctx));
      }
      return said(assets.length === 1 ? `${assets[0].code}: ${assets[0].name}.` : `${assets.length} assets have the serial number "${wanted}".`, assets.length === 1 ? assets[0] : assets);
    },
  }),

  tool({
    name: 'who_holds',
    title: 'Who holds what',
    description:
      'What an employee holds now (read only), by their name or employee code: the assets in their custody and their custody records still open. Only people who hold something are listed.',
    shape: { employee: z.string().trim().min(2).max(100).describe('The employee’s name, or part of it, or their employee code.') },
    annotations: READ,
    run: async (args, ctx) => {
      const found = await ctx.api.get<AssetHolderReport[]>(ASSET_API.reports.holders(args.employee));
      if (!found.ok || !found.body) return apiRefusal(found, 'Who holds what could not be read.');
      if (!found.body.length) return said(`Nobody matching "${args.employee}" holds any asset.`);
      const people = found.body.map((h) => ({
        employee: `${h.employee.fullNameEn} (${h.employee.employeeCode})`,
        assets: h.assets.map((a) => ({ ...a, room: a.room?.name ?? null, kit: a.kit ? `${a.kit.code} ${a.kit.name}` : null, link: assetLink(ctx, a.code) })),
        custody: h.custody.map((c) => ({ ...c, link: custodyLink(ctx, c.code) })),
      }));
      return said(`${people.length} ${people.length === 1 ? 'person matches' : 'people match'}.`, people);
    },
  }),

  tool({
    name: 'overdue_returns',
    title: 'Overdue returns',
    description: 'Shoot custody past its return date (read only): the custody record, who has it, how many days late, and what hasn’t come back.',
    shape: {},
    annotations: READ,
    run: async (_args, ctx) => {
      const found = await ctx.api.get<OverdueReturnView[]>(ASSET_API.reports.overdue);
      if (!found.ok || !found.body) return apiRefusal(found, 'The overdue returns could not be read.');
      if (!found.body.length) return said('Nothing is overdue.');
      const late = found.body.map((o) => ({
        ...o,
        link: custodyLink(ctx, o.code),
        employee: `${o.employee.fullNameEn} (${o.employee.employeeCode})`,
        items: o.items.map((a) => ({ code: a.code, name: a.name, link: assetLink(ctx, a.code) })),
      }));
      return said(`${late.length} custody ${late.length === 1 ? 'record is' : 'records are'} overdue.`, late);
    },
  }),

  tool({
    name: 'stock_levels',
    title: 'Stock levels',
    description: 'The consumables and their stock (read only), each flagged when at or under its reorder level; only those to reorder with reorder_only.',
    shape: { reorder_only: z.boolean().optional().describe('Only the consumables to reorder.') },
    annotations: READ,
    run: async (args, ctx) => {
      const found = await ctx.api.get<StockLevelView[]>(ASSET_API.reports.stock(args.reorder_only === true));
      if (!found.ok || !found.body) return apiRefusal(found, 'The stock could not be read.');
      const rows = found.body.map((s) => ({ ...s, room: s.room?.name ?? null, link: assetLink(ctx, s.code) }));
      const reorder = rows.filter((r) => r.reorder).length;
      if (!rows.length) return said(args.reorder_only ? 'Nothing needs reordering.' : 'There are no consumables in the register.');
      return said(`${rows.length} ${rows.length === 1 ? 'consumable' : 'consumables'}; ${reorder} to reorder.`, rows);
    },
  }),

  tool({
    name: 'counts_due',
    title: 'Counts due',
    description: 'When each group is due its count (read only): how often it is counted, when it was last counted, when it is next due and whether that has passed. Counting itself is done in Trendlix People, not through Claude.',
    shape: {},
    annotations: READ,
    run: async (_args, ctx) => {
      const found = await ctx.api.get<CountDueView[]>(ASSET_API.reports.countsDue);
      if (!found.ok || !found.body) return apiRefusal(found, 'The counts due could not be read.');
      const overdue = found.body.filter((c) => c.overdue).length;
      return said(overdue ? `${overdue} ${overdue === 1 ? 'group is' : 'groups are'} overdue a count.` : 'No group is overdue a count.', found.body);
    },
  }),

  tool({
    name: 'list_rooms',
    title: 'List rooms',
    description: 'The rooms assets are kept in (read only), with how many assets each has. Archived rooms (no longer offered for new assets) only with include_archived.',
    shape: { include_archived: z.boolean().optional() },
    annotations: READ,
    run: async (args, ctx) => {
      const found = await loadRooms(ctx);
      if (!found.ok || !found.body) return apiRefusal(found, 'The rooms could not be read.');
      const rooms = found.body.filter((r) => args.include_archived || !r.archived).map((r) => ({ id: r.id, name: r.name, notes: r.notes, archived: r.archived, assets: r.assets }));
      return said(rooms.length ? `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}.` : 'There are no rooms yet.', rooms);
    },
  }),

  tool({
    name: 'list_kits',
    title: 'List kits',
    description: 'The production kits (read only): their codes (PK-KIT-A …), names and how many assets each has. Only production kit assets go in a kit.',
    shape: {},
    annotations: READ,
    run: async (_args, ctx) => {
      const found = await loadKits(ctx);
      if (!found.ok || !found.body) return apiRefusal(found, 'The kits could not be read.');
      return said(found.body.length ? `${found.body.length} ${found.body.length === 1 ? 'kit' : 'kits'}.` : 'There are no kits yet.', found.body);
    },
  }),

  tool({
    name: 'asset_catalog',
    title: 'Asset catalog',
    description:
      'What an asset’s fields take, so drafts are filled correctly (read only): the five groups (their code prefix, default class, useful life, count cadence, who holds them, the fields each has), the type codes and their usual group, the conditions, the statuses, the classes, how codes are given, the text limits, the values rule, and the rooms and kits.',
    shape: {},
    annotations: READ,
    run: async (_args, ctx) => {
      const [rooms, kits] = await Promise.all([loadRooms(ctx), loadKits(ctx)]);
      const catalog = {
        your_access: ctx.me.assets.access,
        groups: ASSET_GROUPS.map((g) => {
          const rule = ASSET_GROUP_RULES[g];
          return {
            key: g,
            label: ASSET_GROUP_LABELS[g],
            code_prefix: rule.prefix,
            default_class: rule.defaultClass,
            useful_life_years: rule.usefulLifeYears,
            counted_every_days: rule.countEveryDays,
            held_by: ASSET_CUSTODY_HOLDER_LABELS[rule.custodyBy],
            examples: rule.examples,
            fields: assetFieldsOf(g),
          };
        }),
        types: ASSET_TYPES.map((t) => ({ code: t.code, label: t.label, usual_group: t.group })),
        conditions: ASSET_CONDITIONS.map((c) => ({ key: c, label: ASSET_CONDITION_LABELS[c] })),
        statuses: ASSET_STATUSES.map((s) => ({ key: s, label: ASSET_STATUS_LABELS[s], set_by_hand: (ASSET_STATUSES_BY_HAND as readonly string[]).includes(s) })),
        classes: ASSET_CLASSES.map((c) => ({ key: c, label: ASSET_CLASS_LABELS[c] })),
        codes:
          'PREFIX-TYPE-NNNN, e.g. PK-CAM-0003: the group’s prefix, the type code and a number, given by Trendlix People when a person confirms a draft. Never chosen, never in a draft, never changed.',
        dates: 'YYYY-MM-DD',
        text_limits: { name: ASSET_TEXT_LIMITS.name, brand: ASSET_TEXT_LIMITS.brand, model: ASSET_TEXT_LIMITS.model, serial: ASSET_TEXT_LIMITS.serial, unit: ASSET_TEXT_LIMITS.unit, notes: ASSET_TEXT_LIMITS.notes },
        values: {
          you_see_and_set_them: ctx.me.assets.values,
          rule: 'Only the CEO, Finance and a Super Admin see and set the purchase cost, supplier, invoice, market value and book value (EGP).',
        },
        drafts: 'A draft is in no total or list but Drafts from Claude; it joins the register only when a person confirms it in Trendlix People. ' + PHOTOS_NOTE,
        rooms: rooms.ok && rooms.body ? rooms.body.filter((r) => !r.archived).map((r) => ({ id: r.id, name: r.name })) : [],
        kits: kits.ok && kits.body ? kits.body.map((k) => ({ id: k.id, code: k.code, name: k.name })) : [],
      };
      return said('The asset catalog.', catalog);
    },
  }),

  tool({
    name: 'list_asset_drafts',
    title: 'List asset drafts',
    description: 'The drafts from Claude still waiting for a person to confirm them (Assets custodians and managers only), newest first, each with its link.',
    shape: {},
    annotations: READ,
    run: async (_args, ctx) => {
      const found = await ctx.api.get<AssetDraftView[]>(ASSET_API.drafts);
      if (!found.ok || !found.body) return apiRefusal(found, 'The drafts could not be read.');
      if (!found.body.length) return said('No draft is waiting.');
      return said(`${found.body.length} ${found.body.length === 1 ? 'draft is' : 'drafts are'} waiting to be confirmed.`, found.body.map((d) => draftFor(d, ctx)));
    },
  }),

  tool({
    name: 'create_asset_draft',
    title: 'Draft an asset',
    description:
      'Draft a new asset for a person to review (Assets custodians and managers only). It is NOT added to the register: nothing is saved as an asset until a person confirms the draft in Trendlix People, when its code is given. The fields are the Add asset form’s: name, group and type at least (see asset_catalog); a consumable has a quantity, unit and reorder level, and no serial, condition or useful life; only a production kit asset goes in a kit. Values (money) only for the CEO, Finance and a Super Admin. ' +
      PHOTOS_NOTE +
      ' Always give the person the draft’s link from the answer.',
    shape: draftShape(false),
    annotations: DRAFT,
    run: async (args, ctx) => {
      if (args.values && !ctx.me.assets.values) return refused(ASSETS_REFUSALS.values, 'Draft it again without the values.');
      const places = await placesFor(ctx, { room: args.room, kit: args.kit }, false);
      if (isResult(places)) return places;
      const made = await ctx.api.send<AssetDraftView>('POST', ASSET_API.drafts, draftBody(args, places));
      if (!made.ok || !made.body) return apiRefusal(made, 'The draft could not be saved.');
      const link = draftLink(ctx, made.body.id);
      return said(
        `Draft saved: ${made.body.fields.name}. It is not in the register yet: a person reviews and confirms it at ${link} (its code is given then). ${PHOTOS_NOTE}`,
        draftFor(made.body, ctx),
      );
    },
  }),

  tool({
    name: 'update_asset_draft',
    title: 'Change an asset draft',
    description:
      'Change a draft from Claude that is still waiting (Assets custodians and managers only): only the fields sent change, null clears one. A confirmed or discarded draft can’t be changed. Values (money) only for the CEO, Finance and a Super Admin. ' +
      PHOTOS_NOTE,
    shape: { draft_id: z.uuid().describe('The draft’s id, from create_asset_draft or list_asset_drafts.'), ...draftShape(true) },
    annotations: { ...DRAFT, idempotentHint: true },
    run: async (args, ctx) => {
      if (args.values && !ctx.me.assets.values) return refused(ASSETS_REFUSALS.values, 'Change it again without the values.');
      const places = await placesFor(ctx, { room: args.room, kit: args.kit }, false);
      if (isResult(places)) return places;
      const body = draftBody(args, places);
      if (!Object.keys(body).length) return refused('Say what to change on the draft.');
      const changed = await ctx.api.send<AssetDraftView>('PATCH', ASSET_API.draft(args.draft_id), body);
      if (!changed.ok || !changed.body) return apiRefusal(changed, 'No draft has that id.');
      return said(`Draft changed: ${changed.body.fields.name}. A person confirms it at ${draftLink(ctx, changed.body.id)}. ${PHOTOS_NOTE}`, draftFor(changed.body, ctx));
    },
  }),
];

/** What the server tells Claude about itself, once, when it connects. */
export const SERVER_INSTRUCTIONS = [
  'Trendlix People’s Assets section: the studio’s asset register (cameras, lenses, lights, IT, furniture, consumables), read with the signed-in person’s own Assets access.',
  'Read with search_assets, get_asset, who_holds, overdue_returns, stock_levels, counts_due, list_rooms, list_kits and asset_catalog.',
  'To help with data entry, an Assets custodian or manager can draft assets (create_asset_draft, update_asset_draft): call asset_catalog first to fill the group, type and fields correctly. A draft is not an asset: a person confirms it in Trendlix People, where its code is given and its photos are added. Always share the draft’s link.',
  'Money (purchase cost, market value, book value) is only for the CEO, Finance and a Super Admin: never ask anyone else for it.',
  'Nothing else is possible through this connector: no deleting, disposal, custody handover or return, counts, settings, or anything outside Assets.',
].join(' ');
