import { BadRequestException, Injectable } from '@nestjs/common';
import { KPI_SETTING_DEFAULTS, kpiSettingsProblems, type KpiSettings, type KpiSettingsView } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { KpiSettingsDto } from './kpis.dto.js';

// The KPI settings (owner's brief, 21 October 2026: "Deadlines in a small KPI settings section, defaults: self-rating by
// the 3rd, manager by the 6th, HR by the 8th of the next month"; "If the employee doesn't sign by the 10th, it's final
// anyway"): the four days, each after the one before (packages/shared kpiSettingsProblems). Everyone reads them (the
// scorecards show their deadlines); HR and a Super Admin change them, each change in the audit log. One row, id 1, added
// by the KPIs migration.

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
      updatedAt: row.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row.updatedBy ? { email: row.updatedBy.email, name: names.get(row.updatedBy.id)?.name ?? null } : null,
    };
  }

  /** Changes the days sent; refused (400, each problem) unless each step is after the one before, within the 28th. */
  async update(dto: KpiSettingsDto, user: SessionUser): Promise<KpiSettingsView> {
    const before = await this.read();
    const sent = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<KpiSettings>;
    const after: KpiSettings = { ...before, ...sent };
    const problems = kpiSettingsProblems(after);
    if (problems.length) throw new BadRequestException(problems);
    const diff = changes(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    if (Object.keys(diff).length) {
      await this.prisma.kpiSettings.upsert({ where: { id: ID }, update: { ...after, updatedById: user.id }, create: { id: ID, ...after, updatedById: user.id } });
      await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, diff });
    }
    return this.view();
  }
}
