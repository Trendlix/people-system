import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { accessoriesProblems, accessoriesText, attachProblem, normalAssetCode, tidyAccessories, type AssetView } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetsCaller } from './assets-access.js';
import { lockSerials, serialProblems } from './asset-serials.js';
import { accessoryRows, ASSET_ENTITY, AssetsService, mainAssetByCode } from './assets.service.js';
import type { AccessoriesDto } from './asset-upkeep.dto.js';

// Accessories on an asset's page (owner, 22 October 2026: "and for the assets, i think we might need to add accessories
// under assets, like laptop charger under the charger, DJI ronin accessories , etc..."; asked how, "Both kinds";
// packages/shared asset-accessories.ts), a custodian's or a manager's:
// - the checklist: the small things that come with it, replaced as a whole (in order), at most 30 lines, never on a
//   consumable or a disposed asset; a custody item keeps what went out with it, so changing it never changes a record;
// - attaching: an asset of its own attached to a main one (one level only, never to itself, never a consumable, never a
//   disposed one), or detached. Both rows held while it changes, so two people attaching at once can't make two levels.
// Audited on the asset ('asset'), the checklist in words, attaching on both assets.

@Injectable()
export class AssetAccessoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
  ) {}

  /** PUT /assets/:code/accessories: its checklist replaced (an empty list clears it). */
  async setAccessories(code: string, dto: AccessoriesDto, caller: AssetsCaller): Promise<AssetView> {
    const { id } = await this.assets.idOf(code);
    const list = tidyAccessories(dto.items);
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.asset.findUniqueOrThrow({
        where: { id },
        select: { code: true, group: true, status: true, serial: true, accessories: { select: { name: true, quantity: true, serial: true }, orderBy: { position: 'asc' } } },
      });
      if (a.status === 'disposed') throw new ConflictException(`${a.code} is disposed: its accessories can’t change.`);
      const problems = accessoriesProblems(list, a.group);
      if (problems.length) throw new BadRequestException(problems);
      // a line's serial no other asset's or accessory's, nor its own asset's (22 October 2026)
      await lockSerials(tx);
      const serials = await serialProblems(tx, null, list, { asset: id, ownSerial: a.serial });
      if (serials.length) throw new BadRequestException(serials);
      await tx.assetAccessory.deleteMany({ where: { assetId: id } });
      if (list.length) await tx.assetAccessory.createMany({ data: accessoryRows(id, list) });
      return { code: a.code, before: accessoriesText(a.accessories), after: accessoriesText(list) };
    });
    if (done.before !== done.after) {
      await this.audit.record({
        userId: caller.user.id,
        action: 'accessories',
        entityType: ASSET_ENTITY,
        entityId: id,
        diff: { code: done.code, accessories: { from: done.before || null, to: done.after || null } },
      });
    }
    return this.assets.get(done.code, caller);
  }

  /** PATCH /assets/:code/parent: attached to the main asset coded `parentCode`, or detached (null). */
  async attach(code: string, parentCode: string | null | undefined, caller: AssetsCaller): Promise<AssetView> {
    const item = await this.assets.idOf(code);
    const wanted = parentCode ? normalAssetCode(parentCode) : null;
    const main = wanted ? await mainAssetByCode(this.prisma, wanted) : null;
    if (wanted && !main) throw new BadRequestException([`No asset has the code ${wanted}: check the main asset’s code.`]);

    const done = await this.prisma.$transaction(async (tx) => {
      // both rows held, in order, so two attachments at once can't nest
      const ids = [item.id, ...(main ? [main.id] : [])].sort();
      await tx.$queryRaw`SELECT id FROM assets WHERE id IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) ORDER BY id FOR UPDATE`;
      const side = async (id: string) => {
        const r = await tx.asset.findUniqueOrThrow({
          where: { id },
          select: { id: true, code: true, group: true, status: true, parentAssetId: true, parent: { select: { code: true } }, _count: { select: { attached: true } } },
        });
        return { id: r.id, code: r.code, group: r.group, status: r.status, parentId: r.parentAssetId, attached: r._count.attached, parentCode: r.parent?.code ?? null };
      };
      const it = await side(item.id);
      if (!main) {
        if (!it.parentId) throw new ConflictException(`${it.code} isn’t attached to another asset.`);
        await tx.asset.update({ where: { id: it.id }, data: { parentAssetId: null } });
        return { it, from: it.parentCode, fromId: it.parentId, to: null as string | null, toId: null as string | null };
      }
      const m = await side(main.id);
      const problem = attachProblem(it, m);
      if (problem) throw new ConflictException(problem);
      await tx.asset.update({ where: { id: it.id }, data: { parentAssetId: m.id } });
      return { it, from: it.parentCode, fromId: it.parentId, to: m.code, toId: m.id };
    });

    await this.audit.record({
      userId: caller.user.id,
      action: done.to ? 'attach' : 'detach',
      entityType: ASSET_ENTITY,
      entityId: done.it.id,
      diff: { code: done.it.code, attachedTo: { from: done.from, to: done.to } },
    });
    for (const [id, mainCode, action] of [
      [done.fromId, done.from, 'detach'],
      [done.toId, done.to, 'attach'],
    ] as const) {
      if (id && mainCode) await this.audit.record({ userId: caller.user.id, action, entityType: ASSET_ENTITY, entityId: id, diff: { code: mainCode, [action === 'attach' ? 'attached' : 'detached']: done.it.code } });
    }
    return this.assets.get(done.it.code, caller);
  }
}
