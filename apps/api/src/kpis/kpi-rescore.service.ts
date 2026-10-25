import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { KPI_ATTENDANCE_IN_KPI_DEFAULT } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CARD_INCLUDE, keptPillars, monthOfCard, pillarsJson, SCORECARD_ENTITY, scoreOf } from './kpi-views.js';

// The scorecards not yet final follow Attendance in the KPI (owner, 25 October 2026, asked whether attendance is cut
// twice, on the fixed part of the pay and through the KPI's Attendance metric: "Fixed cut only"; packages/shared
// kpis.ts): each one's attendance_counted is the setting's, at the self-rating, with the manager, with HR or at the
// sign-off, the practice ones too, and the score kept on it (final %, level, the pillars' percents, which the lists,
// the overview and its Excel read) is worked out again with it, as kpiScore does. A final scorecard is never touched:
// it keeps its result exactly, and the payroll reads only final ones. Done when the setting is switched
// (KpiSettingsService), and when the API starts, for the migration that switched it off (it can't work a score out in
// SQL; as expected-hours.service.ts does for the payroll lines): once done there is nothing left to do, so a start
// changes nothing. Each scorecard whose kept score changed is in the audit log, by whoever switched it (nobody, the
// system, at a start), with what it was and became. Nobody is told: the score shown is what the page works out anyway.

const LOCK = 'people-system:kpi-attendance-rescore';

type Tx = Prisma.TransactionClient;

/** A scorecard whose kept score was worked out again. */
export interface RescoredCard {
  id: string;
  month: string;
  employeeCode: string;
  practice: boolean;
  from: { finalPercent: number | null; level: string | null };
  to: { finalPercent: number; level: string };
}

/** The setting as it is kept (the default, off, while the row is missing). */
export async function attendanceInKpi(db: PrismaService | Tx): Promise<boolean> {
  const row = await db.kpiSettings.findUnique({ where: { id: 1 }, select: { attendanceInKpi: true } });
  return row?.attendanceInKpi ?? KPI_ATTENDANCE_IN_KPI_DEFAULT;
}

/** Whether two kept pillar percents differ, key by key (the database keeps the keys in an order of its own). */
function pillarsDiffer(kept: Record<string, number | null>, now: Record<string, number | null>): boolean {
  const keys = new Set([...Object.keys(kept), ...Object.keys(now)]);
  for (const k of keys) if ((kept[k] ?? null) !== (now[k] ?? null)) return true;
  return false;
}

@Injectable()
export class KpiRescoreService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KpiRescoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const changed = await this.follow(null);
    if (changed.length) this.logger.log(`Worked out again the score of ${changed.length} KPI scorecards not yet final, as Attendance in the KPI has it.`);
  }

  /**
   * Makes every scorecard not final follow the setting as it is kept (in the caller's transaction when sent, after the
   * setting was saved in it), and works out again the kept score of those scored. One at a time across the API's
   * instances. Answers those whose kept score changed; audits them when not in a caller's transaction (`tx` given: the
   * caller audits them with `record`).
   */
  async follow(userId: string | null, tx?: Tx): Promise<RescoredCard[]> {
    if (tx) return this.inTx(tx);
    const changed = await this.prisma.$transaction((t) => this.inTx(t), { timeout: 60_000 });
    await this.record(changed, userId, await attendanceInKpi(this.prisma));
    return changed;
  }

  /** The audit log's entries for the scorecards whose kept score changed, by `userId` (null: the system). */
  async record(changed: readonly RescoredCard[], userId: string | null, counted: boolean): Promise<void> {
    for (const c of changed) {
      await this.audit.record({
        userId,
        action: 'update',
        entityType: SCORECARD_ENTITY,
        entityId: c.id,
        diff: {
          month: c.month,
          employeeCode: c.employeeCode,
          ...(c.practice && { practice: true }),
          reason: counted ? 'Attendance in the KPI switched on: the Attendance metric counts again' : 'Attendance in the KPI switched off: the KPI is performance only',
          attendanceCounted: counted,
          finalPercent: { from: c.from.finalPercent, to: c.to.finalPercent },
          ...(c.from.level !== c.to.level && { level: { from: c.from.level, to: c.to.level } }),
        },
      });
    }
  }

  private async inTx(tx: Tx): Promise<RescoredCard[]> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`;
    const counted = await attendanceInKpi(tx);
    await tx.kpiScorecard.updateMany({ where: { status: { not: 'final' }, attendanceCounted: !counted }, data: { attendanceCounted: counted } });
    // the scored ones keep a score: worked out again (those not scored yet keep none, and the page works theirs out)
    const rows = await tx.kpiScorecard.findMany({ where: { status: { not: 'final' }, finalPercent: { not: null } }, include: CARD_INCLUDE });
    const changed: RescoredCard[] = [];
    for (const row of rows) {
      const score = scoreOf(row, 'final');
      const pillars = pillarsJson(score);
      const was = row.finalPercent?.toNumber() ?? null;
      if (was === score.finalPercent && row.level === score.level && !pillarsDiffer(keptPillars(row.pillars), pillars)) continue;
      const { count } = await tx.kpiScorecard.updateMany({
        where: { id: row.id, status: { not: 'final' } },
        data: { finalPercent: score.finalPercent, level: score.level, pillars },
      });
      if (!count) continue;
      changed.push({
        id: row.id,
        month: monthOfCard(row),
        employeeCode: row.employee.employeeCode,
        practice: row.practice,
        from: { finalPercent: was, level: row.level },
        to: { finalPercent: score.finalPercent, level: score.level },
      });
    }
    return changed;
  }
}
