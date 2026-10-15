import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ENDING_RULES, type NoticeUnit } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import type { EndingRule } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateEndingRuleDto } from './contracts.dto.js';
import { meetsLegalMinimum } from './notice.js';

const ENTITY = 'ending_rule';

/** The rules whose notice the law sets a floor for: resignation (Art. 156) and a company ending with notice; notice can't be shortened below it (Art. 161). */
const LEGAL_MINIMUM_RULES: readonly string[] = ['resignation', 'company_notice'];

export function endingRuleView(r: EndingRule) {
  return {
    key: r.key,
    label: r.label,
    initiator: r.initiator,
    noticeAmount: r.noticeAmount,
    noticeUnit: r.noticeUnit,
    payInLieu: r.payInLieu,
    endReason: r.endReason,
    source: r.source,
    active: r.active,
  };
}

// The ways an employment can end, each with its notice (owner's decisions, 15 October 2026, checked against Labour Law
// 14/2025). HR and Admin tune the label, the notice, pay in lieu and whether a rule is offered; who starts it, the end
// reason it gives and its legal source stay as seeded from packages/shared ENDING_RULE_DEFAULTS.
@Injectable()
export class EndingRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.prisma.endingRule.findMany({ orderBy: { sortOrder: 'asc' } })).map(endingRuleView);
  }

  async update(key: string, dto: UpdateEndingRuleDto, user: SessionUser) {
    const before = await this.row(key);
    const noticeAmount = dto.noticeAmount ?? before.noticeAmount;
    const noticeUnit = (dto.noticeUnit ?? before.noticeUnit) as NoticeUnit;
    // three months ≈ 90 days ≈ 13 weeks ≈ 65 working days: see LEGAL_MINIMUM_NOTICE
    if (LEGAL_MINIMUM_RULES.includes(key) && !meetsLegalMinimum(noticeAmount, noticeUnit)) {
      throw new BadRequestException("The law requires at least 3 months' notice for this (Art. 156); it can be longer, not shorter.");
    }
    const data = { label: dto.label, noticeAmount: dto.noticeAmount, noticeUnit: dto.noticeUnit, payInLieu: dto.payInLieu, active: dto.active };
    const after = await this.prisma.endingRule.update({ where: { key }, data });
    const diff = changes(endingRuleView(before), data);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, diff: { key, ...diff } });
    return endingRuleView(after);
  }

  /** A rule by its key; unknown keys are refused. */
  async row(key: string): Promise<EndingRule> {
    const rule = (ENDING_RULES as readonly string[]).includes(key) ? await this.prisma.endingRule.findUnique({ where: { key } }) : null;
    if (!rule) throw new NotFoundException('Ending rule not found.');
    return rule;
  }
}
