// Assets step 4's own rules on the site (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal";
// owner, 22 October 2026: "like laptop charger under the charger, DJI ronin accessories"; "Both kinds"): reading the
// accessories' checklist, the attach form, Use and Restock, a maintenance entry, a disposal and a kit's codes into what
// the API takes, with every problem the shared checks find; what a kit's status, a disposal and an accessory say; the
// accessories that came back on the receive-back form; and the deduction link for missing accessories. The rules are
// packages/shared asset-accessories.ts and asset-upkeep.ts; the API checks everything again. Pure code, tested; relative
// imports, as vitest doesn't know the "@/" paths.

import {
  accessoriesDeductionReason,
  accessoriesProblems,
  accessoryText,
  ACCESSORY_LIMITS,
  DISPOSAL_METHOD_LABELS,
  disposalProblems,
  isAssetCode,
  KIT_STATUS_LABELS,
  MAINTENANCE_KINDS,
  maintenanceProblems,
  normalAssetCode,
  stockMoveProblems,
  STOCK_NOTE_MAX,
  type AccessoryInput,
  type AccessoryOut,
  type AssetGroup,
  type DisposalResult,
  type KitStatus,
  type MaintenanceKind,
  type StockMoveKind,
} from '@trendlix/shared';
import { formatDate, parseDate } from '../../../lib/format';
import { numberFrom } from './assets';
import { deductionHref } from './custody';

type Fields = Pick<FormData, 'get'>;
const text = (fd: Fields, key: string): string => String(fd.get(key) ?? '').trim();

// ---------- the accessories' checklist ----------

/** The fields of the checklist's line `i` on the form. */
export const accessoryField = (i: number, part: 'name' | 'quantity' | 'serial' | 'notes') => `acc-${part}-${i}`;

/**
 * The checklist as typed: `rows` lines of name, how many, serial and notes, a line with nothing in it left out; with every
 * problem the shared checks find (a quantity left empty counts 1).
 */
export function readAccessoriesForm(fd: Fields, rows: number, group: AssetGroup | string): { items: AccessoryInput[]; problems: string[] } {
  const items: AccessoryInput[] = [];
  const problems: string[] = [];
  for (let i = 0; i < rows; i++) {
    const name = text(fd, accessoryField(i, 'name')).replace(/\s+/g, ' ');
    const rawQuantity = text(fd, accessoryField(i, 'quantity'));
    const serial = text(fd, accessoryField(i, 'serial'));
    const notes = text(fd, accessoryField(i, 'notes'));
    if (!name && !serial && !notes && (!rawQuantity || rawQuantity === '1')) continue;
    const quantity = rawQuantity ? numberFrom(rawQuantity) : 1;
    items.push({ name, quantity: quantity === null || Number.isNaN(quantity) ? Number.NaN : quantity, serial: serial || null, notes: notes || null });
  }
  problems.push(...accessoriesProblems(items, group));
  return { items, problems };
}

/** The checklist in words for a list: "Charger, 2 × Battery"; null when it has none. */
export const checklistText = (list: readonly { name: string; quantity: number; serial?: string | null }[] | undefined): string | null =>
  list && list.length ? list.map(accessoryText).join(', ') : null;

/** The most lines the checklist's form shows at once (the API's limit). */
export const ACCESSORY_ROWS_MAX = ACCESSORY_LIMITS.perAsset;

// ---------- attaching ----------

/** The attach form's code read as kept ("pk-gmb-0001 " → "PK-GMB-0001"), or a problem. */
export function readParentCode(raw: string): { code: string | null; problem: string | null } {
  const code = normalAssetCode(raw);
  if (!code) return { code: null, problem: 'Enter the main asset’s code, e.g. PK-GMB-0001.' };
  return isAssetCode(code) ? { code, problem: null } : { code: null, problem: `${code} isn’t an asset code: type it as on its label, e.g. PK-GMB-0001.` };
}

// ---------- stock ----------

/** Use or Restock as typed: how many and a note, checked against the stock now. */
export function stockBody(fd: Fields, kind: StockMoveKind, quantity: number, unit: string | null): { body: Record<string, unknown>; problems: string[] } {
  const amount = numberFrom(text(fd, 'amount'));
  const note = text(fd, 'note');
  const problems =
    amount === null || Number.isNaN(amount)
      ? ['Enter how many, e.g. 2 or 2.5.', ...(note.length > STOCK_NOTE_MAX ? [`Keep the note to ${STOCK_NOTE_MAX} characters or fewer.`] : [])]
      : stockMoveProblems(kind, amount, quantity, unit, note);
  return { body: { kind, amount, note: note || null }, problems };
}

/** A stock move in words: "−8 rolls", "+12.5". */
export function deltaText(delta: number, unit: string | null): string {
  const n = Math.abs(delta);
  return `${delta < 0 ? '−' : '+'}${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}${unit ? ` ${unit}` : ''}`;
}

// ---------- the maintenance log by hand ----------

/** A maintenance entry as typed: its kind, date (today when empty), vendor, notes and, for those who see the values, its cost. */
export function maintenanceBody(fd: Fields, opts: { values: boolean; today: string }): { body: Record<string, unknown>; problems: string[] } {
  const kind = text(fd, 'kind');
  const on = parseDate(text(fd, 'on'));
  const vendor = text(fd, 'vendor') || null;
  const notes = text(fd, 'notes') || null;
  const rawCost = opts.values ? text(fd, 'cost') : '';
  const cost = rawCost ? numberFrom(rawCost) : null;
  const problems: string[] = [];
  if (on === null) problems.push('Enter the date as DD/MM/YYYY, e.g. 22/10/2026.');
  if (cost !== null && Number.isNaN(cost)) problems.push('Enter the cost in EGP, e.g. 1500 or 1500.50.');
  const input = { kind: kind as MaintenanceKind, on: on || opts.today, vendor, cost: cost !== null && !Number.isNaN(cost) ? cost : null, notes };
  if (on !== null) problems.push(...maintenanceProblems(input, opts.today).filter((p) => !(cost !== null && Number.isNaN(cost) && p.startsWith('Enter the cost'))));
  if (!(MAINTENANCE_KINDS as readonly string[]).includes(kind) && !problems.some((p) => p.startsWith('Choose what it was'))) problems.unshift('Choose what it was: a repair, service, inspection, warranty claim or upgrade.');
  const body: Record<string, unknown> = { kind, on: input.on, vendor, notes };
  if (opts.values && input.cost !== null) body.cost = input.cost;
  return { body, problems: [...new Set(problems)] };
}

// ---------- disposal ----------

/** A disposal as typed: how, when (today when empty), who approved it, notes and, for those who see the values, the amount received. */
export function disposalBody(fd: Fields, opts: { values: boolean; today: string; purchaseDate: string | null }): { body: Record<string, unknown>; problems: string[] } {
  const method = text(fd, 'method');
  const on = parseDate(text(fd, 'on'));
  const approvedBy = text(fd, 'approvedBy');
  const notes = text(fd, 'notes') || null;
  const rawAmount = opts.values ? text(fd, 'amount') : '';
  const amount = rawAmount ? numberFrom(rawAmount) : null;
  const problems: string[] = [];
  if (on === null) problems.push('Enter the disposal date as DD/MM/YYYY, e.g. 22/10/2026.');
  if (amount !== null && Number.isNaN(amount)) problems.push('Enter the amount received in EGP, e.g. 12000.');
  const input = {
    // checked by disposalProblems: one of the methods, or said
    method: method as never,
    on: on || opts.today,
    amount: amount !== null && !Number.isNaN(amount) ? amount : null,
    approvedBy,
    notes,
  };
  if (on !== null) problems.push(...disposalProblems(input, opts.today, opts.purchaseDate));
  const body: Record<string, unknown> = { method, on: input.on, approvedBy, notes };
  if (opts.values && input.amount !== null) body.amount = input.amount;
  return { body, problems: [...new Set(problems)] };
}

/** What a disposal did besides, in words: "It left PK-KIT-A. Detached: PK-ACC-0001, PK-BAT-0002." */
export function disposalResultText(r: DisposalResult): string | null {
  const parts = [
    r.leftKit ? `It left ${r.leftKit}.` : null,
    r.detached.length ? `Detached from it: ${r.detached.join(', ')}.` : null,
    r.detachedFrom ? `It was detached from ${r.detachedFrom}.` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** A disposal in words: "Sold on 22/10/2026". */
export const disposalText = (d: { method: keyof typeof DISPOSAL_METHOD_LABELS; on: string }): string => `${DISPOSAL_METHOD_LABELS[d.method] ?? d.method} on ${formatDate(d.on)}`;

// ---------- kits ----------

/** The codes typed to add to a kit, one a line or separated by commas or spaces, as kept; and those that aren't codes. */
export function kitCodesFrom(raw: string): { codes: string[]; wrong: string[] } {
  const words = raw
    .split(/[\s,;]+/)
    .map((w) => normalAssetCode(w))
    .filter(Boolean);
  const codes = [...new Set(words.filter((w) => isAssetCode(w)))];
  const wrong = [...new Set(words.filter((w) => !isAssetCode(w)))];
  return { codes, wrong };
}

export const kitStatusText = (s: KitStatus): string => KIT_STATUS_LABELS[s] ?? s;

/** The badge's colours of a kit's status: available green, partly out amber, out blue, empty grey. */
export function kitStatusTone(s: KitStatus): string {
  switch (s) {
    case 'available':
      return 'bg-ok-soft text-ok';
    case 'partly_out':
      return 'bg-warn-soft text-warn';
    case 'out':
      return 'bg-accent-soft text-accent';
    case 'empty':
      return 'bg-line-soft text-muted';
  }
}

// ---------- deductions ----------

/**
 * "Create a deduction" for accessories that didn't come back (owner, 22 October 2026: accessories; 21 October 2026:
 * "Record it; HR decides a deduction"): Additions / Deductions opened with the reason "Loss: Charger of IT-LAP-0003 on
 * CUS-0042" and the custody item. `today`: YYYY-MM-DD in Cairo (its month).
 */
export function accessoriesDeductionHref(r: { employeeId: string; itemId: string; missing: readonly AccessoryOut[]; assetCode: string; custodyCode: string }, today: string): string {
  const query = new URLSearchParams({
    month: today.slice(0, 7),
    employee: r.employeeId,
    custodyItem: r.itemId,
    reason: accessoriesDeductionReason(r.missing, r.assetCode, r.custodyCode),
  });
  return `/payroll/adjustments?${query.toString()}`;
}

/**
 * "Create a deduction" for an item that stays on the person's record: damaged or missing (custody.ts deductionHref), or
 * (step 4) back without some of its accessories, whose reason names them.
 */
export function incidentDeductionHref(
  r: { employeeId: string; itemId: string; condition: string | null; missing?: readonly AccessoryOut[] | null; assetCode: string; custodyCode: string },
  today: string,
): string | null {
  if (r.condition === 'damaged' || r.condition === 'missing') return deductionHref({ ...r, condition: r.condition }, today);
  if (r.missing && r.missing.length) return accessoriesDeductionHref({ ...r, missing: r.missing }, today);
  return null;
}

/** The accessories that didn't come back, in words: "Not back: Charger, 2 × Battery"; null when all did. */
export const missingAccessoriesText = (missing: readonly AccessoryOut[] | null | undefined): string | null => (missing && missing.length ? `Not back: ${missing.map(accessoryText).join(', ')}` : null);
