import { BadRequestException, Injectable } from '@nestjs/common';
import { INVITE_STANDARD, inviteWordsProblems, recencyMonthsProblem, REJECTION_STANDARD, rejectionWordsProblems, SUGGESTION_LIMITS, type RecruitmentSettingsView } from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { userRef } from './recruitment-views.js';
import type { RecruitmentSettingsDto } from './recruitment.dto.js';

// Recruitment Settings (Phase 2, owner, 22 October 2026; the brief: "a polite standard text that an HR-editable
// Recruitment Settings section can change (English and Arabic)"): the rejection email's subject and words, HR's (or a
// Super Admin's) to change, HR and the CEO to read; empty means the standard. Each change audited (whether a text
// changed, never the text). Since 24 October 2026 (Suggested From Earlier CVs, owner: "Suggest; HR adds", "Yes, HR
// presses 'Invite to apply'"): how far back CVs count (12 months unless changed), and the invitation to apply's words.

export const SETTINGS_ENTITY = 'recruitment_settings';

const USER = { select: { id: true, email: true } } as const;

type Texts = {
  rejectionSubject: string | null;
  rejectionEn: string | null;
  rejectionAr: string | null;
  inviteSubject: string | null;
  inviteEn: string | null;
  inviteAr: string | null;
};
const TEXT_FIELDS = ['rejectionSubject', 'rejectionEn', 'rejectionAr', 'inviteSubject', 'inviteEn', 'inviteAr'] as const satisfies readonly (keyof Texts)[];

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
      suggestions: { recencyMonths: row?.suggestMonths ?? SUGGESTION_LIMITS.recencyMonths },
      invite: { subject: row?.inviteSubject ?? null, en: row?.inviteEn ?? null, ar: row?.inviteAr ?? null },
      inviteStandard: { subject: INVITE_STANDARD.subject, en: INVITE_STANDARD.en, ar: INVITE_STANDARD.ar },
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: userRef(row?.updatedBy ?? null, names),
    };
  }

  /**
   * HR's words for the rejection email and the invitation, and the months back CVs count; a field left out stays, an
   * empty text goes back to the standard.
   */
  async update(dto: RecruitmentSettingsDto, user: SessionUser): Promise<RecruitmentSettingsView> {
    const problems = [
      ...rejectionWordsProblems({ subject: dto.rejectionSubject, en: dto.rejectionEn, ar: dto.rejectionAr }),
      ...inviteWordsProblems({ subject: dto.inviteSubject, en: dto.inviteEn, ar: dto.inviteAr }),
      ...(dto.suggestMonths !== undefined ? [recencyMonthsProblem(dto.suggestMonths)].filter((p): p is string => !!p) : []),
    ];
    if (problems.length) throw new BadRequestException(problems);
    const before = await this.prisma.recruitmentSettings.findUnique({ where: { id: 1 } });
    const texts = Object.fromEntries(TEXT_FIELDS.map((k) => [k, dto[k] === undefined ? (before?.[k] ?? null) : dto[k] || null])) as Texts;
    const next = { ...texts, suggestMonths: dto.suggestMonths ?? before?.suggestMonths ?? SUGGESTION_LIMITS.recencyMonths };
    // the subjects and the months as they are; the long texts by whether they changed, never the words
    const shown = (v: (Partial<Texts> & { suggestMonths?: number }) | null) => ({
      rejectionSubject: v?.rejectionSubject ?? null,
      rejectionEn: v?.rejectionEn ? '(text)' : null,
      rejectionAr: v?.rejectionAr ? '(text)' : null,
      inviteSubject: v?.inviteSubject ?? null,
      inviteEn: v?.inviteEn ? '(text)' : null,
      inviteAr: v?.inviteAr ? '(text)' : null,
      suggestMonths: v?.suggestMonths ?? SUGGESTION_LIMITS.recencyMonths,
    });
    const rejectionChanged = (before?.rejectionEn ?? null) !== next.rejectionEn || (before?.rejectionAr ?? null) !== next.rejectionAr;
    const inviteChanged = (before?.inviteEn ?? null) !== next.inviteEn || (before?.inviteAr ?? null) !== next.inviteAr;
    const diff = changes(shown(before), shown(next));
    if (!Object.keys(diff).length && !rejectionChanged && !inviteChanged) return this.get();
    await this.prisma.recruitmentSettings.upsert({ where: { id: 1 }, create: { id: 1, ...next, updatedById: user.id }, update: { ...next, updatedById: user.id, updatedAt: new Date() } });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: SETTINGS_ENTITY,
      entityId: null,
      diff: { ...diff, ...(rejectionChanged && { rejectionText: 'changed' }), ...(inviteChanged && { inviteText: 'changed' }) },
    });
    return this.get();
  }
}
