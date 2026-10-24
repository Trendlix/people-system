import { BadRequestException, Injectable } from '@nestjs/common';
import { custodyTermsArOf, custodyTermsOf, termsArProblems, termsArToKeep, termsProblems, thresholdProblem, type AssetSettingsView } from '@trendlix/shared';
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
// before use", is shown beside them, never printed. Since 24 October 2026 (owner: the form in "Arabic and English" side
// by side) the Arabic terms beside them, written the same way; none written: the standard Arabic wording while the
// English terms are the standard ones, else none, and the forms print the English alone (custody.ts custodyTermsArOf).

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

  /** The terms the custody forms print now in both languages: a new record's snapshot (the Arabic may be none). */
  async custodyTermsBoth(db: Db = this.prisma): Promise<{ terms: string[]; termsAr: string[] }> {
    const row = await db.assetSettings.findUnique({ where: { id: ID }, select: { custodyTerms: true, custodyTermsAr: true } });
    return { terms: custodyTermsOf(row?.custodyTerms), termsAr: custodyTermsArOf(row?.custodyTerms, row?.custodyTermsAr) };
  }

  async view(): Promise<AssetSettingsView> {
    const row = await this.prisma.assetSettings.upsert({ where: { id: ID }, update: {}, create: { id: ID }, include: { updatedBy: { select: { id: true, email: true } } } });
    const names = await userNames(this.prisma, [row.updatedBy]);
    return {
      capitalizationThreshold: row.capitalizationThreshold.toNumber(),
      custodyTerms: custodyTermsOf(row.custodyTerms),
      custodyTermsStandard: !row.custodyTerms?.length,
      custodyTermsAr: custodyTermsArOf(row.custodyTerms, row.custodyTermsAr),
      custodyTermsArStandard: !row.custodyTermsAr?.length,
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
   * standard wording, in both languages. `termsAr` (24 October 2026): the Arabic terms beside them, empty for none
   * written (the standard Arabic wording typed back unchanged counts as none, so it keeps following the English);
   * left out (undefined), as they were. Records already made keep the terms they were printed with. Audited, from and to,
   * the Arabic as the terms in force.
   */
  async updateTerms(terms: string[] | null, user: SessionUser, termsAr?: string[]): Promise<AssetSettingsView> {
    const next = terms === null ? [] : terms.map((t) => t.trim());
    const typedAr = terms === null ? [] : termsAr?.map((t) => t.trim());
    if (terms !== null) {
      const problems = [...termsProblems(next), ...(typedAr ? termsArProblems(typedAr) : [])];
      if (problems.length) throw new BadRequestException(problems);
    }
    const row = await this.prisma.assetSettings.findUnique({ where: { id: ID }, select: { custodyTerms: true, custodyTermsAr: true } });
    const before = row?.custodyTerms ?? [];
    const beforeAr = row?.custodyTermsAr ?? [];
    const nextAr = typedAr ? termsArToKeep(typedAr) : beforeAr;
    if (JSON.stringify(before) !== JSON.stringify(next) || JSON.stringify(beforeAr) !== JSON.stringify(nextAr)) {
      const data = { custodyTerms: next, custodyTermsAr: nextAr, updatedById: user.id };
      await this.prisma.assetSettings.upsert({ where: { id: ID }, update: data, create: { id: ID, ...data } });
      await this.audit.record({
        userId: user.id,
        action: 'update',
        entityType: SETTINGS_ENTITY,
        diff: changes(
          { custodyTerms: custodyTermsOf(before), custodyTermsAr: custodyTermsArOf(before, beforeAr) },
          { custodyTerms: custodyTermsOf(next), custodyTermsAr: custodyTermsArOf(next, nextAr) },
        ),
      });
    }
    return this.view();
  }
}
