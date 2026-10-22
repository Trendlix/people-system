// Accessories (owner, 22 October 2026: "and for the assets, i think we might need to add accessories under assets, like
// laptop charger under the charger, DJI ronin accessories , etc..."; asked how, "Both kinds"):
// - The checklist: small things that come with an asset (a charger, cables, a case), listed on it with how many and,
//   when it has one, a serial. They go out with it on a handover, as a snapshot on the custody item (all ticked unless
//   one stays behind), are ticked again when it comes back, and one missing is noted on the return and goes the way a
//   damaged or missing item does: HR decides a deduction (owner, 21 October 2026: "Record it; HR decides a deduction").
// - Attached assets: valuable accessories (Ronin parts, batteries, monitors) are assets of their own, with their own code
//   and label, attached to the main one. They go out with it on a handover (those available; the others skipped, said
//   why, as a kit's are) and come back item by item; each can still be handed over alone. One level only.
// Pure code: the API decides with these, the web shows them.

import { ASSET_STATUS_LABELS, type AssetGroup, type AssetStatus } from './assets.js';

// ---------- the checklist ----------

/** The limits of an asset's checklist. */
export const ACCESSORY_LIMITS = {
  /** Lines on one asset. */
  perAsset: 30,
  name: 80,
  serial: 80,
  notes: 300,
  /** How many of one accessory a line may count. */
  quantityMax: 999,
} as const;

/** A line of the checklist as the form sends it. */
export interface AccessoryInput {
  name: string;
  quantity: number;
  serial: string | null;
  notes: string | null;
}

/** A line of an asset's checklist as the API answers it. */
export interface AccessoryView extends AccessoryInput {
  id: string;
}

const tidy = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t || null;
};

/** The lines sent, tidied: names, serials and notes trimmed (empty ones null), the quantity 1 unless given. */
export function tidyAccessories(list: unknown): AccessoryInput[] {
  if (!Array.isArray(list)) return [];
  return list.map((a) => {
    const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    return {
      name: tidy(o.name) ?? '',
      quantity: o.quantity === undefined || o.quantity === null || o.quantity === '' ? 1 : (o.quantity as number),
      serial: tidy(o.serial),
      notes: typeof o.notes === 'string' ? o.notes.trim() || null : null,
    };
  });
}

/**
 * Every problem with an asset's checklist, in words (none: it can be saved): at most 30 lines, each with a name (no two
 * alike), a whole quantity from 1 to 999, a serial and notes within their lengths. A consumable has none: it is kept by
 * quantity.
 */
export function accessoriesProblems(list: readonly AccessoryInput[], group: AssetGroup | string): string[] {
  const L = ACCESSORY_LIMITS;
  const out: string[] = [];
  if (group === 'consumable' && list.length) return ['A consumable has no accessories: it is kept by quantity.'];
  if (list.length > L.perAsset) out.push(`Keep the accessories to ${L.perAsset} lines or fewer.`);
  const seen = new Map<string, number>();
  list.forEach((a, i) => {
    const which = a.name ? `Accessory ${i + 1} (${a.name})` : `Accessory ${i + 1}`;
    if (!a.name) out.push(`${which}: give it a name, e.g. Charger.`);
    else if (a.name.length > L.name) out.push(`${which}: keep its name to ${L.name} characters or fewer.`);
    else {
      const key = `${a.name.toLowerCase()}|${(a.serial ?? '').toLowerCase()}`;
      if (seen.has(key)) out.push(`${which}: accessory ${seen.get(key)! + 1} is the same. Count them in one line.`);
      else seen.set(key, i);
    }
    if (!(typeof a.quantity === 'number' && Number.isInteger(a.quantity) && a.quantity >= 1 && a.quantity <= L.quantityMax)) {
      out.push(`${which}: give how many as a whole number from 1 to ${L.quantityMax}.`);
    }
    if (a.serial && a.serial.length > L.serial) out.push(`${which}: keep its serial number to ${L.serial} characters or fewer.`);
    if (a.notes && a.notes.length > L.notes) out.push(`${which}: keep its notes to ${L.notes} characters or fewer.`);
  });
  return out;
}

/** An accessory in words: "2 × Battery (SN 123)", "Charger". */
export const accessoryText = (a: { name: string; quantity: number; serial?: string | null }): string =>
  `${a.quantity > 1 ? `${a.quantity} × ` : ''}${a.name}${a.serial ? ` (${a.serial})` : ''}`;

/** A checklist in words, one after the other: "Charger, 2 × Battery". */
export const accessoriesText = (list: readonly { name: string; quantity: number; serial?: string | null }[]): string => list.map(accessoryText).join(', ');

// ---------- on a handover and a return ----------

/** An accessory as it went out with an item on a custody record (a snapshot: the checklist may change later). */
export interface AccessoryOut {
  name: string;
  quantity: number;
  serial: string | null;
}

/**
 * What goes out with an item: its checklist's lines whose ids are `going` (all of them when `going` is undefined, the
 * form's default: everything ticked), as a snapshot. Ids not on the checklist are ignored.
 */
export function accessoriesGoingOut(checklist: readonly AccessoryView[], going?: readonly string[]): AccessoryOut[] {
  const chosen = going === undefined ? null : new Set(going);
  return checklist.filter((a) => !chosen || chosen.has(a.id)).map((a) => ({ name: a.name, quantity: a.quantity, serial: a.serial }));
}

/**
 * Every problem with what came back of an item's accessories, in words: `back` has, for each line that went out (in
 * order), how many came back, a whole number from 0 to how many went.
 */
export function accessoriesBackProblems(out: readonly AccessoryOut[], back: readonly unknown[]): string[] {
  if (back.length !== out.length) return ['Say how many of each accessory came back. Reload the page and try again.'];
  const problems: string[] = [];
  out.forEach((a, i) => {
    const n = back[i];
    if (!(typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= a.quantity)) {
      problems.push(`${accessoryText(a)}: say how many came back, from 0 to ${a.quantity}.`);
    }
  });
  return problems;
}

/**
 * The accessories that didn't come back: for each line, how many are missing (those that went less those back). An
 * item that came back missing has every accessory that went with it missing too. None missing: an empty list.
 */
export function missingAccessories(out: readonly AccessoryOut[], back: readonly number[] | null, itemMissing = false): AccessoryOut[] {
  return out.flatMap((a, i) => {
    const missing = itemMissing ? a.quantity : a.quantity - (back?.[i] ?? a.quantity);
    return missing > 0 ? [{ name: a.name, quantity: missing, serial: a.serial }] : [];
  });
}

/** The deduction's reason for missing accessories, prefilled: "Loss: Charger, 2 × Battery of IT-LAP-0003 on CUS-0042". */
export const accessoriesDeductionReason = (missing: readonly AccessoryOut[], assetCode: string, custodyCode: string): string =>
  `Loss: ${accessoriesText(missing)} of ${assetCode} on ${custodyCode}`;

/** A snapshot as kept (JSON): its well-formed lines; anything else none. */
export function accessoriesOutOf(json: unknown): AccessoryOut[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((a) => {
    if (!a || typeof a !== 'object') return [];
    const o = a as Record<string, unknown>;
    return typeof o.name === 'string' && typeof o.quantity === 'number' ? [{ name: o.name, quantity: o.quantity, serial: typeof o.serial === 'string' ? o.serial : null }] : [];
  });
}

// ---------- attached assets ----------

/** An asset as the attach rules read it. */
export interface AttachSide {
  id: string;
  code: string;
  group: AssetGroup | string;
  status: AssetStatus | string;
  /** The main asset it is attached to, if any. */
  parentId: string | null;
  /** How many assets are attached to it. */
  attached: number;
}

/**
 * Why `item` can't be attached to `main`, or null when it can (owner, 22 October 2026: "Both kinds"): one level only (a
 * main asset isn't attached to another, an attached one has none of its own), never to itself, never a consumable on
 * either side, never to a disposed asset, nor a disposed one.
 */
export function attachProblem(item: AttachSide, main: AttachSide): string | null {
  if (item.id === main.id) return 'An asset can’t be attached to itself.';
  if (item.group === 'consumable') return `${item.code} is a consumable: consumables are kept by quantity, not attached.`;
  if (main.group === 'consumable') return `${main.code} is a consumable: nothing is attached to a consumable.`;
  if (item.status === 'disposed') return `${item.code} is disposed: it can’t be attached.`;
  if (main.status === 'disposed') return `${main.code} is disposed: nothing can be attached to it.`;
  if (main.parentId) return `${main.code} is itself attached to another asset: attach to that one instead (one level only).`;
  if (item.attached > 0) return `${item.code} has assets attached to it: it can’t be attached to another (one level only).`;
  if (item.parentId === main.id) return `${item.code} is attached to ${main.code} already.`;
  return null;
}

/** An asset attached to another, as the main one's page lists it. */
export interface AttachedAssetView {
  id: string;
  code: string;
  name: string;
  status: AssetStatus;
  /** Who holds it, when it is in custody. */
  holder: string | null;
}

/** The main asset an asset is attached to. */
export interface AssetParentRef {
  id: string;
  code: string;
  name: string;
}

/** Why an attached asset isn't added to a handover with its main one, or null when it is (as a kit's, kitSkipReason). */
export function attachedSkipReason(a: { status: AssetStatus | string; holder?: string | null; custodyCode?: string | null }): string | null {
  switch (a.status) {
    case 'available':
      return null;
    case 'custody':
      return a.holder ? `Out with ${a.holder}${a.custodyCode ? ` on ${a.custodyCode}` : ''}` : 'In custody';
    default:
      return ASSET_STATUS_LABELS[a.status as AssetStatus] ?? a.status;
  }
}
