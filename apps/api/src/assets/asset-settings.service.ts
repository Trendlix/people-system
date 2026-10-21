import { BadRequestException, Injectable } from '@nestjs/common';
import { thresholdProblem, type AssetSettingsView } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssetSettingsDto } from './assets.dto.js';

// The asset settings (spec §5, Settings: "Capitalization threshold"): one row, id 1, added by the Assets migration.
// An asset cheaper than the threshold is Expensed, its book value 0 (spec §6.8); 0: none is. An Assets manager, the
// CEO, Finance or a Super Admin read and change it (owner's decisions, 21 October 2026: the settings are a manager's,
// and the values the CEO's and Finance's, whose book values it decides), each change in the audit log, from and to (a
// rule of the register, not an asset's value).

const ID = 1;
export const SETTINGS_ENTITY = 'asset_settings';

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AssetSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The threshold now, in EGP (0 when the row is missing). */
  async threshold(db: Db = this.prisma): Promise<number> {
    const row = await db.assetSettings.findUnique({ where: { id: ID }, select: { capitalizationThreshold: true } });
    return row ? row.capitalizationThreshold.toNumber() : 0;
  }

  async view(): Promise<AssetSettingsView> {
    const row = await this.prisma.assetSettings.upsert({ where: { id: ID }, update: {}, create: { id: ID }, include: { updatedBy: { select: { id: true, email: true } } } });
    const names = await userNames(this.prisma, [row.updatedBy]);
    return {
      capitalizationThreshold: row.capitalizationThreshold.toNumber(),
      updatedAt: row.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row.updatedBy ? { email: row.updatedBy.email, name: names.get(row.updatedBy.id)?.name ?? null } : null,
    };
  }

  async update(dto: AssetSettingsDto, user: SessionUser): Promise<AssetSettingsView> {
    const problem = thresholdProblem(dto.capitalizationThreshold);
    if (problem) throw new BadRequestException([problem]);
    const before = await this.threshold();
    if (before !== dto.capitalizationThreshold) {
      const data = { capitalizationThreshold: dto.capitalizationThreshold, updatedById: user.id };
      await this.prisma.assetSettings.upsert({ where: { id: ID }, update: data, create: { id: ID, ...data } });
      await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, diff: changes({ capitalizationThreshold: before }, { capitalizationThreshold: dto.capitalizationThreshold }) });
    }
    return this.view();
  }
}
