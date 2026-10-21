// Custody (Assets, step 3; owner, 21 October 2026: the "Asset Register" spec's custody, built the People System's way:
// "use the main ERP system specs .. dont stick to the MD file"): assets handed over to an employee, for a shoot (with its
// return date) or as a long-term assignment (back at clearance), on a custody record CUS-0042 whose form is printed,
// signed on paper and attached; received back item by item, good, damaged or missing; what each person holds; and their
// own, read only (owner, 21 October 2026: "Yes, My custody"). Damages and losses stay on the person's record and HR
// decides a deduction (owner, 21 October 2026: "Record it; HR decides a deduction"), never made by itself. The repairs
// and the lost and found of an asset's page too. Pure code: the API decides with these, the web shows them.

import {
  ASSET_STATUS_LABELS,
  type AssetCondition,
  type AssetGroup,
  type AssetHolderRef,
  type AssetStatus,
  type AssetType,
  type AssetUserRef,
} from './assets.js';

// ---------- kinds, statuses, conditions ----------

/**
 * A shoot (spec §6.2: "A shoot check-out needs a return date") or a long-term assignment ("Long-term assignments have no
 * return date; they come back at clearance").
 */
export const CUSTODY_KINDS = ['shoot', 'assignment'] as const;
export type CustodyKind = (typeof CUSTODY_KINDS)[number];

export const CUSTODY_KIND_LABELS: Record<CustodyKind, string> = { shoot: 'Shoot', assignment: 'Long-term assignment' };

export const CUSTODY_KIND_HINTS: Record<CustodyKind, string> = {
  shoot: 'For a shoot: it comes back by the return date.',
  assignment: 'Held long term, e.g. a laptop or a phone: no return date, it comes back at clearance.',
};

export const isCustodyKind = (value: unknown): value is CustodyKind => (CUSTODY_KINDS as readonly unknown[]).includes(value);

/** A record's state: nothing back yet, some back, all back. */
export const CUSTODY_STATUSES = ['open', 'partial', 'closed'] as const;
export type CustodyStatus = (typeof CUSTODY_STATUSES)[number];

export const CUSTODY_STATUS_LABELS: Record<CustodyStatus, string> = { open: 'Out', partial: 'Partly returned', closed: 'Closed' };

/** How an item comes back (spec §3: "return_condition good|damaged|missing"). */
export const RETURN_CONDITIONS = ['good', 'damaged', 'missing'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const RETURN_CONDITION_LABELS: Record<ReturnCondition, string> = { good: 'Good', damaged: 'Damaged', missing: 'Missing' };

/** What each condition does to the asset, as the receive-back form says it. */
export const RETURN_CONDITION_HINTS: Record<ReturnCondition, string> = {
  good: 'Back in the register, available.',
  damaged: 'Under repair, with an entry in its maintenance log.',
  missing: 'Marked lost.',
};

export const isReturnCondition = (value: unknown): value is ReturnCondition => (RETURN_CONDITIONS as readonly unknown[]).includes(value);

/**
 * The asset's status once received back (spec §6.4): good → available; damaged → under repair (with a maintenance entry);
 * missing → lost. Its holder and record are cleared in every case.
 */
export const STATUS_ON_RETURN: Record<ReturnCondition, AssetStatus> = { good: 'available', damaged: 'repair', missing: 'lost' };

/** A record's status from its items: none back → open; all back → closed; else partly returned. */
export function custodyStatusOf(items: readonly { returned: boolean }[]): CustodyStatus {
  const back = items.filter((i) => i.returned).length;
  if (back === 0) return 'open';
  return back === items.length ? 'closed' : 'partial';
}

// ---------- overdue and not signed ----------

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Overdue (spec §6.2): a shoot whose return date has passed (`today`, YYYY-MM-DD in Cairo, is after it) and whose record
 * isn't closed. A long-term assignment never is.
 */
export function isOverdue(r: { kind: CustodyKind | string; status: CustodyStatus | string; dueDate: string | null }, today: string): boolean {
  return r.kind === 'shoot' && r.status !== 'closed' && r.dueDate !== null && r.dueDate < today;
}

/** Whole days past the return date; 0 when it isn't overdue. */
export function daysOverdue(r: { kind: CustodyKind | string; status: CustodyStatus | string; dueDate: string | null }, today: string): number {
  return isOverdue(r, today) ? daysBetween(r.dueDate!, today) : 0;
}

/**
 * The spec's paper signing: save the handover, print the form, the employee signs it, the signed page is photographed or
 * scanned and attached. Without it the record shows "Signed copy not attached" and is on the Not signed list.
 */
export const NOT_SIGNED_TEXT = 'Signed copy not attached';

/** The custodians are told once when a record's signed copy is still not attached this many days after the handover. */
export const CUSTODY_UNSIGNED_DAYS = 3;

/** Whether a record is still not signed `CUSTODY_UNSIGNED_DAYS` days after it went out (`outAt`, an ISO moment). */
export function unsignedTooLong(r: { signed: boolean; outAt: string }, now: Date): boolean {
  return !r.signed && now.getTime() - Date.parse(r.outAt) >= CUSTODY_UNSIGNED_DAYS * DAY_MS;
}

// ---------- the custody list's filters ----------

/** The Custody list's filters (spec §5: "Active, Overdue, Not signed, Closed, All"). */
export const CUSTODY_FILTERS = ['active', 'overdue', 'unsigned', 'closed', 'all'] as const;
export type CustodyFilter = (typeof CUSTODY_FILTERS)[number];

export const CUSTODY_FILTER_LABELS: Record<CustodyFilter, string> = { active: 'Active', overdue: 'Overdue', unsigned: 'Not signed', closed: 'Closed', all: 'All' };

export const isCustodyFilter = (value: unknown): value is CustodyFilter => (CUSTODY_FILTERS as readonly unknown[]).includes(value);

/** Whether a record is in a filter's list. */
export function inCustodyFilter(r: { kind: string; status: string; dueDate: string | null; signed: boolean }, filter: CustodyFilter, today: string): boolean {
  switch (filter) {
    case 'active':
      return r.status !== 'closed';
    case 'overdue':
      return isOverdue(r, today);
    case 'unsigned':
      return !r.signed;
    case 'closed':
      return r.status === 'closed';
    case 'all':
      return true;
  }
}

/** The custody list's page size. */
export const CUSTODY_PAGE_SIZE = 50;

// ---------- codes ----------

/** A custody record's code as kept: CUS-0042 (assets.ts custodyCode gives it from the counters). */
export const CUSTODY_CODE_PATTERN = /^CUS-\d{4,}$/;

export const isCustodyCode = (value: unknown): value is string => typeof value === 'string' && CUSTODY_CODE_PATTERN.test(value);

/** A code as typed ("cus-0042 "), as kept ("CUS-0042"). */
export const normalCustodyCode = (value: string): string => value.trim().toUpperCase();

// ---------- handing over ----------

/** The most assets one handover takes. */
export const CUSTODY_ITEMS_MAX = 100;

/** The longest each text may be. */
export const CUSTODY_TEXT_LIMITS = {
  purpose: 200,
  notes: 2000,
  handedOverBy: 120,
  accessories: 300,
  returnNotes: 1000,
  term: 600,
} as const;

/** The most terms the form prints. */
export const CUSTODY_TERMS_MAX = 15;

/**
 * Why an asset can't be handed over, or null when it can (spec §6.1: "Only available, non-consumable assets can be
 * handed over"). A draft from Claude is never an asset, so it is never offered.
 */
export function handOverProblem(a: { code: string; status: AssetStatus | string; group: AssetGroup | string }): string | null {
  if (a.group === 'consumable') return `${a.code} is a consumable: consumables are kept by quantity, not handed over.`;
  if (a.status !== 'available') {
    const label = ASSET_STATUS_LABELS[a.status as AssetStatus]?.toLowerCase() ?? a.status;
    return `${a.code} is ${label}: only available assets are handed over.`;
  }
  return null;
}

/** A kit's asset left out of a handover, and why (spec §6.3: "items already out or under repair are skipped, and the UI says so"). */
export interface KitSkip {
  code: string;
  name: string;
  why: string;
}

/** Why a kit's asset isn't added by the kit quick-add, or null when it is: out (with whom, on which record), under repair, lost. */
export function kitSkipReason(a: { status: AssetStatus | string; group: AssetGroup | string; holder?: string | null; custodyCode?: string | null }): string | null {
  if (a.group === 'consumable') return 'A consumable';
  switch (a.status) {
    case 'available':
      return null;
    case 'custody':
      return a.holder ? `Out with ${a.holder}${a.custodyCode ? ` on ${a.custodyCode}` : ''}` : 'In custody';
    case 'repair':
      return 'Under repair';
    case 'lost':
      return 'Lost';
    case 'disposed':
      return 'Disposed';
    default:
      return ASSET_STATUS_LABELS[a.status as AssetStatus] ?? a.status;
  }
}

/**
 * The kit quick-add (spec §6.3: "Handing over a kit adds all its available items; items already out or under repair are
 * skipped"): the ids of the kit's assets that can go, and those skipped with why. Disposed ones aren't in a kit's list.
 */
export function kitQuickAdd<T extends { id: string; code: string; name: string; status: AssetStatus | string; group: AssetGroup | string; holder?: string | null; custodyCode?: string | null }>(
  items: readonly T[],
): { add: string[]; skipped: KitSkip[] } {
  const add: string[] = [];
  const skipped: KitSkip[] = [];
  for (const i of items) {
    if (i.status === 'disposed') continue;
    const why = kitSkipReason(i);
    if (why) skipped.push({ code: i.code, name: i.name, why });
    else add.push(i.id);
  }
  return { add, skipped };
}

/** A handover as the form sends it: who, what kind, until when, why, by whom, and the assets with their condition. */
export interface HandoverInput {
  employeeId: string;
  kind: CustodyKind;
  /** YYYY-MM-DD; a shoot's only. */
  dueDate: string | null;
  purpose: string | null;
  /** Who handed it over, as written on the form: the signed-in person unless changed. */
  handedOverBy: string;
  notes: string | null;
  items: { assetId: string; conditionOut: AssetCondition | null; accessories: string | null }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * Every problem with a handover's own fields, in words (the assets themselves are checked against the register by the
 * API); none: it can be saved. `today`: YYYY-MM-DD in Cairo. `assets`: how many assets it takes, kits counted in.
 */
export function handoverProblems(h: Omit<HandoverInput, 'items'> & { items: readonly unknown[] }, today: string, assets = h.items.length): string[] {
  const out: string[] = [];
  if (!h.employeeId) out.push('Choose the employee.');
  if (!isCustodyKind(h.kind)) out.push('Choose a shoot or a long-term assignment.');
  if (h.kind === 'shoot') {
    if (!h.dueDate) out.push('A shoot needs its return date.');
    else if (!validDate(h.dueDate)) out.push('Enter the return date as DD/MM/YYYY.');
    else if (h.dueDate < today) out.push('The return date can’t be before today.');
  } else if (h.kind === 'assignment' && h.dueDate) {
    out.push('A long-term assignment has no return date: it comes back at clearance.');
  }
  if (!h.handedOverBy?.trim()) out.push('Say who handed it over.');
  else if (h.handedOverBy.length > CUSTODY_TEXT_LIMITS.handedOverBy) out.push(`Keep who handed it over to ${CUSTODY_TEXT_LIMITS.handedOverBy} characters or fewer.`);
  if (h.purpose && h.purpose.length > CUSTODY_TEXT_LIMITS.purpose) out.push(`Keep the purpose to ${CUSTODY_TEXT_LIMITS.purpose} characters or fewer.`);
  if (h.notes && h.notes.length > CUSTODY_TEXT_LIMITS.notes) out.push(`Keep the notes to ${CUSTODY_TEXT_LIMITS.notes} characters or fewer.`);
  if (assets < 1) out.push('Choose the assets to hand over.');
  else if (assets > CUSTODY_ITEMS_MAX) out.push(`Hand over at most ${CUSTODY_ITEMS_MAX} assets at a time.`);
  return out;
}

// ---------- the terms ----------

/**
 * The terms printed on the custody form (spec §6), the standard wording: kept until an Assets manager writes others in
 * Assets → Settings; each record keeps the terms it was printed with. The owner's note, not the form's: "have a labour
 * lawyer review this wording before use".
 */
export const CUSTODY_TERMS_STANDARD: readonly string[] = [
  'I received the items listed above in the condition stated, with their accessories.',
  'I will use them only for company work and will not lend them to anyone else.',
  'I will return them by the return date, whenever the company asks, and before my last working day.',
  'I will report any damage, loss or theft within 24 hours. For theft I will also file a police report.',
  'I am responsible for loss or damage caused by my negligence or misuse, within the limits of Egyptian labor law.',
];

/** The note beside the terms in Settings (the owner's, never printed on the form). */
export const CUSTODY_TERMS_REVIEW_NOTE = 'Have a labour lawyer review this wording before use.';

/** The terms in force: those set, else the standard wording. */
export const custodyTermsOf = (set: readonly string[] | null | undefined): string[] => (set && set.length ? [...set] : [...CUSTODY_TERMS_STANDARD]);

/** The terms as typed in Settings, one a line: blank lines dropped, each trimmed. */
export const termsFromText = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);

/** Every problem with the terms, in words; none: they can be saved. */
export function termsProblems(terms: readonly string[]): string[] {
  const out: string[] = [];
  if (!terms.length) out.push('Write at least one term.');
  if (terms.length > CUSTODY_TERMS_MAX) out.push(`Keep the terms to ${CUSTODY_TERMS_MAX} or fewer.`);
  if (terms.some((t) => !t.trim())) out.push('A term can’t be empty.');
  if (terms.some((t) => t.length > CUSTODY_TEXT_LIMITS.term)) out.push(`Keep each term to ${CUSTODY_TEXT_LIMITS.term} characters or fewer.`);
  return out;
}

// ---------- damages to deductions ----------

/**
 * The automatic maintenance entry of an asset returned damaged (spec §6.4: "Returned damaged on CUS-xxxx by {name}"),
 * with the notes typed on return after it.
 */
export function returnedDamagedNote(custodyCode: string, name: string, notes?: string | null): string {
  return `Returned damaged on ${custodyCode} by ${name}${notes?.trim() ? `: ${notes.trim()}` : ''}`;
}

/**
 * Who gets "Create a deduction" on a damaged or missing item (owner, 21 October 2026: "Record it; HR decides a
 * deduction"): those who enter additions and deductions in Payroll, HR; never made by itself. A C-level person's records
 * are seen only by those who see C-level people, as everywhere.
 */
export const createsCustodyDeduction = (user: { roles: readonly string[] }): boolean => user.roles.includes('hr');

/** Those who see a custody item's deductions (their month, status and amount): as Additions / Deductions, HR, Finance and the CEO. */
export const seesCustodyDeductions = (user: { roles: readonly string[] }): boolean => user.roles.some((r) => r === 'hr' || r === 'finance' || r === 'ceo');

/** The deduction's reason, prefilled: "Damage: PK-CAM-0003 on CUS-0042", a missing one "Loss: …". */
export function custodyDeductionReason(condition: 'damaged' | 'missing', assetCode: string, custodyCode: string): string {
  return `${condition === 'missing' ? 'Loss' : 'Damage'}: ${assetCode} on ${custodyCode}`;
}

/** The deduction type a damaged or missing item becomes (payroll-adjustments.ts: "Damage or loss"). */
export const CUSTODY_DEDUCTION_TYPE = 'damage_loss';

/** Why a deduction can't be linked to a custody item, or null when it can. */
export function custodyDeductionProblem(d: { kind: string; type: string }, item: { returnCondition: string | null; employeeId: string } | null, employeeId: string): string | null {
  if (d.kind !== 'deduction' || d.type !== CUSTODY_DEDUCTION_TYPE) return 'Only a Damage or loss deduction is linked to a custody item.';
  if (!item || item.employeeId !== employeeId) return 'Choose a damaged or missing item of this employee’s custody.';
  if (item.returnCondition !== 'damaged' && item.returnCondition !== 'missing') return 'Only an item returned damaged or missing becomes a deduction.';
  return null;
}

// ---------- an asset's page: repairs, lost and found ----------

/** The maintenance log's kinds (spec §3: "Repair|Service|Inspection|Warranty claim|Upgrade"). */
export const MAINTENANCE_KINDS = ['repair', 'service', 'inspection', 'warranty_claim', 'upgrade'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  repair: 'Repair',
  service: 'Service',
  inspection: 'Inspection',
  warranty_claim: 'Warranty claim',
  upgrade: 'Upgrade',
};

/** What made an entry, when the register made it: sent to repair, back from repair, returned damaged on a custody record. */
export const MAINTENANCE_EVENTS = ['sent_to_repair', 'back_from_repair', 'returned_damaged'] as const;
export type MaintenanceEvent = (typeof MAINTENANCE_EVENTS)[number];

export const MAINTENANCE_EVENT_LABELS: Record<MaintenanceEvent, string> = {
  sent_to_repair: 'Sent to repair',
  back_from_repair: 'Back from repair',
  returned_damaged: 'Returned damaged',
};

/** The actions of an asset's page besides editing it. */
export const ASSET_ACTIONS = ['hand_over', 'send_to_repair', 'back_from_repair', 'mark_lost', 'mark_found'] as const;
export type AssetAction = (typeof ASSET_ACTIONS)[number];

/**
 * Why an action can't be taken on an asset in its status, or null when it can: hand over an available one (not a
 * consumable); send an available one to repair; back from repair one under repair; mark lost an available one or one
 * under repair (one in custody is lost by receiving it back missing); mark found a lost one. Custody and disposal change
 * by their own steps only.
 */
export function assetActionProblem(action: AssetAction, a: { code: string; status: AssetStatus | string; group: AssetGroup | string }): string | null {
  if (action === 'hand_over') return handOverProblem(a);
  if (a.group === 'consumable') return 'Consumables are always available: they are kept by quantity.';
  const label = ASSET_STATUS_LABELS[a.status as AssetStatus]?.toLowerCase() ?? a.status;
  switch (action) {
    case 'send_to_repair':
      return a.status === 'available' ? null : a.status === 'custody' ? `${a.code} is in custody: receive it back damaged to send it to repair.` : `${a.code} is ${label}: only an available asset is sent to repair.`;
    case 'back_from_repair':
      return a.status === 'repair' ? null : `${a.code} isn’t under repair.`;
    case 'mark_lost':
      return a.status === 'available' || a.status === 'repair' ? null : a.status === 'custody' ? `${a.code} is in custody: receive it back missing to mark it lost.` : `${a.code} is ${label} already or can’t be marked lost.`;
    case 'mark_found':
      return a.status === 'lost' ? null : `${a.code} isn’t lost.`;
  }
}

/** Which actions an asset's page offers now. */
export function assetActionsOf(a: { code: string; status: AssetStatus | string; group: AssetGroup | string }): Record<AssetAction, boolean> {
  return Object.fromEntries(ASSET_ACTIONS.map((x) => [x, assetActionProblem(x, a) === null])) as Record<AssetAction, boolean>;
}

/** The longest a repair's vendor and notes may be. */
export const MAINTENANCE_TEXT_LIMITS = { vendor: 120, notes: 1000 } as const;

// ---------- addresses ----------

/** A custody record's page on the site (the notices link to it; the phone pages open it under /app). */
export const custodyRecordPath = (code: string): string => `/assets/custody/${encodeURIComponent(code)}`;

/** My custody on the site: it opens the person's own profile on its Custody tab (in the app, the phone pages' own). */
export const MY_CUSTODY_PATH = '/my-custody';

// ---------- the API's answers ----------

/** An asset in a custody record's or a holding's list. */
export interface CustodyAssetRef {
  id: string;
  code: string;
  name: string;
  group: AssetGroup;
  type: AssetType;
  status: AssetStatus;
  brand: string | null;
  model: string | null;
  serial: string | null;
}

/** The person a record is for, with where they work and their job, as the form prints them. */
export interface CustodyPersonView extends AssetHolderRef {
  jobTitle: string | null;
  department: string | null;
}

/** A signed copy attached (a photo or a PDF), served at GET /assets/custody/:code/signed/:fileId. */
export interface CustodyFileRef {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: AssetUserRef | null;
}

/** A deduction HR made from a damaged or missing item: for HR, Finance and the CEO only. */
export interface CustodyDeductionRef {
  id: string;
  /** YYYY-MM */
  month: string;
  status: string;
  amount: number | null;
}

/** An item of a custody record. `valueAtOut` only for those who see the values; `deductions` only for HR, Finance and the CEO. */
export interface CustodyItemView {
  id: string;
  asset: CustodyAssetRef;
  conditionOut: AssetCondition | null;
  accessories: string | null;
  valueAtOut?: number | null;
  /** ISO moment it came back; null: still out. */
  returnedAt: string | null;
  returnCondition: ReturnCondition | null;
  receivedBy: AssetUserRef | null;
  returnNotes: string | null;
  deductions?: CustodyDeductionRef[];
}

/** One return, as the form appends it: the items received back together, when and by whom. */
export interface CustodyReturnView {
  at: string;
  receivedBy: AssetUserRef | null;
  items: { itemId: string; code: string; name: string; condition: ReturnCondition; notes: string | null }[];
}

/** A custody record as GET /assets/custody/:code answers it. */
export interface CustodyRecordView {
  id: string;
  code: string;
  kind: CustodyKind;
  status: CustodyStatus;
  employee: CustodyPersonView;
  purpose: string | null;
  /** YYYY-MM-DD, a shoot's only. */
  dueDate: string | null;
  outAt: string;
  closedAt: string | null;
  /** Who handed it over, as written. */
  handedOverBy: string | null;
  /** Who recorded it in the system. */
  issuedBy: AssetUserRef | null;
  notes: string | null;
  /** The terms printed on its form, as they were when it was saved. */
  terms: string[];
  items: CustodyItemView[];
  returns: CustodyReturnView[];
  files: CustodyFileRef[];
  signed: boolean;
  overdue: boolean;
  daysOverdue: number;
  /** The items' values when they went out, together: for those who see the values. */
  valueAtOut?: number | null;
  can: { receive: boolean; attach: boolean; deduction: boolean };
}

/** A record in the Custody list, and in a person's custody history. */
export interface CustodyRowView {
  id: string;
  code: string;
  kind: CustodyKind;
  status: CustodyStatus;
  employee: AssetHolderRef;
  purpose: string | null;
  dueDate: string | null;
  outAt: string;
  closedAt: string | null;
  items: number;
  /** Still out. */
  out: number;
  signed: boolean;
  overdue: boolean;
  daysOverdue: number;
}

/** GET /assets/custody: a page of the list, with how many each filter has (over the search alone). */
export interface CustodyListView {
  items: CustodyRowView[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<CustodyFilter, number>;
}

/** An asset the handover form offers: available, not a consumable. */
export interface HandoverAssetChoice {
  id: string;
  code: string;
  name: string;
  group: AssetGroup;
  type: AssetType;
  serial: string | null;
  condition: AssetCondition | null;
  kit: { id: string; code: string } | null;
}

/** A kit for the quick-add: its assets, each with why it would be skipped (null: it goes). */
export interface HandoverKitChoice {
  id: string;
  code: string;
  name: string;
  items: { id: string; code: string; name: string; status: AssetStatus; why: string | null }[];
}

/** GET /assets/custody/choices: what the handover form chooses from. */
export interface HandoverChoices {
  /** Current employees only, C-level people only for those who see them. */
  people: (AssetHolderRef & { department: string | null })[];
  assets: HandoverAssetChoice[];
  kits: HandoverKitChoice[];
  /** The signed-in person, as "Handed over by" starts. */
  handedOverBy: string;
  /** The terms the form will print. */
  terms: string[];
}

/** POST /assets/custody: the record made, and the kits' assets skipped (with why). */
export interface HandoverResult {
  record: CustodyRecordView;
  skipped: KitSkip[];
}

/** An asset someone holds now. `valueAtOut` only for those who see the values. */
export interface HeldItemView {
  itemId: string;
  asset: CustodyAssetRef;
  custody: { code: string; kind: CustodyKind; dueDate: string | null };
  /** ISO moment it was handed over. */
  since: string;
  overdue: boolean;
  daysOverdue: number;
  conditionOut: AssetCondition | null;
  accessories: string | null;
  valueAtOut?: number | null;
}

/** An item returned damaged or missing: it stays on the person's record (spec §6.4). */
export interface CustodyIncidentView {
  itemId: string;
  asset: CustodyAssetRef;
  custodyCode: string;
  condition: 'damaged' | 'missing';
  returnedAt: string;
  notes: string | null;
  receivedBy: AssetUserRef | null;
  valueAtOut?: number | null;
  deductions?: CustodyDeductionRef[];
}

/** A card of the holdings search: what someone holds now. `value` only for those who see the values. */
export interface HolderCardView {
  employee: AssetHolderRef;
  holding: number;
  overdue: number;
  damagedOrMissing: number;
  value?: number | null;
}

/** GET /assets/custody/people/:employeeId: what a person holds, their damaged and missing items, their records. */
export interface HoldingsView {
  employee: CustodyPersonView;
  current: HeldItemView[];
  incidents: CustodyIncidentView[];
  records: CustodyRowView[];
  value?: number | null;
  can: { handOver: boolean; deduction: boolean };
}

/** GET /me/custody: what the signed-in person holds, their records and their signed forms (read only, no values). */
export interface MyCustodyView {
  employeeId: string | null;
  current: HeldItemView[];
  records: (CustodyRowView & { files: CustodyFileRef[] })[];
  overdue: number;
}

/** An asset's custody history entry, on its page. */
export interface AssetCustodyEntry {
  itemId: string;
  code: string;
  kind: CustodyKind;
  employee: AssetHolderRef;
  outAt: string;
  dueDate: string | null;
  conditionOut: AssetCondition | null;
  returnedAt: string | null;
  returnCondition: ReturnCondition | null;
  receivedBy: AssetUserRef | null;
  returnNotes: string | null;
  valueAtOut?: number | null;
}

/** A maintenance log entry. `cost` only for those who see the values. */
export interface MaintenanceEntryView {
  id: string;
  /** YYYY-MM-DD */
  on: string;
  kind: MaintenanceKind;
  event: MaintenanceEvent | null;
  vendor: string | null;
  cost?: number | null;
  notes: string | null;
  custodyCode: string | null;
  createdAt: string;
  createdBy: AssetUserRef | null;
}

/** GET /assets/:code/history: its custody history (C-level people's records left out for those who don't see them) and its maintenance log. */
export interface AssetHistoryView {
  custody: AssetCustodyEntry[];
  /** Records of C-level people left out for the caller. */
  hiddenRecords: number;
  maintenance: MaintenanceEntryView[];
  can: Record<AssetAction, boolean>;
}
