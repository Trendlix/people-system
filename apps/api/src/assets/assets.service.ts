import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  accessoriesProblems,
  accessoriesText,
  attachProblem,
  STOCK_EDIT_NOTE,
  tidyAccessories,
  type AccessoryInput,
  ASSET_GROUP_RULES,
  ASSET_GROUPS,
  ASSET_MARKET_FIELDS,
  ASSET_STATUSES,
  ASSET_VALUE_FIELDS,
  ASSETS_PAGE_SIZE,
  ASSETS_REFUSALS,
  assetCode,
  assetCodePrefix,
  assetProblems,
  assetStatusProblem,
  assetValuesProblems,
  fitToGroup,
  isAssetCode,
  normalAssetCode,
  type AssetGroup,
  type AssetInput,
  type AssetListView,
  type AssetStatus,
  type AssetType,
  type AssetValuesInput,
  type AssetView,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { assertDeletes } from '../auth/roles.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextCodeNumber } from './asset-codes.js';
import { AssetSettingsService } from './asset-settings.service.js';
import { ASSET_DETAIL, ASSET_ROW, detailView, rowView, type ValueContext } from './asset-views.js';
import type { AssetsCaller } from './assets-access.js';
import type { AssetValuesDto, CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './assets.dto.js';

// The asset register (owner, 21 October 2026: the Assets module, step 1; packages/shared assets.ts has the rules):
// registering an asset (its code given in the same transaction: PREFIX-TYPE-NNNN, from the counters, race-safe), editing
// it (the code never changes, even when its group or type does; what the new group doesn't have is cleared), its values
// (the CEO's, Finance's and a Super Admin's only), its label printed, deleting it (a Super Admin only, and only if it was
// never in custody), the register's list with its search and filters, and an asset's page by its code. Every write is in
// the audit log ('asset'), the values as the fact that they were set or changed, never the amounts (as the wages are).

export const ASSET_ENTITY = 'asset';
export const ASSET_NOT_FOUND = 'Asset not found.';

const NEVER_IN_CUSTODY = 'It was in custody: it can’t be deleted. Dispose of it instead.';

type Row = Prisma.AssetGetPayload<{ select: typeof FULL }>;

/** Everything of an asset but its photos, for an edit: its fields and its values as they are. */
const FULL = {
  id: true,
  code: true,
  parentAssetId: true,
  _count: { select: { accessories: true, attached: true } },
  name: true,
  group: true,
  type: true,
  assetClass: true,
  brand: true,
  model: true,
  serial: true,
  condition: true,
  status: true,
  roomId: true,
  kitId: true,
  quantity: true,
  unit: true,
  reorderLevel: true,
  purchaseDate: true,
  usefulLifeYears: true,
  warrantyEnd: true,
  notes: true,
  purchasePrice: true,
  supplier: true,
  invoiceNo: true,
  priceLow: true,
  marketValue: true,
  priceHigh: true,
  priceNote: true,
} as const satisfies Prisma.AssetSelect;

const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : d.toNumber());

/** An asset's own fields as plain values, as the shared rules and the audit log compare them. */
function fieldsOf(r: Row): AssetInput {
  return {
    name: r.name,
    group: r.group as AssetGroup,
    type: r.type as AssetType,
    assetClass: r.assetClass as AssetInput['assetClass'],
    brand: r.brand,
    model: r.model,
    serial: r.serial,
    condition: r.condition as AssetInput['condition'],
    roomId: r.roomId,
    kitId: r.kitId,
    quantity: num(r.quantity),
    unit: r.unit,
    reorderLevel: num(r.reorderLevel),
    purchaseDate: fromDateOnly(r.purchaseDate),
    usefulLifeYears: r.usefulLifeYears,
    warrantyEnd: fromDateOnly(r.warrantyEnd),
    notes: r.notes,
  };
}

function valuesOf(r: Row): AssetValuesInput {
  return {
    purchasePrice: num(r.purchasePrice),
    supplier: r.supplier,
    invoiceNo: r.invoiceNo,
    priceLow: num(r.priceLow),
    marketValue: num(r.marketValue),
    priceHigh: num(r.priceHigh),
    priceNote: r.priceNote,
  };
}

export const NO_VALUES: AssetValuesInput = { purchasePrice: null, supplier: null, invoiceNo: null, priceLow: null, marketValue: null, priceHigh: null, priceNote: null };

/** The asset's fields as the database keeps them. */
function fieldData(a: AssetInput) {
  return {
    name: a.name,
    group: a.group,
    type: a.type,
    assetClass: a.assetClass,
    brand: a.brand,
    model: a.model,
    serial: a.serial,
    condition: a.condition,
    roomId: a.roomId,
    kitId: a.kitId,
    quantity: a.quantity,
    unit: a.unit,
    reorderLevel: a.reorderLevel,
    purchaseDate: a.purchaseDate === null ? null : toDateOnly(a.purchaseDate),
    usefulLifeYears: a.usefulLifeYears,
    warrantyEnd: a.warrantyEnd === null ? null : toDateOnly(a.warrantyEnd),
    notes: a.notes,
  };
}

/** The values as the database keeps them. */
const valueData = (v: AssetValuesInput) => ({ ...v });

/** The values in the audit log: each one there as 'set' or 'changed', never its amount or words. */
export function maskedValues(diff: Record<string, unknown>, mark: 'set' | 'changed'): Record<string, unknown> {
  const out = { ...diff };
  for (const key of ASSET_VALUE_FIELDS) if (key in out) out[key] = mark;
  return out;
}

/** The fields a request sends for a group that doesn't have them: refused rather than dropped. */
export function sentForAnotherGroup(dto: { kitId?: string | null; quantity?: number | null; reorderLevel?: number | null; unit?: string | null }, group: AssetGroup): string[] {
  const out: string[] = [];
  if (dto.kitId && group !== 'kit') out.push('Only a production kit asset goes in a kit.');
  if ((dto.quantity != null || dto.reorderLevel != null || dto.unit != null) && group !== 'consumable') out.push('Only consumables are kept by quantity.');
  return out;
}

/** The search: the name, code or serial, or the name or code of who holds it. */
function searchWhere(q: string | undefined): Prisma.AssetWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: 'insensitive' as const };
  return { OR: [{ name: contains }, { code: contains }, { serial: contains }, { holder: { is: { OR: [{ fullNameEn: contains }, { employeeCode: contains }] } } }] };
}

/** "A value given": the values sent, with what isn't sent left as it was. */
export function mergeValues(before: AssetValuesInput, sent: AssetValuesDto | undefined): AssetValuesInput {
  const out = { ...before };
  if (!sent) return out;
  for (const key of ASSET_VALUE_FIELDS) {
    const value = sent[key];
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * A new asset's fields from what Add sends (a draft's too): its class and useful life default to its group's (owner's
 * spec §2.2: 8, 5, 3, 7 years; none for consumables), fitted to its group.
 */
export function newAssetInput(dto: CreateAssetDto): AssetInput {
  const rule = ASSET_GROUP_RULES[dto.group];
  return fitToGroup<AssetInput>({
    name: dto.name,
    group: dto.group,
    type: dto.type,
    assetClass: dto.assetClass ?? rule.defaultClass,
    brand: dto.brand ?? null,
    model: dto.model ?? null,
    serial: dto.serial ?? null,
    condition: dto.condition ?? null,
    roomId: dto.roomId ?? null,
    kitId: dto.kitId ?? null,
    quantity: dto.quantity ?? null,
    unit: dto.unit ?? null,
    reorderLevel: dto.reorderLevel ?? null,
    purchaseDate: dto.purchaseDate ?? null,
    usefulLifeYears: dto.usefulLifeYears ?? rule.usefulLifeYears,
    warrantyEnd: dto.warrantyEnd ?? null,
    notes: dto.notes ?? null,
  });
}

/**
 * An asset's fields after an edit (a draft's too): only what is sent changes (null clears it); a new group brings its
 * class and, when it had none, its useful life, unless they are sent; an asset becoming a consumable is one of it unless
 * a quantity is sent; fitted to its group, so nothing of the old group stays.
 */
export function editedAssetInput(before: AssetInput, dto: UpdateAssetDto): AssetInput {
  const group = dto.group ?? before.group;
  const groupChanged = group !== before.group;
  const rule = ASSET_GROUP_RULES[group];
  const sent = <K extends keyof AssetInput>(key: K, value: AssetInput[K] | undefined): AssetInput[K] => (value === undefined ? before[key] : value);
  const merged: AssetInput = {
    name: dto.name ?? before.name,
    group,
    type: dto.type ?? before.type,
    assetClass: dto.assetClass ?? (groupChanged ? rule.defaultClass : before.assetClass),
    brand: sent('brand', dto.brand),
    model: sent('model', dto.model),
    serial: sent('serial', dto.serial),
    condition: sent('condition', dto.condition),
    roomId: sent('roomId', dto.roomId),
    kitId: sent('kitId', dto.kitId),
    quantity: sent('quantity', dto.quantity),
    unit: sent('unit', dto.unit),
    reorderLevel: sent('reorderLevel', dto.reorderLevel),
    purchaseDate: sent('purchaseDate', dto.purchaseDate),
    usefulLifeYears: dto.usefulLifeYears !== undefined ? dto.usefulLifeYears : groupChanged && before.usefulLifeYears === null ? rule.usefulLifeYears : before.usefulLifeYears,
    warrantyEnd: sent('warrantyEnd', dto.warrantyEnd),
    notes: sent('notes', dto.notes),
  };
  if (groupChanged && group === 'consumable' && merged.quantity === null) merged.quantity = 1;
  return fitToGroup(merged);
}

/** The main asset an asset is attached to, by its code as typed (step 4), with what the attach rules read; 404-free: null. */
export async function mainAssetByCode(db: PrismaService | Prisma.TransactionClient, code: string) {
  const normal = normalAssetCode(code);
  if (!isAssetCode(normal)) return null;
  const row = await db.asset.findUnique({ where: { code: normal }, select: { id: true, code: true, name: true, group: true, status: true, parentAssetId: true, _count: { select: { attached: true } } } });
  return row && { id: row.id, code: row.code, name: row.name, group: row.group, status: row.status, parentId: row.parentAssetId, attached: row._count.attached };
}

/** Why a new asset (or a draft) can't be attached to the main asset coded `parentCode`, or null when it can; the main asset found. */
export async function newAttachProblem(db: PrismaService | Prisma.TransactionClient, parentCode: string, group: AssetGroup) {
  const main = await mainAssetByCode(db, parentCode);
  if (!main) return { problem: `No asset has the code ${normalAssetCode(parentCode)}: check the main asset’s code.`, main: null };
  return { problem: attachProblem({ id: '', code: 'This asset', group, status: 'available', parentId: null, attached: 0 }, main), main };
}

/** The accessories' lines as kept, in order. */
export const accessoryRows = (assetId: string, list: readonly AccessoryInput[]) =>
  list.map((a, position) => ({ assetId, position, name: a.name, quantity: a.quantity, serial: a.serial, notes: a.notes }));

/**
 * What else registering an asset does (step 2: confirming a draft from Claude): `values`, the draft's values, kept when
 * the person confirming can't see them (they were drafted by someone who can); `within`, run in the transaction that
 * saves the asset with its code (a draft marked confirmed: when it can't be, nothing is saved and the code isn't used);
 * `audit`, more for the asset's entry.
 */
export interface CreateOptions {
  values?: AssetValuesInput;
  within?: (tx: Prisma.TransactionClient, created: { id: string; code: string }) => Promise<void>;
  audit?: Record<string, unknown>;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AssetSettingsService,
  ) {}

  private async context(): Promise<ValueContext> {
    return { threshold: await this.settings.threshold(), today: todayInCairo() };
  }

  /** GET /assets: the register, a page at a time, by code; disposed assets only when asked for. */
  async list(q: ListAssetsQueryDto, caller: AssetsCaller): Promise<AssetListView> {
    if (q.needsValues && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const search = searchWhere(q.q);
    const where: Prisma.AssetWhereInput = {
      AND: [
        search,
        q.status ? { status: q.status } : { status: { not: 'disposed' } },
        q.group ? { group: q.group } : {},
        q.roomId ? { roomId: q.roomId } : {},
        q.kitId ? { kitId: q.kitId } : {},
        // who holds it, by their name or employee code (step 2: the Claude connector's search)
        q.holder ? { holder: { is: { OR: [{ fullNameEn: { contains: q.holder, mode: 'insensitive' } }, { employeeCode: { contains: q.holder, mode: 'insensitive' } }] } } } : {},
        q.needsValues ? { purchasePrice: null, status: { not: 'disposed' } } : {},
      ],
    };
    const page = q.page ?? 1;
    const [total, rows, byGroup, byStatus, ctx] = await Promise.all([
      this.prisma.asset.count({ where }),
      this.prisma.asset.findMany({ where, select: ASSET_ROW, orderBy: { code: 'asc' }, skip: (page - 1) * ASSETS_PAGE_SIZE, take: ASSETS_PAGE_SIZE }),
      this.prisma.asset.groupBy({ by: ['group'], where: { AND: [search, { status: { not: 'disposed' } }] }, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['status'], where: search, _count: { _all: true } }),
      this.context(),
    ]);
    const group = Object.fromEntries(ASSET_GROUPS.map((g) => [g, 0])) as Record<AssetGroup, number>;
    for (const g of byGroup) if (g.group in group) group[g.group as AssetGroup] = g._count._all;
    const status = Object.fromEntries(ASSET_STATUSES.map((s) => [s, 0])) as Record<AssetStatus, number>;
    for (const s of byStatus) if (s.status in status) status[s.status as AssetStatus] = s._count._all;
    return { items: rows.map((r) => rowView(r, caller, ctx)), total, page, pageSize: ASSETS_PAGE_SIZE, counts: { group, status } };
  }

  /** GET /assets/:code (the address in its QR label), its code as typed or scanned. */
  async get(code: string, caller: AssetsCaller): Promise<AssetView> {
    const normal = normalAssetCode(code);
    if (!isAssetCode(normal)) throw new NotFoundException(ASSET_NOT_FOUND);
    const [row, ctx] = await Promise.all([this.prisma.asset.findUnique({ where: { code: normal }, select: ASSET_DETAIL }), this.context()]);
    if (!row) throw new NotFoundException(ASSET_NOT_FOUND);
    const names = await userNames(this.prisma, [row.createdBy, row.disposedBy]);
    return detailView(row, caller, ctx, names);
  }

  /** The asset's id by its code, or 404. */
  async idOf(code: string): Promise<{ id: string; code: string }> {
    const normal = normalAssetCode(code);
    const row = isAssetCode(normal) ? await this.prisma.asset.findUnique({ where: { code: normal }, select: { id: true, code: true } }) : null;
    if (!row) throw new NotFoundException(ASSET_NOT_FOUND);
    return row;
  }

  /**
   * Registers an asset: its class and useful life default to its group's; fitted to its group; its code given in the
   * transaction that saves it, from the counter of its prefix and type (race-safe). The values only from those who see
   * them.
   */
  async create(dto: CreateAssetDto, caller: AssetsCaller, options: CreateOptions = {}): Promise<AssetView> {
    if (dto.values && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const input = newAssetInput(dto);
    const status: AssetStatus = dto.status ?? 'available';
    const values = options.values ?? mergeValues(NO_VALUES, dto.values);
    // step 4 (owner, 22 October 2026: accessories, "Both kinds"): its checklist and the main asset it is attached to
    const accessories = tidyAccessories(dto.accessories ?? []);
    const attach = dto.parentCode ? await newAttachProblem(this.prisma, dto.parentCode, input.group) : null;
    const problems = [
      ...sentForAnotherGroup(dto, dto.group),
      ...assetProblems(input, todayInCairo()),
      ...[assetStatusProblem(null, status, input.group)].filter((p): p is string => !!p),
      ...assetValuesProblems(values),
      ...accessoriesProblems(accessories, input.group),
      ...(attach?.problem ? [attach.problem] : []),
    ];
    if (problems.length) throw new BadRequestException(problems);
    await this.checkPlaces(input, null);

    const marketSet = ASSET_MARKET_FIELDS.some((k) => values[k] !== null);
    const created = await this.prisma.$transaction(async (tx) => {
      const prefix = assetCodePrefix(input.group, input.type);
      const code = assetCode(prefix, await nextCodeNumber(tx, prefix));
      if (attach?.main) {
        // the main asset held, and checked again: not disposed or attached to another meanwhile
        await tx.$queryRaw`SELECT id FROM assets WHERE id = ${attach.main.id}::uuid FOR UPDATE`;
        const main = await mainAssetByCode(tx, attach.main.code);
        const again = main && attachProblem({ id: '', code: 'This asset', group: input.group, status, parentId: null, attached: 0 }, main);
        if (!main || again) throw new ConflictException(again ?? 'The main asset changed meanwhile. Reload the page.');
      }
      const row = await tx.asset.create({
        data: {
          code,
          ...fieldData(input),
          status,
          ...valueData(values),
          priceUpdatedAt: marketSet ? new Date() : null,
          createdById: caller.user.id,
          parentAssetId: attach?.main?.id ?? null,
        },
        select: { id: true, code: true },
      });
      if (accessories.length) await tx.assetAccessory.createMany({ data: accessoryRows(row.id, accessories) });
      if (options.within) await options.within(tx, row);
      return row;
    });

    const given = Object.fromEntries(
      Object.entries({
        ...input,
        status,
        ...values,
        accessories: accessories.length ? accessoriesText(accessories) : null,
        attachedTo: attach?.main?.code ?? null,
      }).filter(([, v]) => v !== null),
    );
    await this.audit.record({
      userId: caller.user.id,
      action: 'create',
      entityType: ASSET_ENTITY,
      entityId: created.id,
      diff: maskedValues({ code: created.code, ...given, ...options.audit }, 'set'),
    });
    return this.get(created.code, caller);
  }

  /**
   * Edits an asset: only what is sent changes (null clears it). Its code never changes, whatever its group or type
   * become; a new group brings its class and, when it had none, its useful life, unless they are sent, and clears what
   * the group doesn't have (fitToGroup). The status by hand: never custody or disposed (assetStatusProblem). The values
   * only from those who see them.
   */
  async update(code: string, dto: UpdateAssetDto, caller: AssetsCaller): Promise<AssetView> {
    if (dto.values && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    if (dto.accessories !== undefined || dto.parentCode !== undefined) {
      throw new BadRequestException(['Change its accessories and what it is attached to on the asset’s page.']);
    }
    const row = await this.full(code);
    const before = fieldsOf(row);
    const after = editedAssetInput(before, dto);
    const group = after.group;

    const beforeStatus = row.status as AssetStatus;
    const status = dto.status ?? beforeStatus;
    const statusProblem =
      dto.status !== undefined
        ? assetStatusProblem(beforeStatus, dto.status, group)
        : group === 'consumable' && beforeStatus !== 'available'
          ? beforeStatus === 'custody'
            ? 'It is held in custody: it can’t become a consumable until it is received back.'
            : 'Consumables are always available: set it to Available first, or keep its group.'
          : null;
    const beforeValues = valuesOf(row);
    const values = mergeValues(beforeValues, dto.values);
    const problems = [
      ...sentForAnotherGroup(dto, group),
      ...assetProblems(after, todayInCairo()),
      ...(statusProblem ? [statusProblem] : []),
      ...(dto.values ? assetValuesProblems(values) : []),
    ];
    // step 4: a consumable has no accessories and nothing attached; a disposed asset is in no kit
    if (group === 'consumable' && before.group !== 'consumable' && (row._count.accessories || row._count.attached || row.parentAssetId)) {
      problems.push('It has accessories or attached assets, or is attached to another: remove them on its page before it becomes a consumable.');
    }
    if (beforeStatus === 'disposed' && after.kitId) problems.push('A disposed asset is in no kit.');
    if (problems.length) throw new BadRequestException(problems);
    await this.checkPlaces(after, before);

    const fieldDiff = changes({ ...before, status: beforeStatus }, { ...after, status });
    const valueDiff = changes({ ...beforeValues }, { ...values });
    if (!Object.keys(fieldDiff).length && !Object.keys(valueDiff).length) return this.get(row.code, caller);
    const marketChanged = ASSET_MARKET_FIELDS.some((k) => k in valueDiff);
    // a consumable's quantity changed on the Edit form: kept as a stock move too (step 4), so its history adds up
    const delta = before.group === 'consumable' && group === 'consumable' && after.quantity !== null && before.quantity !== null ? Math.round((after.quantity - before.quantity) * 100) / 100 : 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: row.id },
        data: { ...fieldData(after), status, ...valueData(values), ...(marketChanged && { priceUpdatedAt: new Date() }) },
      });
      if (delta !== 0) {
        await tx.assetStockMove.create({ data: { assetId: row.id, delta, quantityAfter: after.quantity!, note: STOCK_EDIT_NOTE, byId: caller.user.id } });
      }
    });
    await this.audit.record({ userId: caller.user.id, action: 'update', entityType: ASSET_ENTITY, entityId: row.id, diff: maskedValues({ code: row.code, ...fieldDiff, ...valueDiff }, 'changed') });
    return this.get(row.code, caller);
  }

  /** PATCH /assets/:code/values: the CEO, Finance or a Super Admin set the values, whatever their Assets level. */
  async updateValues(code: string, dto: AssetValuesDto, caller: AssetsCaller): Promise<AssetView> {
    if (!caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const row = await this.full(code);
    const before = valuesOf(row);
    const after = mergeValues(before, dto);
    const problems = assetValuesProblems(after);
    if (problems.length) throw new BadRequestException(problems);
    const diff = changes({ ...before }, { ...after });
    if (Object.keys(diff).length) {
      const marketChanged = ASSET_MARKET_FIELDS.some((k) => k in diff);
      await this.prisma.asset.update({ where: { id: row.id }, data: { ...valueData(after), ...(marketChanged && { priceUpdatedAt: new Date() }) } });
      await this.audit.record({ userId: caller.user.id, action: 'update_values', entityType: ASSET_ENTITY, entityId: row.id, diff: maskedValues({ code: row.code, ...diff }, 'changed') });
    }
    return this.get(row.code, caller);
  }

  /** Its label printed (spec §5: "after printing set labeled_at"). */
  async markLabeled(code: string, caller: AssetsCaller): Promise<AssetView> {
    const { id, code: kept } = await this.idOf(code);
    const at = new Date();
    await this.prisma.asset.update({ where: { id }, data: { labeledAt: at } });
    await this.audit.record({ userId: caller.user.id, action: 'label', entityType: ASSET_ENTITY, entityId: id, diff: { code: kept, labeledAt: at.toISOString() } });
    return this.get(kept, caller);
  }

  /**
   * Deletes an asset: a Super Admin only (the system's rule), and only one never in custody (spec §6.10); otherwise it
   * is disposed of. Its photos go with it; its code is never given again (the counter stays).
   */
  async remove(code: string, caller: AssetsCaller): Promise<void> {
    assertDeletes(caller.user);
    const row = await this.prisma.asset.findFirst({
      where: { code: normalAssetCode(code) },
      select: { id: true, code: true, name: true, group: true, type: true, status: true, _count: { select: { custodyItems: true, photos: true } } },
    });
    if (!row) throw new NotFoundException(ASSET_NOT_FOUND);
    if (row._count.custodyItems > 0 || row.status === 'custody') throw new ConflictException(NEVER_IN_CUSTODY);
    try {
      // never in custody, also by the time it is deleted: a handover made meanwhile holds it (custody_items restricts)
      await this.prisma.asset.delete({ where: { id: row.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw new ConflictException(NEVER_IN_CUSTODY);
      throw err;
    }
    await this.audit.record({
      userId: caller.user.id,
      action: 'delete',
      entityType: ASSET_ENTITY,
      entityId: row.id,
      diff: { code: row.code, name: row.name, group: row.group, type: row.type, photos: row._count.photos },
    });
  }

  private async full(code: string): Promise<Row> {
    const normal = normalAssetCode(code);
    const row = isAssetCode(normal) ? await this.prisma.asset.findUnique({ where: { code: normal }, select: FULL }) : null;
    if (!row) throw new NotFoundException(ASSET_NOT_FOUND);
    return row;
  }

  /** The room and the kit it names exist; a room newly chosen isn't archived (a draft's too). */
  async checkPlaces(after: AssetInput, before: AssetInput | null): Promise<void> {
    const problems: string[] = [];
    if (after.roomId && after.roomId !== before?.roomId) {
      const room = await this.prisma.assetRoom.findUnique({ where: { id: after.roomId }, select: { archivedAt: true } });
      if (!room) problems.push('Choose a room from the list.');
      else if (room.archivedAt) problems.push('That room is archived: choose another.');
    }
    if (after.kitId && after.kitId !== before?.kitId) {
      const kit = await this.prisma.assetKit.findUnique({ where: { id: after.kitId }, select: { id: true } });
      if (!kit) problems.push('Choose a kit from the list.');
    }
    if (problems.length) throw new BadRequestException(problems);
  }
}
