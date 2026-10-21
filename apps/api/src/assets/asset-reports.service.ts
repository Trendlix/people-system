import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ASSET_GROUPS,
  countDue,
  daysFromTo,
  needsReorder,
  type AssetBriefView,
  type AssetGroup,
  type AssetHolderReport,
  type AssetStatus,
  type AssetType,
  type CountDueView,
  type OverdueReturnView,
  type StockLevelView,
} from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { dayInCairo, fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

// What the Claude connector reads besides the register (step 2; owner, 21 October 2026: "i might link a claude account
// for the assets section only to fetch data"; packages/shared asset-drafts.ts), for anyone with Assets access: who holds
// what (by the person's name or code, only people who hold something), the shoots' custody past its return date, the
// consumables' stock and what needs reordering, and the counts due by group (spec §2.2: every so many days). No values:
// the money is never in these answers (a custody item's value stays the CEO's, Finance's and a Super Admin's). Disposed
// assets aside, as from every total. Since step 3 (custody, 21 October 2026) who holds what and the overdue returns are
// the custody records the handovers make; C-level people's are left out for anyone who doesn't see them (owner, 19
// October 2026: "make C level Employees details not visible to HR"), as the custody pages leave them out. The counts
// are recorded by a later step: until then they are all due.

const BRIEF = {
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

const brief = (a: BriefRow): AssetBriefView => ({
  code: a.code,
  name: a.name,
  group: a.group as AssetGroup,
  type: a.type as AssetType,
  status: a.status as AssetStatus,
  serial: a.serial,
  room: a.room,
  kit: a.kit,
});

const PERSON = { id: true, employeeCode: true, fullNameEn: true } as const;
const OPEN_CUSTODY = ['open', 'partial'];
const MAX_PEOPLE = 10;

@Injectable()
export class AssetReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** GET /assets/reports/holders?q=: the people matching who hold assets or have custody open, and what (10 at most). */
  async holders(q: string | undefined, user: SessionUser): Promise<AssetHolderReport[]> {
    const text = q?.trim() ?? '';
    if (text.length < 2) throw new BadRequestException(['Enter at least 2 letters of the person’s name, or their employee code.']);
    const contains = { contains: text, mode: 'insensitive' as const };
    const hidden = await this.confidential.hiddenFrom(user);
    const people = await this.prisma.employee.findMany({
      where: {
        AND: [
          hidden.length ? { id: { notIn: hidden } } : {},
          { OR: [{ fullNameEn: contains }, { fullNameAr: contains }, { employeeCode: contains }] },
          { OR: [{ assetsHeld: { some: { status: { not: 'disposed' } } } }, { custodyRecords: { some: { status: { in: OPEN_CUSTODY } } } }] },
        ],
      },
      select: {
        ...PERSON,
        assetsHeld: { where: { status: { not: 'disposed' } }, select: BRIEF, orderBy: { code: 'asc' } },
        custodyRecords: { where: { status: { in: OPEN_CUSTODY } }, select: { code: true, kind: true, dueDate: true }, orderBy: { outAt: 'desc' } },
      },
      orderBy: { fullNameEn: 'asc' },
      take: MAX_PEOPLE,
    });
    return people.map((p) => ({
      employee: { id: p.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn },
      assets: p.assetsHeld.map(brief),
      custody: p.custodyRecords.map((c) => ({ code: c.code, kind: c.kind, dueDate: fromDateOnly(c.dueDate) })),
    }));
  }

  /** GET /assets/reports/overdue: a shoot's custody still out past its return date, most overdue first. */
  async overdue(user: SessionUser): Promise<OverdueReturnView[]> {
    const today = todayInCairo();
    const hidden = await this.confidential.hiddenFrom(user);
    const rows = await this.prisma.custodyRecord.findMany({
      where: { kind: 'shoot', status: { in: OPEN_CUSTODY }, dueDate: { lt: toDateOnly(today) }, ...(hidden.length && { employeeId: { notIn: hidden } }) },
      select: {
        code: true,
        purpose: true,
        outAt: true,
        dueDate: true,
        employee: { select: PERSON },
        items: { where: { returnedAt: null }, select: { asset: { select: BRIEF } } },
      },
      orderBy: { dueDate: 'asc' },
      take: 200,
    });
    return rows
      .filter((r) => r.dueDate && r.items.length)
      .map((r) => {
        const due = fromDateOnly(r.dueDate!);
        return {
          code: r.code,
          employee: r.employee,
          purpose: r.purpose,
          outAt: r.outAt.toISOString(),
          dueDate: due,
          daysOverdue: daysFromTo(due, today),
          items: r.items.map((i) => brief(i.asset)),
        };
      });
  }

  /** GET /assets/reports/stock?reorder=1: the consumables and their stock, those to reorder first (only those, asked). */
  async stock(reorderOnly: boolean): Promise<StockLevelView[]> {
    const rows = await this.prisma.asset.findMany({
      where: { group: 'consumable', status: { not: 'disposed' } },
      select: { code: true, name: true, type: true, quantity: true, unit: true, reorderLevel: true, room: { select: { id: true, name: true } } },
      orderBy: { code: 'asc' },
      take: 1000,
    });
    const views = rows.map((r) => {
      const quantity = r.quantity === null ? null : r.quantity.toNumber();
      const reorderLevel = r.reorderLevel === null ? null : r.reorderLevel.toNumber();
      return {
        code: r.code,
        name: r.name,
        type: r.type as AssetType,
        quantity,
        unit: r.unit,
        reorderLevel,
        reorder: needsReorder({ group: 'consumable', quantity, reorderLevel }),
        room: r.room,
      };
    });
    const wanted = reorderOnly ? views.filter((v) => v.reorder) : views;
    return wanted.sort((a, b) => Number(b.reorder) - Number(a.reorder) || a.code.localeCompare(b.code));
  }

  /**
   * GET /assets/reports/counts-due: each group, how many assets it has, when the whole group was last counted and when
   * its next count is due (spec §2.2: every 6 months, monthly, quarterly, yearly, monthly); never counted, it is due now.
   */
  async countsDue(): Promise<CountDueView[]> {
    const [assets, counts] = await Promise.all([
      this.prisma.asset.groupBy({ by: ['group'], where: { status: { not: 'disposed' } }, _count: { _all: true } }),
      this.prisma.assetCount.groupBy({ by: ['scopeGroup'], where: { scopeKind: 'group', scopeGroup: { not: null } }, _max: { countedAt: true } }),
    ]);
    const today = todayInCairo();
    const assetsIn = new Map(assets.map((a) => [a.group, a._count._all]));
    const lastOf = new Map(counts.map((c) => [c.scopeGroup, c._max.countedAt]));
    return ASSET_GROUPS.map((g) => {
      const last = lastOf.get(g) ?? null;
      return countDue(g, assetsIn.get(g) ?? 0, last?.toISOString() ?? null, last ? dayInCairo(last) : null, today);
    });
  }
}
