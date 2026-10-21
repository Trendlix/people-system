import {
  bookValue,
  needsReorder,
  type AssetClass,
  type AssetCondition,
  type AssetGroup,
  type AssetRowView,
  type AssetStatus,
  type AssetType,
  type AssetView,
} from '@trendlix/shared';
import { isSuperAdmin } from '../auth/roles.js';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AssetsCaller } from './assets-access.js';

// An asset as the API answers it (packages/shared AssetRowView, AssetView). The values rule (owner, 21 October 2026:
// "CEO and Finance") is kept here, in one place: `values` (the purchase cost, supplier, invoice, market value, book
// value) is only put in the answer for the CEO, Finance and a Super Admin; for anyone else the key isn't there at all,
// whatever their Assets level. The book value is worked out on the day asked (packages/shared bookValue), from the
// capitalization threshold.

const money = (d: Prisma.Decimal | null): number | null => (d === null ? null : d.toNumber());

/** What a list row reads. */
export const ASSET_ROW = {
  id: true,
  code: true,
  name: true,
  group: true,
  type: true,
  assetClass: true,
  status: true,
  condition: true,
  brand: true,
  model: true,
  serial: true,
  quantity: true,
  unit: true,
  reorderLevel: true,
  purchaseDate: true,
  usefulLifeYears: true,
  purchasePrice: true,
  marketValue: true,
  room: { select: { id: true, name: true } },
  kit: { select: { id: true, code: true, name: true } },
  holder: { select: { id: true, employeeCode: true, fullNameEn: true } },
  photos: { select: { id: true, position: true }, orderBy: [{ position: 'asc' }, { uploadedAt: 'asc' }], take: 1 },
} as const satisfies Prisma.AssetSelect;

/** What an asset's page reads: every field but the photos' files. */
export const ASSET_DETAIL = {
  ...ASSET_ROW,
  warrantyEnd: true,
  supplier: true,
  invoiceNo: true,
  priceLow: true,
  priceHigh: true,
  priceNote: true,
  priceUpdatedAt: true,
  labeledAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, email: true } },
  photos: { select: { id: true, position: true }, orderBy: [{ position: 'asc' }, { uploadedAt: 'asc' }] },
  _count: { select: { custodyItems: true } },
} as const satisfies Prisma.AssetSelect;

export type AssetRow = Prisma.AssetGetPayload<{ select: typeof ASSET_ROW }>;
export type AssetDetail = Prisma.AssetGetPayload<{ select: typeof ASSET_DETAIL }>;

/** Worked out once a request: the capitalization threshold and the day (Cairo) the book values are on. */
export interface ValueContext {
  threshold: number;
  today: string;
}

function bookOf(r: Pick<AssetRow, 'purchasePrice' | 'purchaseDate' | 'usefulLifeYears' | 'assetClass'>, ctx: ValueContext) {
  return bookValue({ purchasePrice: money(r.purchasePrice), purchaseDate: fromDateOnly(r.purchaseDate), usefulLifeYears: r.usefulLifeYears, assetClass: r.assetClass }, ctx.threshold, ctx.today);
}

const quantity = (d: Prisma.Decimal | null): number | null => (d === null ? null : d.toNumber());

/** The parts of a row every caller with access sees. */
function common(r: AssetRow) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    group: r.group as AssetGroup,
    type: r.type as AssetType,
    status: r.status as AssetStatus,
    condition: (r.condition as AssetCondition | null) ?? null,
    brand: r.brand,
    model: r.model,
    serial: r.serial,
    room: r.room,
    kit: r.kit,
    holder: r.holder,
    quantity: quantity(r.quantity),
    unit: r.unit,
    reorder: needsReorder({ group: r.group, quantity: quantity(r.quantity), reorderLevel: quantity(r.reorderLevel) }),
  };
}

/** A row of the register; `values` only for those who see them. */
export function rowView(r: AssetRow, caller: Pick<AssetsCaller, 'values'>, ctx: ValueContext): AssetRowView {
  const view: AssetRowView = { ...common(r), photo: r.photos[0] ?? null };
  if (caller.values) {
    const book = bookOf(r, ctx);
    view.values = { purchasePrice: money(r.purchasePrice), marketValue: money(r.marketValue), bookValue: book.amount, expensed: book.expensed };
  }
  return view;
}

/** An asset's page; `values` only for those who see them. `createdBy`: the user who registered it, by name. */
export function detailView(r: AssetDetail, caller: AssetsCaller, ctx: ValueContext, createdByName: string | null): AssetView {
  const everInCustody = r._count.custodyItems > 0;
  const register = caller.access === 'custodian' || caller.access === 'manager';
  const view: AssetView = {
    ...common(r),
    photo: r.photos[0] ?? null,
    assetClass: r.assetClass as AssetClass,
    reorderLevel: quantity(r.reorderLevel),
    purchaseDate: fromDateOnly(r.purchaseDate),
    usefulLifeYears: r.usefulLifeYears,
    warrantyEnd: fromDateOnly(r.warrantyEnd),
    notes: r.notes,
    labeledAt: r.labeledAt?.toISOString() ?? null,
    photos: r.photos,
    everInCustody,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy ? { email: r.createdBy.email, name: createdByName } : null,
    updatedAt: r.updatedAt.toISOString(),
    can: {
      edit: register,
      photos: register,
      values: caller.values,
      // only a Super Admin deletes (the system's rule), and only an asset never in custody: else it is disposed of
      delete: isSuperAdmin(caller.user) && !everInCustody,
    },
  };
  if (caller.values) {
    view.values = {
      purchasePrice: money(r.purchasePrice),
      supplier: r.supplier,
      invoiceNo: r.invoiceNo,
      priceLow: money(r.priceLow),
      marketValue: money(r.marketValue),
      priceHigh: money(r.priceHigh),
      priceNote: r.priceNote,
      priceUpdatedAt: r.priceUpdatedAt?.toISOString() ?? null,
      bookValue: bookOf(r, ctx),
    };
  }
  return view;
}
