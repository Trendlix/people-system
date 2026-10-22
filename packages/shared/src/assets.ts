// The Assets module (owner, 21 October 2026: "i want to add this module with a special permission to the system", with
// the "Asset Register" spec; then "use the main ERP system specs .. dont stick to the MD file"): the studio's assets,
// who holds them, their counts and their values, built inside the People System. The spec says what the module does
// (the five groups, the type codes, the asset codes, the statuses, the values); how it is built is this system's own.
// This file holds the rules both apps use: the access levels and the values rule, the groups, types, statuses and
// conditions, the codes, the book value, the fields each group shows, the status rules, the checks of a form in words,
// and the API's answers. Step 1 of 5: the register (owner's build order: foundation + assets, Claude, custody, kits /
// stock / repairs / disposal, counts / labels / dashboard / phone / exports).

import type { AccessoryView, AssetParentRef, AttachedAssetView } from './asset-accessories.js';
import type { AssetDisposalView, AssetKitItemView, KitStatus } from './asset-upkeep.js';
import type { ProductImageSource } from './product-images.js';

// ---------- who may do what ----------

/**
 * The Assets access a user is given on the Users page (owner, 21 October 2026: "3 levels per user"), by an Admin or a
 * Super Admin, each change audited. None: the module is hidden (its sidebar, its pages, and the API answers 403).
 * Viewer: read only. Custodian: registers and edits assets, hands them over and receives them back, counts, stock and
 * repairs (the later steps), but not disposal or the settings. Manager: everything, disposal and the settings too.
 */
export const ASSETS_ACCESS_LEVELS = ['none', 'viewer', 'custodian', 'manager'] as const;
export type AssetsAccess = (typeof ASSETS_ACCESS_LEVELS)[number];

export const ASSETS_ACCESS_LABELS: Record<AssetsAccess, string> = {
  none: 'No access',
  viewer: 'Viewer',
  custodian: 'Custodian',
  manager: 'Manager',
};

/** What each level may do, as the Users page explains it. */
export const ASSETS_ACCESS_HINTS: Record<AssetsAccess, string> = {
  none: 'Assets is hidden from them.',
  viewer: 'Sees the asset register, read only.',
  custodian: 'Registers and edits assets, hands them over and receives them back, counts them, keeps the stock and the repairs. Not disposal or the settings.',
  manager: 'Everything in Assets, including disposal, the rooms and the settings.',
};

export const isAssetsAccess = (value: unknown): value is AssetsAccess => (ASSETS_ACCESS_LEVELS as readonly unknown[]).includes(value);

const ACCESS_RANK: Record<AssetsAccess, number> = { none: 0, viewer: 1, custodian: 2, manager: 3 };

/** Whether `held` allows what `wanted` does (a manager does what a custodian does, a custodian what a viewer does). */
export const assetsAccessAtLeast = (held: AssetsAccess, wanted: AssetsAccess): boolean => ACCESS_RANK[held] >= ACCESS_RANK[wanted];

/**
 * Who sees and sets the asset values (owner, 21 October 2026: "CEO and Finance"; the Super Admin too, as everywhere):
 * the purchase cost, the supplier and invoice details, the book value, the market value (low, mid, high and its note)
 * and the disposal amounts. Not an Assets manager, custodian or viewer who isn't also one of them: the API leaves the
 * values out of what it answers them.
 */
export const ASSET_VALUE_ROLES = ['ceo', 'finance', 'super_admin'] as const;

export const seesAssetValues = (user: { roles: readonly string[] }): boolean => user.roles.some((r) => (ASSET_VALUE_ROLES as readonly string[]).includes(r));

/**
 * The Assets access a user has in effect: a Super Admin is always a manager (owner, 21 October 2026); the CEO and
 * Finance, who fill the values, are at least viewers whatever is set (they see the register to value it, and the
 * "Needs values" list), and keep a higher level when one is set; everyone else the level set on the Users page (none
 * until one is). The values themselves are seesAssetValues, beside the level, never part of it.
 */
export function assetsAccessOf(user: { roles: readonly string[]; assetsAccess?: string | null }): AssetsAccess {
  if (user.roles.includes('super_admin')) return 'manager';
  const set: AssetsAccess = isAssetsAccess(user.assetsAccess) ? user.assetsAccess : 'none';
  return set === 'none' && seesAssetValues(user) ? 'viewer' : set;
}

/**
 * GET /auth/me's `assets`: the access in effect, whether they see the values, and whether the Assets AI is set up
 * (owner, 21 October 2026: "i might link a claude account for the assets section only to fetch data and help in the
 * data entry"; then, asked how without paying extra, "the connection method": a connector on their own Claude account,
 * step 2). Since step 2, `ai` says the Claude connector is offered to them: true for anyone with Assets access (it reads
 * at their level, and drafts for a custodian or a manager). The Add asset form then points to Connect Claude: photos
 * and labels are read in Claude, which drafts the asset (connector.ts, asset-drafts.ts).
 */
export interface AssetsAccessView {
  access: AssetsAccess;
  values: boolean;
  ai: boolean;
}

/** What someone may do in Assets, by their access in effect and the values rule. */
export function assetsCan(view: AssetsAccessView) {
  return {
    /** the register, the asset pages, the photos */
    view: assetsAccessAtLeast(view.access, 'viewer'),
    /** register, edit and add photos (and, later, hand over, receive, count, stock, repairs) */
    register: assetsAccessAtLeast(view.access, 'custodian'),
    /** the rooms (and, later, disposal) */
    manage: assetsAccessAtLeast(view.access, 'manager'),
    /** see and set the values; the "Needs values" list */
    values: view.values,
    /** the capitalization threshold: a manager, or someone who sets the values (it decides what is Expensed) */
    settings: assetsAccessAtLeast(view.access, 'manager') || view.values,
  };
}

/** What the API answers someone without the access a route needs. */
export const ASSETS_REFUSALS = {
  none: 'You do not have access to Assets.',
  custodian: 'Only an Assets custodian or manager can do this.',
  manager: 'Only an Assets manager can do this.',
  values: 'Only the CEO, Finance and a Super Admin see and set asset values.',
  settings: 'Only an Assets manager, the CEO, Finance or a Super Admin can change the asset settings.',
} as const;

// ---------- the five groups ----------

/** How an asset is managed day to day (spec §2.2). */
export const ASSET_GROUPS = ['studio', 'kit', 'it', 'office', 'consumable'] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];

/**
 * The accounting class (spec §2.1): cameras, laptops, furniture and studio fixtures are fixed; only what is used up
 * within a year, or bought for resale, is current.
 */
export const ASSET_CLASSES = ['fixed', 'current'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = { fixed: 'Fixed asset', current: 'Current asset' };

/** Who holds an asset of a group in custody (spec §2.2): a room, an employee per shoot or long term, the storeroom. */
export const ASSET_CUSTODY_HOLDERS = ['room', 'employee_per_shoot', 'employee_long_term', 'storeroom'] as const;
export type AssetCustodyHolder = (typeof ASSET_CUSTODY_HOLDERS)[number];

export const ASSET_CUSTODY_HOLDER_LABELS: Record<AssetCustodyHolder, string> = {
  room: 'A room',
  employee_per_shoot: 'An employee, per shoot',
  employee_long_term: 'An employee, long term',
  storeroom: 'The storeroom, by quantity',
};

export interface AssetGroupRule {
  label: string;
  /** The first part of its assets' codes. */
  prefix: 'ST' | 'PK' | 'IT' | 'OF' | 'CS';
  defaultClass: AssetClass;
  /** Years, for the book value; null: none (consumables). */
  usefulLifeYears: number | null;
  /** Counted every this many days (the counts, a later step). */
  countEveryDays: number;
  custodyBy: AssetCustodyHolder;
  examples: string;
}

/** The five groups as the spec has them (§2.2). */
export const ASSET_GROUP_RULES: Record<AssetGroup, AssetGroupRule> = {
  studio: {
    label: 'Studio installed',
    prefix: 'ST',
    defaultClass: 'fixed',
    usefulLifeYears: 8,
    countEveryDays: 182,
    custodyBy: 'room',
    examples: 'Cyclorama, lighting grid, rigging, mounted backdrop systems, studio AC',
  },
  kit: {
    label: 'Production kit (movable)',
    prefix: 'PK',
    defaultClass: 'fixed',
    usefulLifeYears: 5,
    countEveryDays: 30,
    custodyBy: 'employee_per_shoot',
    examples: 'Cameras, lenses, tripods, portable lights, audio, gimbals, rechargeable batteries',
  },
  it: {
    label: 'IT and devices',
    prefix: 'IT',
    defaultClass: 'fixed',
    usefulLifeYears: 3,
    countEveryDays: 91,
    custodyBy: 'employee_long_term',
    examples: 'Laptops, phones, tablets, drives',
  },
  office: {
    label: 'Office furniture and equipment',
    prefix: 'OF',
    defaultClass: 'fixed',
    usefulLifeYears: 7,
    countEveryDays: 365,
    custodyBy: 'room',
    examples: 'Desks, chairs, cabinets, printers',
  },
  consumable: {
    label: 'Consumables and stock',
    prefix: 'CS',
    defaultClass: 'current',
    usefulLifeYears: null,
    countEveryDays: 30,
    custodyBy: 'storeroom',
    examples: 'Disposable batteries, gaffer tape, gels, backdrop paper',
  },
};

export const ASSET_GROUP_LABELS: Record<AssetGroup, string> = Object.fromEntries(ASSET_GROUPS.map((g) => [g, ASSET_GROUP_RULES[g].label])) as Record<AssetGroup, string>;

export const isAssetGroup = (value: unknown): value is AssetGroup => (ASSET_GROUPS as readonly unknown[]).includes(value);

// ---------- types ----------

/**
 * The type codes (spec §2.3: "3 letters, extendable"; AC has 2), each with the group it usually belongs to (a hint for
 * the form, never a rule: a type can be in any group; null: any).
 */
export const ASSET_TYPES = [
  { code: 'CAM', label: 'Camera', group: 'kit' },
  { code: 'LEN', label: 'Lens', group: 'kit' },
  { code: 'LGT', label: 'Lighting', group: 'kit' },
  { code: 'GRP', label: 'Stands and grip', group: 'kit' },
  { code: 'AUD', label: 'Audio', group: 'kit' },
  { code: 'MON', label: 'Monitor', group: 'kit' },
  { code: 'GMB', label: 'Gimbal', group: 'kit' },
  { code: 'DRN', label: 'Drone', group: 'kit' },
  { code: 'ACC', label: 'Accessory', group: 'kit' },
  { code: 'BAT', label: 'Batteries', group: 'kit' },
  { code: 'BKD', label: 'Backdrop system', group: 'studio' },
  { code: 'RIG', label: 'Rigging', group: 'studio' },
  { code: 'PWR', label: 'Power distribution', group: 'studio' },
  { code: 'LAP', label: 'Laptop', group: 'it' },
  { code: 'WKS', label: 'Workstation', group: 'it' },
  { code: 'PHN', label: 'Phone', group: 'it' },
  { code: 'TAB', label: 'Tablet', group: 'it' },
  { code: 'DRV', label: 'Storage drive', group: 'it' },
  { code: 'NET', label: 'Network', group: 'it' },
  { code: 'DSK', label: 'Desk', group: 'office' },
  { code: 'CHR', label: 'Chair', group: 'office' },
  { code: 'CAB', label: 'Cabinet', group: 'office' },
  { code: 'PRN', label: 'Printer', group: 'office' },
  { code: 'AC', label: 'Air conditioner', group: 'studio' },
  { code: 'APL', label: 'Appliance', group: 'office' },
  { code: 'VEH', label: 'Vehicle', group: null },
  { code: 'GEL', label: 'Gels', group: 'consumable' },
  { code: 'TAP', label: 'Tape', group: 'consumable' },
  { code: 'PAP', label: 'Backdrop paper', group: 'consumable' },
  { code: 'SUP', label: 'Supplies', group: 'consumable' },
  { code: 'OTH', label: 'Other', group: null },
] as const satisfies readonly { code: string; label: string; group: AssetGroup | null }[];

export type AssetType = (typeof ASSET_TYPES)[number]['code'];

export const ASSET_TYPE_CODES: readonly AssetType[] = ASSET_TYPES.map((t) => t.code);

export const ASSET_TYPE_LABELS: Record<AssetType, string> = Object.fromEntries(ASSET_TYPES.map((t) => [t.code, t.label])) as Record<AssetType, string>;

export const isAssetType = (value: unknown): value is AssetType => (ASSET_TYPE_CODES as readonly unknown[]).includes(value);

/** The types to offer first for a group: its usual ones, then those of any group (Vehicle, Other). */
export function assetTypesFor(group: AssetGroup): AssetType[] {
  return ASSET_TYPES.filter((t) => t.group === group || t.group === null).map((t) => t.code);
}

// ---------- statuses and conditions ----------

/** Where an asset stands (spec §2.4). */
export const ASSET_STATUSES = ['available', 'custody', 'repair', 'lost', 'disposed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available: 'Available',
  custody: 'In custody',
  repair: 'Under repair',
  lost: 'Lost',
  disposed: 'Disposed',
};

export const isAssetStatus = (value: unknown): value is AssetStatus => (ASSET_STATUSES as readonly unknown[]).includes(value);

/**
 * The statuses the form sets by hand. Custody is set by a handover only and ends by receiving it back (spec §2.4:
 * "Handover only (never editable by hand)"); disposed by the dispose flow only (a manager's, a later step). Under
 * repair and Lost are on the form until the repairs and the counts (later steps) set them too.
 */
export const ASSET_STATUSES_BY_HAND = ['available', 'repair', 'lost'] as const satisfies readonly AssetStatus[];

/** Whether a status leaves an asset out of every total: disposed (spec §2.4: "Excluded from all totals"). */
export const countsInTotals = (status: AssetStatus | string): boolean => status !== 'disposed';

/**
 * Why an asset's status can't be changed by hand from `from` to `to`, or null when it can (spec §2.4). A consumable is
 * always available ("they're tracked by quantity").
 */
export function assetStatusProblem(from: AssetStatus | null, to: AssetStatus, group: AssetGroup): string | null {
  if (from === to) return null;
  if (to === 'custody') return 'Custody is set by a handover only, never by hand.';
  if (from === 'custody') return 'It is held in custody: it changes when it is received back.';
  if (to === 'disposed') return 'Disposal has its own steps, for an Assets manager.';
  if (from === 'disposed') return 'A disposed asset stays disposed.';
  if (group === 'consumable' && to !== 'available') return 'Consumables are always available: they are kept by quantity.';
  return null;
}

/** The condition an asset is in (spec §3). */
export const ASSET_CONDITIONS = ['new', 'excellent', 'good', 'used', 'needs_repair'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  new: 'New',
  excellent: 'Excellent',
  good: 'Good',
  used: 'Used',
  needs_repair: 'Needs repair',
};

export const isAssetCondition = (value: unknown): value is AssetCondition => (ASSET_CONDITIONS as readonly unknown[]).includes(value);

// ---------- codes ----------

/**
 * An asset's code (spec §2.3): `{PREFIX}-{TYPE}-{NNNN}`, e.g. PK-CAM-0003, numbered in order for each prefix and type,
 * at least 4 digits. Given once, in the database transaction that registers it (a counters table), so two people saving
 * at once never get the same; never changed, even when its group or type is edited later; never given again, even
 * after it is disposed of or deleted.
 */
export const ASSET_CODE_PATTERN = /^(ST|PK|IT|OF|CS)-([A-Z]{2,4})-(\d{4,})$/;

export const isAssetCode = (value: unknown): value is string => typeof value === 'string' && ASSET_CODE_PATTERN.test(value);

/** A code as typed or scanned ("pk-cam-0003 "), as kept ("PK-CAM-0003"). */
export const normalAssetCode = (value: string): string => value.trim().toUpperCase();

/** The counter an asset's number comes from: its group's prefix and its type, "PK-CAM-". */
export const assetCodePrefix = (group: AssetGroup, type: AssetType | string): string => `${ASSET_GROUP_RULES[group].prefix}-${type}-`;

/** The code of the n-th of a prefix: assetCode("PK-CAM-", 3) → "PK-CAM-0003". */
export const assetCode = (prefix: string, n: number): string => `${prefix}${String(n).padStart(4, '0')}`;

/** A kit's code (spec §2.3): PK-KIT-A, PK-KIT-B … PK-KIT-Z, PK-KIT-AA, PK-KIT-AB …, from the same counters. */
export const KIT_CODE_PREFIX = 'PK-KIT-';

/** 1 → A, 26 → Z, 27 → AA, 52 → AZ, 53 → BA, 702 → ZZ, 703 → AAA. */
export function kitLetters(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('A kit number starts at 1.');
  let out = '';
  for (let left = n; left > 0; left = Math.floor((left - 1) / 26)) out = String.fromCharCode(65 + ((left - 1) % 26)) + out;
  return out;
}

export const kitCode = (n: number): string => `${KIT_CODE_PREFIX}${kitLetters(n)}`;

export const KIT_CODE_PATTERN = /^PK-KIT-[A-Z]+$/;

/** A custody record's number (spec §2.3): CUS-0042, from the same counters (custody: a later step). */
export const CUSTODY_CODE_PREFIX = 'CUS-';

export const custodyCode = (n: number): string => `${CUSTODY_CODE_PREFIX}${String(n).padStart(4, '0')}`;

/**
 * The address inside an asset's QR label (spec §5): its page on the site, which the phone pages and the app open too.
 */
export const ASSET_LABEL_BASE = 'https://people.trendlix.com/assets/';

export const assetLabelUrl = (code: string): string => `${ASSET_LABEL_BASE}${encodeURIComponent(code)}`;

// ---------- the fields each group shows ----------

/**
 * Which fields an asset of a group has: a consumable is kept by quantity (its quantity, unit and reorder level), is
 * always available and has no serial, condition or useful life; only a production kit asset goes in a kit (spec §3:
 * "kit_id [only for kit group]").
 */
export function assetFieldsOf(group: AssetGroup) {
  const consumable = group === 'consumable';
  return {
    stock: consumable,
    kit: group === 'kit',
    serial: !consumable,
    condition: !consumable,
    usefulLife: !consumable,
    status: !consumable,
  };
}

/** An asset's own fields, as the form sends them and the API keeps them (the values are apart: AssetValuesInput). */
export interface AssetInput {
  name: string;
  group: AssetGroup;
  type: AssetType;
  assetClass: AssetClass;
  brand: string | null;
  model: string | null;
  serial: string | null;
  condition: AssetCondition | null;
  roomId: string | null;
  kitId: string | null;
  quantity: number | null;
  unit: string | null;
  reorderLevel: number | null;
  /** YYYY-MM-DD */
  purchaseDate: string | null;
  usefulLifeYears: number | null;
  /** YYYY-MM-DD */
  warrantyEnd: string | null;
  notes: string | null;
}

/**
 * An asset fitted to its group: what the group doesn't have left empty (a kit off a non-kit asset, the quantity off a
 * non-consumable, the serial, condition and useful life off a consumable), a consumable's quantity 0 when none is given.
 * Applied when it is registered and whenever its group changes, so a group edit never leaves fields of the old one.
 */
export function fitToGroup<T extends AssetInput>(asset: T): T {
  const fields = assetFieldsOf(asset.group);
  return {
    ...asset,
    kitId: fields.kit ? asset.kitId : null,
    quantity: fields.stock ? (asset.quantity ?? 0) : null,
    unit: fields.stock ? asset.unit : null,
    reorderLevel: fields.stock ? asset.reorderLevel : null,
    serial: fields.serial ? asset.serial : null,
    condition: fields.condition ? asset.condition : null,
    usefulLifeYears: fields.usefulLife ? asset.usefulLifeYears : null,
  };
}

/** The longest each text may be. */
/**
 * A serial number as serials are compared (owner, 22 October 2026: "same serial number shouldn't be added twice"): its
 * Unicode compatibility form, Arabic-Indic digits as 0-9, upper case, Latin letters and digits only, so "abc-123",
 * "ABC 123" and "ABC123" are one serial; null when it has none. The migration 20261022170000_asset_serial_keys gave the
 * serials kept before theirs the same way (normalize NFKC, translate, upper, regexp_replace).
 */
export function assetSerialKey(serial: string | null | undefined): string | null {
  if (typeof serial !== 'string') return null;
  const key = serial
    .normalize('NFKC')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return key || null;
}

export const ASSET_TEXT_LIMITS = {
  name: 120,
  brand: 80,
  model: 80,
  serial: 80,
  unit: 20,
  notes: 2000,
  supplier: 120,
  invoiceNo: 60,
  priceNote: 500,
  roomName: 80,
  roomNotes: 500,
  kitName: 80,
  kitNotes: 500,
} as const;

/** The most an amount may be (numeric(14,2)): under a trillion EGP. */
export const ASSET_MONEY_MAX = 999_999_999_999.99;

/** The most a quantity or reorder level may be. */
export const ASSET_QUANTITY_MAX = 1_000_000;

export const ASSET_USEFUL_LIFE_MAX = 50;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const hundredths = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** Every problem with an asset's fields, in words (after fitToGroup); none: it can be saved. `today`: YYYY-MM-DD, in Cairo. */
export function assetProblems(a: AssetInput, today: string): string[] {
  const out: string[] = [];
  const long = (value: string | null, max: number, what: string) => {
    if (value !== null && value.length > max) out.push(`Keep the ${what} to ${max} characters or fewer.`);
  };
  if (!a.name?.trim()) out.push('Enter the asset’s name.');
  long(a.name, ASSET_TEXT_LIMITS.name, 'name');
  if (!isAssetGroup(a.group)) out.push('Choose the group.');
  if (!isAssetType(a.type)) out.push('Choose the type.');
  if (!(ASSET_CLASSES as readonly string[]).includes(a.assetClass)) out.push('Choose fixed or current.');
  if (a.condition !== null && !isAssetCondition(a.condition)) out.push('Choose the condition.');
  long(a.brand, ASSET_TEXT_LIMITS.brand, 'brand');
  long(a.model, ASSET_TEXT_LIMITS.model, 'model');
  long(a.serial, ASSET_TEXT_LIMITS.serial, 'serial number');
  long(a.unit, ASSET_TEXT_LIMITS.unit, 'unit');
  long(a.notes, ASSET_TEXT_LIMITS.notes, 'notes');
  if (a.kitId !== null && a.group !== 'kit') out.push('Only a production kit asset goes in a kit.');
  if (a.group === 'consumable') {
    if (a.quantity === null || !hundredths(a.quantity) || a.quantity < 0 || a.quantity > ASSET_QUANTITY_MAX) out.push(`Enter the quantity, from 0 to ${ASSET_QUANTITY_MAX.toLocaleString('en-US')}.`);
    if (a.reorderLevel !== null && (!hundredths(a.reorderLevel) || a.reorderLevel < 0 || a.reorderLevel > ASSET_QUANTITY_MAX)) out.push('Enter the reorder level as 0 or more, or leave it empty.');
  } else if (a.quantity !== null || a.reorderLevel !== null) {
    out.push('Only consumables are kept by quantity.');
  }
  if (a.usefulLifeYears !== null && (!Number.isInteger(a.usefulLifeYears) || a.usefulLifeYears < 1 || a.usefulLifeYears > ASSET_USEFUL_LIFE_MAX)) {
    out.push(`Enter the useful life in whole years, from 1 to ${ASSET_USEFUL_LIFE_MAX}.`);
  }
  if (a.purchaseDate !== null) {
    if (!validDate(a.purchaseDate)) out.push('Enter the purchase date as DD/MM/YYYY.');
    else if (a.purchaseDate > today) out.push('The purchase date can’t be in the future.');
  }
  if (a.warrantyEnd !== null) {
    if (!validDate(a.warrantyEnd)) out.push('Enter the warranty end as DD/MM/YYYY.');
    else if (a.purchaseDate !== null && validDate(a.purchaseDate) && a.warrantyEnd < a.purchaseDate) out.push('The warranty can’t end before the purchase date.');
  }
  return out;
}

/** Whether a consumable is at or under its reorder level (spec §6.7: "Reorder when qty <= reorder_level"). */
export function needsReorder(a: { group: AssetGroup | string; quantity: number | null; reorderLevel: number | null }): boolean {
  return a.group === 'consumable' && a.quantity !== null && a.reorderLevel !== null && a.quantity <= a.reorderLevel;
}

// ---------- values ----------

/**
 * The values (owner, 21 October 2026: "CEO and Finance"): what the CEO, Finance and a Super Admin see and set, and
 * nobody else. All in EGP (spec §2.5). The market value is a range (low, mid, high) with a note on how it was reached:
 * a person's estimate for now, Claude's to review once the AI is set up (step 2).
 */
export interface AssetValuesInput {
  purchasePrice: number | null;
  supplier: string | null;
  invoiceNo: string | null;
  priceLow: number | null;
  marketValue: number | null;
  priceHigh: number | null;
  priceNote: string | null;
}

/** The values' fields: only those who see the values send them (the API refuses them from anyone else, 403). */
export const ASSET_VALUE_FIELDS = ['purchasePrice', 'supplier', 'invoiceNo', 'priceLow', 'marketValue', 'priceHigh', 'priceNote'] as const satisfies readonly (keyof AssetValuesInput)[];

/** The market value's three amounts: changing one of them stamps when the market value was last updated. */
export const ASSET_MARKET_FIELDS = ['priceLow', 'marketValue', 'priceHigh'] as const satisfies readonly (keyof AssetValuesInput)[];

/** Every problem with the values, in words; none: they can be saved. */
export function assetValuesProblems(v: AssetValuesInput): string[] {
  const out: string[] = [];
  const money = (value: number | null, what: string) => {
    if (value !== null && (!hundredths(value) || value < 0 || value > ASSET_MONEY_MAX)) out.push(`Enter the ${what} in EGP as 0 or more, with at most 2 decimals, e.g. 45000 or 45000.50.`);
  };
  money(v.purchasePrice, 'purchase cost');
  money(v.priceLow, 'low market value');
  money(v.marketValue, 'market value');
  money(v.priceHigh, 'high market value');
  if (v.priceLow !== null && v.marketValue !== null && v.priceLow > v.marketValue) out.push('The low market value can’t be more than the market value.');
  if (v.marketValue !== null && v.priceHigh !== null && v.marketValue > v.priceHigh) out.push('The market value can’t be more than the high one.');
  if (v.priceLow !== null && v.priceHigh !== null && v.priceLow > v.priceHigh) out.push('The low market value can’t be more than the high one.');
  if (v.supplier !== null && v.supplier.length > ASSET_TEXT_LIMITS.supplier) out.push(`Keep the supplier to ${ASSET_TEXT_LIMITS.supplier} characters or fewer.`);
  if (v.invoiceNo !== null && v.invoiceNo.length > ASSET_TEXT_LIMITS.invoiceNo) out.push(`Keep the invoice number to ${ASSET_TEXT_LIMITS.invoiceNo} characters or fewer.`);
  if (v.priceNote !== null && v.priceNote.length > ASSET_TEXT_LIMITS.priceNote) out.push(`Keep the note to ${ASSET_TEXT_LIMITS.priceNote} characters or fewer.`);
  return out;
}

/** The capitalization threshold's problem, in words; null when it can be saved. */
export function thresholdProblem(value: number): string | null {
  return hundredths(value) && value >= 0 && value <= ASSET_MONEY_MAX ? null : 'Enter the threshold in EGP as 0 or more, with at most 2 decimals, e.g. 5000.';
}

/** An asset's book value: the amount (EGP) or why there is none. */
export interface BookValue {
  /** EGP with 2 decimals; null when it can't be worked out (`missing` says why). */
  amount: number | null;
  /** Cheaper than the capitalization threshold: expensed, its book value 0 (spec §6.8). */
  expensed: boolean;
  /** What it needs to be worked out. */
  missing: 'purchase_price' | 'purchase_date' | 'useful_life' | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * The book value on a day (spec §2.5): straight line, purchase price × (1 − years since purchase ÷ useful life), never
 * below 0, the years counted in days ÷ 365.25 (none before the purchase date); 0 and Expensed when the price is below
 * the capitalization threshold (spec §6.8); the price itself for a current asset (stock isn't depreciated). Null with
 * what it needs when the price is missing, or for a fixed asset the purchase date or the useful life.
 */
export function bookValue(a: { purchasePrice: number | null; purchaseDate: string | null; usefulLifeYears: number | null; assetClass: AssetClass | string }, threshold: number, on: string): BookValue {
  if (a.purchasePrice === null) return { amount: null, expensed: false, missing: 'purchase_price' };
  if (a.purchasePrice < threshold) return { amount: 0, expensed: true, missing: null };
  if (a.assetClass === 'current') return { amount: round2(a.purchasePrice), expensed: false, missing: null };
  if (a.purchaseDate === null) return { amount: null, expensed: false, missing: 'purchase_date' };
  if (a.usefulLifeYears === null || a.usefulLifeYears <= 0) return { amount: null, expensed: false, missing: 'useful_life' };
  const days = Math.max(0, Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${a.purchaseDate}T00:00:00Z`)) / 86_400_000));
  const years = days / 365.25;
  return { amount: round2(Math.max(0, a.purchasePrice * (1 - years / a.usefulLifeYears))), expensed: false, missing: null };
}

/** What a missing book value says, on the asset's page. */
export const BOOK_VALUE_MISSING_TEXT: Record<NonNullable<BookValue['missing']>, string> = {
  purchase_price: 'Needs the purchase cost',
  purchase_date: 'Needs the purchase date',
  useful_life: 'Needs the useful life',
};

/** "Needs values" (owner's decisions, 21 October 2026): an asset without a purchase cost, not disposed of. */
export const needsValues = (a: { purchasePrice: number | null; status: AssetStatus | string }): boolean => a.purchasePrice === null && a.status !== 'disposed';

// ---------- photos ----------

/** Up to 6 photos an asset (owner's brief, 21 October 2026); the first is the one the lists show. */
export const ASSET_PHOTOS_MAX = 6;

/** Each photo at most 10 MB, as the employee file's papers. The web makes a photo smaller before it is sent. */
export const ASSET_PHOTO_MAX_MB = 10;

/** The longest side the web sends a photo at, and its JPEG quality (spec §4: 1600 px, JPEG 85%). */
export const ASSET_PHOTO_SIDE = 1600;
export const ASSET_PHOTO_QUALITY = 0.85;

// ---------- the API's answers ----------

/** A room an asset is in. Rooms, not "locations": Check-in Setup's check-in locations are another thing. */
export interface AssetRoomRef {
  id: string;
  name: string;
}

export interface AssetKitRef {
  id: string;
  code: string;
  name: string;
}

/** The employee holding it in custody (custody: a later step). */
export interface AssetHolderRef {
  id: string;
  employeeCode: string;
  fullNameEn: string;
}

/**
 * A photo, served at GET /assets/:code/photos/:id. `product`: only on the maker's product image a draft from Claude
 * brought (owner, 21 October 2026: "let the mcp connector fetch the product photo and add it"), where it came from; it
 * shows the model, not the item itself, so it is badged "Product image" wherever it shows.
 */
export interface AssetPhotoRef {
  id: string;
  position: number;
  product?: ProductImageSource;
}

export interface AssetUserRef {
  email: string;
  name: string | null;
}

/** An asset's values on its page, only for those who see the values (the key is left out for everyone else). */
export interface AssetValuesView extends AssetValuesInput {
  /** ISO moment the market value last changed; null: never set. */
  priceUpdatedAt: string | null;
  bookValue: BookValue;
}

/** An asset as GET /assets lists it. `values` only for those who see the values. */
export interface AssetRowView {
  id: string;
  code: string;
  name: string;
  group: AssetGroup;
  type: AssetType;
  status: AssetStatus;
  condition: AssetCondition | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  room: AssetRoomRef | null;
  kit: AssetKitRef | null;
  holder: AssetHolderRef | null;
  quantity: number | null;
  unit: string | null;
  /** A consumable at or under its reorder level. */
  reorder: boolean;
  /** The first photo; null: none. */
  photo: AssetPhotoRef | null;
  values?: { purchasePrice: number | null; marketValue: number | null; bookValue: number | null; expensed: boolean };
  /** The main asset it is attached to (step 4, asset-accessories.ts); null: none. Left out by an API from before. */
  parent?: AssetParentRef | null;
}

/** GET /assets: a page of the register, with how many match, and counts for the filter chips (the search alone). */
export interface AssetListView {
  items: AssetRowView[];
  total: number;
  page: number;
  pageSize: number;
  /** Over the search (q) alone, whatever chips are chosen; disposed assets in their status only. */
  counts: { group: Record<AssetGroup, number>; status: Record<AssetStatus, number> };
}

/** The register's page size. */
export const ASSETS_PAGE_SIZE = 50;

/** An asset as GET /assets/:code answers it. `values` only for those who see the values. */
export interface AssetView extends Omit<AssetRowView, 'values'> {
  assetClass: AssetClass;
  reorderLevel: number | null;
  purchaseDate: string | null;
  usefulLifeYears: number | null;
  warrantyEnd: string | null;
  notes: string | null;
  labeledAt: string | null;
  photos: AssetPhotoRef[];
  /** Whether it was ever in custody: then it can't be deleted, only disposed of. */
  everInCustody: boolean;
  createdAt: string;
  createdBy: AssetUserRef | null;
  updatedAt: string;
  values?: AssetValuesView;
  /** What the caller may do on it now. */
  can: {
    edit: boolean;
    photos: boolean;
    values: boolean;
    delete: boolean;
    /** Step 4 (asset-upkeep.ts, asset-accessories.ts): its checklist and attached assets, a consumable's Use and Restock, a maintenance entry by hand (a custodian or a manager); disposal (a manager). */
    accessories?: boolean;
    attach?: boolean;
    stock?: boolean;
    maintenance?: boolean;
    dispose?: boolean;
  };
  /** Step 4: its accessories' checklist, in order. */
  accessories?: AccessoryView[];
  /** Step 4: the assets attached to it. */
  attached?: AttachedAssetView[];
  /** Step 4: how it was disposed of, once it is. */
  disposal?: AssetDisposalView | null;
}

/** A room as GET /assets/rooms lists it. */
export interface AssetRoomView {
  id: string;
  name: string;
  notes: string | null;
  archived: boolean;
  /** Assets in it now (disposed ones aside). */
  assets: number;
}

/** A kit as GET /assets/kits lists it. */
export interface AssetKitView {
  id: string;
  code: string;
  name: string;
  notes: string | null;
  /** Assets in it now (disposed ones aside). */
  assets: number;
  /** Step 4 (asset-upkeep.ts): its assets, by code, and how it stands. Left out by an API from before. */
  items?: AssetKitItemView[];
  status?: KitStatus;
}

/** GET /assets/settings. */
export interface AssetSettingsView {
  /** EGP: an asset cheaper than this is Expensed (book value 0). 0: none is. */
  capitalizationThreshold: number;
  /**
   * The terms the custody forms print (step 3): those an Assets manager wrote, else the standard wording (custody.ts).
   * `custodyTermsStandard`: none were written, the standard wording is printed.
   */
  custodyTerms: string[];
  custodyTermsStandard: boolean;
  updatedAt: string | null;
  updatedBy: AssetUserRef | null;
}
