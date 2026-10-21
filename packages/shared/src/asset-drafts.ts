// Assets, step 2 (owner, 21 October 2026: "i might link a claude account for the assets section only to fetch data and
// help in the data entry"; then "the connection method"): what the Claude connector reads besides the register, and the
// drafts it writes. A draft is never an asset: it has no code, it is in no total or list but Drafts from Claude, and it
// joins the register only when a person confirms it in the system (the spec: "nothing is saved until a person presses
// Save"), when its code is given; Discard sets it aside. The connector can't send photos: the person adds them while
// confirming. It can add the maker's product image from a link, fetched by the website (product-images.ts; owner, 21
// October 2026: "let the mcp connector fetch the product photo and add it / yes build it"). Pure code; the API's answers.

import type { AssetGroup, AssetHolderRef, AssetInput, AssetKitRef, AssetRoomRef, AssetStatus, AssetType, AssetUserRef, AssetValuesInput } from './assets.js';
import { ASSET_GROUP_RULES } from './assets.js';
import type { ProductImageSource, ProductImageType } from './product-images.js';

// ---------- drafts ----------

/** Waiting for a person; confirmed (it became an asset); discarded (set aside, kept for the audit log). */
export const ASSET_DRAFT_STATUSES = ['open', 'confirmed', 'discarded'] as const;
export type AssetDraftStatus = (typeof ASSET_DRAFT_STATUSES)[number];

/** Where a draft came from: the Claude connector (the only source for now). */
export const ASSET_DRAFT_SOURCES = ['claude'] as const;
export type AssetDraftSource = (typeof ASSET_DRAFT_SOURCES)[number];

/** The site's Drafts from Claude list, and a draft's own page: the Add Asset form filled in from it, to review and confirm. */
export const ASSET_DRAFTS_PATH = '/assets/drafts';
export const assetDraftPath = (id: string): string => `/assets/new?draft=${encodeURIComponent(id)}`;

/**
 * A draft as GET /assets/drafts and GET /assets/drafts/:id answer it (custodians and managers). `values` only for the
 * CEO, Finance and a Super Admin, as on an asset; `valuesSet` says to anyone that values were drafted (they are kept
 * when the draft is confirmed, whoever confirms it).
 */
export interface AssetDraftView {
  id: string;
  status: AssetDraftStatus;
  source: AssetDraftSource;
  /** The asset's fields as drafted, fitted to its group (the room and the kit by id). */
  fields: AssetInput;
  room: AssetRoomRef | null;
  kit: AssetKitRef | null;
  values?: AssetValuesInput;
  valuesSet: boolean;
  createdAt: string;
  createdBy: AssetUserRef | null;
  updatedAt: string;
  confirmedAt: string | null;
  confirmedBy: AssetUserRef | null;
  /** The asset it became, once confirmed. */
  asset: { code: string } | null;
  discardedAt: string | null;
  discardedBy: AssetUserRef | null;
  /** The maker's product images Claude added (at most 3), in order; they become the asset's photos when it is confirmed. */
  productImages: AssetDraftImageView[];
}

/**
 * A product image on a draft (owner, 21 October 2026: "let the mcp connector fetch the product photo and add it"),
 * served at GET /assets/drafts/:id/product-images/:imageId; never its bytes in the audit log.
 */
export interface AssetDraftImageView extends ProductImageSource {
  id: string;
  position: number;
  mimeType: ProductImageType;
  sizeBytes: number;
  width: number;
  height: number;
  /** ISO moment it was added. */
  addedAt: string;
  addedBy: AssetUserRef | null;
}

// ---------- what the connector reads ----------

/** An asset in a few words, as the reports list it. */
export interface AssetBriefView {
  code: string;
  name: string;
  group: AssetGroup;
  type: AssetType;
  status: AssetStatus;
  serial: string | null;
  room: AssetRoomRef | null;
  kit: AssetKitRef | null;
}

/** GET /assets/reports/holders?q=: an employee matching the name or code who holds assets now, and what. */
export interface AssetHolderReport {
  employee: AssetHolderRef;
  assets: AssetBriefView[];
  /** Their custody records still open (a shoot's with its return date), CUS-0042 … */
  custody: { code: string; kind: string; dueDate: string | null }[];
}

/** GET /assets/reports/overdue: a shoot's custody past its return date, and what hasn't come back. */
export interface OverdueReturnView {
  code: string;
  employee: AssetHolderRef;
  purpose: string | null;
  /** ISO moment it went out. */
  outAt: string;
  /** YYYY-MM-DD */
  dueDate: string;
  daysOverdue: number;
  items: AssetBriefView[];
}

/** GET /assets/reports/stock: a consumable's stock, flagged when at or under its reorder level. */
export interface StockLevelView {
  code: string;
  name: string;
  type: AssetType;
  quantity: number | null;
  unit: string | null;
  reorderLevel: number | null;
  reorder: boolean;
  room: AssetRoomRef | null;
}

/** GET /assets/reports/counts-due: a group's count, every so many days (spec §2.2), when it was last counted and next due. */
export interface CountDueView {
  group: AssetGroup;
  label: string;
  everyDays: number;
  /** Its assets now, disposed ones aside. */
  assets: number;
  /** ISO moment of its last count of the whole group; null: never counted. */
  lastCountedAt: string | null;
  /** YYYY-MM-DD: the last count and `everyDays`; today when never counted. */
  dueOn: string;
  overdue: boolean;
  neverCounted: boolean;
}

const DAY_MS = 86_400_000;

/** A day (YYYY-MM-DD) plus n days. */
export function dayPlus(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export const daysFromTo = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * When a group is due its count: `everyDays` after the day it was last counted (`lastCountedOn`, YYYY-MM-DD in Cairo),
 * overdue once that day has passed; never counted, it is due today. A group with no assets is never overdue.
 */
export function countDue(group: AssetGroup, assets: number, lastCountedAt: string | null, lastCountedOn: string | null, today: string): CountDueView {
  const rule = ASSET_GROUP_RULES[group];
  const dueOn = lastCountedOn ? dayPlus(lastCountedOn, rule.countEveryDays) : today;
  return {
    group,
    label: rule.label,
    everyDays: rule.countEveryDays,
    assets,
    lastCountedAt,
    dueOn,
    overdue: assets > 0 && dueOn < today,
    neverCounted: lastCountedAt === null,
  };
}
