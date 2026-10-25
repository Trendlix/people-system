import {
  assetsAccessAtLeast,
  bookValue,
  needsReorder,
  productImageHost,
  type AssetClass,
  type AssetCondition,
  type AssetGroup,
  type AssetPhotoRef,
  type AssetRowView,
  type AssetStatus,
  type AssetType,
  type AssetView,
  type DisposalMethod,
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

/** What a photo's answer reads: its place, and a product image's source (21 October 2026: product images from Claude). */
export const PHOTO_REF = { id: true, position: true, kind: true, sourcePageUrl: true, imageUrl: true, caption: true } as const satisfies Prisma.AssetPhotoSelect;

type PhotoRow = Prisma.AssetPhotoGetPayload<{ select: typeof PHOTO_REF }>;

/** A photo as the API answers it: `product` only on a product image, with where it came from. */
export function photoRef(r: PhotoRow): AssetPhotoRef {
  const ref: AssetPhotoRef = { id: r.id, position: r.position };
  if (r.kind === 'product' && r.sourcePageUrl && r.imageUrl) {
    ref.product = { sourcePageUrl: r.sourcePageUrl, sourceHost: productImageHost(r.sourcePageUrl) ?? r.sourcePageUrl, imageUrl: r.imageUrl, caption: r.caption };
  }
  return ref;
}

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
  photos: { select: PHOTO_REF, orderBy: [{ position: 'asc' }, { uploadedAt: 'asc' }], take: 1 },
  // step 4 (owner, 22 October 2026: accessories, "Both kinds"): the main asset it is attached to
  parent: { select: { id: true, code: true, name: true } },
  // whether it was ever in custody (25 October 2026: Delete selected on All Assets says beforehand what it will skip)
  _count: { select: { custodyItems: true } },
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
  photos: { select: PHOTO_REF, orderBy: [{ position: 'asc' }, { uploadedAt: 'asc' }] },
  _count: { select: { custodyItems: true } },
  // step 4: its checklist, the assets attached to it (disposed ones are detached), and its disposal
  accessories: { select: { id: true, name: true, quantity: true, serial: true, notes: true }, orderBy: { position: 'asc' } },
  attached: { select: { id: true, code: true, name: true, status: true, holder: { select: { fullNameEn: true } } }, orderBy: { code: 'asc' } },
  disposalMethod: true,
  disposedOn: true,
  disposalAmount: true,
  disposalBookValue: true,
  disposalApprovedBy: true,
  disposalNotes: true,
  disposedBy: { select: { id: true, email: true } },
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
    parent: r.parent,
  };
}

/** A row of the register; `values` only for those who see them. */
export function rowView(r: AssetRow, caller: Pick<AssetsCaller, 'values'>, ctx: ValueContext): AssetRowView {
  const view: AssetRowView = { ...common(r), photo: r.photos[0] ? photoRef(r.photos[0]) : null, everInCustody: r._count.custodyItems > 0 };
  if (caller.values) {
    const book = bookOf(r, ctx);
    view.values = { purchasePrice: money(r.purchasePrice), marketValue: money(r.marketValue), bookValue: book.amount, expensed: book.expensed };
  }
  return view;
}

/**
 * An asset's page; `values` only for those who see them. `names`: the users it names (who registered it, who disposed of
 * it), by name.
 */
export function detailView(r: AssetDetail, caller: AssetsCaller, ctx: ValueContext, names: ReadonlyMap<string, { name: string | null }>): AssetView {
  const everInCustody = r._count.custodyItems > 0;
  const register = assetsAccessAtLeast(caller.access, 'custodian');
  const disposed = r.status === 'disposed';
  const consumable = r.group === 'consumable';
  const createdByName = r.createdBy ? (names.get(r.createdBy.id)?.name ?? null) : null;
  const view: AssetView = {
    ...common(r),
    photo: r.photos[0] ? photoRef(r.photos[0]) : null,
    assetClass: r.assetClass as AssetClass,
    reorderLevel: quantity(r.reorderLevel),
    purchaseDate: fromDateOnly(r.purchaseDate),
    usefulLifeYears: r.usefulLifeYears,
    warrantyEnd: fromDateOnly(r.warrantyEnd),
    notes: r.notes,
    labeledAt: r.labeledAt?.toISOString() ?? null,
    photos: r.photos.map(photoRef),
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
      // step 4: the checklist and attaching (not on a consumable or a disposed asset), Use and Restock (a consumable), a
      // maintenance entry by hand (not a consumable), a custodian's or a manager's; disposal, a manager's
      accessories: register && !consumable && !disposed,
      attach: register && !consumable && !disposed,
      stock: register && consumable,
      maintenance: register && !consumable,
      dispose: caller.access === 'manager' && !consumable && !disposed && r.status !== 'custody',
    },
    accessories: r.accessories,
    attached: r.attached.map((a) => ({ id: a.id, code: a.code, name: a.name, status: a.status as AssetStatus, holder: a.holder?.fullNameEn ?? null })),
    disposal:
      disposed && r.disposalMethod && r.disposedOn
        ? {
            method: r.disposalMethod as DisposalMethod,
            on: fromDateOnly(r.disposedOn),
            approvedBy: r.disposalApprovedBy,
            notes: r.disposalNotes,
            by: r.disposedBy ? { email: r.disposedBy.email, name: names.get(r.disposedBy.id)?.name ?? null } : null,
            ...(caller.values && { amount: money(r.disposalAmount), bookValue: money(r.disposalBookValue) }),
          }
        : null,
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
