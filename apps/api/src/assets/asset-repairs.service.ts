import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assetActionProblem, ASSETS_REFUSALS, normalAssetCode, type AssetAction, type AssetStatus, type AssetView, type MaintenanceEvent } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { todayInCairo, toDateOnly } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetsCaller } from './assets-access.js';
import { ASSET_ENTITY, ASSET_NOT_FOUND, AssetsService } from './assets.service.js';
import type { LostFoundDto, RepairDto } from './custody.dto.js';

// An asset's page actions besides editing it and handing it over (Assets step 3, the brief: "send to repair / back from
// repair (a maintenance entry), mark lost / found"), for a custodian or a manager: sent to repair (an available one),
// with an entry in its maintenance log; back from repair (one under repair), available again, with another entry, its
// cost a value (from the CEO, Finance or a Super Admin only); marked lost (an available one or one under repair: one in
// custody is lost by receiving it back missing) and found (a lost one, available again). The status rules are
// packages/shared assetActionProblem; the asset's row is held while it changes, so two people acting at once don't both
// change it. Audited on the asset, the cost only as the fact that it was set. The fuller repairs come with step 4.

type Act = Exclude<AssetAction, 'hand_over'>;

const NEXT: Record<Act, AssetStatus> = { send_to_repair: 'repair', back_from_repair: 'available', mark_lost: 'lost', mark_found: 'available' };

/** The maintenance entry each action keeps; none for lost and found. */
const EVENT: Partial<Record<Act, MaintenanceEvent>> = { send_to_repair: 'sent_to_repair', back_from_repair: 'back_from_repair' };

@Injectable()
export class AssetRepairsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
  ) {}

  repair(code: string, dto: RepairDto, caller: AssetsCaller, back: boolean): Promise<AssetView> {
    return this.act(code, back ? 'back_from_repair' : 'send_to_repair', dto, caller);
  }

  lostOrFound(code: string, dto: LostFoundDto, caller: AssetsCaller, found: boolean): Promise<AssetView> {
    return this.act(code, found ? 'mark_found' : 'mark_lost', dto, caller);
  }

  private async act(code: string, action: Act, dto: RepairDto | LostFoundDto, caller: AssetsCaller): Promise<AssetView> {
    const repair = dto as RepairDto;
    if (repair.cost !== undefined && repair.cost !== null && !caller.values) throw new ForbiddenException(ASSETS_REFUSALS.values);
    if (!EVENT[action] && (repair.cost != null || repair.vendor != null || repair.on != null)) throw new BadRequestException(['Only a repair has a date, a vendor and a cost.']);
    const today = todayInCairo();
    if (repair.on && repair.on > today) throw new BadRequestException(['The date can’t be in the future.']);
    const kept = await this.prisma.asset.findUnique({ where: { code: normalAssetCode(code) }, select: { id: true } });
    if (!kept) throw new NotFoundException(ASSET_NOT_FOUND);

    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${kept.id}::uuid FOR UPDATE`;
      const a = await tx.asset.findUniqueOrThrow({ where: { id: kept.id }, select: { id: true, code: true, status: true, group: true } });
      const problem = assetActionProblem(action, a);
      if (problem) throw new ConflictException(problem);
      await tx.asset.update({ where: { id: a.id }, data: { status: NEXT[action] } });
      const event = EVENT[action];
      if (event) {
        await tx.assetMaintenance.create({
          data: { assetId: a.id, on: toDateOnly(repair.on ?? today), kind: 'repair', event, vendor: repair.vendor ?? null, cost: repair.cost ?? null, notes: repair.notes ?? null, createdById: caller.user.id },
        });
      }
      return a;
    });

    await this.audit.record({
      userId: caller.user.id,
      action,
      entityType: ASSET_ENTITY,
      entityId: done.id,
      diff: {
        code: done.code,
        status: { from: done.status, to: NEXT[action] },
        ...(repair.on && { on: repair.on }),
        ...(repair.vendor && { vendor: repair.vendor }),
        ...(repair.cost != null && { cost: 'set' }),
        ...(dto.notes && { notes: dto.notes }),
      },
    });
    return this.assets.get(done.code, caller);
  }
}
