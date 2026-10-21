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
  /** Drafts from Claude: the open drafts, each reviewed and confirmed on the Add form (assetDraftPath). */
  drafts: '/assets/drafts',
  /** Connect Claude: the connector's address and the steps in Claude. */
  connectClaude: '/assets/connect-claude',
  /** An asset's page: the address inside its QR label (https://people.trendlix.com/assets/{code}). */
  asset: (code: string) => `/assets/${at(code)}`,
  edit: (code: string) => `/assets/${at(code)}/edit`,
  values: (code: string) => `/assets/${at(code)}/values`,
  label: (code: string) => `/assets/${at(code)}/label`,
} as const;

/** The phone pages' Assets pages (/app, the employee app). */
export const APP_ASSET_PATHS = {
  list: '/app/assets',
  listWith: (query: Pick<AssetQuery, 'q' | 'page'>) => `/app/assets${queryOf(query)}`,
  new: '/app/assets/new',
  asset: (code: string) => `/app/assets/${at(code)}`,
} as const;

/** A photo of an asset, served by the website with the caller's session (app/asset-photo). */
export const assetPhotoSrc = (code: string, photoId: string) => `/asset-photo/${at(code)}/${encodeURIComponent(photoId)}`;
