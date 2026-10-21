import { BadRequestException, Injectable } from '@nestjs/common';
import { custodyTermsOf, termsProblems, thresholdProblem, type AssetSettingsView } from '@trendlix/shared';
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
// rule of the register, not an asset's value). Step 3: the terms the custody forms print, an Assets manager's alone
// (the brief, 21 October 2026: "Put the terms in Assets → Settings as editable text, managers only, and the snapshot on
// each record"); none written: the standard wording. The owner's note on them, "Have a labour lawyer review this wording
// before use", is shown beside them, never printed.

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

  /** The terms the custody forms print now: those written, else the standard wording. */
  async custodyTerms(db: Db = this.prisma): Promise<string[]> {
    const row = await db.assetSettings.findUnique({ where: { id: ID }, select: { custodyTerms: true } });
    return custodyTermsOf(row?.custodyTerms);
  }

  async view(): Promise<AssetSettingsView> {
    const row = await this.prisma.assetSettings.upsert({ where: { id: ID }, update: {}, create: { id: ID }, include: { updatedBy: { select: { id: true, email: true } } } });
    const names = await userNames(this.prisma, [row.updatedBy]);
    return {
      capitalizationThreshold: row.capitalizationThreshold.toNumber(),
      custodyTerms: custodyTermsOf(row.custodyTerms),
      custodyTermsStandard: !row.custodyTerms?.length,
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

  /**
   * The custody terms written by an Assets manager, one a term (the route checks the level); `standard`: back to the
   * standard wording. Records already made keep the terms they were printed with. Audited, from and to.
   */
  async updateTerms(terms: string[] | null, user: SessionUser): Promise<AssetSettingsView> {
    const next = terms === null ? [] : terms.map((t) => t.trim());
    if (terms !== null) {
      const problems = termsProblems(next);
      if (problems.length) throw new BadRequestException(problems);
    }
    const row = await this.prisma.assetSettings.findUnique({ where: { id: ID }, select: { custodyTerms: true } });
    const before = row?.custodyTerms ?? [];
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      const data = { custodyTerms: next, updatedById: user.id };
      await this.prisma.assetSettings.upsert({ where: { id: ID }, update: data, create: { id: ID, ...data } });
      await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, diff: changes({ custodyTerms: custodyTermsOf(before) }, { custodyTerms: custodyTermsOf(next) }) });
    }
    return this.view();
  }
}
