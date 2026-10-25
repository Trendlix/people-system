// Assets, step 4 (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal"; the spec §3, §5, §6):
// - Stock: a consumable is used (−) or restocked (+), each move kept with the quantity after it, a note, by whom and
//   when; the quantity never goes below 0 (spec §3 move_stock); "Reorder" at or under its reorder level (§6.7).
// - Kits: a kit's assets and how it stands: Available (all of them), Out (none available) or Partly out (spec §5: "Kit
//   cards with items and status (Available / Partly out / Out)"); only production kit assets go in a kit.
// - The maintenance log by hand: a repair, service, inspection, warranty claim or upgrade on a day, with its vendor, its
//   cost (a value: the CEO's, Finance's and a Super Admin's only) and notes (spec §3 maintenance_log).
// - Disposal (spec §6.9: "manager only: method, date, amount received, approver, book value at the time. Disposed assets
//   stay in the database and leave every total"): an Assets manager's; never one in custody (received back first),
//   never a consumable (used up through Stock); it leaves its kit and its attached assets.
// Pure code: the API decides with these, the web shows them.

import { ASSET_MONEY_MAX, ASSET_QUANTITY_MAX, ASSET_STATUS_LABELS, type AssetStatus, type AssetUserRef } from './assets.js';
import { MAINTENANCE_KINDS, MAINTENANCE_TEXT_LIMITS, type MaintenanceKind } from './custody.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const hundredths = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const round2 = (n: number) => Math.round(n * 100) / 100 + 0;

// ---------- stock ----------

/** The longest a stock move's note may be. */
export const STOCK_NOTE_MAX = 300;

/** Used (taken out of stock) or restocked (added). */
export const STOCK_MOVE_KINDS = ['use', 'restock'] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

export const STOCK_MOVE_KIND_LABELS: Record<StockMoveKind, string> = { use: 'Use', restock: 'Restock' };

/** A quantity in words with its unit: "3 rolls", "2.5 m". */
const qty = (n: number, unit: string | null) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}${unit ? ` ${unit}` : ''}`;

/**
 * Every problem with a stock move, in words (none: it can be made): an amount above 0 with at most 2 decimals, within
 * the quantity limit; a use never more than what is in stock (`quantity` now), a restock never past the limit.
 */
export function stockMoveProblems(kind: StockMoveKind | string, amount: unknown, quantity: number, unit: string | null, note?: string | null): string[] {
  const out: string[] = [];
  if (kind !== 'use' && kind !== 'restock') return ['Choose Use or Restock.'];
  if (!(typeof amount === 'number' && hundredths(amount) && amount > 0 && amount <= ASSET_QUANTITY_MAX)) {
    out.push(`Enter how many, above 0, with at most 2 decimals.`);
  } else if (kind === 'use' && amount > quantity + 1e-9) {
    out.push(quantity > 0 ? `Only ${qty(quantity, unit)} in stock: use at most that.` : 'None is in stock: restock it first.');
  } else if (kind === 'restock' && quantity + amount > ASSET_QUANTITY_MAX) {
    out.push(`The stock can be at most ${ASSET_QUANTITY_MAX.toLocaleString('en-US')}.`);
  }
  if (note && note.length > STOCK_NOTE_MAX) out.push(`Keep the note to ${STOCK_NOTE_MAX} characters or fewer.`);
  return out;
}

/** The change a move makes to the stock: − for a use, + for a restock. */
export const stockDelta = (kind: StockMoveKind, amount: number): number => round2(kind === 'use' ? -amount : amount);

/** The stock after a move (never below 0). */
export const stockAfter = (quantity: number, delta: number): number => Math.max(0, round2(quantity + delta));

/** A consumable's stock move, newest first on its page. */
export interface StockMoveView {
  id: string;
  /** − used, + restocked. */
  delta: number;
  quantityAfter: number;
  note: string | null;
  by: AssetUserRef | null;
  /** ISO moment. */
  at: string;
}

/** The note a stock move gets when the quantity is changed on the Edit form instead of Use or Restock. */
export const STOCK_EDIT_NOTE = 'Quantity changed on the Edit form';

// ---------- kits ----------

/** How a kit stands: all its assets available, none, or some; Empty: none in it. */
export const KIT_STATUSES = ['available', 'partly_out', 'out', 'empty'] as const;
export type KitStatus = (typeof KIT_STATUSES)[number];

export const KIT_STATUS_LABELS: Record<KitStatus, string> = { available: 'Available', partly_out: 'Partly out', out: 'Out', empty: 'Empty' };

/** A kit's status from its assets (disposed ones aren't in a kit): every one available, none, or some. */
export function kitStatusOf(items: readonly { status: AssetStatus | string }[]): KitStatus {
  const kept = items.filter((i) => i.status !== 'disposed');
  if (!kept.length) return 'empty';
  const available = kept.filter((i) => i.status === 'available').length;
  if (available === kept.length) return 'available';
  return available === 0 ? 'out' : 'partly_out';
}

/** An asset in a kit, on the Kits page. */
export interface AssetKitItemView {
  id: string;
  code: string;
  name: string;
  status: AssetStatus;
  /** Who holds it, when it is in custody. */
  holder: string | null;
}

/** Why an asset can't be put in a kit, or null when it can: only a production kit asset, never a disposed one. */
export function kitItemProblem(a: { code: string; group: string; status: AssetStatus | string }): string | null {
  if (a.group !== 'kit') return `${a.code} isn’t a production kit asset: only those go in a kit.`;
  if (a.status === 'disposed') return `${a.code} is disposed: it can’t go in a kit.`;
  return null;
}

/** The most assets added to or taken out of a kit at once. */
export const KIT_ITEMS_MAX = 100;

// ---------- the maintenance log by hand ----------

/** A maintenance entry as the form sends it. */
export interface MaintenanceInput {
  kind: MaintenanceKind;
  /** YYYY-MM-DD */
  on: string;
  vendor: string | null;
  /** EGP: from the CEO, Finance or a Super Admin only. */
  cost: number | null;
  notes: string | null;
}

/** Every problem with a maintenance entry, in words; none: it can be saved. `today`: YYYY-MM-DD in Cairo. */
export function maintenanceProblems(m: MaintenanceInput, today: string): string[] {
  const out: string[] = [];
  if (!(MAINTENANCE_KINDS as readonly string[]).includes(m.kind)) out.push('Choose what it was: a repair, service, inspection, warranty claim or upgrade.');
  if (!validDate(m.on)) out.push('Enter the date as DD/MM/YYYY.');
  else if (m.on > today) out.push('The date can’t be in the future.');
  if (m.vendor && m.vendor.length > MAINTENANCE_TEXT_LIMITS.vendor) out.push(`Keep the vendor to ${MAINTENANCE_TEXT_LIMITS.vendor} characters or fewer.`);
  if (m.notes && m.notes.length > MAINTENANCE_TEXT_LIMITS.notes) out.push(`Keep the notes to ${MAINTENANCE_TEXT_LIMITS.notes} characters or fewer.`);
  if (m.cost !== null && !(hundredths(m.cost) && m.cost >= 0 && m.cost <= ASSET_MONEY_MAX)) out.push('Enter the cost in EGP as 0 or more, with at most 2 decimals.');
  if (!m.vendor && !m.notes) out.push('Say who did it or what was done.');
  return out;
}

// ---------- disposal ----------

/** How an asset left (spec §3: disposal method). */
export const DISPOSAL_METHODS = ['sold', 'scrapped', 'written_off', 'donated'] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const DISPOSAL_METHOD_LABELS: Record<DisposalMethod, string> = { sold: 'Sold', scrapped: 'Scrapped', written_off: 'Written off', donated: 'Donated' };

export const isDisposalMethod = (value: unknown): value is DisposalMethod => (DISPOSAL_METHODS as readonly unknown[]).includes(value);

/** The longest a disposal's approver and notes may be. */
export const DISPOSAL_TEXT_LIMITS = { approvedBy: 120, notes: 1000 } as const;

/** A disposal as the form sends it. */
export interface DisposalInput {
  method: DisposalMethod;
  /** YYYY-MM-DD */
  on: string;
  /** EGP received (a value: from the CEO, Finance or a Super Admin only); null: none, or not known to the person. */
  amount: number | null;
  /** Who approved it, as written. */
  approvedBy: string;
  notes: string | null;
}

/**
 * Why an asset can't be disposed of now, or null when it can (spec §6.9): never one in custody (it is received back
 * first), never a consumable (used up through Stock), never one disposed already.
 */
export function disposeProblem(a: { code: string; group: string; status: AssetStatus | string }): string | null {
  if (a.status === 'disposed') return `${a.code} is disposed already.`;
  if (a.group === 'consumable') return `${a.code} is a consumable: it is used up through Stock, not disposed of.`;
  if (a.status === 'custody') return `${a.code} is in custody: receive it back first, then dispose of it.`;
  return null;
}

/** Every problem with a disposal's fields, in words; none: it can be saved. `today`: YYYY-MM-DD in Cairo. */
export function disposalProblems(d: DisposalInput, today: string, purchaseDate: string | null = null): string[] {
  const out: string[] = [];
  if (!isDisposalMethod(d.method)) out.push('Choose how it was disposed of: sold, scrapped, written off or donated.');
  if (!validDate(d.on)) out.push('Enter the disposal date as DD/MM/YYYY.');
  else if (d.on > today) out.push('The disposal date can’t be in the future.');
  else if (purchaseDate && d.on < purchaseDate) out.push('The disposal date can’t be before the purchase date.');
  if (!d.approvedBy?.trim()) out.push('Say who approved the disposal.');
  else if (d.approvedBy.length > DISPOSAL_TEXT_LIMITS.approvedBy) out.push(`Keep who approved it to ${DISPOSAL_TEXT_LIMITS.approvedBy} characters or fewer.`);
  if (d.notes && d.notes.length > DISPOSAL_TEXT_LIMITS.notes) out.push(`Keep the notes to ${DISPOSAL_TEXT_LIMITS.notes} characters or fewer.`);
  // the amount is a value: a manager who doesn't see the values leaves it empty, and Finance sets it on the values page
  if (d.amount !== null && !(hundredths(d.amount) && d.amount >= 0 && d.amount <= ASSET_MONEY_MAX)) out.push('Enter the amount received in EGP as 0 or more, with at most 2 decimals.');
  return out;
}

/** An asset's disposal on its page; `amount` and `bookValue` only for those who see the values. */
export interface AssetDisposalView {
  method: DisposalMethod;
  /** YYYY-MM-DD */
  on: string;
  approvedBy: string | null;
  notes: string | null;
  by: AssetUserRef | null;
  amount?: number | null;
  /** The book value on the disposal date, kept then; null when it couldn't be worked out. */
  bookValue?: number | null;
}

/** What disposing of an asset did besides: the kit it left and the assets detached from it (or it from its main one). */
export interface DisposalResult {
  leftKit: string | null;
  detached: string[];
  detachedFrom: string | null;
}

/** A disposed asset's line in words: "Disposed: Sold on 22/10/2026". */
export const disposedText = (d: { method: DisposalMethod; on: string }, formatDate: (day: string) => string): string =>
  `${ASSET_STATUS_LABELS.disposed}: ${DISPOSAL_METHOD_LABELS[d.method]} on ${formatDate(d.on)}`;

// ---------- several at once ----------
// The owner, 25 October 2026: "cant i delete assets as a super admin?", then "can i delete multiple assets at one?";
// asked, "Never-in-custody only": on All Assets a Super Admin ticks assets and presses Delete selected; those never in
// custody are deleted and the others skipped with the reason, Dispose selected offered for them (an Assets manager's,
// with the disposal rules above). Each asset goes through the same rule as one deleted or disposed of on its page.

/** The most assets one Delete selected or Dispose selected takes. */
export const ASSETS_BULK_MAX = 200;

/** Why Delete selected or Dispose selected left an asset as it was (a disposal's own reasons are its refusals). */
export const BULK_SKIP_REASONS = {
  notFound: 'Not found.',
  inCustody: 'In custody now.',
  wasInCustody: 'It was in custody: dispose of it instead.',
} as const;

/**
 * Why an asset can't be deleted, from its status and whether it was ever in custody; null when it can (never in custody:
 * spec §6.10; otherwise it is disposed of). In custody now first: it can't be disposed of either until it is back.
 */
export function deleteSkipReason(a: { status: AssetStatus | string; everInCustody: boolean }): string | null {
  if (a.status === 'custody') return BULK_SKIP_REASONS.inCustody;
  if (a.everInCustody) return BULK_SKIP_REASONS.wasInCustody;
  return null;
}

/**
 * A single disposal's refusal said beside the code it is about: "PK-CAM-0004 is in custody: receive it back first, then
 * dispose of it." → "It is in custody: receive it back first, then dispose of it."; anything else as it is.
 */
export const reasonBesideCode = (code: string, message: string): string => (message.startsWith(`${code} `) ? `It ${message.slice(code.length + 1)}` : message);

/** An asset Delete selected or Dispose selected left as it was, and why. */
export interface BulkSkipped {
  code: string;
  reason: string;
}

/** POST /assets/bulk-delete's answer (a Super Admin's): what was deleted, and what was skipped with the reason. */
export interface BulkDeleteResult {
  deleted: { code: string; name: string }[];
  skipped: BulkSkipped[];
}

/** POST /assets/bulk-dispose's answer (an Assets manager's): what was disposed of, with what else each did, and what was skipped. */
export interface BulkDisposeResult {
  disposed: ({ code: string; name: string } & DisposalResult)[];
  skipped: BulkSkipped[];
}
