import { Injectable } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ContractSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateContractSettingsDto } from './contracts.dto.js';

const ENTITY = 'contract_settings';
const ID = 1;

/**
 * The basic wage social insurance Form 1 prints for an employee who has none of their own (owner, 16 October 2026):
 * the column's default, used where the settings row is missing.
 */
export const INSURANCE_BASIC_DEFAULT = 410;

export interface ContractSettingsView {
  probationMonths: number;
  durationMonths: number;
  insuranceBasicDefault: number;
  /** The basic salary's share of the gross a new contract or offer starts with, in percent (80 to start with). */
  basicPercentDefault: number;
}

const view = (s: ContractSettings): ContractSettingsView => ({
  probationMonths: s.probationMonths,
  durationMonths: s.durationMonths,
  insuranceBasicDefault: s.insuranceBasicDefault.toNumber(),
  basicPercentDefault: s.basicPercentDefault,
});

// The defaults for new contracts (owner's decisions, 15 October 2026): 3 months of probation, the most the law allows
// (Art. 90), and a fixed term of 12 months; and the basic wage social insurance Form 1 prints for an employee who has
// none of their own, 410 EGP to start with (owner, 16 October 2026). One row, id 1, seeded by the contracts migration
// and prisma/seed.ts. The basic share of the gross a new contract or offer starts with, 80% as it always was, and the
// Form 1 basic wage change the payroll sheet, so they are edited on Payroll Setup (owner's request, 16 October 2026:
// everything that changes the sheet in one place); they stay here, read by the contracts and the forms as before.
@Injectable()
export class ContractSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The one row; created with the defaults if it is missing. */
  private row(): Promise<ContractSettings> {
    return this.prisma.contractSettings.upsert({ where: { id: ID }, update: {}, create: { id: ID } });
  }

  async get(): Promise<ContractSettingsView> {
    return view(await this.row());
  }

  async update(dto: UpdateContractSettingsDto, user: SessionUser): Promise<ContractSettingsView> {
    const before = await this.row();
    const data = {
      probationMonths: dto.probationMonths,
      durationMonths: dto.durationMonths,
      insuranceBasicDefault: dto.insuranceBasicDefault,
      basicPercentDefault: dto.basicPercentDefault,
    };
    const after = await this.prisma.contractSettings.update({ where: { id: ID }, data });
    const diff = changes(view(before) as unknown as Record<string, unknown>, data);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, diff });
    return view(after);
  }
}
