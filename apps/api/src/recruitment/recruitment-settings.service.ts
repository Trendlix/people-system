import { BadRequestException, Injectable } from '@nestjs/common';
import {
  INVITE_STANDARD,
  inviteWordsProblems,
  positionChoiceProblems,
  recencyMonthsProblem,
  REJECTION_STANDARD,
  rejectionWordsProblems,
  SUGGESTION_LIMITS,
  type CvPosition,
  type CvPositionsView,
  type RecruitmentSettingsView,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { positionsOf } from './cv-positions.js';
import { areasOf } from './general-cvs.service.js';
import { userRef } from './recruitment-views.js';
import type { CvPositionChoicesDto, RecruitmentSettingsDto } from './recruitment.dto.js';

// Recruitment Settings (Phase 2, owner, 22 October 2026; the brief: "a polite standard text that an HR-editable
// Recruitment Settings section can change (English and Arabic)"): the rejection email's subject and words, HR's (or a
// Super Admin's) to change, HR and the CEO to read; empty means the standard. Each change audited (whether a text
// changed, never the text). Since 24 October 2026 (Suggested From Earlier CVs, owner: "Suggest; HR adds", "Yes, HR
// presses 'Invite to apply'"): how far back CVs count (12 months unless changed), and the invitation to apply's words.
// Since 25 October 2026 ("Positions on the CV Form"; owner, on "Send us your CV": "should it be the positions?", then
// "Position, grouped by team"; packages/shared cv-positions.ts): every position with HR's choices, each shown on the
// careers page or hidden, and a public name; HR (or a Super Admin) changes them, HR and the CEO read them, and HR's lists
// filter by their teams. Each change audited: the positions hidden, shown again and renamed.

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

  // ---------- the positions on the CV form (25 October 2026) ----------

  /**
   * Every position, hidden ones too, with HR's choices; and the teams HR's lists filter general CVs by (the positions'
   * teams, and the areas older CVs were sent for), as HR names them ("Video · Production"), in the organisation's order.
   */
  async positions(): Promise<CvPositionsView> {
    const order = [{ sortOrder: 'asc' as const }, { nameEn: 'asc' as const }];
    const [positions, areas, departments, last] = await Promise.all([
      positionsOf(this.prisma),
      areasOf(this.prisma),
      this.prisma.department.findMany({ where: { parentId: null }, orderBy: order, select: { id: true, nameEn: true, children: { orderBy: order, select: { id: true, nameEn: true } } } }),
      this.prisma.cvPositionChoice.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, updatedBy: USER } }),
    ]);
    const used = new Set([...positions.map((p) => p.teamId), ...areas.map((a) => a.id)]);
    const teams = departments
      .flatMap((d) => [{ id: d.id, name: d.nameEn }, ...d.children.map((t) => ({ id: t.id, name: `${t.nameEn} · ${d.nameEn}` }))])
      .filter((t) => used.has(t.id));
    const names = await userNames(this.prisma, [last?.updatedBy ?? null]);
    return { positions, teams, updatedAt: last?.updatedAt.toISOString() ?? null, updatedBy: userRef(last?.updatedBy ?? null, names) };
  }

  /**
   * HR's choices for the positions: each sent shown or hidden, with a public name (empty, or its own name: none). Only
   * the ones that changed are kept (a position back to shown by its own name has no row) and audited: those hidden,
   * those shown again, and the public names given or taken away. A position not on the list (its job titles changed
   * since the page opened) refuses the save.
   */
  async savePositions(dto: CvPositionChoicesDto, user: SessionUser): Promise<CvPositionsView> {
    const sent = (Array.isArray(dto.positions) ? dto.positions : []).map((r) => {
      const row = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
      const name = typeof row.publicName === 'string' ? row.publicName.trim().replace(/\s+/g, ' ') : '';
      return { key: typeof row.key === 'string' ? row.key : '', hidden: row.hidden === true, publicName: name || null };
    });
    const positions = await positionsOf(this.prisma);
    const byKey = new Map(positions.map((p) => [p.key, p]));
    const problems = positionChoiceProblems(sent, new Set(byKey.keys()));
    if (problems.length) throw new BadRequestException(problems);
    const changed = new Map<string, { position: CvPosition; hidden: boolean; publicName: string | null }>();
    for (const r of sent) {
      const position = byKey.get(r.key)!;
      const publicName = r.publicName && r.publicName !== position.name ? r.publicName : null;
      if (position.hidden === r.hidden && position.publicName === publicName) changed.delete(r.key);
      else changed.set(r.key, { position, hidden: r.hidden, publicName });
    }
    if (!changed.size) return this.positions();
    const now = new Date();
    await this.prisma.$transaction(
      [...changed.values()].map((c) =>
        c.hidden || c.publicName
          ? this.prisma.cvPositionChoice.upsert({
              where: { key: c.position.key },
              create: { key: c.position.key, hidden: c.hidden, publicName: c.publicName, updatedById: user.id, updatedAt: now },
              update: { hidden: c.hidden, publicName: c.publicName, updatedById: user.id, updatedAt: now },
            })
          : // back to shown by its own name: no row (the last change is still told by the audit log)
            this.prisma.cvPositionChoice.deleteMany({ where: { key: c.position.key } }),
      ),
    );
    // a position by its own name and its team, "Video Editor (Video · Production)"
    const named = (p: CvPosition) => `${p.name} (${p.teamHrName})`;
    const all = [...changed.values()];
    const hidden = all.filter((c) => c.hidden && !c.position.hidden).map((c) => named(c.position));
    const shownAgain = all.filter((c) => !c.hidden && c.position.hidden).map((c) => named(c.position));
    const publicNames = all.filter((c) => c.publicName !== c.position.publicName).map((c) => `${named(c.position)}: ${c.position.publicName ?? 'its own name'} → ${c.publicName ?? 'its own name'}`);
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: SETTINGS_ENTITY,
      entityId: null,
      diff: { positionsOnCvForm: { ...(hidden.length && { hidden }), ...(shownAgain.length && { shownAgain }), ...(publicNames.length && { publicNames }) } },
    });
    return this.positions();
  }
}
