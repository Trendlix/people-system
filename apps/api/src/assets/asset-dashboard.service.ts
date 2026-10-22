import { Injectable } from '@nestjs/common';
import { ASSET_GROUPS, bookValue, countIsDue, type AssetDashboardView, type AssetGroup } from '@trendlix/shared';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssetReportsService } from './asset-reports.service.js';
import { AssetSettingsService } from './asset-settings.service.js';
import type { AssetsCaller } from './assets-access.js';

// The Assets dashboard (Assets step 5; owner, 22 October 2026: "the Assets dashboard"; the spec's §5 Dashboard: "Market
// value, book value, assets out now; attention chips (overdue returns, lost, low stock, counts due, unsigned handovers,
// under repair, employees in clearance)"), for anyone with Assets access. Disposed assets are out of every figure. The
// values (market, book, purchase) only for the CEO, Finance and a Super Admin ("CEO and Finance"): the key isn't in
// anyone else's answer. C-level people's custody records are left out of the chips for those who don't see them, as the
// Custody list leaves them out, so a chip's number is its list's. "Employees in clearance": people whose offboarding is
// open with "Assets returned" still pending (offboarding, built alongside: read by its table, so the dashboard works
// with or without it; null without it).

const OPEN_CUSTODY = ['open', 'partial'];

@Injectable()
export class AssetDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confidential: ConfidentialService,
    private readonly reports: AssetReportsService,
    private readonly settings: AssetSettingsService,
  ) {}

  async view(caller: AssetsCaller): Promise<AssetDashboardView> {
    const today = todayInCairo();
    const hidden = await this.confidential.hiddenFrom(caller.user);
    const visible = hidden.length ? { employeeId: { notIn: hidden } } : {};
    const live = { status: { not: 'disposed' } };
    const [byStatus, byGroup, overdueReturns, unsigned, lowStock, schedule, unlabelled, clearance] = await Promise.all([
      this.prisma.asset.groupBy({ by: ['status'], where: live, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['group'], where: live, _count: { _all: true } }),
      this.prisma.custodyRecord.count({
        where: { kind: 'shoot', status: { in: OPEN_CUSTODY }, dueDate: { lt: toDateOnly(today) }, items: { some: { returnedAt: null } }, ...visible },
      }),
      // as the Custody list's Not signed filter: no signed copy attached
      this.prisma.custodyRecord.count({ where: { files: { none: {} }, ...visible } }),
      this.reports.stock(true),
      this.reports.countsDue(),
      this.prisma.asset.count({ where: { ...live, labeledAt: null, group: { not: 'consumable' } } }),
      this.inClearance(hidden),
    ]);
    const status = new Map(byStatus.map((s) => [s.status, s._count._all]));
    const groups = new Map(byGroup.map((g) => [g.group, g._count._all]));
    const of = (s: string) => status.get(s) ?? 0;
    const view: AssetDashboardView = {
      totals: {
        assets: [...status.values()].reduce((a, b) => a + b, 0),
        available: of('available'),
        custody: of('custody'),
        repair: of('repair'),
        lost: of('lost'),
      },
      byGroup: Object.fromEntries(ASSET_GROUPS.map((g) => [g, groups.get(g) ?? 0])) as Record<AssetGroup, number>,
      attention: {
        overdueReturns,
        lost: of('lost'),
        lowStock: lowStock.length,
        countsDue: schedule.filter((c) => countIsDue(c, today)).length,
        unsigned,
        repair: of('repair'),
        clearance,
      },
      unlabelled,
      on: today,
    };
    if (caller.values) view.values = await this.values(today);
    return view;
  }

  /** The values added up on `today` (the CEO, Finance and a Super Admin only): market, book (straight line) and purchase. */
  private async values(today: string): Promise<NonNullable<AssetDashboardView['values']>> {
    const [threshold, rows] = await Promise.all([
      this.settings.threshold(),
      this.prisma.asset.findMany({
        where: { status: { not: 'disposed' } },
        select: { purchasePrice: true, purchaseDate: true, usefulLifeYears: true, assetClass: true, marketValue: true },
      }),
    ]);
    let marketValue = 0;
    let bookTotal = 0;
    let purchaseCost = 0;
    let withoutCost = 0;
    for (const r of rows) {
      if (r.marketValue) marketValue += r.marketValue.toNumber();
      if (r.purchasePrice === null) {
        withoutCost += 1;
        continue;
      }
      purchaseCost += r.purchasePrice.toNumber();
      const book = bookValue(
        { purchasePrice: r.purchasePrice.toNumber(), purchaseDate: fromDateOnly(r.purchaseDate), usefulLifeYears: r.usefulLifeYears, assetClass: r.assetClass },
        threshold,
        today,
      );
      bookTotal += book.amount ?? 0;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return { marketValue: round(marketValue), bookValue: round(bookTotal), purchaseCost: round(purchaseCost), withoutCost };
  }

  /**
   * People in clearance who still hold company assets: their offboarding case open with its "Assets returned" item
   * pending (C-level people left out for those who don't see them). Null when the system has no offboarding yet.
   */
  private async inClearance(hidden: readonly string[]): Promise<number | null> {
    const [{ ok }] = await this.prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('offboarding_cases') IS NOT NULL AND to_regclass('offboarding_items') IS NOT NULL AS ok`;
    if (!ok) return null;
    const ids = [...hidden];
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT c.id)::int AS n
      FROM offboarding_cases c
      JOIN employments e ON e.id = c.employment_id
      JOIN offboarding_items i ON i.case_id = c.id AND i.kind = 'assets' AND i.status = 'pending'
      WHERE c.status = 'open' AND NOT (e.employee_id = ANY(${ids}::uuid[]))`;
    return n;
  }
}
