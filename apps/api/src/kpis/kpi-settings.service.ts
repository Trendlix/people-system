import { BadRequestException, Injectable } from '@nestjs/common';
import { KPI_SETTING_DEFAULTS, kpiSettingsProblems, type KpiSettings, type KpiSettingsView } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { attendanceInKpi, KpiRescoreService } from './kpi-rescore.service.js';
import type { KpiSettingsDto } from './kpis.dto.js';

// The KPI settings (owner's brief, 21 October 2026: "Deadlines in a small KPI settings section, defaults: self-rating by
// the 3rd, manager by the 6th, HR by the 8th of the next month"; "If the employee doesn't sign by the 10th, it's final
// anyway"): the four days, each after the one before (packages/shared kpiSettingsProblems). Everyone reads them (the
// scorecards show their deadlines); HR and a Super Admin change them, each change in the audit log. One row, id 1, added
// by the KPIs migration.
// Attendance in the KPI (owner, 25 October 2026, asked whether attendance is cut twice, on the fixed part of the pay and
// through the KPI's Attendance metric: "Fixed cut only"): whether the Attendance metric counts in the KPI, off from then
// (the migration), kept as a switch so it can come back. Everyone reads it; HR and a Super Admin switch it, audited with
// how many scorecards were worked out again: switched, every scorecard not final follows it at once and its kept score
// is worked out again with it (kpi-rescore.service.ts), in the same transaction; a final one never changes. A payroll
// run takes it into its rules when made or refreshed (payroll-settings.service.ts runRules).

const ID = 1;
export const SETTINGS_ENTITY = 'kpi_settings';

type Db = PrismaService | Prisma.TransactionClient;

const settingsOf = (row: { selfRatingDay: number; managerDay: number; hrDay: number; signOffDay: number }): KpiSettings => ({
  selfRatingDay: row.selfRatingDay,
  managerDay: row.managerDay,
  hrDay: row.hrDay,
  signOffDay: row.signOffDay,
});

@Injectable()
export class KpiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rescore: KpiRescoreService,
  ) {}

  /** The deadlines as they are now (the defaults if the row is missing). */
  async read(db: Db = this.prisma): Promise<KpiSettings> {
    const row = await db.kpiSettings.findUnique({ where: { id: ID } });
    return row ? settingsOf(row) : { ...KPI_SETTING_DEFAULTS };
  }

  async view(): Promise<KpiSettingsView> {
    const row = await this.prisma.kpiSettings.upsert({ where: { id: ID }, update: {}, create: { id: ID }, include: { updatedBy: { select: { id: true, email: true } } } });
    const names = await userNames(this.prisma, [row.updatedBy]);
    return {
      ...settingsOf(row),
      attendanceInKpi: row.attendanceInKpi,
      updatedAt: row.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row.updatedBy ? { email: row.updatedBy.email, name: names.get(row.updatedBy.id)?.name ?? null } : null,
    };
  }

  /** Whether the Attendance metric counts in the KPI now (25 October 2026: off unless switched on). */
  attendanceInKpi(db: Db = this.prisma): Promise<boolean> {
    return attendanceInKpi(db);
  }

  /**
   * Changes the days sent, and switches Attendance in the KPI when sent; refused (400, each problem) unless each step is
   * after the one before, within the 28th. Switched, the scorecards not final follow it, their kept scores worked out
   * again, each in the audit log.
   */
  async update(dto: KpiSettingsDto, user: SessionUser): Promise<KpiSettingsView> {
    const { attendanceInKpi: switchTo, ...days } = dto;
    const before = await this.read();
    const sent = Object.fromEntries(Object.entries(days).filter(([, v]) => v !== undefined)) as Partial<KpiSettings>;
    const after: KpiSettings = { ...before, ...sent };
    const problems = kpiSettingsProblems(after);
    if (problems.length) throw new BadRequestException(problems);
    const diff: Record<string, unknown> = changes(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    const was = await this.attendanceInKpi();
    const switching = switchTo !== undefined && switchTo !== was;
    if (switching) diff.attendanceInKpi = { from: was, to: switchTo };
    if (Object.keys(diff).length) {
      const data = { ...after, ...(switching && { attendanceInKpi: switchTo }), updatedById: user.id };
      const rescored = await this.prisma.$transaction(
        async (tx) => {
          await tx.kpiSettings.upsert({ where: { id: ID }, update: data, create: { id: ID, ...data } });
          return switching ? this.rescore.follow(user.id, tx) : [];
        },
        { timeout: 60_000 },
      );
      await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, diff: { ...diff, ...(switching && { rescored: rescored.length }) } });
      if (switching) await this.rescore.record(rescored, user.id, switchTo);
    }
    return this.view();
  }
}
