// The Assets pages' own rules (owner, 21 October 2026: "i want to add this module with a special permission to the
// system", "use the main ERP system specs .. dont stick to the MD file"): reading the register's address (the search,
// the chips, the room and kit, the page), the chips themselves, what a row says (where it is, who holds it, its
// quantity, its book value), reading the Add and Edit forms into what the API takes, and the Users page's words on the
// Assets access. The module's rules are packages/shared assets.ts; the API checks everything again. Pure code, tested;
// relative imports, as vitest doesn't know the "@/" paths.

import {
  ASSET_GROUP_LABELS,
  ASSET_GROUP_RULES,
  ASSET_GROUPS,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  ASSETS_ACCESS_LABELS,
  ASSETS_PAGE_SIZE,
  BOOK_VALUE_MISSING_TEXT,
  assetProblems,
  assetStatusProblem,
  assetValuesProblems,
  fitToGroup,
  isAssetCode,
  isAssetCondition,
  isAssetGroup,
  isAssetStatus,
  type AssetClass,
  type AssetGroup,
  type AssetHolderRef,
  type AssetInput,
  type AssetListView,
  type AssetsAccess,
  type AssetStatus,
  type AssetValuesInput,
  type BookValue,
  normalAssetCode,
  type AssetDraftView,
} from '@trendlix/shared';
import { ASSET_PATHS, APP_ASSET_PATHS, type AssetQuery } from '../../../lib/asset-paths';
import { formatDate, formatDateTime, parseDate } from '../../../lib/format';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { withCode } from '../../../lib/hidden';

// ---------- the register's address ----------

const UUID = /^[0-9a-f-]{36}$/i;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/** What the register's address asks for, with anything it doesn't know left out. */
export interface ReadQuery {
  q: string;
  group: AssetGroup | null;
  status: AssetStatus | null;
  roomId: string | null;
  kitId: string | null;
  page: number;
}

export function readAssetQuery(params: Params): ReadQuery {
  const group = first(params.group);
  const status = first(params.status);
  const roomId = first(params.roomId);
  const kitId = first(params.kitId);
  const page = Number(first(params.page));
  return {
    q: first(params.q).trim().slice(0, 100),
    group: isAssetGroup(group) ? group : null,
    status: isAssetStatus(status) ? status : null,
    roomId: UUID.test(roomId) ? roomId : null,
    kitId: UUID.test(kitId) ? kitId : null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Whether anything narrows the register (a search, a chip, a room or a kit). */
export const isFiltered = (query: ReadQuery): boolean => !!(query.q || query.group || query.status || query.roomId || query.kitId);

/** The query as the address and the API take it. */
export const asQuery = (query: ReadQuery): AssetQuery => ({ ...query });

export interface ChipLink {
  key: string;
  label: string;
  href: string;
  count: number | undefined;
  active: boolean;
}

/** The group chips: All groups, then each group with how many the search finds in it. A chip starts again on page 1. */
export function groupChips(query: ReadQuery, counts: AssetListView['counts'] | null, listHref = ASSET_PATHS.listWith): ChipLink[] {
  const all = counts ? ASSET_GROUPS.reduce((sum, g) => sum + (counts.group[g] ?? 0), 0) : undefined;
  return [
    { key: 'all', label: 'All groups', href: listHref({ ...query, group: null, page: 1 }), count: all, active: query.group === null },
    ...ASSET_GROUPS.map((g) => ({
      key: g,
      label: ASSET_GROUP_LABELS[g],
      href: listHref({ ...query, group: g, page: 1 }),
      count: counts?.group[g],
      active: query.group === g,
    })),
  ];
}

/** The status chips: Not disposed (the register as it stands: disposed assets leave every total), then each status. */
export function statusChips(query: ReadQuery, counts: AssetListView['counts'] | null, listHref = ASSET_PATHS.listWith): ChipLink[] {
  const standing = counts ? ASSET_STATUSES.filter((s) => s !== 'disposed').reduce((sum, s) => sum + (counts.status[s] ?? 0), 0) : undefined;
  return [
    { key: 'all', label: 'Not disposed', href: listHref({ ...query, status: null, page: 1 }), count: standing, active: query.status === null },
    ...ASSET_STATUSES.map((s) => ({
      key: s,
      label: ASSET_STATUS_LABELS[s],
      href: listHref({ ...query, status: s, page: 1 }),
      count: counts?.status[s],
      active: query.status === s,
    })),
  ];
}

/** The pages of a list: how many, and the links to the one before and after (null at either end). */
export function pagesOf(list: Pick<AssetListView, 'total' | 'page' | 'pageSize'>, query: ReadQuery, listHref = ASSET_PATHS.listWith) {
  const size = list.pageSize > 0 ? list.pageSize : ASSETS_PAGE_SIZE;
  const count = Math.max(1, Math.ceil(list.total / size));
  return {
    count,
    previous: list.page > 1 ? listHref({ ...query, page: list.page - 1 }) : null,
    next: list.page < count ? listHref({ ...query, page: list.page + 1 }) : null,
  };
}

/** "120 assets", "1 asset", "Showing 51–100 of 120 assets". */
export function countText(list: Pick<AssetListView, 'total' | 'page' | 'pageSize' | 'items'>): string {
  const noun = list.total === 1 ? 'asset' : 'assets';
  if (list.total <= list.pageSize || !list.items.length) return `${list.total.toLocaleString('en-US')} ${noun}`;
  const from = (list.page - 1) * list.pageSize + 1;
  const to = from + list.items.length - 1;
  return `Showing ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${list.total.toLocaleString('en-US')} ${noun}`;
}

/** The phone pages' register, with the search and page kept. */
export const appListHref = (query: Pick<AssetQuery, 'q' | 'page'>) => APP_ASSET_PATHS.listWith(query);

/**
 * An asset's code from its page's address, as kept: "pk-cam-0003" → "PK-CAM-0003"; null for anything that isn't one
 * (the page is then not found without asking the API).
 */
export function codeFromParam(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = normalAssetCode(decoded);
  return isAssetCode(code) ? code : null;
}

// ---------- what a row says ----------

/** Who holds it: "Mona Hassan · EMP-0042" (a developer's: the tag alone, 23 October 2026); null when nobody does. */
export const holderText = (holder: AssetHolderRef | null): string | null => (holder ? withCode(holder.fullNameEn, holder.employeeCode) : null);

/** Where it is: the room and the kit, "Studio A · PK-KIT-A Interview kit"; null for neither. */
export function placeText(row: { room: { name: string } | null; kit: { code: string; name: string } | null }): string | null {
  const parts = [row.room?.name, row.kit && `${row.kit.code} ${row.kit.name}`].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : null;
}

/** A quantity: "12 rolls", "3.5 m", "0"; whole numbers without decimals. */
export function quantityText(quantity: number | null, unit: string | null): string {
  if (quantity === null) return '—';
  const n = quantity.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
}

/** An amount in EGP, or a dash for none. */
export const moneyText = (amount: number | null | undefined): string => (amount === null || amount === undefined ? '—' : formatEgp(amount));

/** The book value in words: the amount, "Expensed (below the threshold)", or what it needs ("Needs the purchase cost"). */
export function bookValueText(book: Pick<BookValue, 'amount' | 'expensed' | 'missing'>): string {
  if (book.expensed) return 'Expensed (below the threshold)';
  if (book.amount !== null) return formatEgp(book.amount);
  return book.missing ? BOOK_VALUE_MISSING_TEXT[book.missing] : '—';
}

/** A list row's book value: the amount, "Expensed", or a dash. */
export const rowBookText = (values: { bookValue: number | null; expensed: boolean }): string =>
  values.expensed ? 'Expensed' : values.bookValue === null ? '—' : formatEgp(values.bookValue);

/** The badge's colours for a status: available green, in custody blue, under repair amber, lost red, disposed grey. */
export function statusTone(status: AssetStatus): string {
  switch (status) {
    case 'available':
      return 'bg-ok-soft text-ok';
    case 'custody':
      return 'bg-accent-soft text-accent';
    case 'repair':
      return 'bg-warn-soft text-warn';
    case 'lost':
      return 'bg-danger-soft text-danger';
    case 'disposed':
      return 'bg-line-soft text-muted';
  }
}

/** A useful life in years: "5 years", "1 year". */
export const yearsText = (years: number | null): string => (years === null ? '—' : `${years} ${years === 1 ? 'year' : 'years'}`);

/** The group's useful life, as the field's placeholder: "5 (the group's)"; none for consumables. */
export function usefulLifeHint(group: AssetGroup): string {
  const years = ASSET_GROUP_RULES[group].usefulLifeYears;
  return years === null ? 'Consumables have no useful life.' : `${ASSET_GROUP_LABELS[group]}: ${yearsText(years)} unless you set another.`;
}

// ---------- the forms ----------

const ARABIC_DIGITS = /[٠-٩]/g;

/**
 * A number typed in a field: "45,000.50", "٤٥٠٠٠", " 12 " → the number; "" → null; anything else → NaN (said as a
 * problem by the shared checks).
 */
export function numberFrom(raw: string): number | null {
  const s = raw.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,\s]/g, '').replace(/^EGP/i, '');
  if (s === '') return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

const text = (fd: Pick<FormData, 'get'>, key: string): string => String(fd.get(key) ?? '').trim();
const textOrNull = (fd: Pick<FormData, 'get'>, key: string): string | null => text(fd, key) || null;

/** The fields of the Add and Edit forms, by name, so a refused save can show what was typed. */
export const ASSET_FORM_FIELDS = [
  'name',
  'group',
  'type',
  'assetClass',
  'brand',
  'model',
  'serial',
  'condition',
  'status',
  'roomId',
  'kitId',
  'quantity',
  'unit',
  'reorderLevel',
  'purchaseDate',
  'usefulLifeYears',
  'warrantyEnd',
  'notes',
] as const;

export const VALUE_FORM_FIELDS = ['purchasePrice', 'supplier', 'invoiceNo', 'priceLow', 'marketValue', 'priceHigh', 'priceNote'] as const;

/** What was typed in a form, to show again after a refusal. */
export function typedValues(fd: Pick<FormData, 'get'>, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f, String(fd.get(f) ?? '')]));
}

/** A form read for the API: the asset's own fields fitted to its group, the status chosen, and the problems found. */
export interface AssetForm {
  asset: AssetInput;
  /** The status chosen by hand on the Edit form; null on Add, or when it can't be chosen (in custody, disposed). */
  status: AssetStatus | null;
  problems: string[];
}

/**
 * The Add or Edit form read into the asset's fields, fitted to its group (fitToGroup: what the group doesn't have is
 * left empty), with every problem the shared checks find (assetProblems), the dates read as DD/MM/YYYY. `from`: the
 * asset's status now (Edit), so a status chosen by hand is checked (assetStatusProblem); null on Add. `today`:
 * YYYY-MM-DD in Cairo.
 */
export function readAssetForm(fd: Pick<FormData, 'get'>, today: string, from: AssetStatus | null = null): AssetForm {
  const problems: string[] = [];
  const group = text(fd, 'group');
  const date = (key: string, label: string): string | null => {
    const parsed = parseDate(text(fd, key));
    if (parsed === null) {
      problems.push(`Enter the ${label} as DD/MM/YYYY, e.g. 14/10/2026.`);
      return null;
    }
    return parsed || null;
  };
  const condition = text(fd, 'condition');
  const raw: AssetInput = {
    name: text(fd, 'name'),
    group: (isAssetGroup(group) ? group : '') as AssetGroup,
    type: text(fd, 'type') as AssetInput['type'],
    assetClass: (text(fd, 'assetClass') || (isAssetGroup(group) ? ASSET_GROUP_RULES[group].defaultClass : '')) as AssetClass,
    brand: textOrNull(fd, 'brand'),
    model: textOrNull(fd, 'model'),
    serial: textOrNull(fd, 'serial'),
    condition: isAssetCondition(condition) ? condition : condition ? (condition as AssetInput['condition']) : null,
    roomId: textOrNull(fd, 'roomId'),
    kitId: textOrNull(fd, 'kitId'),
    quantity: numberFrom(text(fd, 'quantity')),
    unit: textOrNull(fd, 'unit'),
    reorderLevel: numberFrom(text(fd, 'reorderLevel')),
    purchaseDate: date('purchaseDate', 'purchase date'),
    usefulLifeYears: numberFrom(text(fd, 'usefulLifeYears')),
    warrantyEnd: date('warrantyEnd', 'warranty end'),
    notes: textOrNull(fd, 'notes'),
  };
  const asset = isAssetGroup(raw.group) ? fitToGroup(raw) : raw;
  problems.push(...assetProblems(asset, today));
  // a status chosen by hand on Edit: Available, Under repair or Lost (never In custody or Disposed), checked against now
  let status: AssetStatus | null = null;
  const chosen = text(fd, 'status');
  if (from !== null && isAssetStatus(chosen) && chosen !== from && isAssetGroup(asset.group)) {
    const problem = assetStatusProblem(from, chosen, asset.group);
    if (problem) problems.push(problem);
    else status = chosen;
  }
  return { asset, status, problems: [...new Set(problems)] };
}

/** The values form read for the API, with every problem in words (assetValuesProblems). */
export function readValuesForm(fd: Pick<FormData, 'get'>): { values: AssetValuesInput; problems: string[] } {
  const values: AssetValuesInput = {
    purchasePrice: numberFrom(text(fd, 'purchasePrice')),
    supplier: textOrNull(fd, 'supplier'),
    invoiceNo: textOrNull(fd, 'invoiceNo'),
    priceLow: numberFrom(text(fd, 'priceLow')),
    marketValue: numberFrom(text(fd, 'marketValue')),
    priceHigh: numberFrom(text(fd, 'priceHigh')),
    priceNote: textOrNull(fd, 'priceNote'),
  };
  return { values, problems: assetValuesProblems(values) };
}

/**
 * What POST /assets (Add) or PATCH /assets/:code (Edit) is sent: the asset's fields (empty ones as null on Edit, so a
 * cleared field is cleared; left out on Add, so the group's class and useful life apply), the status chosen on Edit,
 * and the values when the person sets them.
 */
export function assetBody(form: AssetForm, mode: 'add' | 'edit', values: AssetValuesInput | null): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(form.asset)) {
    if (mode === 'add' && (value === null || value === '')) continue;
    body[key] = value;
  }
  if (mode === 'edit' && form.status) body.status = form.status;
  if (values) {
    const sent = mode === 'add' ? Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) : values;
    if (Object.keys(sent).length) body.values = sent;
  }
  return body;
}

/** The field values of an asset for the Edit form: dates as DD/MM/YYYY, numbers as typed, empty for none. */
export function editDefaults(asset: {
  name: string;
  group: string;
  type: string;
  assetClass: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  condition: string | null;
  status: string;
  room: { id: string } | null;
  kit: { id: string } | null;
  quantity: number | null;
  unit: string | null;
  reorderLevel: number | null;
  purchaseDate: string | null;
  usefulLifeYears: number | null;
  warrantyEnd: string | null;
  notes: string | null;
}): Record<string, string> {
  const n = (v: number | null) => (v === null ? '' : String(v));
  return {
    name: asset.name,
    group: asset.group,
    type: asset.type,
    assetClass: asset.assetClass,
    brand: asset.brand ?? '',
    model: asset.model ?? '',
    serial: asset.serial ?? '',
    condition: asset.condition ?? '',
    status: asset.status,
    roomId: asset.room?.id ?? '',
    kitId: asset.kit?.id ?? '',
    quantity: n(asset.quantity),
    unit: asset.unit ?? '',
    reorderLevel: n(asset.reorderLevel),
    purchaseDate: formatDate(asset.purchaseDate),
    usefulLifeYears: n(asset.usefulLifeYears),
    warrantyEnd: formatDate(asset.warrantyEnd),
    notes: asset.notes ?? '',
  };
}

/** The values for the values form: amounts as plain numbers, empty for none. */
export function valuesDefaults(values: AssetValuesInput | null | undefined): Record<string, string> {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  return {
    purchasePrice: n(values?.purchasePrice),
    supplier: values?.supplier ?? '',
    invoiceNo: values?.invoiceNo ?? '',
    priceLow: n(values?.priceLow),
    marketValue: n(values?.marketValue),
    priceHigh: n(values?.priceHigh),
    priceNote: values?.priceNote ?? '',
  };
}

// ---------- drafts from Claude ----------

/**
 * A draft from Claude's fields for the Add form (step 2, owner, 21 October 2026: "the connection method"; the spec:
 * "nothing is saved until a person presses Save"): dates as DD/MM/YYYY, numbers as typed, empty for none, its room and
 * kit chosen. The person reviews them, adds the photos and confirms.
 */
export function draftDefaults(fields: AssetInput): Record<string, string> {
  return editDefaults({
    ...fields,
    status: 'available',
    room: fields.roomId ? { id: fields.roomId } : null,
    kit: fields.kitId ? { id: fields.kitId } : null,
  });
}

/** Who drafted it and when: "Drafted with Claude by Mona Hassan on 21/10/2026, 5:42 PM". */
export function draftedText(draft: Pick<AssetDraftView, 'createdAt' | 'createdBy'>): string {
  const who = draft.createdBy ? ` by ${draft.createdBy.name ?? draft.createdBy.email}` : '';
  return `Drafted with Claude${who} on ${formatDateTime(draft.createdAt)}`;
}

// ---------- photos ----------

/** What the photo box says: how many more can be added (an asset has at most `max`). */
export function photosLeftText(had: number, chosen: number, max: number): string {
  const left = max - had - chosen;
  if (left <= 0) return `That is ${max}, the most an asset has.`;
  if (had + chosen === 0) return `Up to ${max} photos. The first is the one the lists show.`;
  return `${left} more ${left === 1 ? 'photo' : 'photos'} can be added.`;
}

/** What the page says once photos were sent: all, some (with why the others weren't), or none. */
export function photosSentText(sent: number, failed: string[]): string | null {
  if (!sent && !failed.length) return null;
  const done = sent ? `${sent} ${sent === 1 ? 'photo' : 'photos'} added.` : '';
  const not = failed.length ? `${failed.length} ${failed.length === 1 ? 'photo was' : 'photos were'} not added: ${[...new Set(failed)].join(' ')}` : '';
  return [done, not].filter(Boolean).join(' ');
}

// ---------- the Users page ----------

/**
 * The Assets access in words for the Users page: the level set, and, when another is in effect, which and why ("Manager:
 * a Super Admin always is", "Viewer: the CEO and Finance always see the register, to fill the values").
 */
export function accessInEffectText(set: AssetsAccess, inEffect: AssetsAccess, roles: readonly string[]): string | null {
  if (set === inEffect) return null;
  if (roles.includes('super_admin')) return `In effect: ${ASSETS_ACCESS_LABELS[inEffect]}, as a Super Admin always is.`;
  return `In effect: ${ASSETS_ACCESS_LABELS[inEffect]}: the CEO and Finance always see the register, to fill the values.`;
}

/** Who is always which level, and who alone sees the values, under the levels on the Users page. */
export const ASSETS_VALUES_NOTE =
  'A Super Admin is always a manager. The CEO and Finance are always at least viewers, to fill the values: only they and a Super Admin see the purchase cost, the book value and the market value.';

/** The Users list's short column: the level in effect, "—" for none. */
export const accessShort = (inEffect: AssetsAccess | undefined): string => (!inEffect || inEffect === 'none' ? '—' : ASSETS_ACCESS_LABELS[inEffect]);

// ---------- the asset's page ----------

/** What the asset's page says once something was done (?done=, ?photosFailed=), or null. */
export function doneText(done: string | null | undefined, code: string, photosFailed?: number | null): string | null {
  const failed = photosFailed && photosFailed > 0 ? ` ${photosFailed === 1 ? 'A photo was' : `${photosFailed} photos were`} not added: add ${photosFailed === 1 ? 'it' : 'them'} under Photos.` : '';
  switch (done) {
    case 'added':
      return `${code} added.${failed}`;
    case 'saved':
      return `Changes saved.${failed}`;
    case 'values':
      return 'Values saved.';
    default:
      return failed ? failed.trim() : null;
  }
}

/** What was just done, kept on the way to the same asset's page elsewhere (the app's): "?done=saved&photosFailed=1". */
export function keptQuery(params: Params): string {
  const kept = new URLSearchParams();
  for (const key of ['done', 'photosFailed']) {
    const value = first(params[key]);
    if (/^[a-z0-9]{1,20}$/i.test(value)) kept.set(key, value);
  }
  const qs = kept.toString();
  return qs ? `?${qs}` : '';
}

/** The warranty in words: "Until 14/10/2027", "Ended 14/10/2025"; null for none. */
export function warrantyText(end: string | null, today: string): string | null {
  if (!end) return null;
  return end < today ? `Ended ${formatDate(end)}` : `Until ${formatDate(end)}`;
}

/** The market value's range: "EGP 40,000.00 – EGP 45,000.00 – EGP 50,000.00", or what of it is set. */
export function marketText(v: Pick<AssetValuesInput, 'priceLow' | 'marketValue' | 'priceHigh'>): string {
  if (v.priceLow === null && v.marketValue === null && v.priceHigh === null) return '—';
  const parts = [
    v.priceLow !== null ? `low ${formatEgp(v.priceLow)}` : null,
    v.marketValue !== null ? formatEgp(v.marketValue) : null,
    v.priceHigh !== null ? `high ${formatEgp(v.priceHigh)}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}
