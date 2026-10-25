import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ASSETS_REFUSALS,
  BULK_SKIP_REASONS,
  bookValue,
  disposalProblems,
  disposeProblem,
  maintenanceProblems,
  stockAfter,
  stockDelta,
  stockMoveProblems,
  reasonBesideCode,
  type AssetView,
  type BulkDisposeResult,
  type DisposalInput,
  type DisposalResult,
  type StockMoveKind,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssetSettingsService } from './asset-settings.service.js';
import type { BulkDisposeDto, DisposalAmountDto, DisposeDto, MaintenanceDto, StockMoveDto } from './asset-upkeep.dto.js';
import type { AssetsCaller } from './assets-access.js';
import { ASSET_ENTITY, AssetsService, bulkCodes } from './assets.service.js';

// Assets, step 4 (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal"; the spec §3, §6;
// packages/shared asset-upkeep.ts), on an asset's page:
// - Stock: a consumable used or restocked by a custodian or a manager, the quantity never below 0, each move kept with
//   the quantity after it, a note and who made it (spec §3 move_stock), all in one transaction with the row held.
// - The maintenance log by hand: a repair, service, inspection, warranty claim or upgrade, its cost (a value) only from
//   the CEO, Finance or a Super Admin. Sending to repair and back stay on asset-repairs.service.ts.
// - Disposal (spec §6.9), an Assets manager's: the method, the day, who approved it, notes, and the amount received (a
//   value: from the CEO, Finance or a Super Admin, or set by them later); the book value on that day kept; never one in
//   custody or a consumable; it leaves its kit, its attached assets are detached, and it from its main one. Disposed
//   assets stay, out of every total and list but the Disposed filter.
// Every write audited on the asset ('asset'), the money only as the fact that it was set (as the values are). Dispose
// selected on All Assets (25 October 2026) puts several through the same rules, one at a time.

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Why Dispose selected left an asset as it was: the refusal one disposal on its page would get (not found, in custody, a
 * consumable, disposed already, a day before its purchase), said beside its code; null for anything else (a fault).
 */
function skipReason(err: unknown, code: string): string | null {
  if (err instanceof NotFoundException) return BULK_SKIP_REASONS.notFound;
  if (!(err instanceof ConflictException || err instanceof BadRequestException)) return null;
  const body = (err as HttpException).getResponse();
  const message = typeof body === 'object' && body !== null && 'message' in body ? (body as { message: unknown }).message : err.message;
  return reasonBesideCode(code, Array.isArray(message) ? message.join(' ') : String(message));
}

const num = (d: { toNumber(): number } | null): number | null => (d === null ? null : d.toNumber());

@Injectable()
export class AssetUpkeepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
    private readonly settings: AssetSettingsService,
  ) {}

  /** POST /assets/:code/stock: Use (−) or Restock (+). */
  async moveStock(code: string, dto: StockMoveDto, caller: AssetsCaller): Promise<AssetView> {
    const { id } = await this.assets.idOf(code);
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.asset.findUniqueOrThrow({ where: { id }, select: { code: true, group: true, quantity: true, unit: true } });
      if (a.group !== 'consumable') throw new ConflictException(`${a.code} isn’t a consumable: only consumables are kept by quantity.`);
      const quantity = num(a.quantity) ?? 0;
      const problems = stockMoveProblems(dto.kind, dto.amount, quantity, a.unit, dto.note);
      if (problems.length) throw new BadRequestException(problems);
      const delta = stockDelta(dto.kind, dto.amount);
      const after = stockAfter(quantity, delta);
      await tx.asset.update({ where: { id }, data: { quantity: after } });
      await tx.assetStockMove.create({ data: { assetId: id, delta, quantityAfter: after, note: dto.note ?? null, byId: caller.user.id } });
      return { code: a.code, from: quantity, to: after, unit: a.unit };
    });
    await this.audit.record({
      userId: caller.user.id,
      action: dto.kind satisfies StockMoveKind,
      entityType: ASSET_ENTITY,
      entityId: id,
      diff: { code: done.code, amount: round2(dto.amount), quantity: { from: done.from, to: done.to }, ...(done.unit && { unit: done.unit }), ...(dto.note && { note: dto.note }) },
    });
    return this.assets.get(done.code, caller);
  }

  /** POST /assets/:code/maintenance: an entry of its maintenance log by hand; its status doesn't change. */
  async addMaintenance(code: string, dto: MaintenanceDto, caller: AssetsCaller): Promise<AssetView> {
    if (dto.cost !== undefined && dto.cost !== null && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const today = todayInCairo();
    const input = { kind: dto.kind, on: dto.on ?? today, vendor: dto.vendor ?? null, cost: dto.cost ?? null, notes: dto.notes ?? null };
    const problems = maintenanceProblems(input, today);
    if (problems.length) throw new BadRequestException(problems);
    const { id } = await this.assets.idOf(code);
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id }, select: { code: true, group: true, status: true } });
    if (a.group === 'consumable') throw new ConflictException(`${a.code} is a consumable: it has no maintenance log.`);
    if (a.status === 'disposed') throw new ConflictException(`${a.code} is disposed: its maintenance log is closed.`);
    const entry = await this.prisma.assetMaintenance.create({
      data: { assetId: id, on: toDateOnly(input.on), kind: input.kind, vendor: input.vendor, cost: input.cost, notes: input.notes, createdById: caller.user.id },
      select: { id: true },
    });
    await this.audit.record({
      userId: caller.user.id,
      action: 'maintenance',
      entityType: ASSET_ENTITY,
      entityId: id,
      diff: { code: a.code, entry: entry.id, kind: input.kind, on: input.on, ...(input.vendor && { vendor: input.vendor }), ...(input.cost !== null && { cost: 'set' }), ...(input.notes && { notes: input.notes }) },
    });
    return this.assets.get(a.code, caller);
  }

  /**
   * POST /assets/:code/dispose (an Assets manager): disposed of, with its book value on the day kept; out of its kit, its
   * attached assets detached, and it from its main one. The answer: the asset, and what else it did.
   */
  async dispose(code: string, dto: DisposeDto, caller: AssetsCaller): Promise<{ asset: AssetView; result: DisposalResult }> {
    if (dto.amount !== undefined && dto.amount !== null && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const today = todayInCairo();
    const input: DisposalInput = { method: dto.method, on: dto.on ?? today, amount: dto.amount ?? null, approvedBy: dto.approvedBy, notes: dto.notes ?? null };
    const done = await this.disposeOne(code, input, caller, { threshold: await this.settings.threshold(), today });
    return { asset: await this.assets.get(done.code, caller), result: done.result };
  }

  /**
   * POST /assets/bulk-dispose (owner, 25 October 2026: Dispose selected on All Assets, for those Delete selected skips),
   * an Assets manager's: each asset ticked goes through dispose's rules, each in its own transaction with its rows held
   * and audited as one disposed of on its page; the method, day, approver and note the same for all, checked once (no
   * amount: Finance sets each one's later). Those it refuses (in custody, a consumable, disposed already, a day before its
   * purchase, not found) are skipped with the reason; the others stay disposed of whatever happens to the next.
   */
  async bulkDispose(dto: BulkDisposeDto, caller: AssetsCaller): Promise<BulkDisposeResult> {
    const today = todayInCairo();
    const input: DisposalInput = { method: dto.method, on: dto.date ?? today, amount: null, approvedBy: dto.approvedBy, notes: dto.note ?? null };
    const problems = disposalProblems(input, today);
    if (problems.length) throw new BadRequestException(problems);
    const day = { threshold: await this.settings.threshold(), today };
    const out: BulkDisposeResult = { disposed: [], skipped: [] };
    for (const code of bulkCodes(dto.codes)) {
      try {
        const done = await this.disposeOne(code, input, caller, day);
        out.disposed.push({ code: done.code, name: done.name, ...done.result });
      } catch (err) {
        const reason = skipReason(err, code);
        if (reason === null) throw err;
        out.skipped.push({ code, reason });
      }
    }
    return out;
  }

  /** dispose's rules for one asset, by its code: disposed of in a transaction with its rows held, and audited. */
  private async disposeOne(code: string, input: DisposalInput, caller: AssetsCaller, day: { threshold: number; today: string }) {
    const { threshold, today } = day;
    const { id } = await this.assets.idOf(code);
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${id}::uuid OR parent_asset_id = ${id}::uuid ORDER BY id FOR UPDATE`;
      const a = await tx.asset.findUniqueOrThrow({
        where: { id },
        select: {
          code: true,
          name: true,
          group: true,
          status: true,
          assetClass: true,
          purchaseDate: true,
          purchasePrice: true,
          usefulLifeYears: true,
          kit: { select: { code: true } },
          parent: { select: { code: true } },
          attached: { select: { id: true, code: true }, orderBy: { code: 'asc' } },
        },
      });
      const refused = disposeProblem(a);
      if (refused) throw new ConflictException(refused);
      const problems = disposalProblems(input, today, fromDateOnly(a.purchaseDate));
      if (problems.length) throw new BadRequestException(problems);
      const book = bookValue({ purchasePrice: num(a.purchasePrice), purchaseDate: fromDateOnly(a.purchaseDate), usefulLifeYears: a.usefulLifeYears, assetClass: a.assetClass }, threshold, input.on);
      await tx.asset.update({
        where: { id },
        data: {
          status: 'disposed',
          disposalMethod: input.method,
          disposedOn: toDateOnly(input.on),
          disposalAmount: input.amount,
          disposalBookValue: book.amount,
          disposalApprovedBy: input.approvedBy,
          disposalNotes: input.notes,
          disposedById: caller.user.id,
          kitId: null,
          parentAssetId: null,
        },
      });
      if (a.attached.length) await tx.asset.updateMany({ where: { parentAssetId: id }, data: { parentAssetId: null } });
      return { code: a.code, name: a.name, from: a.status, book, result: { leftKit: a.kit?.code ?? null, detached: a.attached.map((x) => x.code), detachedFrom: a.parent?.code ?? null } satisfies DisposalResult, attached: a.attached };
    });

    await this.audit.record({
      userId: caller.user.id,
      action: 'dispose',
      entityType: ASSET_ENTITY,
      entityId: id,
      diff: {
        code: done.code,
        status: { from: done.from, to: 'disposed' },
        disposalMethod: input.method,
        disposedOn: input.on,
        disposalApprovedBy: input.approvedBy,
        ...(input.notes && { disposalNotes: input.notes }),
        ...(input.amount !== null && { disposalAmount: 'set' }),
        ...(done.book.amount !== null && { disposalBookValue: 'kept' }),
        ...(done.result.leftKit && { leftKit: done.result.leftKit }),
        ...(done.result.detached.length && { detached: done.result.detached }),
        ...(done.result.detachedFrom && { detachedFrom: done.result.detachedFrom }),
      },
    });
    for (const x of done.attached) {
      await this.audit.record({ userId: caller.user.id, action: 'detach', entityType: ASSET_ENTITY, entityId: x.id, diff: { code: x.code, attachedTo: { from: done.code, to: null }, reason: 'disposed' } });
    }
    return { code: done.code, name: done.name, result: done.result };
  }

  /** PATCH /assets/:code/disposal: the amount received, set or changed later by the CEO, Finance or a Super Admin. */
  async setDisposalAmount(code: string, dto: DisposalAmountDto, caller: AssetsCaller): Promise<AssetView> {
    if (!caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    const { id } = await this.assets.idOf(code);
    const a = await this.prisma.asset.findUniqueOrThrow({ where: { id }, select: { code: true, status: true, disposalAmount: true } });
    if (a.status !== 'disposed') throw new ConflictException(`${a.code} isn’t disposed of.`);
    const amount = dto.amount ?? null;
    if (num(a.disposalAmount) !== amount) {
      await this.prisma.asset.update({ where: { id }, data: { disposalAmount: amount } });
      await this.audit.record({ userId: caller.user.id, action: 'update_values', entityType: ASSET_ENTITY, entityId: id, diff: { code: a.code, disposalAmount: 'changed' } });
    }
    return this.assets.get(a.code, caller);
  }
}
