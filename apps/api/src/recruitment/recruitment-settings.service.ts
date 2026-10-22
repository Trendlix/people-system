import { BadRequestException, Injectable } from '@nestjs/common';
import { REJECTION_STANDARD, rejectionWordsProblems, type RecruitmentSettingsView } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { userRef } from './recruitment-views.js';
import type { RecruitmentSettingsDto } from './recruitment.dto.js';

// Recruitment Settings (Phase 2, owner, 22 October 2026; the brief: "a polite standard text that an HR-editable
// Recruitment Settings section can change (English and Arabic)"): the rejection email's subject and words, HR's (or a
// Super Admin's) to change, HR and the CEO to read; empty means the standard. Each change audited (whether a text
// changed, never the text).

export const SETTINGS_ENTITY = 'recruitment_settings';

const USER = { select: { id: true, email: true } } as const;

@Injectable()
export class RecruitmentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<RecruitmentSettingsView> {
    const row = await this.prisma.recruitmentSettings.findUnique({ where: { id: 1 }, include: { updatedBy: USER } });
    const names = await userNames(this.prisma, [row?.updatedBy ?? null]);
    return {
      rejection: { subject: row?.rejectionSubject ?? null, en: row?.rejectionEn ?? null, ar: row?.rejectionAr ?? null },
      standard: { subject: REJECTION_STANDARD.subject, en: REJECTION_STANDARD.en, ar: REJECTION_STANDARD.ar },
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: userRef(row?.updatedBy ?? null, names),
    };
  }

  /** HR's words for the rejection email; a field left out stays, an empty one goes back to the standard. */
  async update(dto: RecruitmentSettingsDto, user: SessionUser): Promise<RecruitmentSettingsView> {
    const problems = rejectionWordsProblems({ subject: dto.rejectionSubject, en: dto.rejectionEn, ar: dto.rejectionAr });
    if (problems.length) throw new BadRequestException(problems);
    const before = await this.prisma.recruitmentSettings.findUnique({ where: { id: 1 } });
    const next = {
      rejectionSubject: dto.rejectionSubject === undefined ? (before?.rejectionSubject ?? null) : dto.rejectionSubject || null,
      rejectionEn: dto.rejectionEn === undefined ? (before?.rejectionEn ?? null) : dto.rejectionEn || null,
      rejectionAr: dto.rejectionAr === undefined ? (before?.rejectionAr ?? null) : dto.rejectionAr || null,
    };
    const shown = (v: { rejectionSubject: string | null; rejectionEn: string | null; rejectionAr: string | null } | null) => ({
      rejectionSubject: v?.rejectionSubject ?? null,
      rejectionEn: v?.rejectionEn ? '(text)' : null,
      rejectionAr: v?.rejectionAr ? '(text)' : null,
    });
    const textChanged = (before?.rejectionEn ?? null) !== next.rejectionEn || (before?.rejectionAr ?? null) !== next.rejectionAr;
    const diff = changes(shown(before), shown(next));
    if (!Object.keys(diff).length && !textChanged) return this.get();
    await this.prisma.recruitmentSettings.upsert({ where: { id: 1 }, create: { id: 1, ...next, updatedById: user.id }, update: { ...next, updatedById: user.id, updatedAt: new Date() } });
    await this.audit.record({ userId: user.id, action: 'update', entityType: SETTINGS_ENTITY, entityId: null, diff: { ...diff, ...(textChanged && { rejectionText: 'changed' }) } });
    return this.get();
  }
}
