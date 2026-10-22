import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ASSET_COUNT_LIMITS,
  ASSET_COUNT_RESULTS,
  assetActionProblem,
  assetsAccessAtLeast,
  codeFromLabel,
  countFigures,
  countGroupLabel,
  countResultOf,
  countScopeProblems,
  statusAfterCount,
  type AssetCountLineView,
  type AssetCountResult,
  type AssetCountScopeInput,
  type AssetCountScopeKind,
  type AssetCountScopeView,
  type AssetCountSheetView,
  type AssetCountsView,
  type AssetCountSummaryView,
  type AssetCountView,
  type AssetGroup,
  type AssetStatus,
  type AssetType,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssetReportsService } from './asset-reports.service.js';
import type { AssetsCaller } from './assets-access.js';
import { ASSET_ENTITY } from './assets.service.js';
import type { AssetCountDto, MarkLostFromCountDto } from './asset-counts.dto.js';

// The counts (Assets step 5; owner, 22 October 2026: "Assets step 5 (stock counts, label sheets, the Assets dashboard,
// exports) … work on this"; the spec's record_count and §6 rules 5–6; packages/shared asset-counts.ts): a group, a room
// or a kit counted by ticking what is there. The sheet is what the scope has now, disposed ones aside (lost ones in, so
// one found comes back); saving it, in one transaction with those assets held: in custody → out, ticked → found, else
// missing; a lost one found is available again. A missing one is marked lost later, on its own ("Mark lost", spec
// §6.5). Anyone with Assets access reads the sheets, the schedule and the counts; a custodian or a manager counts and
// marks lost. A C-level holder's name is left out for those who don't see them (the custody pages' rule). Audited: the
// count ('asset_count'), and each asset whose status it changed ('asset').

export const COUNT_ENTITY = 'asset_count';
export const COUNT_NOT_FOUND = 'Count not found.';

const BRIEF = {
  id: true,
  code: true,
  name: true,
  group: true,
  type: true,
  status: true,
  serial: true,
  room: { select: { id: true, name: true } },
  kit: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.AssetSelect;

type BriefRow = Prisma.AssetGetPayload<{ select: typeof BRIEF }>;

const brief = (a: BriefRow) => ({
  code: a.code,
  name: a.name,
  group: a.group as AssetGroup,
  type: a.type as AssetType,
  status: a.status as AssetStatus,
  serial: a.serial,
  room: a.room,
  kit: a.kit,
});

const USER = { select: { id: true, email: true } } as const;

const COUNT_SELECT = {
  id: true,
  scopeKind: true,
  scopeGroup: true,
  scopeLabel: true,
  scopeRoom: { select: { id: true, name: true } },
  scopeKit: { select: { id: true, code: true, name: true } },
  countedAt: true,
  countedBy: USER,
  notes: true,
  expected: true,
  lines: { select: { result: true, lostMarkedAt: true } },
} as const satisfies Prisma.AssetCountSelect;

type CountRow = Prisma.AssetCountGetPayload<{ select: typeof COUNT_SELECT }>;

/** The order of a count's lines: missing first, then out, then found. */
const RESULT_ORDER: Record<AssetCountResult, number> = { missing: 0, out: 1, found: 2 };

/** A scope's where, its words and its row's columns. */
interface Scope {
  where: Prisma.AssetWhereInput;
  view: AssetCountScopeView;
  data: { scopeKind: AssetCountScopeKind; scopeGroup: string | null; scopeRoomId: string | null; scopeKitId: string | null; scopeLabel: string };
}

type Db = PrismaService | Prisma.TransactionClient;

function scopeViewOf(r: Pick<CountRow, 'scopeKind' | 'scopeGroup' | 'scopeLabel' | 'scopeRoom' | 'scopeKit'>): AssetCountScopeView {
  return {
    kind: r.scopeKind as AssetCountScopeKind,
    group: (r.scopeGroup as AssetGroup | null) ?? null,
    room: r.scopeRoom,
    kit: r.scopeKit,
    label: r.scopeLabel,
  };
}

@Injectable()
export class AssetCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly reports: AssetReportsService,
  ) {}

  /** The scope as sent: its group, or its room or kit (404 when not there), with its words. */
  private async scopeOf(s: AssetCountScopeInput, db: Db = this.prisma): Promise<Scope> {
    const problems = countScopeProblems(s);
    if (problems.length) throw new BadRequestException(problems);
    if (s.kind === 'group') {
      const group = s.group!;
      const label = countGroupLabel(group);
      return {
        where: { group },
        view: { kind: 'group', group, room: null, kit: null, label },
        data: { scopeKind: 'group', scopeGroup: group, scopeRoomId: null, scopeKitId: null, scopeLabel: label },
      };
    }
    if (s.kind === 'room') {
      const room = await db.assetRoom.findUnique({ where: { id: s.roomId! }, select: { id: true, name: true } });
      if (!room) throw new NotFoundException('Room not found.');
      return {
        where: { roomId: room.id },
        view: { kind: 'room', group: null, room, kit: null, label: room.name },
        data: { scopeKind: 'room', scopeGroup: null, scopeRoomId: room.id, scopeKitId: null, scopeLabel: room.name },
      };
    }
    const kit = await db.assetKit.findUnique({ where: { id: s.kitId! }, select: { id: true, code: true, name: true } });
    if (!kit) throw new NotFoundException('Kit not found.');
    const label = `${kit.code} · ${kit.name}`;
    return {
      where: { kitId: kit.id },
      view: { kind: 'kit', group: null, room: null, kit, label },
      data: { scopeKind: 'kit', scopeGroup: null, scopeRoomId: null, scopeKitId: kit.id, scopeLabel: label },
    };
  }

  /** GET /assets/counts/sheet: what a count of the scope expects now, by code, with who holds those in custody. */
  async sheet(s: AssetCountScopeInput, caller: AssetsCaller): Promise<AssetCountSheetView> {
    const scope = await this.scopeOf(s);
    const hidden = new Set(await this.confidential.hiddenFrom(caller.user));
    const rows = await this.prisma.asset.findMany({
      where: { ...scope.where, status: { not: 'disposed' } },
      select: { ...BRIEF, holder: { select: { id: true, employeeCode: true, fullNameEn: true } } },
      orderBy: { code: 'asc' },
    });
    return { scope: scope.view, items: rows.map((r) => ({ ...brief(r), holder: r.holder && !hidden.has(r.holder.id) ? r.holder : null })) };
  }

  /**
   * POST /assets/counts: the count saved (spec record_count): each asset the scope expects with its result, a lost one
   * found available again. 400 when nothing is there to count, or a code ticked isn't one of the scope's.
   */
  async record(dto: AssetCountDto, caller: AssetsCaller): Promise<AssetCountView> {
    const problems = countScopeProblems(dto);
    if (problems.length) throw new BadRequestException(problems);
    const unread = dto.found.filter((t) => codeFromLabel(t) === null);
    if (unread.length) throw new BadRequestException(unread.slice(0, 5).map((t) => `“${t.slice(0, 40)}” isn’t an asset’s code.`));
    const ticked = new Set(dto.found.map((t) => codeFromLabel(t)!));

    const done = await this.prisma.$transaction(async (tx) => {
      const scope = await this.scopeOf(dto, tx);
      const ids = (await tx.asset.findMany({ where: { ...scope.where, status: { not: 'disposed' } }, select: { id: true } })).map((a) => a.id);
      if (!ids.length) throw new BadRequestException([`Nothing to count: ${scope.view.label} has no assets.`]);
      // the scope's assets held while counted, so a handover or a return at the same moment waits
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      const assets = await tx.asset.findMany({
        where: { id: { in: ids }, ...scope.where, status: { not: 'disposed' } },
        select: { id: true, code: true, status: true },
        orderBy: { code: 'asc' },
      });
      const codes = new Set(assets.map((a) => a.code));
      const elsewhere = [...ticked].filter((c) => !codes.has(c));
      if (elsewhere.length) {
        throw new BadRequestException(
          elsewhere.slice(0, 5).map((c) => `${c} isn’t counted with ${scope.view.label}: untick it, and count it where it is kept.`),
        );
      }
      const lines = assets.map((a) => ({ asset: a, result: countResultOf(a.status, ticked.has(a.code)) }));
      const made = await tx.assetCount.create({
        data: {
          ...scope.data,
          countedById: caller.user.id,
          notes: dto.notes ?? null,
          expected: lines.length,
          lines: { createMany: { data: lines.map((l) => ({ assetId: l.asset.id, result: l.result })) } },
        },
        select: { id: true },
      });
      const foundAgain = lines.filter((l) => statusAfterCount(l.asset.status as AssetStatus, l.result) !== l.asset.status);
      if (foundAgain.length) await tx.asset.updateMany({ where: { id: { in: foundAgain.map((l) => l.asset.id) } }, data: { status: 'available' } });
      return { id: made.id, scope, lines, foundAgain };
    });

    const figures = countFigures(done.lines);
    await this.audit.record({
      userId: caller.user.id,
      action: 'count',
      entityType: COUNT_ENTITY,
      entityId: done.id,
      diff: {
        scope: done.scope.view.label,
        expected: figures.expected,
        found: figures.found,
        missing: figures.missing,
        out: figures.out,
        ...(done.foundAgain.length && { foundAgain: done.foundAgain.map((l) => l.asset.code) }),
        ...(dto.notes && { notes: dto.notes }),
      },
    });
    for (const l of done.foundAgain) {
      await this.audit.record({
        userId: caller.user.id,
        action: 'mark_found',
        entityType: ASSET_ENTITY,
        entityId: l.asset.id,
        diff: { code: l.asset.code, status: { from: 'lost', to: 'available' }, count: done.scope.view.label },
      });
    }
    const view = await this.get(done.id, caller);
    return { ...view, foundAgain: done.foundAgain.map((l) => l.asset.code) };
  }

  /** GET /assets/counts: the groups' schedule (counts due) and the counts made, newest first. */
  async list(page: number | undefined): Promise<AssetCountsView> {
    const size = ASSET_COUNT_LIMITS.pageSize;
    const at = Math.max(1, page ?? 1);
    const [schedule, total, rows] = await Promise.all([
      this.reports.countsDue(),
      this.prisma.assetCount.count(),
      this.prisma.assetCount.findMany({ select: COUNT_SELECT, orderBy: { countedAt: 'desc' }, skip: (at - 1) * size, take: size }),
    ]);
    const names = await userNames(this.prisma, rows.map((r) => r.countedBy));
    return { schedule, history: rows.map((r) => this.summaryOf(r, names)), total, page: at, pageSize: size };
  }

  private summaryOf(r: CountRow, names: Map<string, { name: string }>): AssetCountSummaryView {
    const figures = countFigures(r.lines.map((l) => ({ result: l.result, lostMarked: l.lostMarkedAt !== null })));
    return {
      id: r.id,
      scope: scopeViewOf(r),
      countedAt: r.countedAt.toISOString(),
      countedBy: r.countedBy ? { email: r.countedBy.email, name: names.get(r.countedBy.id)?.name ?? null } : null,
      expected: r.expected,
      found: figures.found,
      missing: figures.missing,
      out: figures.out,
      lostMarked: figures.lostMarked,
    };
  }

  /** GET /assets/counts/:id: the count with each asset's line, missing first; 404 when not there. */
  async get(id: string, caller: AssetsCaller): Promise<AssetCountView> {
    const row = await this.prisma.assetCount.findUnique({ where: { id }, select: COUNT_SELECT });
    if (!row) throw new NotFoundException(COUNT_NOT_FOUND);
    const lines = await this.prisma.assetCountLine.findMany({
      where: { countId: id },
      select: { result: true, lostMarkedAt: true, lostMarkedBy: USER, asset: { select: BRIEF } },
    });
    const names = await userNames(this.prisma, [row.countedBy, ...lines.map((l) => l.lostMarkedBy)]);
    const marks = assetsAccessAtLeast(caller.access, 'custodian');
    const views: AssetCountLineView[] = lines
      .map((l) => {
        const result = (ASSET_COUNT_RESULTS as readonly string[]).includes(l.result) ? (l.result as AssetCountResult) : 'missing';
        return {
          asset: brief(l.asset),
          result,
          lostMarkedAt: l.lostMarkedAt?.toISOString() ?? null,
          lostMarkedBy: l.lostMarkedBy ? { email: l.lostMarkedBy.email, name: names.get(l.lostMarkedBy.id)?.name ?? null } : null,
          canMarkLost: marks && result === 'missing' && l.lostMarkedAt === null && assetActionProblem('mark_lost', l.asset) === null,
        };
      })
      .sort((a, b) => RESULT_ORDER[a.result] - RESULT_ORDER[b.result] || a.asset.code.localeCompare(b.asset.code));
    return { ...this.summaryOf(row, names), notes: row.notes, lines: views, foundAgain: [] };
  }

  /**
   * POST /assets/counts/:id/lines/:code/lost: a missing asset of the count marked lost (spec §6.5, a deliberate step of
   * its own): only one still missing on it, not marked already, and available or under repair now (one handed over or
   * found since isn't lost). Audited on the asset and on the count.
   */
  async markLost(id: string, rawCode: string, dto: MarkLostFromCountDto, caller: AssetsCaller): Promise<AssetCountView> {
    const code = codeFromLabel(rawCode);
    if (!code) throw new NotFoundException('Asset not found on this count.');
    const done = await this.prisma.$transaction(async (tx) => {
      const count = await tx.assetCount.findUnique({ where: { id }, select: { id: true, scopeLabel: true } });
      if (!count) throw new NotFoundException(COUNT_NOT_FOUND);
      const line = await tx.assetCountLine.findFirst({ where: { countId: id, asset: { code } }, select: { id: true, result: true, lostMarkedAt: true, assetId: true } });
      if (!line) throw new NotFoundException('Asset not found on this count.');
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${line.assetId}::uuid FOR UPDATE`;
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: line.assetId }, select: { id: true, code: true, status: true, group: true } });
      if (line.result !== 'missing') throw new ConflictException(`${asset.code} wasn’t missing on this count: only a missing asset is marked lost.`);
      if (line.lostMarkedAt) throw new ConflictException(`${asset.code} was marked lost already.`);
      const problem = assetActionProblem('mark_lost', asset);
      if (problem) throw new ConflictException(problem);
      const at = new Date();
      await tx.asset.update({ where: { id: asset.id }, data: { status: 'lost' } });
      await tx.assetCountLine.update({ where: { id: line.id }, data: { lostMarkedAt: at, lostMarkedById: caller.user.id } });
      return { count, asset };
    });
    await this.audit.record({
      userId: caller.user.id,
      action: 'mark_lost',
      entityType: ASSET_ENTITY,
      entityId: done.asset.id,
      diff: { code: done.asset.code, status: { from: done.asset.status, to: 'lost' }, count: done.count.scopeLabel, ...(dto.notes && { notes: dto.notes }) },
    });
    await this.audit.record({ userId: caller.user.id, action: 'mark_lost', entityType: COUNT_ENTITY, entityId: done.count.id, diff: { code: done.asset.code, scope: done.count.scopeLabel } });
    return this.get(id, caller);
  }
}
