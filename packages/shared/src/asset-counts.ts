// Assets step 5 (owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard, exports) …
// work on this"; the spec's §5 Dashboard, Counts, labels and exports, §6 rules 5–7):
// - Counts: a group, a room or a kit counted by ticking what is there (tapped, typed or scanned from its label). Each
//   asset expected (the scope's, disposed ones aside, lost ones in, so one found comes back) gets a result: in custody →
//   out (it is with its holder), ticked → found, else missing. A lost asset found is available again; a missing one is
//   only marked lost by a deliberate "Mark lost" afterwards (spec §6.5). A group's count is due its interval after its
//   last count of the whole group, never counted: due now (spec §6.6, asset-drafts.ts countDue). Consumables are counted
//   like the rest, by being there: their quantity is put right with Use and Restock.
// - Label sheets: A4, 3 × 8 labels of 63 × 30 mm (spec §5), each the single label's (QR to its page, code, name,
//   company), from a chosen label on, so a sheet already partly used is used up.
// - The dashboard: what is out, available, under repair and lost; the market and book values (the CEO, Finance and a
//   Super Admin only: "CEO and Finance"); the chips that need attention, each opening its list.
// - Exports: the register, custody, stock moves, the maintenance log and the counts as Excel, the money columns only for
//   those who see the values.
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/asset-counts.spec.ts.

import type { AssetBriefView, CountDueView } from './asset-drafts.js';
import {
  ASSET_GROUP_LABELS,
  isAssetCode,
  isAssetGroup,
  normalAssetCode,
  type AssetGroup,
  type AssetHolderRef,
  type AssetKitRef,
  type AssetRoomRef,
  type AssetStatus,
  type AssetUserRef,
} from './assets.js';

// ---------- counts ----------

/** What a count covers: a whole group, a room or a kit (spec §3 counts.scope_kind). */
export const ASSET_COUNT_SCOPES = ['group', 'room', 'kit'] as const;
export type AssetCountScopeKind = (typeof ASSET_COUNT_SCOPES)[number];

export const ASSET_COUNT_SCOPE_LABELS: Record<AssetCountScopeKind, string> = { group: 'Group', room: 'Room', kit: 'Kit' };

export const isAssetCountScope = (value: unknown): value is AssetCountScopeKind => (ASSET_COUNT_SCOPES as readonly unknown[]).includes(value);

/** Each expected asset's result in a count. */
export const ASSET_COUNT_RESULTS = ['found', 'missing', 'out'] as const;
export type AssetCountResult = (typeof ASSET_COUNT_RESULTS)[number];

export const ASSET_COUNT_RESULT_LABELS: Record<AssetCountResult, string> = { found: 'Found', missing: 'Missing', out: 'Out (in custody)' };

/** The limits of a count as sent. */
export const ASSET_COUNT_LIMITS = {
  notes: 1000,
  /** The most assets ticked in one count. */
  found: 5000,
  /** The counts' history, a page. */
  pageSize: 30,
} as const;

/**
 * An expected asset's result (spec §3 record_count): in custody, out, whether ticked or not (the record says who has
 * it); ticked, found; else missing.
 */
export function countResultOf(status: AssetStatus | string, ticked: boolean): AssetCountResult {
  if (status === 'custody') return 'out';
  return ticked ? 'found' : 'missing';
}

/** The status an asset takes from its count: a lost one found is available again; any other stays as it is. */
export function statusAfterCount(status: AssetStatus, result: AssetCountResult): AssetStatus {
  return status === 'lost' && result === 'found' ? 'available' : status;
}

/** A count's figures from its lines. */
export function countFigures(lines: readonly { result: AssetCountResult | string; lostMarked?: boolean }[]): { expected: number; found: number; missing: number; out: number; lostMarked: number } {
  const figures = { expected: lines.length, found: 0, missing: 0, out: 0, lostMarked: 0 };
  for (const l of lines) {
    if (l.result === 'found') figures.found += 1;
    else if (l.result === 'missing') figures.missing += 1;
    else if (l.result === 'out') figures.out += 1;
    if (l.lostMarked) figures.lostMarked += 1;
  }
  return figures;
}

/** What a count is of, as sent: the kind and the group, room or kit it names. */
export interface AssetCountScopeInput {
  kind: AssetCountScopeKind;
  group?: AssetGroup | null;
  roomId?: string | null;
  kitId?: string | null;
}

/** POST /assets/counts: the scope, the codes ticked as there, and notes. */
export interface AssetCountInput extends AssetCountScopeInput {
  found: string[];
  notes?: string | null;
}

/** What is wrong with a count's scope as sent, each in words (none: it names one group, room or kit). */
export function countScopeProblems(s: Partial<AssetCountScopeInput>): string[] {
  if (!isAssetCountScope(s.kind)) return ['Choose what to count: a group, a room or a kit.'];
  if (s.kind === 'group' && !isAssetGroup(s.group)) return ['Choose the group to count.'];
  if (s.kind === 'room' && !s.roomId) return ['Choose the room to count.'];
  if (s.kind === 'kit' && !s.kitId) return ['Choose the kit to count.'];
  return [];
}

/** The group's words as a count is named by them ("Production kit (movable)"). */
export const countGroupLabel = (group: AssetGroup): string => ASSET_GROUP_LABELS[group];

/**
 * An asset's code from what was typed or scanned: a code ("pk-cam-0003", any case and spacing) or its label's address
 * (https://people.trendlix.com/assets/PK-CAM-0003, or the phone pages' /app/assets/…); null when it is neither.
 */
export function codeFromLabel(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    let path: string;
    try {
      path = new URL(raw).pathname;
    } catch {
      return null;
    }
    const m = /^\/(?:app\/)?assets\/([^/]+)\/?$/.exec(path);
    if (!m) return null;
    let code: string;
    try {
      code = normalAssetCode(decodeURIComponent(m[1]));
    } catch {
      return null;
    }
    return isAssetCode(code) ? code : null;
  }
  const code = normalAssetCode(raw.replace(/\s+/g, ''));
  return isAssetCode(code) ? code : null;
}

/** Whether a group's count is due now (on or past its day), when it has assets: the dashboard's "Counts due". */
export const countIsDue = (c: Pick<CountDueView, 'assets' | 'dueOn'>, today: string): boolean => c.assets > 0 && c.dueOn <= today;

// ---------- the counts' answers ----------

/** What a count covers, named. */
export interface AssetCountScopeView {
  kind: AssetCountScopeKind;
  group: AssetGroup | null;
  room: AssetRoomRef | null;
  kit: AssetKitRef | null;
  /** "Production kit (movable)", "Studio A", "PK-KIT-A · Shoot kit A". */
  label: string;
}

/** An asset to tick on a count's sheet: who holds it when in custody (it is "out" whatever is ticked). */
export interface AssetCountSheetItem extends AssetBriefView {
  holder: AssetHolderRef | null;
}

/** GET /assets/counts/sheet: what a count of the scope expects, by code (disposed ones aside). */
export interface AssetCountSheetView {
  scope: AssetCountScopeView;
  items: AssetCountSheetItem[];
}

/** A count on the history list. */
export interface AssetCountSummaryView {
  id: string;
  scope: AssetCountScopeView;
  countedAt: string;
  countedBy: AssetUserRef | null;
  expected: number;
  found: number;
  missing: number;
  out: number;
  /** Missing ones marked lost since. */
  lostMarked: number;
}

/** An asset's line on a count. */
export interface AssetCountLineView {
  asset: AssetBriefView;
  result: AssetCountResult;
  lostMarkedAt: string | null;
  lostMarkedBy: AssetUserRef | null;
  /** A missing one not marked lost yet whose status allows it now (available or under repair), for a custodian or a manager. */
  canMarkLost: boolean;
}

/** GET /assets/counts/:id and POST /assets/counts. */
export interface AssetCountView extends AssetCountSummaryView {
  notes: string | null;
  /** Missing first, then out, then found; by code within each. */
  lines: AssetCountLineView[];
  /** Assets made available again by the count: lost ones found. */
  foundAgain: string[];
}

/** GET /assets/counts: the groups' schedule and the counts made, newest first, a page at a time. */
export interface AssetCountsView {
  schedule: CountDueView[];
  history: AssetCountSummaryView[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- the dashboard ----------

/** The attention chips, each a filtered list (spec §5 Dashboard). */
export const ASSET_ATTENTION = ['overdueReturns', 'lost', 'lowStock', 'countsDue', 'unsigned', 'repair', 'clearance'] as const;
export type AssetAttention = (typeof ASSET_ATTENTION)[number];

export const ASSET_ATTENTION_LABELS: Record<AssetAttention, string> = {
  overdueReturns: 'Overdue returns',
  lost: 'Lost',
  lowStock: 'Low stock',
  countsDue: 'Counts due',
  unsigned: 'Signed copy not attached',
  repair: 'Under repair',
  clearance: 'Employees in clearance',
};

/** GET /assets/dashboard. `values` only for the CEO, Finance and a Super Admin; disposed assets out of every figure. */
export interface AssetDashboardView {
  totals: { assets: number; available: number; custody: number; repair: number; lost: number };
  byGroup: Record<AssetGroup, number>;
  values?: {
    /** EGP: the market values added up (those with one). */
    marketValue: number;
    /** EGP: the book values on today (spec: straight line, Expensed ones 0). */
    bookValue: number;
    /** EGP: the purchase costs added up (those with one). */
    purchaseCost: number;
    /** Assets without a purchase cost yet: their book value isn't in the total. */
    withoutCost: number;
  };
  /** Each chip's number; `clearance` null until offboarding's clearance is in the system. */
  attention: Record<Exclude<AssetAttention, 'clearance'>, number> & { clearance: number | null };
  /** Labels not printed yet (not labelled), consumables aside. */
  unlabelled: number;
  /** YYYY-MM-DD (Cairo) the figures are on. */
  on: string;
}

// ---------- exports ----------

/** The Excel exports (spec §5 Settings: exports). */
export const ASSET_EXPORTS = ['register', 'custody', 'stock', 'maintenance', 'counts'] as const;
export type AssetExportKind = (typeof ASSET_EXPORTS)[number];

export const isAssetExport = (value: unknown): value is AssetExportKind => (ASSET_EXPORTS as readonly unknown[]).includes(value);

export const ASSET_EXPORT_LABELS: Record<AssetExportKind, { title: string; hint: string }> = {
  register: { title: 'Asset register', hint: 'Every asset with its group, status, room, kit, holder and dates; the values for the CEO, Finance and a Super Admin.' },
  custody: { title: 'Custody records', hint: 'Each record with its items: who, when out, the return date, what came back and in what state.' },
  stock: { title: 'Stock moves', hint: 'Each use and restock of the consumables, with the quantity after it.' },
  maintenance: { title: 'Maintenance log', hint: 'Repairs, services, inspections and the rest; the costs for the CEO, Finance and a Super Admin.' },
  counts: { title: 'Counts', hint: 'Each count with every asset’s result: found, missing or out.' },
};

/** The workbook's name: "Asset register 2026-10-22.xlsx". */
export const assetExportFileName = (kind: AssetExportKind, today: string): string => `${ASSET_EXPORT_LABELS[kind].title} ${today}.xlsx`;

// ---------- label sheets ----------

/** An A4 sheet of 3 × 8 labels of 63 × 30 mm (spec §5), centred on the page. */
export const LABEL_SHEET = {
  columns: 3,
  rows: 8,
  perSheet: 24,
  pageWidthMm: 210,
  pageHeightMm: 297,
  labelWidthMm: 63,
  labelHeightMm: 30,
  /** (210 − 3 × 63) ÷ 2 and (297 − 8 × 30) ÷ 2: the sheet's margins. */
  marginLeftMm: 10.5,
  marginTopMm: 28.5,
  /** The most labels printed at once (10 sheets). */
  maxLabels: 240,
} as const;

/** What is wrong with the label to start at (a sheet already partly used), or null: a whole number from 1 to 24. */
export function labelStartProblem(start: unknown): string | null {
  return typeof start === 'number' && Number.isInteger(start) && start >= 1 && start <= LABEL_SHEET.perSheet ? null : `Choose the label to start at: from 1 to ${LABEL_SHEET.perSheet}.`;
}

/**
 * The labels on their sheets: each sheet's 24 places, left to right and top to bottom, null where nothing prints (the
 * places before `start` on the first sheet, and after the last label).
 */
export function labelSheetSlots<T>(items: readonly T[], start = 1): (T | null)[][] {
  const skip = labelStartProblem(start) ? 0 : start - 1;
  const places: (T | null)[] = [...Array<null>(skip).fill(null), ...items];
  const sheets: (T | null)[][] = [];
  for (let i = 0; i < places.length; i += LABEL_SHEET.perSheet) {
    const sheet = places.slice(i, i + LABEL_SHEET.perSheet);
    while (sheet.length < LABEL_SHEET.perSheet) sheet.push(null);
    sheets.push(sheet);
  }
  return items.length ? sheets : [];
}

/** An asset the label sheets may print. */
export interface AssetLabelChoice {
  code: string;
  name: string;
  group: AssetGroup;
  status: AssetStatus;
  room: AssetRoomRef | null;
  kit: AssetKitRef | null;
  /** ISO moment its label was last marked printed; null: never. */
  labeledAt: string | null;
}

/** POST /assets/labels/labelled: the labels printed and stuck on. */
export interface AssetLabelledInput {
  codes: string[];
}
