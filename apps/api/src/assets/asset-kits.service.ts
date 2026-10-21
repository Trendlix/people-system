import { Injectable, NotFoundException } from '@nestjs/common';
import { KIT_CODE_PREFIX, kitCode, type AssetKitView } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextCodeNumber } from './asset-codes.js';
import type { CreateKitDto, UpdateKitDto } from './assets.dto.js';

// The production kits (spec §2.3: PK-KIT-A, PK-KIT-B …): production kit assets packed together. Step 1 makes them and
// names them, so a kit asset can be put in one and the register filtered by one; handing a kit over and counting it
// come with custody and the counts (later steps). Everyone with Assets access reads them; a custodian or manager makes
// and renames them. A kit's code is given in the transaction that saves it, from the same counters as the assets'
// ("PK-KIT-"), never changed, never given again. Every change in the audit log ('asset_kit').

export const KIT_ENTITY = 'asset_kit';
const KIT_NOT_FOUND = 'Kit not found.';

@Injectable()
export class AssetKitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every kit, by code, with the assets in it now (disposed ones aside). */
  async list(): Promise<AssetKitView[]> {
    const [kits, counts] = await Promise.all([
      this.prisma.assetKit.findMany({ select: { id: true, code: true, name: true, notes: true } }),
      this.prisma.asset.groupBy({ by: ['kitId'], where: { kitId: { not: null }, status: { not: 'disposed' } }, _count: { _all: true } }),
    ]);
    const inKit = new Map(counts.map((c) => [c.kitId, c._count._all]));
    // PK-KIT-B before PK-KIT-AA: shorter codes first, then in order
    return kits.map((k) => ({ ...k, assets: inKit.get(k.id) ?? 0 })).sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
  }

  private async view(id: string): Promise<AssetKitView> {
    const view = (await this.list()).find((k) => k.id === id);
    if (!view) throw new NotFoundException(KIT_NOT_FOUND);
    return view;
  }

  async create(dto: CreateKitDto, userId: string): Promise<AssetKitView> {
    const kit = await this.prisma.$transaction(async (tx) => {
      const code = kitCode(await nextCodeNumber(tx, KIT_CODE_PREFIX));
      return tx.assetKit.create({ data: { code, name: dto.name, notes: dto.notes ?? null, createdById: userId }, select: { id: true, code: true } });
    });
    await this.audit.record({ userId, action: 'create', entityType: KIT_ENTITY, entityId: kit.id, diff: { code: kit.code, name: dto.name, ...(dto.notes && { notes: dto.notes }) } });
    return this.view(kit.id);
  }

  async update(id: string, dto: UpdateKitDto, userId: string): Promise<AssetKitView> {
    const before = await this.prisma.assetKit.findUnique({ where: { id }, select: { code: true, name: true, notes: true } });
    if (!before) throw new NotFoundException(KIT_NOT_FOUND);
    const diff = changes({ name: before.name, notes: before.notes }, { name: dto.name, notes: dto.notes });
    if (Object.keys(diff).length) {
      await this.prisma.assetKit.update({ where: { id }, data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.notes !== undefined && { notes: dto.notes }) } });
      await this.audit.record({ userId, action: 'update', entityType: KIT_ENTITY, entityId: id, diff: { code: before.code, ...diff } });
    }
    return this.view(id);
  }
}
