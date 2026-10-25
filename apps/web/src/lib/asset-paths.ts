// The Assets module's addresses (owner, 21 October 2026: "i want to add this module with a special permission to the
// system"): the API's (the web server calls them with lib/api.ts), the site's pages, the phone pages' and the photos'.
// The rules and the API's answers are packages/shared assets.ts. Pure code, no "@/" imports: the tests read it.

const q = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

const at = (code: string) => encodeURIComponent(code);

/** What the register is asked for: the search, the chips, the room and kit, the "Needs values" list, the page. */
export interface AssetQuery {
  q?: string | null;
  group?: string | null;
  status?: string | null;
  roomId?: string | null;
  kitId?: string | null;
  /** Who holds it: their name or employee code (the Claude connector's search, step 2). */
  holder?: string | null;
  needsValues?: boolean;
  page?: number | null;
}

const queryOf = (query: AssetQuery) =>
  q({
    q: query.q?.trim() || null,
    group: query.group,
    status: query.status,
    roomId: query.roomId,
    kitId: query.kitId,
    holder: query.holder?.trim() || null,
    needsValues: query.needsValues ? '1' : null,
    page: query.page && query.page > 1 ? query.page : null,
  });

/** The API's Assets endpoints (all under /api, as lib/api.ts adds it). */
export const ASSET_API = {
  /** GET AssetListView; POST (custodian or manager) → AssetView. */
  list: (query: AssetQuery = {}) => `/assets${queryOf(query)}`,
  create: '/assets',
  /** GET AssetView; PATCH (custodian or manager) → AssetView; DELETE (Super Admin) → 204. */
  asset: (code: string) => `/assets/${at(code)}`,
  /** POST { codes } (a Super Admin; at most 200) → BulkDeleteResult: Delete selected on All Assets (25 October 2026). */
  bulkDelete: '/assets/bulk-delete',
  /** PATCH Partial<AssetValuesInput> (the CEO, Finance, a Super Admin) → AssetView. */
  values: (code: string) => `/assets/${at(code)}/values`,
  /** POST → AssetView: labelled now. */
  labeled: (code: string) => `/assets/${at(code)}/labeled`,
  /** POST multipart `photos` → AssetPhotoRef[]. */
  photos: (code: string) => `/assets/${at(code)}/photos`,
  /** GET the image; PUT multipart `photo` → AssetPhotoRef[]; DELETE (Super Admin) → 204. */
  photo: (code: string, photoId: string) => `/assets/${at(code)}/photos/${encodeURIComponent(photoId)}`,
  /** POST → AssetPhotoRef[]: the main photo. */
  photoFirst: (code: string, photoId: string) => `/assets/${at(code)}/photos/${encodeURIComponent(photoId)}/first`,
  /** GET AssetRoomView[]; POST (manager). */
  rooms: '/assets/rooms',
  /** PATCH (manager); DELETE (Super Admin). */
  room: (id: string) => `/assets/rooms/${encodeURIComponent(id)}`,
  /** GET AssetKitView[]; POST (custodian or manager). */
  kits: '/assets/kits',
  /** PATCH (custodian or manager). */
  kit: (id: string) => `/assets/kits/${encodeURIComponent(id)}`,
  /** GET and PATCH AssetSettingsView (a manager, or the CEO, Finance, a Super Admin). */
  settings: '/assets/settings',
  /**
   * The drafts from Claude (step 2, owner, 21 October 2026: "the connection method"): GET AssetDraftView[] (the open
   * ones), POST a draft (custodian or manager).
   */
  drafts: '/assets/drafts',
  /** GET AssetDraftView; PATCH while it is open. */
  draft: (id: string) => `/assets/drafts/${encodeURIComponent(id)}`,
  /** POST the reviewed Add form → AssetView: the asset made, its code given now (the website only). */
  draftConfirm: (id: string) => `/assets/drafts/${encodeURIComponent(id)}/confirm`,
  /** POST → AssetDraftView: set aside (the website only). */
  draftDiscard: (id: string) => `/assets/drafts/${encodeURIComponent(id)}/discard`,
  /**
   * A draft's product images (21 October 2026: "let the mcp connector fetch the product photo and add it"): POST
   * multipart `image` + imageUrl, sourcePageUrl, caption → AssetDraftImageView[] (the connector's alone).
   */
  draftImages: (id: string) => `/assets/drafts/${encodeURIComponent(id)}/product-images`,
  /** GET the image; DELETE (custodian or manager, while the draft is open) → 204. */
  draftImage: (id: string, imageId: string) => `/assets/drafts/${encodeURIComponent(id)}/product-images/${encodeURIComponent(imageId)}`,
  /** What the connector reads besides the register (anyone with Assets access). */
  reports: {
    /** GET AssetHolderReport[]: who matches the name or code, and what they hold. */
    holders: (q: string) => `/assets/reports/holders${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    /** GET OverdueReturnView[]. */
    overdue: '/assets/reports/overdue',
    /** GET StockLevelView[]; only those to reorder with `reorderOnly`. */
    stock: (reorderOnly = false) => `/assets/reports/stock${reorderOnly ? '?reorder=1' : ''}`,
    /** GET CountDueView[]. */
    countsDue: '/assets/reports/counts-due',
  },
} as const;

/**
 * Assets step 4's endpoints (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal"; owner, 22
 * October 2026: accessories, "Both kinds"; packages/shared asset-accessories.ts and asset-upkeep.ts): a custodian or a
 * manager keeps the accessories, attaches, moves stock, adds to the maintenance log and fills the kits; an Assets
 * manager disposes; the CEO, Finance or a Super Admin set the amount a disposal received.
 */
export const ASSET_STEP4_API = {
  /** PUT { items: [{ name, quantity, serial, notes }] } → AssetView. */
  accessories: (code: string) => `/assets/${at(code)}/accessories`,
  /** PATCH { parentCode } (null detaches) → AssetView. */
  parent: (code: string) => `/assets/${at(code)}/parent`,
  /** POST { kind: 'use' | 'restock', amount, note } → AssetView. */
  stock: (code: string) => `/assets/${at(code)}/stock`,
  /** POST { kind, on, vendor, cost, notes } → AssetView. */
  maintenance: (code: string) => `/assets/${at(code)}/maintenance`,
  /** POST { method, on, amount, approvedBy, notes } → { asset, result } (an Assets manager). */
  dispose: (code: string) => `/assets/${at(code)}/dispose`,
  /** PATCH { amount } → AssetView (the CEO, Finance, a Super Admin). */
  disposal: (code: string) => `/assets/${at(code)}/disposal`,
  /** POST { codes, method, date, approvedBy, note } → BulkDisposeResult (an Assets manager): Dispose selected (25 October 2026). */
  bulkDispose: '/assets/bulk-dispose',
  /** PATCH { add, addCodes, remove } → AssetKitView. */
  kitItems: (id: string) => `/assets/kits/${encodeURIComponent(id)}/items`,
} as const;

/** What a count is of: a group, a room or a kit (Assets step 5). */
export interface CountScopeQuery {
  kind: string;
  group?: string | null;
  roomId?: string | null;
  kitId?: string | null;
}

const scopeQueryOf = (s: CountScopeQuery) => q({ kind: s.kind, group: s.kind === 'group' ? s.group : null, roomId: s.kind === 'room' ? s.roomId : null, kitId: s.kind === 'kit' ? s.kitId : null });

/** What the label sheets choose from (Assets step 5): not labelled yet, a group, a room, a kit, a search. */
export interface LabelQuery {
  unlabelled?: boolean;
  group?: string | null;
  roomId?: string | null;
  kitId?: string | null;
  q?: string | null;
}

const labelQueryOf = (l: LabelQuery) => q({ unlabelled: l.unlabelled ? '1' : null, group: l.group, roomId: l.roomId, kitId: l.kitId, q: l.q?.trim() || null });

/**
 * Assets step 5's endpoints (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard,
 * exports) … work on this"; packages/shared asset-counts.ts has every answer's shape): a viewer and up reads, a
 * custodian or a manager counts, marks lost and marks labels printed.
 */
export const ASSET_STEP5_API = {
  /** GET AssetCountsView (?page=); POST AssetCountInput → AssetCountView (custodian or manager). */
  counts: (page?: number | null) => `/assets/counts${q({ page: page && page > 1 ? page : null })}`,
  count: '/assets/counts',
  /** GET AssetCountSheetView: what a count of the scope expects. */
  sheet: (scope: CountScopeQuery) => `/assets/counts/sheet${scopeQueryOf(scope)}`,
  /** GET AssetCountView. */
  countOne: (id: string) => `/assets/counts/${encodeURIComponent(id)}`,
  /** POST { notes } → AssetCountView: a missing asset of the count marked lost. */
  markLost: (id: string, code: string) => `/assets/counts/${encodeURIComponent(id)}/lines/${at(code)}/lost`,
  /** GET AssetDashboardView. */
  dashboard: '/assets/dashboard',
  /** GET an Excel workbook: register, custody, stock, maintenance, counts. */
  exportFile: (kind: string) => `/assets/exports/${encodeURIComponent(kind)}`,
  /** GET AssetLabelChoice[]: by what was chosen, or exactly `codes`. */
  labels: (query: LabelQuery) => `/assets/labels${labelQueryOf(query)}`,
  labelsFor: (codes: readonly string[]) => `/assets/labels${q({ codes: codes.join(',') })}`,
  /** POST { codes } → { labelled, at }. */
  labelled: '/assets/labels/labelled',
} as const;

/** What the Custody list is asked for (step 3): its filter, the search, the page. */
export interface CustodyQuery {
  filter?: string | null;
  q?: string | null;
  page?: number | null;
}

const custodyQueryOf = (query: CustodyQuery) =>
  q({ filter: query.filter && query.filter !== 'active' ? query.filter : null, q: query.q?.trim() || null, page: query.page && query.page > 1 ? query.page : null });

/**
 * The custody endpoints (Assets step 3, owner, 21 October 2026; packages/shared custody.ts has every answer's shape):
 * a viewer and up reads, a custodian or a manager hands over, receives back and attaches the signed copy; My custody is
 * anyone's own.
 */
export const CUSTODY_API = {
  /** GET CustodyListView (?filter=active|overdue|unsigned|closed|all &q= &page=); POST HandoverDto → HandoverResult. */
  list: (query: CustodyQuery = {}) => `/assets/custody${custodyQueryOf(query)}`,
  handOver: '/assets/custody',
  /** GET HandoverChoices (custodian or manager). */
  choices: '/assets/custody/choices',
  /** GET HolderCardView[]: ?q= a name or an employee code; none: everyone holding something now. */
  people: (search?: string | null) => `/assets/custody/people${q({ q: search?.trim() || null })}`,
  /** GET HoldingsView. */
  person: (employeeId: string) => `/assets/custody/people/${encodeURIComponent(employeeId)}`,
  /** GET CustodyRecordView. */
  record: (code: string) => `/assets/custody/${at(code)}`,
  /** POST { lines: [{ itemId, condition, notes }] } → CustodyRecordView. */
  receive: (code: string) => `/assets/custody/${at(code)}/return`,
  /** POST multipart `file` (a photo or a PDF) → CustodyRecordView. */
  signed: (code: string) => `/assets/custody/${at(code)}/signed`,
  /** GET the signed copy's file. */
  signedFile: (code: string, fileId: string) => `/assets/custody/${at(code)}/signed/${encodeURIComponent(fileId)}`,
  /** GET AssetHistoryView: an asset's custody history and maintenance log. */
  history: (code: string) => `/assets/${at(code)}/history`,
  /** POST { on, vendor, notes } → AssetView: sent to repair; …/back with { cost } too (the values' people). */
  repair: (code: string) => `/assets/${at(code)}/repair`,
  repairBack: (code: string) => `/assets/${at(code)}/repair/back`,
  /** POST { notes } → AssetView. */
  lost: (code: string) => `/assets/${at(code)}/lost`,
  found: (code: string) => `/assets/${at(code)}/found`,
  /** PATCH { terms } or { standard: true } → AssetSettingsView (an Assets manager). */
  terms: '/assets/settings/terms',
  /** GET MyCustodyView: the signed-in person's own. */
  mine: '/me/custody',
  /** GET their own signed form's file. */
  myFile: (code: string, fileId: string) => `/me/custody/${at(code)}/files/${encodeURIComponent(fileId)}`,
} as const;

/** The site's custody pages (step 3). */
export const CUSTODY_PATHS = {
  /** The Custody list: Active, Overdue, Not signed, Closed, All. */
  list: '/assets/custody',
  listWith: (query: CustodyQuery) => `/assets/custody${custodyQueryOf(query)}`,
  /** New handover; ?employee=, ?asset= and (step 4) ?kit= choose them to start with. */
  new: '/assets/custody/new',
  newWith: (start: { employee?: string | null; asset?: string | null; kit?: string | null }) => `/assets/custody/new${q({ employee: start.employee, asset: start.asset, kit: start.kit })}`,
  /** A custody record's page, its form to print, and a signed copy (served by the website with the caller's session). */
  record: (code: string) => `/assets/custody/${at(code)}`,
  form: (code: string) => `/assets/custody/${at(code)}/form`,
  signedFile: (code: string, fileId: string) => `/assets/custody/${at(code)}/signed/${encodeURIComponent(fileId)}`,
  /** Holdings: "Type a name or code to see what they hold". */
  holders: '/assets/holders',
  holdersWith: (search: string | null) => `/assets/holders${q({ q: search?.trim() || null })}`,
  /** A person's holdings, and their custody statement to print. */
  person: (employeeId: string) => `/assets/holders/${encodeURIComponent(employeeId)}`,
  statement: (employeeId: string) => `/assets/holders/${encodeURIComponent(employeeId)}/statement`,
  /** My custody (owner, 21 October 2026: "Yes, My custody"): opens the person's own profile on its Custody tab. */
  mine: '/my-custody',
  /** Their own signed form, served by the website with their session. */
  myFile: (code: string, fileId: string) => `/my-custody/${at(code)}/files/${encodeURIComponent(fileId)}`,
} as const;

/** The phone pages' custody pages (/app): My custody, and for a custodian a handover and a record. */
export const APP_CUSTODY_PATHS = {
  mine: '/app/custody',
  new: '/app/assets/custody/new',
  newWith: (start: { employee?: string | null; asset?: string | null }) => `/app/assets/custody/new${q({ employee: start.employee, asset: start.asset })}`,
  record: (code: string) => `/app/assets/custody/${at(code)}`,
} as const;

/** The site's Assets pages. */
export const ASSET_PATHS = {
  /** The register. */
  list: '/assets',
  /** The register with a search or a filter. */
  listWith: (query: AssetQuery) => `/assets${queryOf(query)}`,
  new: '/assets/new',
  /** Those without a purchase cost, for the CEO, Finance and a Super Admin. */
  needsValues: '/assets/needs-values',
  kits: '/assets/kits',
  rooms: '/assets/rooms',
  settings: '/assets/settings',
  /** Step 4: the consumables with their stock, Use and Restock. */
  stock: '/assets/stock',
  /** Drafts from Claude: the open drafts, each reviewed and confirmed on the Add form (assetDraftPath). */
  drafts: '/assets/drafts',
  /** Connect Claude: the connector's address and the steps in Claude. */
  connectClaude: '/assets/connect-claude',
  /** An asset's page: the address inside its QR label (https://people.trendlix.com/assets/{code}). */
  asset: (code: string) => `/assets/${at(code)}`,
  edit: (code: string) => `/assets/${at(code)}/edit`,
  values: (code: string) => `/assets/${at(code)}/values`,
  label: (code: string) => `/assets/${at(code)}/label`,
  // Assets step 5 (22 October 2026): the dashboard, the counts, the label sheets and the exports
  dashboard: '/assets/dashboard',
  counts: '/assets/counts',
  countsPage: (page: number) => `/assets/counts${q({ page: page > 1 ? page : null })}`,
  countNew: (scope: CountScopeQuery) => `/assets/counts/new${scopeQueryOf(scope)}`,
  count: (id: string) => `/assets/counts/${encodeURIComponent(id)}`,
  labels: '/assets/labels',
  labelsWith: (query: LabelQuery) => `/assets/labels${labelQueryOf(query)}`,
  labelsPrint: (codes: readonly string[], start = 1) => `/assets/labels/print${q({ codes: codes.join(','), start: start > 1 ? start : null })}`,
  /** An export, served by the website with the caller's session. */
  exportFile: (kind: string) => `/assets/exports/${encodeURIComponent(kind)}`,
} as const;

/** The phone pages' Assets pages (/app, the employee app). */
export const APP_ASSET_PATHS = {
  list: '/app/assets',
  listWith: (query: Pick<AssetQuery, 'q' | 'page'>) => `/app/assets${queryOf(query)}`,
  new: '/app/assets/new',
  asset: (code: string) => `/app/assets/${at(code)}`,
  // Assets step 5 (22 October 2026): counting with the phone's camera, and a label scanned to open its asset
  counts: '/app/assets/counts',
  countNew: (scope: CountScopeQuery) => `/app/assets/counts/new${scopeQueryOf(scope)}`,
  count: (id: string) => `/app/assets/counts/${encodeURIComponent(id)}`,
  scan: '/app/assets/scan',
} as const;

/** A photo of an asset, served by the website with the caller's session (app/asset-photo). */
export const assetPhotoSrc = (code: string, photoId: string) => `/asset-photo/${at(code)}/${encodeURIComponent(photoId)}`;

/** A draft's product image, served by the website with the caller's session (app/asset-draft-image). */
export const draftImageSrc = (draftId: string, imageId: string) => `/asset-draft-image/${encodeURIComponent(draftId)}/${encodeURIComponent(imageId)}`;
