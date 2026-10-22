// The custody pages' own rules (Assets step 3; owner, 21 October 2026: the "Asset Register" spec's custody, built the
// People System's way: "use the main ERP system specs .. dont stick to the MD file"): reading the Custody list's address
// and its chips, what a record, an item and a holding say (their kind, their return date, overdue, "Signed copy not
// attached"), reading the handover form into what the API takes (the kit quick-add too: a kit's available assets added,
// the others listed with why), reading the receive-back form, the repairs' forms and the terms, and the link that opens
// a deduction on Additions / Deductions for HR (owner, 21 October 2026: "Record it; HR decides a deduction"). The rules
// are packages/shared custody.ts; the API checks everything again. Pure code, tested; relative imports, as vitest
// doesn't know the "@/" paths.

import {
  ADJUSTMENT_STATUS_LABELS,
  CUSTODY_FILTER_LABELS,
  CUSTODY_FILTERS,
  CUSTODY_KIND_LABELS,
  CUSTODY_PAGE_SIZE,
  CUSTODY_STATUS_LABELS,
  CUSTODY_TEXT_LIMITS,
  custodyDeductionReason,
  handoverProblems,
  isAssetCode,
  isAssetCondition,
  isCustodyCode,
  isCustodyFilter,
  isCustodyKind,
  isReturnCondition,
  MAINTENANCE_EVENT_LABELS,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_TEXT_LIMITS,
  normalAssetCode,
  normalCustodyCode,
  RETURN_CONDITION_LABELS,
  termsFromText,
  termsProblems,
  type AdjustmentStatus,
  type CustodyDeductionRef,
  type CustodyFilter,
  type CustodyKind,
  type CustodyListView,
  type CustodyStatus,
  type HandoverAssetChoice,
  type HandoverKitChoice,
  type KitSkip,
  type MaintenanceEntryView,
  type ReturnCondition,
} from '@trendlix/shared';
import { CUSTODY_PATHS, type CustodyQuery } from '../../../lib/asset-paths';
import { formatDate, formatDateTime, parseDate } from '../../../lib/format';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { monthName } from '../payroll/list';
import { numberFrom } from './assets';

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

// ---------- the Custody list ----------

/** What the Custody list's address asks for: Active unless another filter is chosen. */
export interface ReadCustodyQuery {
  filter: CustodyFilter;
  q: string;
  page: number;
}

export function readCustodyQuery(params: Params): ReadCustodyQuery {
  const filter = first(params.filter);
  const page = Number(first(params.page));
  return {
    filter: isCustodyFilter(filter) ? filter : 'active',
    q: first(params.q).trim().slice(0, 100),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export const asCustodyQuery = (query: ReadCustodyQuery): CustodyQuery => ({ ...query });

export interface CustodyChip {
  key: CustodyFilter;
  label: string;
  href: string;
  count: number | undefined;
  active: boolean;
}

/** The filter chips (spec §5: "Active, Overdue, Not signed, Closed, All"), each with how many the search finds; a chip starts again on page 1. */
export function custodyChips(query: ReadCustodyQuery, counts: CustodyListView['counts'] | null, listHref = CUSTODY_PATHS.listWith): CustodyChip[] {
  return CUSTODY_FILTERS.map((f) => ({
    key: f,
    label: CUSTODY_FILTER_LABELS[f],
    href: listHref({ ...query, filter: f, page: 1 }),
    count: counts?.[f],
    active: query.filter === f,
  }));
}

/** The pages of the list: how many, and the links to the one before and after (null at either end). */
export function custodyPagesOf(list: Pick<CustodyListView, 'total' | 'page' | 'pageSize'>, query: ReadCustodyQuery, listHref = CUSTODY_PATHS.listWith) {
  const size = list.pageSize > 0 ? list.pageSize : CUSTODY_PAGE_SIZE;
  const count = Math.max(1, Math.ceil(list.total / size));
  return {
    count,
    previous: list.page > 1 ? listHref({ ...query, page: list.page - 1 }) : null,
    next: list.page < count ? listHref({ ...query, page: list.page + 1 }) : null,
  };
}

/** "12 records", "1 record". */
export const recordsText = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'record' : 'records'}`;

/**
 * A custody record's code from its page's address, as kept: "cus-0042" → "CUS-0042"; null for anything that isn't one
 * (an address that can't be read too: the page is then not found without asking the API).
 */
export function custodyCodeFromParam(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = normalCustodyCode(decoded);
  return isCustodyCode(code) ? code : null;
}

// ---------- what a record says ----------

export const kindText = (kind: CustodyKind): string => CUSTODY_KIND_LABELS[kind] ?? kind;

/** The badge's colours for a record's status: out blue, partly returned amber, closed grey. */
export function custodyStatusTone(status: CustodyStatus): string {
  switch (status) {
    case 'open':
      return 'bg-accent-soft text-accent';
    case 'partial':
      return 'bg-warn-soft text-warn';
    case 'closed':
      return 'bg-line-soft text-muted';
  }
}

export const custodyStatusText = (status: CustodyStatus): string => CUSTODY_STATUS_LABELS[status] ?? status;

/** "1 day", "3 days". */
export const daysText = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * Its return date in words: a shoot's "Return by 23/10/2026", overdue "Overdue 2 days (due 23/10/2026)", closed "Was due
 * 23/10/2026"; a long-term assignment "Long term: back at clearance".
 */
export function dueText(r: { kind: CustodyKind; status?: CustodyStatus; dueDate: string | null; overdue: boolean; daysOverdue: number }): string {
  if (r.kind !== 'shoot' || !r.dueDate) return 'Long term: back at clearance';
  if (r.overdue) return `Overdue ${daysText(r.daysOverdue)} (due ${formatDate(r.dueDate)})`;
  if (r.status === 'closed') return `Was due ${formatDate(r.dueDate)}`;
  return `Return by ${formatDate(r.dueDate)}`;
}

/** How many are still out: "3 out", "1 of 3 out", "All 3 back". */
export function outText(r: { items: number; out: number }): string {
  if (r.out === 0) return r.items === 1 ? 'Back' : `All ${r.items} back`;
  return r.out === r.items ? `${r.items} out` : `${r.out} of ${r.items} out`;
}

/** "3 items", "1 item". */
export const itemsText = (n: number): string => `${n} ${n === 1 ? 'item' : 'items'}`;

/** An item's return in words: "Out", "Back in good condition on 22/10/2026, 4:15 PM", "Damaged …", "Missing …". */
export function returnText(i: { returnedAt: string | null; returnCondition: ReturnCondition | null }): string {
  if (!i.returnedAt || !i.returnCondition) return 'Out';
  const when = formatDateTime(i.returnedAt);
  return i.returnCondition === 'good' ? `Back in good condition on ${when}` : `${RETURN_CONDITION_LABELS[i.returnCondition]} on return, ${when}`;
}

/** The badge's colours of an item's return: out blue, good green, damaged amber, missing red. */
export function returnTone(condition: ReturnCondition | null): string {
  if (condition === 'good') return 'bg-ok-soft text-ok';
  if (condition === 'damaged') return 'bg-warn-soft text-warn';
  if (condition === 'missing') return 'bg-danger-soft text-danger';
  return 'bg-accent-soft text-accent';
}

export const returnLabel = (condition: ReturnCondition | null): string => (condition ? RETURN_CONDITION_LABELS[condition] : 'Out');

/** Who did it: their name, else their email. */
export const whoText = (u: { email: string; name: string | null } | null): string | null => (u ? (u.name ?? u.email) : null);

/** A file's size: "820 KB", "2.4 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A value, or a dash: only shown when the API sent it (the CEO, Finance and a Super Admin). */
export const valueText = (amount: number | null | undefined): string => (amount === null || amount === undefined ? '—' : formatEgp(amount));

// ---------- the handover form ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?employee= (a person's holdings), ?asset= (an asset's page) and (step 4) ?kit= (a kit's card) as the handover form starts with them. */
export function handoverStart(params: Params): { employeeId: string | null; assetCode: string | null; kitId: string | null } {
  const employee = first(params.employee).trim();
  const asset = normalAssetCode(first(params.asset));
  const kit = first(params.kit).trim();
  return { employeeId: UUID.test(employee) ? employee : null, assetCode: isAssetCode(asset) ? asset : null, kitId: UUID.test(kit) ? kit : null };
}

/** The handover form as typed: the dates as DD/MM/YYYY, each asset with its condition and accessories. */
export interface HandoverDraft {
  employeeId: string;
  kind: string;
  /** DD/MM/YYYY as typed. */
  dueDate: string;
  purpose: string;
  handedOverBy: string;
  notes: string;
  /** Step 4: `accessoryIds`, the checklist's lines ticked to go (left out when it has none). */
  items: { assetId: string; conditionOut: string; accessories: string; accessoryIds?: string[] }[];
}

/**
 * What POST /assets/custody is sent, with every problem the shared checks find (handoverProblems) and a date not read;
 * the return date only for a shoot. `today`: YYYY-MM-DD in Cairo.
 */
export function handoverBody(d: HandoverDraft, today: string): { body: Record<string, unknown>; problems: string[] } {
  const problems: string[] = [];
  const kind = isCustodyKind(d.kind) ? d.kind : null;
  if (!kind) problems.push('Choose a shoot or a long-term assignment.');
  let dueDate: string | null = null;
  if (kind === 'shoot') {
    const parsed = parseDate(d.dueDate);
    if (parsed === null) problems.push('Enter the return date as DD/MM/YYYY, e.g. 24/10/2026.');
    else dueDate = parsed || null;
  }
  const handedOverBy = d.handedOverBy.trim();
  const purpose = d.purpose.trim() || null;
  const notes = d.notes.trim() || null;
  const items = d.items.map((i) => ({
    assetId: i.assetId,
    conditionOut: isAssetCondition(i.conditionOut) ? i.conditionOut : null,
    accessories: i.accessories.trim() || null,
    ...(i.accessoryIds && { accessoryIds: i.accessoryIds }),
  }));
  if (kind) {
    for (const p of handoverProblems({ employeeId: d.employeeId, kind, dueDate, purpose, handedOverBy, notes, items }, today)) {
      // a return date not read is said above already
      if (!(p === 'A shoot needs its return date.' && problems.some((x) => x.startsWith('Enter the return date')))) problems.push(p);
    }
  } else if (!d.employeeId) problems.unshift('Choose the employee.');
  if (items.some((i) => i.accessories && i.accessories.length > CUSTODY_TEXT_LIMITS.accessories)) problems.push(`Keep each asset's accessories to ${CUSTODY_TEXT_LIMITS.accessories} characters or fewer.`);
  const body: Record<string, unknown> = { employeeId: d.employeeId, kind, ...(kind === 'shoot' && { dueDate }), purpose, handedOverBy, notes, items };
  return { body, problems: [...new Set(problems)] };
}

/**
 * The kit quick-add (spec §6.3: "Handing over a kit adds all its available items; items already out or under repair are
 * skipped, and the UI says so"): the kit's assets the form can add (available, not chosen yet), and those skipped with
 * why. One already on the list is left as it is.
 */
export function kitAdd(kit: HandoverKitChoice, chosen: ReadonlySet<string>, available: readonly HandoverAssetChoice[]): { added: HandoverAssetChoice[]; skipped: KitSkip[] } {
  const byId = new Map(available.map((a) => [a.id, a]));
  const added: HandoverAssetChoice[] = [];
  const skipped: KitSkip[] = [];
  for (const i of kit.items) {
    if (chosen.has(i.id)) continue;
    const asset = byId.get(i.id);
    if (i.why) skipped.push({ code: i.code, name: i.name, why: i.why });
    else if (!asset) skipped.push({ code: i.code, name: i.name, why: 'Not available' });
    else added.push(asset);
  }
  return { added, skipped };
}

/** What the kit quick-add says: "PK-KIT-A: 4 added; 2 skipped." */
export function kitAddText(kit: Pick<HandoverKitChoice, 'code' | 'name'>, added: number, skipped: number): string {
  const parts = [added ? `${itemsText(added)} added` : 'nothing added', skipped ? `${skipped} skipped` : null].filter(Boolean);
  return `${kit.code} ${kit.name}: ${parts.join('; ')}.`;
}

/** An asset as the picker names it: "PK-CAM-0003 · Sony FX3 camera body · S/N 1234". */
export const assetOptionText = (a: Pick<HandoverAssetChoice, 'code' | 'name' | 'serial'>): string => [a.code, a.name, a.serial ? `S/N ${a.serial}` : null].filter(Boolean).join(' · ');

/**
 * What goes with an asset on a handover (step 4, owner, 22 October 2026: accessories, "Both kinds"): its attached assets
 * that are available ("Goes with it: PK-ACC-0001 Ronin plate"), and those skipped with why.
 */
export function attachedText(a: Pick<HandoverAssetChoice, 'attached'>): { going: string | null; skipped: string | null } {
  const list = a.attached ?? [];
  const going = list.filter((x) => !x.why);
  const skipped = list.filter((x) => x.why);
  return {
    going: going.length ? `Goes with it: ${going.map((x) => `${x.code} ${x.name}`).join(', ')}` : null,
    skipped: skipped.length ? `Stays behind: ${skipped.map((x) => `${x.code} (${x.why})`).join(', ')}` : null,
  };
}

/** What a skipped kit asset says: "PK-LEN-0002 Lens: Under repair". */
export const skipText = (s: KitSkip): string => `${s.code} ${s.name}: ${s.why}`;

// ---------- receiving back ----------

/** The field of an item's condition on the receive-back form, and of its notes. */
export const conditionField = (itemId: string) => `condition-${itemId}`;
export const returnNotesField = (itemId: string) => `notes-${itemId}`;

/** The field of how many of an item's accessory `i` came back (step 4, owner, 22 October 2026: accessories). */
export const accessoryBackField = (itemId: string, i: number) => `accback-${itemId}-${i}`;

/**
 * How many of each accessory that went out with an item came back, as the form has them: a line of one is a tick box
 * (ticked: back), a line of more a number (empty: all of them; not a number: -1, which the API refuses in words). Null
 * when none went out.
 */
export function readAccessoriesBack(fd: Pick<FormData, 'get'>, itemId: string, out: readonly { quantity: number }[]): number[] | null {
  if (!out.length) return null;
  return out.map((a, i) => {
    const raw = String(fd.get(accessoryBackField(itemId, i)) ?? '').trim();
    if (a.quantity === 1) return raw === '1' || raw === 'on' ? 1 : 0;
    if (raw === '') return a.quantity;
    const n = numberFrom(raw);
    return n === null || Number.isNaN(n) || !Number.isInteger(n) ? -1 : n;
  });
}

/** A line received back, as POST …/return takes it. */
export interface ReturnLine {
  itemId: string;
  condition: ReturnCondition;
  notes: string | null;
  /** Step 4: how many of each accessory that went out came back (left out when none went, or the item is missing). */
  accessoriesBack?: number[];
}

/**
 * The receive-back form read: each item chosen with how it came back, its notes and (step 4) its accessories back; those
 * left as still out aren't sent. `items`: the items still out, by id, or with the accessories that went out with them.
 */
export function readReturnForm(
  fd: Pick<FormData, 'get'>,
  items: readonly (string | { id: string; accessoriesOut?: readonly { quantity: number }[] })[],
): { lines: ReturnLine[]; problems: string[] } {
  const lines: ReturnLine[] = [];
  const problems: string[] = [];
  for (const item of items) {
    const id = typeof item === 'string' ? item : item.id;
    const out = typeof item === 'string' ? [] : (item.accessoriesOut ?? []);
    const condition = String(fd.get(conditionField(id)) ?? '');
    const notes = String(fd.get(returnNotesField(id)) ?? '').trim();
    if (notes.length > CUSTODY_TEXT_LIMITS.returnNotes) problems.push(`Keep each item's notes to ${CUSTODY_TEXT_LIMITS.returnNotes} characters or fewer.`);
    if (isReturnCondition(condition)) {
      const back = condition === 'missing' ? null : readAccessoriesBack(fd, id, out);
      lines.push({ itemId: id, condition, notes: notes || null, ...(back && { accessoriesBack: back }) });
    }
  }
  if (!lines.length) problems.unshift('Choose how each item came back: good, damaged or missing.');
  return { lines, problems: [...new Set(problems)] };
}

// ---------- deductions ----------

/**
 * "Create a deduction" (owner, 21 October 2026: "Record it; HR decides a deduction"): Additions / Deductions opened on
 * the person's month with its form set to a Damage or loss deduction, its reason ("Damage: PK-CAM-0003 on CUS-0042") and
 * the custody item it is for; HR types the amount. `today`: YYYY-MM-DD in Cairo (its month).
 */
export function deductionHref(r: { employeeId: string; itemId: string; condition: 'damaged' | 'missing'; assetCode: string; custodyCode: string }, today: string): string {
  const query = new URLSearchParams({
    month: today.slice(0, 7),
    employee: r.employeeId,
    custodyItem: r.itemId,
    reason: custodyDeductionReason(r.condition, r.assetCode, r.custodyCode),
  });
  return `/payroll/adjustments?${query.toString()}`;
}

/** A deduction made from it: "October 2026 · Pending · EGP 1,500.00". */
export function deductionText(d: CustodyDeductionRef): string {
  return [monthName(d.month), ADJUSTMENT_STATUS_LABELS[d.status as AdjustmentStatus] ?? d.status, d.amount === null ? null : formatEgp(d.amount)].filter(Boolean).join(' · ');
}

// ---------- an asset's page ----------

/** What a maintenance entry is: what made it ("Returned damaged"), else its kind ("Repair"). */
export const maintenanceTitle = (m: Pick<MaintenanceEntryView, 'event' | 'kind'>): string => (m.event ? MAINTENANCE_EVENT_LABELS[m.event] : (MAINTENANCE_KIND_LABELS[m.kind] ?? m.kind));

/** The note on an asset's custody history when C-level people's records are left out for the caller. */
export function hiddenRecordsText(n: number): string | null {
  if (!(n > 0)) return null;
  return n === 1 ? '1 record of a C-level person is left out.' : `${n} records of C-level people are left out.`;
}

/**
 * A repair's form read (sent to repair, back from repair): its date (DD/MM/YYYY, today when left empty, never after
 * it), vendor and notes, and back from repair its cost for those who see the values (`values`); lost and found only
 * the notes.
 */
export function repairBody(fd: Pick<FormData, 'get'>, opts: { repair: boolean; values: boolean; today: string }): { body: Record<string, unknown>; problems: string[] } {
  const text = (k: string) => String(fd.get(k) ?? '').trim();
  const problems: string[] = [];
  const body: Record<string, unknown> = {};
  const notes = text('notes');
  if (notes.length > MAINTENANCE_TEXT_LIMITS.notes) problems.push(`Keep the notes to ${MAINTENANCE_TEXT_LIMITS.notes} characters or fewer.`);
  body.notes = notes || null;
  if (opts.repair) {
    const on = parseDate(text('on'));
    if (on === null) problems.push('Enter the date as DD/MM/YYYY, e.g. 22/10/2026.');
    else if (on && on > opts.today) problems.push('The date can’t be in the future.');
    else if (on) body.on = on;
    const vendor = text('vendor');
    if (vendor.length > MAINTENANCE_TEXT_LIMITS.vendor) problems.push(`Keep the vendor to ${MAINTENANCE_TEXT_LIMITS.vendor} characters or fewer.`);
    body.vendor = vendor || null;
    if (opts.values) {
      const cost = numberFrom(text('cost'));
      if (cost !== null && (Number.isNaN(cost) || cost < 0)) problems.push('Enter the cost in EGP as 0 or more, e.g. 1500 or 1500.50.');
      else if (cost !== null) body.cost = cost;
    }
  }
  return { body, problems };
}

/** The terms as typed in Settings, one a line: the terms to send, and what is wrong with them. */
export function termsBody(text: string): { terms: string[]; problems: string[] } {
  const terms = termsFromText(text);
  return { terms, problems: termsProblems(terms) };
}
