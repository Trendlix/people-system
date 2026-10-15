import { Injectable } from '@nestjs/common';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ContractSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateContractSettingsDto } from './contracts.dto.js';

const ENTITY = 'contract_settings';
const ID = 1;

export interface ContractSettingsView {
  probationMonths: number;
  durationMonths: number;
}

const view = (s: ContractSettings): ContractSettingsView => ({ probationMonths: s.probationMonths, durationMonths: s.durationMonths });

// The defaults for new contracts (owner's decisions, 15 October 2026): 3 months of probation, the most the law allows
// (Art. 90), and a fixed term of 12 months. One row, id 1, seeded by the contracts migration and prisma/seed.ts.
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
    const data = { probationMonths: dto.probationMonths, durationMonths: dto.durationMonths };
    const after = await this.prisma.contractSettings.update({ where: { id: ID }, data });
    const diff = changes(view(before) as unknown as Record<string, unknown>, data);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, diff });
    return view(after);
  }
}
