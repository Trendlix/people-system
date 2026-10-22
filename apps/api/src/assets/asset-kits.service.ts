import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KIT_CODE_PREFIX, kitCode, kitItemProblem, kitStatusOf, normalAssetCode, type AssetKitView, type AssetStatus } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextCodeNumber } from './asset-codes.js';
import type { KitItemsDto } from './asset-upkeep.dto.js';
import { ASSET_ENTITY } from './assets.service.js';
import type { CreateKitDto, UpdateKitDto } from './assets.dto.js';

// The production kits (spec §2.3: PK-KIT-A, PK-KIT-B …): production kit assets packed together. Step 1 made them and
// named them, so a kit asset can be put in one and the register filtered by one; step 3 hands a kit over (the kit
// quick-add). Step 4 (the owner's build order, 21 October 2026: "kits / stock / repairs / disposal"; spec §5: "Kit cards
// with items and status (Available / Partly out / Out); new kit from existing kit assets"): each kit with its assets
// and how it stands, and assets put in a kit or taken out of it from the kit's card (only production kit assets, never a
// disposed one; one in another kit moves). Everyone with Assets access reads them; a custodian or manager makes,
// renames and fills them. A kit's code is given in the transaction that saves it, from the same counters as the
// assets' ("PK-KIT-"), never changed, never given again. Every change in the audit log ('asset_kit', and each asset
// moved on its own).

export const KIT_ENTITY = 'asset_kit';
const KIT_NOT_FOUND = 'Kit not found.';

@Injectable()
export class AssetKitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every kit, by code, with its assets now (disposed ones are in none) and how it stands. */
  async list(): Promise<AssetKitView[]> {
    const kits = await this.prisma.assetKit.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        notes: true,
        assets: {
          where: { status: { not: 'disposed' } },
          select: { id: true, code: true, name: true, status: true, holder: { select: { fullNameEn: true } } },
          orderBy: { code: 'asc' },
        },
      },
    });
    // PK-KIT-B before PK-KIT-AA: shorter codes first, then in order
    return kits
      .map((k) => {
        const items = k.assets.map((a) => ({ id: a.id, code: a.code, name: a.name, status: a.status as AssetStatus, holder: a.holder?.fullNameEn ?? null }));
        return { id: k.id, code: k.code, name: k.name, notes: k.notes, assets: items.length, items, status: kitStatusOf(items) };
      })
      .sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
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

  /**
   * PATCH /assets/kits/:id/items: assets put in the kit (by id, or by code as typed) and taken out of it. Only production
   * kit assets that aren't disposed (kitItemProblem); one in another kit moves to this one, and says so in the audit log.
   * Refused as a whole, with every problem, when one can't go in.
   */
  async setItems(id: string, dto: KitItemsDto, userId: string): Promise<AssetKitView> {
    const kit = await this.prisma.assetKit.findUnique({ where: { id }, select: { id: true, code: true } });
    if (!kit) throw new NotFoundException(KIT_NOT_FOUND);
    const codes = [...new Set((dto.addCodes ?? []).map(normalAssetCode))];
    const addIds = [...new Set(dto.add ?? [])];
    const removeIds = [...new Set(dto.remove ?? [])];
    if (!codes.length && !addIds.length && !removeIds.length) throw new BadRequestException(['Choose the assets to add or take out.']);

    const done = await this.prisma.$transaction(async (tx) => {
      const where: Prisma.AssetWhereInput = { OR: [...(addIds.length ? [{ id: { in: addIds } }] : []), ...(codes.length ? [{ code: { in: codes } }] : [])] };
      const adding = addIds.length || codes.length ? await tx.asset.findMany({ where, select: { id: true, code: true, group: true, status: true, kitId: true, kit: { select: { code: true } } } }) : [];
      const problems: string[] = [];
      const found = new Set(adding.map((a) => a.code));
      for (const c of codes) if (!found.has(c)) problems.push(`No asset has the code ${c}.`);
      if (addIds.length && adding.filter((a) => addIds.includes(a.id)).length !== addIds.length) problems.push('Some of the assets chosen aren’t in the register. Reload the page and choose again.');
      for (const a of adding) {
        const p = kitItemProblem(a);
        if (p) problems.push(p);
      }
      const removing = removeIds.length ? await tx.asset.findMany({ where: { id: { in: removeIds } }, select: { id: true, code: true, kitId: true }, orderBy: { code: 'asc' } }) : [];
      for (const r of removing) if (r.kitId !== id) problems.push(`${r.code} isn’t in ${kit.code}.`);
      if (problems.length) throw new BadRequestException(problems);
      const added = adding.filter((a) => a.kitId !== id).sort((a, b) => a.code.localeCompare(b.code));
      if (added.length) await tx.asset.updateMany({ where: { id: { in: added.map((a) => a.id) } }, data: { kitId: id } });
      if (removing.length) await tx.asset.updateMany({ where: { id: { in: removing.map((r) => r.id) }, kitId: id }, data: { kitId: null } });
      return { added, removing };
    });

    if (done.added.length || done.removing.length) {
      await this.audit.record({
        userId,
        action: 'items',
        entityType: KIT_ENTITY,
        entityId: id,
        diff: { code: kit.code, ...(done.added.length && { added: done.added.map((a) => a.code) }), ...(done.removing.length && { removed: done.removing.map((r) => r.code) }) },
      });
      for (const a of done.added) {
        await this.audit.record({ userId, action: 'update', entityType: ASSET_ENTITY, entityId: a.id, diff: { code: a.code, kit: { from: a.kit?.code ?? null, to: kit.code } } });
      }
      for (const r of done.removing) {
        await this.audit.record({ userId, action: 'update', entityType: ASSET_ENTITY, entityId: r.id, diff: { code: r.code, kit: { from: kit.code, to: null } } });
      }
    }
    return this.view(id);
  }
}
