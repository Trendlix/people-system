import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  KPI_LEVEL_LABELS,
  KPI_LEVELS,
  KPI_SCORER_LABELS,
  KPI_STATUS_LABELS,
  KPI_STATUSES,
  kpiMonthAdd,
  kpiMonthName,
  kpiPercentsByName,
  kpiPillarColumns,
  kpiScored,
  kpiScorecardMonthOn,
  type KpiHeatmap,
  type KpiLevel,
  type KpiOverview,
  type KpiScorer,
  type KpiStatus,
} from '@trendlix/shared';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { dayInCairo, shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import type { Prisma } from '../generated/prisma/client.js';
import { placeName } from '../payroll/adjustments/people.js';
import { firstDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isScorer, kpiShown, seesEveryScorecard, type KpiCaller } from './kpi-access.js';
import { KpiScorecardsService } from './kpi-scorecards.service.js';
import { keptPillars, monthOfCard, pillarSetOf } from './kpi-views.js';

// HR's, the CEO's and the Super Admin's view of the KPIs (the brief: "All KPIs (HR, the CEO, Super Admin): every
// scorecard by month with its step, calibration, pillar averages by department, and an Excel export"), and the team
// overview (spec §11: "team overview (heatmap by month, level distribution, pillar averages by department)"): a month's
// counts by step, the calibrated, the missed self-ratings, those final unsigned, the average final % with the month
// before's, the level distribution and each department's pillar averages (its teams in it), the scored scorecards only;
// the heatmap of people × months, each cell the final % as the caller may see it (a manager their people's, those they
// score). C-level people are left out for HR, and the overview says how many. The Excel export is in the audit log.
// The pillars (owner, 21 October 2026: "Fully flexible"): each scorecard's are its template version's; the department
// averages and the Excel's columns are by pillar name, saying when the month's scorecards don't all have the same.
// Practice scorecards (owner, 22 October 2026: "never reaches payroll, reports or exports") are in none of these: the
// overview, its months and counts, the heatmap (team or all) and the Excel read the real ones only.

const ROW_SELECT = {
  id: true,
  month: true,
  status: true,
  employeeId: true,
  scorer: true,
  managerId: true,
  selfSubmittedAt: true,
  selfMissed: true,
  employeeSignedAt: true,
  managerSignedAt: true,
  finalAt: true,
  finalPercent: true,
  level: true,
  pillars: true,
  departmentId: true,
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  manager: { select: { fullNameEn: true } },
  department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } },
  template: { select: { version: true, pillars: true, attendancePillar: true, publishedAt: true, jobTitle: { select: { titleEn: true } } } },
  scores: { where: { hrChoice: { not: null } }, select: { metricId: true } },
} as const satisfies Prisma.KpiScorecardSelect;

type Row = Prisma.KpiScorecardGetPayload<{ select: typeof ROW_SELECT }>;

const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const average = (values: readonly number[]) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
const isScoredRow = (r: Pick<Row, 'status' | 'finalPercent'>) => kpiScored(r.status) && r.finalPercent !== null;
const emptyLevels = () => Object.fromEntries(KPI_LEVELS.map((l) => [l, 0])) as Record<KpiLevel, number>;

/**
 * A month's scorecards' pillars as columns, by name (owner's brief, 21 October 2026: "Where scorecards with different
 * frameworks are mixed in one month's overview, group the averages by pillar name"), each scorecard with its template
 * version's own, and whether they differ; as many scorecards with each, the newest version's pillars first.
 */
const columnsOf = (rows: readonly Row[]) =>
  kpiPillarColumns([...rows].sort((a, b) => (b.template.publishedAt?.getTime() ?? 0) - (a.template.publishedAt?.getTime() ?? 0)).map((r) => pillarSetOf(r.template)));

/** A scorecard's kept pillar percents by its pillars' names (the columns' keys). */
const percentsOf = (r: Row) => kpiPercentsByName(pillarSetOf(r.template), keptPillars(r.pillars));

@Injectable()
export class KpiOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scorecards: KpiScorecardsService,
  ) {}

  /** A month's overview (the latest with scorecards unless sent). */
  async overview(month: string | undefined, user: SessionUser): Promise<KpiOverview> {
    const caller = await this.everyone(user);
    const hidden = [...caller.confidential.hidden];
    const visible: Prisma.KpiScorecardWhereInput = hidden.length ? { employeeId: { notIn: hidden } } : {};
    const months = await this.months(visible);
    const chosen = month ?? months[0] ?? kpiScorecardMonthOn(todayInCairo());
    const [rows, previous, hiddenCount] = await Promise.all([
      this.rows({ ...visible, month: toDateOnly(firstDay(chosen)) }),
      this.rows({ ...visible, month: toDateOnly(firstDay(kpiMonthAdd(chosen, -1))) }),
      hidden.length ? this.prisma.kpiScorecard.count({ where: { month: toDateOnly(firstDay(chosen)), employeeId: { in: hidden }, practice: false } }) : 0,
    ]);
    const scored = rows.filter(isScoredRow);
    const byStatus = Object.fromEntries(KPI_STATUSES.map((s) => [s, 0])) as Record<KpiStatus, number>;
    for (const r of rows) byStatus[r.status as KpiStatus] = (byStatus[r.status as KpiStatus] ?? 0) + 1;
    const distribution = emptyLevels();
    for (const r of scored) distribution[r.level as KpiLevel]++;
    // each department's scored scorecards, a team's in its department
    const departments = new Map<string, { id: string | null; name: string; rows: Row[] }>();
    for (const r of scored) {
      const top = r.department?.parent ?? r.department ?? null;
      const key = top?.id ?? 'none';
      const entry = departments.get(key) ?? { id: top?.id ?? null, name: top?.nameEn ?? 'No department', rows: [] };
      entry.rows.push(r);
      departments.set(key, entry);
    }
    const { columns, changed } = columnsOf(rows);
    return {
      month: chosen,
      months,
      total: rows.length,
      byStatus,
      calibrated: rows.filter((r) => r.scores.length > 0).length,
      selfMissed: rows.filter((r) => r.selfMissed).length,
      unsigned: rows.filter((r) => r.status === 'final' && (!r.employeeSignedAt || !r.managerSignedAt)).length,
      average: average(scored.map((r) => r.finalPercent!.toNumber())),
      previousAverage: average(previous.filter(isScoredRow).map((r) => r.finalPercent!.toNumber())),
      distribution,
      pillars: columns,
      pillarsChanged: changed,
      departments: [...departments.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => {
          const percents = d.rows.map(percentsOf);
          return {
            id: d.id,
            name: d.name,
            scored: d.rows.length,
            average: average(d.rows.map((r) => r.finalPercent!.toNumber())),
            pillars: Object.fromEntries(columns.map((c) => [c.key, average(percents.map((p) => p[c.key]).filter((v): v is number => typeof v === 'number'))])),
          };
        }),
      hidden: hiddenCount,
    };
  }

  /** People × months up to `to`, the final % as the caller may see it, and the last month's level distribution. */
  async heatmap(query: { scope: 'team' | 'all'; to?: string; months?: number }, user: SessionUser): Promise<KpiHeatmap> {
    const caller = await this.scorecards.caller(user);
    let where: Prisma.KpiScorecardWhereInput;
    if (query.scope === 'all') {
      if (!seesEveryScorecard(user)) throw new ForbiddenException('Only HR, the CEO and a Super Admin see every KPI scorecard.');
      const hidden = [...caller.confidential.hidden];
      where = hidden.length ? { employeeId: { notIn: hidden } } : {};
    } else {
      const or: Prisma.KpiScorecardWhereInput[] = [];
      if (caller.employeeId) or.push({ scorer: 'manager', managerId: caller.employeeId });
      if (user.roles.includes('ceo')) or.push({ scorer: 'ceo' });
      if (user.roles.includes('super_admin')) or.push({ scorer: 'super_admin' });
      where = or.length ? { OR: or } : { id: { in: [] } };
    }
    const count = query.months ?? 6;
    const to = query.to ?? (await this.months(where))[0] ?? kpiScorecardMonthOn(todayInCairo());
    const months = Array.from({ length: count }, (_, i) => kpiMonthAdd(to, i - count + 1));
    const all = await this.rows({ AND: [where, { month: { gte: toDateOnly(firstDay(months[0])), lte: toDateOnly(firstDay(to)) } }] });
    const rows = query.scope === 'team' ? all.filter((r) => isScorer(r, caller)) : all;
    const people = new Map<string, Row[]>();
    for (const r of rows) people.set(r.employeeId, [...(people.get(r.employeeId) ?? []), r]);
    const shownScore = (r: Row) => (kpiShown(r, caller).manager && r.finalPercent !== null ? { finalPercent: r.finalPercent.toNumber(), level: r.level as KpiLevel } : { finalPercent: null, level: null });
    const last = rows.filter((r) => monthOfCard(r) === to);
    const counts = emptyLevels();
    let scored = 0;
    for (const r of last) {
      const s = shownScore(r);
      if (s.level && kpiScored(r.status)) {
        counts[s.level]++;
        scored++;
      }
    }
    return {
      months,
      rows: [...people.values()]
        .map((cards) => {
          const latest = cards.reduce((a, b) => (a.month > b.month ? a : b));
          return {
            employee: latest.employee,
            jobTitle: latest.template.jobTitle.titleEn,
            department: placeName(latest.department),
            cells: months.map((m) => {
              const card = cards.find((c) => monthOfCard(c) === m);
              return card ? { id: card.id, ...shownScore(card), status: card.status as KpiStatus } : null;
            }),
          };
        })
        .sort((a, b) => (a.department ?? '').localeCompare(b.department ?? '') || a.employee.fullNameEn.localeCompare(b.employee.fullNameEn)),
      distribution: { month: to, counts, scored, total: last.length },
    };
  }

  /** A month's scorecards as an Excel workbook: "KPIs October 2026.xlsx"; the download is in the audit log. */
  async workbook(month: string, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const caller = await this.everyone(user);
    const hidden = [...caller.confidential.hidden];
    const rows = await this.rows({ month: toDateOnly(firstDay(month)), ...(hidden.length && { employeeId: { notIn: hidden } }) });
    rows.sort((a, b) => (placeName(a.department) ?? '').localeCompare(placeName(b.department) ?? '') || a.employee.fullNameEn.localeCompare(b.employee.fullNameEn));
    const day = (d: Date | null) => (d ? shownDate(dayInCairo(d)) : null);
    // each scorecard's own pillars, by name: a weight in the header when every scorecard with the pillar has the same
    const { columns: pillars } = columnsOf(rows);
    const percents = new Map(rows.map((r) => [r.id, percentsOf(r)]));
    const columns: Column<Row>[] = [
      { header: 'Employee code', width: 14, value: (r) => r.employee.employeeCode },
      { header: 'Employee', width: 28, value: (r) => r.employee.fullNameEn },
      { header: 'Department', width: 28, value: (r) => placeName(r.department) },
      { header: 'Job title', width: 26, value: (r) => r.template.jobTitle.titleEn },
      { header: 'Template version', width: 10, value: (r) => r.template.version },
      { header: 'Step', width: 18, value: (r) => KPI_STATUS_LABELS[r.status as KpiStatus] ?? r.status },
      { header: 'Scored by', width: 24, value: (r) => (r.scorer === 'manager' ? (r.manager?.fullNameEn ?? null) : KPI_SCORER_LABELS[r.scorer as KpiScorer]) },
      { header: 'Self-rating', width: 14, value: (r) => (r.selfSubmittedAt ? 'Sent' : r.selfMissed ? 'Missed' : 'Not yet') },
      { header: 'Final %', width: 10, numFmt: '0.0', value: (r) => (isScoredRow(r) ? r.finalPercent!.toNumber() : null) },
      { header: 'Level', width: 20, value: (r) => (isScoredRow(r) ? KPI_LEVEL_LABELS[r.level as KpiLevel] : null) },
      ...pillars.map(
        (c): Column<Row> => ({
          header: c.weight !== null ? `${c.name} (${c.weight}%)` : c.name,
          width: 16,
          numFmt: '0.0',
          value: (r) => (isScoredRow(r) ? (percents.get(r.id)?.[c.key] ?? null) : null),
        }),
      ),
      { header: 'Picks changed by HR', width: 12, value: (r) => r.scores.length },
      { header: 'Signed by the employee', width: 14, value: (r) => (r.employeeSignedAt ? 'Yes' : 'No') },
      { header: 'Signed by the manager', width: 14, value: (r) => (r.managerSignedAt ? 'Yes' : 'No') },
      { header: 'Final on', width: 12, value: (r) => day(r.finalAt) },
    ];
    const wb = new ExcelJS.Workbook();
    addSheet(wb, kpiMonthName(month), columns, rows);
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.record({ userId: user.id, action: 'kpi_file', entityType: 'kpi_report', diff: { month, scorecards: rows.length, ...(hidden.length && { confidentialLeftOut: true }) } });
    return { fileName: `KPIs ${kpiMonthName(month)}.xlsx`, data };
  }

  // ---------- helpers ----------

  /** HR, the CEO and a Super Admin, with the C-level people hidden from them. */
  private async everyone(user: SessionUser): Promise<KpiCaller> {
    if (!seesEveryScorecard(user)) throw new ForbiddenException('Only HR, the CEO and a Super Admin see every KPI scorecard.');
    return this.scorecards.caller(user);
  }

  /** The real scorecards only: never a practice one. */
  private rows(where: Prisma.KpiScorecardWhereInput): Promise<Row[]> {
    return this.prisma.kpiScorecard.findMany({ where: { AND: [where, { practice: false }] }, select: ROW_SELECT });
  }

  /** The months with scorecards, newest first. */
  private async months(where: Prisma.KpiScorecardWhereInput): Promise<string[]> {
    const rows = await this.prisma.kpiScorecard.findMany({ where: { AND: [where, { practice: false }] }, distinct: ['month'], orderBy: { month: 'desc' }, select: { month: true } });
    return rows.map(monthOfCard);
  }
}

