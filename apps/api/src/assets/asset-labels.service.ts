import { BadRequestException, Injectable } from '@nestjs/common';
import { codeFromLabel, LABEL_SHEET, type AssetGroup, type AssetLabelChoice, type AssetStatus } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetsCaller } from './assets-access.js';
import type { AssetLabelledDto, AssetLabelsQueryDto } from './asset-counts.dto.js';
import { ASSET_ENTITY } from './assets.service.js';

// The label sheets (Assets step 5; owner, 22 October 2026: "label sheets"; the spec's §5: "labels (A4, 3 × 8 labels of
// 63 × 30 mm …; after printing set labeled_at)"): the assets whose labels may print, chosen by "Not labelled yet", a
// group, a room, a kit or a search (or exactly the codes asked, for the sheets to print), disposed ones aside; and the
// labels printed marked as stuck on, asked for after printing rather than on Print, so a sheet that didn't print isn't
// counted. Anyone with Assets access reads the choices; a custodian or a manager marks them. Each asset marked is in the
// audit log, as a single label is ('label').

const LIMIT = 500;

@Injectable()
export class AssetLabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** GET /assets/labels: the assets the sheets may print, by code; with `codes`, exactly those (in the order asked). */
  async choices(query: AssetLabelsQueryDto): Promise<AssetLabelChoice[]> {
    const select = {
      code: true,
      name: true,
      group: true,
      status: true,
      labeledAt: true,
      room: { select: { id: true, name: true } },
      kit: { select: { id: true, code: true, name: true } },
    } as const satisfies Prisma.AssetSelect;
    const view = (r: Prisma.AssetGetPayload<{ select: typeof select }>): AssetLabelChoice => ({
      code: r.code,
      name: r.name,
      group: r.group as AssetGroup,
      status: r.status as AssetStatus,
      room: r.room,
      kit: r.kit,
      labeledAt: r.labeledAt?.toISOString() ?? null,
    });
    if (query.codes?.length) {
      const codes = [...new Set(query.codes.map((c) => codeFromLabel(c)).filter((c): c is string => c !== null))].slice(0, LABEL_SHEET.maxLabels);
      const rows = await this.prisma.asset.findMany({ where: { code: { in: codes }, status: { not: 'disposed' } }, select });
      const byCode = new Map(rows.map((r) => [r.code, r]));
      return codes.flatMap((c) => (byCode.has(c) ? [view(byCode.get(c)!)] : []));
    }
    const contains = query.q ? { contains: query.q, mode: 'insensitive' as const } : null;
    const rows = await this.prisma.asset.findMany({
      where: {
        status: { not: 'disposed' },
        ...(query.unlabelled && { labeledAt: null }),
        ...(query.group && { group: query.group }),
        ...(query.roomId && { roomId: query.roomId }),
        ...(query.kitId && { kitId: query.kitId }),
        ...(contains && { OR: [{ name: contains }, { code: contains }, { serial: contains }] }),
      },
      select,
      orderBy: { code: 'asc' },
      take: LIMIT,
    });
    return rows.map(view);
  }

  /** POST /assets/labels/labelled: the labels printed marked as stuck on now. 400 for a code not in the register. */
  async labelled(dto: AssetLabelledDto, caller: AssetsCaller): Promise<{ labelled: string[]; at: string }> {
    const read = dto.codes.map((c) => ({ sent: c, code: codeFromLabel(c) }));
    const unread = read.filter((r) => r.code === null);
    if (unread.length) throw new BadRequestException(unread.slice(0, 5).map((r) => `“${r.sent.slice(0, 40)}” isn’t an asset’s code.`));
    const codes = [...new Set(read.map((r) => r.code!))];
    if (!codes.length) throw new BadRequestException(['Choose the labels printed.']);
    const rows = await this.prisma.asset.findMany({ where: { code: { in: codes }, status: { not: 'disposed' } }, select: { id: true, code: true } });
    const known = new Set(rows.map((r) => r.code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length) throw new BadRequestException(missing.slice(0, 5).map((c) => `${c} isn’t in the register, or was disposed of.`));
    const at = new Date();
    await this.prisma.asset.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { labeledAt: at } });
    for (const r of rows) {
      await this.audit.record({ userId: caller.user.id, action: 'label', entityType: ASSET_ENTITY, entityId: r.id, diff: { code: r.code, labeledAt: at.toISOString(), sheet: true } });
    }
    return { labelled: rows.map((r) => r.code).sort(), at: at.toISOString() };
  }
}
