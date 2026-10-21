import {
  daysOverdue,
  isOverdue,
  seesCustodyDeductions,
  type AssetCondition,
  type AssetGroup,
  type AssetStatus,
  type AssetType,
  type AssetUserRef,
  type CustodyAssetRef,
  type CustodyDeductionRef,
  type CustodyFileRef,
  type CustodyItemView,
  type CustodyKind,
  type CustodyReturnView,
  type CustodyRowView,
  type CustodyStatus,
  type HeldItemView,
  type ReturnCondition,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { UserRef } from '../payroll/adjustments/people.js';
import type { AssetsCaller } from './assets-access.js';

// A custody record as the API answers it (Assets step 3; packages/shared custody.ts). The values rule (owner, 21
// October 2026: "CEO and Finance") is kept here, as asset-views.ts keeps it for an asset: an item's value when it went
// out (`valueAtOut`) and the totals of it are only put in the answer for the CEO, Finance and a Super Admin; for anyone
// else the key isn't there at all. A damaged or missing item's deductions (payroll data) only for HR, Finance and the CEO.

export const PERSON = { id: true, employeeCode: true, fullNameEn: true } as const;

/** What an asset in a custody list reads. */
export const ASSET_REF = { id: true, code: true, name: true, group: true, type: true, status: true, brand: true, model: true, serial: true } as const satisfies Prisma.AssetSelect;

const USER = { select: { id: true, email: true } } as const;

/** What a row of the Custody list reads. */
export const RECORD_ROW = {
  id: true,
  code: true,
  kind: true,
  status: true,
  purpose: true,
  dueDate: true,
  outAt: true,
  closedAt: true,
  employee: { select: PERSON },
  _count: { select: { files: true, items: true } },
  items: { where: { returnedAt: null }, select: { id: true } },
} as const satisfies Prisma.CustodyRecordSelect;

export type RecordRow = Prisma.CustodyRecordGetPayload<{ select: typeof RECORD_ROW }>;

/** Newest first, the current employment (no end date) before all ended ones: as the profile orders them. */
export const NEWEST_EMPLOYMENT = [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }] satisfies Prisma.EmploymentOrderByWithRelationInput[];

/** The person as the form prints them: name, code, job title and where they work (their latest employment's). */
export const PERSON_DETAIL = {
  ...PERSON,
  employments: {
    orderBy: NEWEST_EMPLOYMENT,
    take: 1,
    select: { jobTitle: { select: { titleEn: true } }, department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } },
  },
} as const satisfies Prisma.EmployeeSelect;

export type PersonDetailRow = Prisma.EmployeeGetPayload<{ select: typeof PERSON_DETAIL }>;

const DEDUCTION = { select: { id: true, month: true, status: true, amount: true }, orderBy: { createdAt: 'asc' } } as const;

/** What an item of a record reads. */
export const ITEM = {
  id: true,
  valueAtOut: true,
  conditionOut: true,
  accessories: true,
  returnedAt: true,
  returnCondition: true,
  returnNotes: true,
  receivedBy: USER,
  asset: { select: ASSET_REF },
  deductions: DEDUCTION,
} as const satisfies Prisma.CustodyItemSelect;

export type ItemRow = Prisma.CustodyItemGetPayload<{ select: typeof ITEM }>;

export const FILE_REF = { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true, uploadedBy: USER } as const satisfies Prisma.CustodyFileSelect;

/** What a record's page reads. */
export const RECORD_DETAIL = {
  id: true,
  code: true,
  kind: true,
  status: true,
  purpose: true,
  dueDate: true,
  outAt: true,
  closedAt: true,
  outNotes: true,
  terms: true,
  handedOverByName: true,
  employeeId: true,
  employee: { select: PERSON_DETAIL },
  issuedBy: USER,
  items: { select: ITEM, orderBy: { asset: { code: 'asc' } } },
  files: { select: FILE_REF, orderBy: { uploadedAt: 'asc' } },
} as const satisfies Prisma.CustodyRecordSelect;

export type RecordDetail = Prisma.CustodyRecordGetPayload<{ select: typeof RECORD_DETAIL }>;

const money = (d: Prisma.Decimal | null): number | null => (d === null ? null : d.toNumber());

/** Two amounts' sum to the piaster; null when none is known. */
export function sumOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.round(known.reduce((s, v) => s + Math.round(v * 100), 0)) / 100 : null;
}

/** A user as the pages name them: their email and, when it is an employee's work email, their name. */
export const userRef = (names: ReadonlyMap<string, UserRef>, user: { id: string; email: string } | null): AssetUserRef | null =>
  user ? { email: user.email, name: names.get(user.id)?.name ?? null } : null;

/** The users a record's view names (for userNames). */
export const usersOf = (r: Pick<RecordDetail, 'issuedBy' | 'items' | 'files'>) => [r.issuedBy, ...r.items.map((i) => i.receivedBy), ...r.files.map((f) => f.uploadedBy)];

export const assetRef = (a: Prisma.AssetGetPayload<{ select: typeof ASSET_REF }>): CustodyAssetRef => ({
  id: a.id,
  code: a.code,
  name: a.name,
  group: a.group as AssetGroup,
  type: a.type as AssetType,
  status: a.status as AssetStatus,
  brand: a.brand,
  model: a.model,
  serial: a.serial,
});

/** Where someone works, as a team "Department › Team". */
const placeOf = (d: { nameEn: string; parent: { nameEn: string } | null } | null): string | null => (d ? (d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn) : null);

export const personView = (p: PersonDetailRow) => ({
  id: p.id,
  employeeCode: p.employeeCode,
  fullNameEn: p.fullNameEn,
  jobTitle: p.employments[0]?.jobTitle?.titleEn ?? null,
  department: placeOf(p.employments[0]?.department ?? null),
});

export const deductionRefs = (rows: ItemRow['deductions']): CustodyDeductionRef[] =>
  rows.map((d) => ({ id: d.id, month: fromDateOnly(d.month).slice(0, 7), status: d.status, amount: money(d.amount) }));

export const fileRef = (names: ReadonlyMap<string, UserRef>, f: RecordDetail['files'][number]): CustodyFileRef => ({
  id: f.id,
  fileName: f.fileName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  uploadedAt: f.uploadedAt.toISOString(),
  uploadedBy: userRef(names, f.uploadedBy),
});

/** An item; its value for those who see the values, its deductions for HR, Finance and the CEO. */
export function itemView(i: ItemRow, caller: Pick<AssetsCaller, 'values' | 'user'>, names: ReadonlyMap<string, UserRef>): CustodyItemView {
  const view: CustodyItemView = {
    id: i.id,
    asset: assetRef(i.asset),
    conditionOut: (i.conditionOut as AssetCondition | null) ?? null,
    accessories: i.accessories,
    returnedAt: i.returnedAt?.toISOString() ?? null,
    returnCondition: (i.returnCondition as ReturnCondition | null) ?? null,
    receivedBy: userRef(names, i.receivedBy),
    returnNotes: i.returnNotes,
  };
  if (caller.values) view.valueAtOut = money(i.valueAtOut);
  if (seesCustodyDeductions(caller.user) && (i.returnCondition === 'damaged' || i.returnCondition === 'missing')) view.deductions = deductionRefs(i.deductions);
  return view;
}

/** The returns, as the form appends them: the items received back at the same moment by the same person, together. */
export function returnsOf(items: readonly ItemRow[], names: ReadonlyMap<string, UserRef>): CustodyReturnView[] {
  const groups = new Map<string, CustodyReturnView>();
  for (const i of [...items].filter((x) => x.returnedAt).sort((a, b) => a.returnedAt!.getTime() - b.returnedAt!.getTime() || a.asset.code.localeCompare(b.asset.code))) {
    const key = `${i.returnedAt!.toISOString()}|${i.receivedBy?.id ?? ''}`;
    const group = groups.get(key) ?? { at: i.returnedAt!.toISOString(), receivedBy: userRef(names, i.receivedBy), items: [] };
    group.items.push({ itemId: i.id, code: i.asset.code, name: i.asset.name, condition: i.returnCondition as ReturnCondition, notes: i.returnNotes });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The overdue facts of a record on `today`. */
export function lateness(r: { kind: string; status: string; dueDate: Date | null }, today: string) {
  const facts = { kind: r.kind, status: r.status, dueDate: r.dueDate ? fromDateOnly(r.dueDate) : null };
  return { overdue: isOverdue(facts, today), daysOverdue: daysOverdue(facts, today) };
}

export function rowView(r: RecordRow, today: string): CustodyRowView {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind as CustodyKind,
    status: r.status as CustodyStatus,
    employee: r.employee,
    purpose: r.purpose,
    dueDate: r.dueDate ? fromDateOnly(r.dueDate) : null,
    outAt: r.outAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
    items: r._count.items,
    out: r.items.length,
    signed: r._count.files > 0,
    ...lateness(r, today),
  };
}

/** What a held item reads: the item, its asset and its record. */
export const HELD = {
  id: true,
  valueAtOut: true,
  conditionOut: true,
  accessories: true,
  asset: { select: ASSET_REF },
  custody: { select: { code: true, kind: true, status: true, dueDate: true, outAt: true } },
} as const satisfies Prisma.CustodyItemSelect;

export type HeldRow = Prisma.CustodyItemGetPayload<{ select: typeof HELD }>;

/** An asset someone holds now; its value for those who see the values (`values`), never on My custody. */
export function heldView(h: HeldRow, values: boolean, today: string): HeldItemView {
  const view: HeldItemView = {
    itemId: h.id,
    asset: assetRef(h.asset),
    custody: { code: h.custody.code, kind: h.custody.kind as CustodyKind, dueDate: h.custody.dueDate ? fromDateOnly(h.custody.dueDate) : null },
    since: h.custody.outAt.toISOString(),
    ...lateness(h.custody, today),
    conditionOut: (h.conditionOut as AssetCondition | null) ?? null,
    accessories: h.accessories,
  };
  if (values) view.valueAtOut = money(h.valueAtOut);
  return view;
}

export { money };
