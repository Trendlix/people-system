import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import {
  APPLICATION_EVENT_LABELS,
  applicationSourceOf,
  applicationSourceText,
  CANDIDATE_LIMITS,
  candidateEmail,
  candidateMobile,
  END_REASON_LABELS,
  GENERAL_CV_EVENT_LABELS,
  GENERAL_CV_SOURCE_LABELS,
  INTERVIEW_KIND_LABELS,
  INTERVIEW_STATUS_LABELS,
  isGeneralCvSource,
  isGeneralCvStatus,
  isWeakMatch,
  matchReasons,
  mobileSearchForms,
  OFFER_STATUS_LABELS,
  rankMatches,
  type ApplicationCandidate,
  type ApplicationEvent,
  type ApplicationStage,
  type CandidateApplication,
  type CandidateBackfillResult,
  type CandidateBadge,
  type CandidateCv,
  type CandidateEmployeeLink,
  type CandidateEmployeeState,
  type CandidateGeneralCv,
  type CandidateInterview,
  type CandidateListItem,
  type CandidateMatchKind,
  type CandidateMergeView,
  type CandidateOffer,
  type CandidateSummary,
  type CandidateTimelineItem,
  type CandidateView,
  type EndReason,
  type GeneralCvSource,
  type GeneralCvStatus,
  type MatchSignal,
  type PossibleMatches,
  type PossibleMatchView,
  type RehireEligibility,
  type VacancyStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { attachCandidate, findCandidates, lockCandidates, nextCandidateCode, pairOf, refreshCandidate } from './candidate-links.js';
import { InterviewsService } from './interviews.service.js';
import { managesRecruitment, READS, vacancyWhere } from './recruitment-access.js';
import { recruitmentCaller } from './recruitment-scope.js';

// Candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and prevent
// duplication? even if the same candidate applied for 2 jobs"; "Email or mobile"; "Link and show rehire"; "HR decides
// from suggested match"; packages/shared candidates.ts). Who sees them: those who see the applicants' lists today (HR,
// the CEO, a Super Admin; a C-level vacancy's applications only the CEO and a Super Admin); hiring managers and
// interviewers keep only what they see today, so no profile and no other applications. HR and a Super Admin merge two
// candidates, dismiss a pair ("Not the same person") and move an application to a new candidate; only a Super Admin
// undoes a merge. Every merge, undo, dismissal and split is audited.
// - The backfill (once on deploy, main.ts, under an advisory lock; then a sweep every 10 minutes for any row a path
//   left without one): the applications and general CVs from before, oldest first, joined as a new one would be
//   (the email, else the mobile normalized with the system's phone rule, an unparseable one matching nobody), a moved
//   general CV and its application one candidate; then each candidate refreshed (keys, matches, employee).
// - A CV read (CvReadingsService) and an offer's answer (RecruitmentOffersService) refresh their candidate.

export const CANDIDATE_ENTITY = 'candidate';

const NOT_FOUND = 'Candidate not found.';
const BACKFILL_LOCK = 'people-system:candidates-backfill';
const SWEEP_MS = 10 * 60_000;

/** What was moved by a merge, kept to undo it. */
interface Moved {
  applicationIds: string[];
  generalCvIds: string[];
  contactIds: string[];
  employeeId: string | null;
  linkedin: string | null;
  portfolio: string | null;
  carried: string[];
}

const movedOf = (value: Prisma.JsonValue): Moved => {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const str = (x: unknown) => (typeof x === 'string' ? x : null);
  return {
    applicationIds: ids(o.applicationIds),
    generalCvIds: ids(o.generalCvIds),
    contactIds: ids(o.contactIds),
    employeeId: str(o.employeeId),
    linkedin: str(o.linkedin),
    portfolio: str(o.portfolio),
    carried: ids(o.carried),
  };
};

const APP_SELECT = {
  id: true,
  number: true,
  createdAt: true,
  stage: true,
  filteredOut: true,
  rejectReason: true,
  matchPercent: true,
  cvMatchPercent: true,
  source: true,
  employeeId: true,
  vacancy: { select: { id: true, number: true, title: true, status: true } },
  generalCv: { select: { id: true, source: true } },
} satisfies Prisma.JobApplicationSelect;
type AppRow = Prisma.JobApplicationGetPayload<{ select: typeof APP_SELECT }>;

const GCV_SELECT = {
  id: true,
  number: true,
  status: true,
  source: true,
  createdAt: true,
  areaOther: true,
  department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  application: { select: { id: true, number: true } },
} satisfies Prisma.GeneralCvSelect;
type GcvRow = Prisma.GeneralCvGetPayload<{ select: typeof GCV_SELECT }>;

const applicationView = (a: AppRow): CandidateApplication => {
  const source = applicationSourceOf(a.source);
  const generalSource = a.generalCv && isGeneralCvSource(a.generalCv.source) ? a.generalCv.source : null;
  return {
    id: a.id,
    number: a.number,
    vacancy: { id: a.vacancy.id, number: a.vacancy.number, title: a.vacancy.title, status: a.vacancy.status as VacancyStatus },
    appliedAt: a.createdAt.toISOString(),
    stage: a.stage as ApplicationStage,
    filteredOut: a.filteredOut,
    rejectReason: a.stage === 'rejected' ? a.rejectReason : null,
    matchPercent: a.matchPercent,
    cvMatchPercent: a.cvMatchPercent,
    source,
    sourceText: applicationSourceText({ source, generalSource }),
    employeeId: a.employeeId,
  };
};

const areaOf = (g: { department: { nameEn: string; parent: { nameEn: string } | null } | null; areaOther: string | null }) =>
  g.department ? (g.department.parent ? `${g.department.nameEn} · ${g.department.parent.nameEn}` : g.department.nameEn) : (g.areaOther ?? 'Other');

const generalView = (g: GcvRow): CandidateGeneralCv => ({
  id: g.id,
  number: g.number,
  status: (isGeneralCvStatus(g.status) ? g.status : 'new') as GeneralCvStatus,
  area: areaOf(g),
  source: (isGeneralCvSource(g.source) ? g.source : 'other') as GeneralCvSource,
  receivedAt: g.createdAt.toISOString(),
  movedTo: g.application ? { applicationId: g.application.id, reference: g.application.number } : null,
});

@Injectable()
export class CandidatesService implements OnModuleDestroy {
  private readonly logger = new Logger('Candidates');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly interviews: InterviewsService,
  ) {}

  // ---------- the backfill ----------

  /** The backfill now, then the sweep every 10 minutes (main.ts, once the API listens; the tests run it themselves). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<void> {
    try {
      const r = await this.backfill();
      if (r && (r.applications || r.generalCvs)) this.logger.log(`Candidates: ${r.applications} applications and ${r.generalCvs} general CVs joined (${r.created} new candidates).`);
    } catch (err) {
      this.logger.error(`The candidates' backfill failed: ${(err as Error).message}`);
    }
  }

  /**
   * Every application and general CV without a candidate joined to one, oldest first, as a new one would be: the email's
   * candidate, else the mobile's (normalized with the system's phone rule; one that can't be dialled matches nobody),
   * else a new one; a general CV and the application moved from it one candidate. Then each candidate touched
   * refreshed. Idempotent: what has a candidate is left as it is. Null when another process is running it.
   */
  async backfill(): Promise<CandidateBackfillResult | null> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${BACKFILL_LOCK})) AS locked`;
        if (!lock?.locked) return null;
        await lockCandidates(tx);
        const [apps, cvs] = await Promise.all([
          tx.jobApplication.findMany({
            where: { candidateId: null },
            select: { id: true, fullName: true, email: true, mobile: true, linkedin: true, portfolio: true, createdAt: true, generalCv: { select: { id: true, candidateId: true } } },
          }),
          tx.generalCv.findMany({ where: { candidateId: null }, select: { id: true, fullName: true, email: true, mobile: true, linkedin: true, portfolio: true, createdAt: true } }),
        ]);
        const out: CandidateBackfillResult = { applications: 0, generalCvs: 0, created: 0, joined: 0, employeesLinked: 0 };
        if (!apps.length && !cvs.length) return out;
        type Row = { kind: 'app'; row: (typeof apps)[number] } | { kind: 'cv'; row: (typeof cvs)[number] };
        // oldest first; a general CV before the application moved from it (made later, or at the same moment)
        const rows: Row[] = [...cvs.map((row): Row => ({ kind: 'cv', row })), ...apps.map((row): Row => ({ kind: 'app', row }))].sort(
          (x, y) => x.row.createdAt.getTime() - y.row.createdAt.getTime() || (x.kind === 'cv' ? -1 : 1) - (y.kind === 'cv' ? -1 : 1),
        );
        const ofCv = new Map<string, string>();
        const touched = new Set<string>();
        for (const r of rows) {
          const hint = r.kind === 'app' && r.row.generalCv ? (r.row.generalCv.candidateId ?? ofCv.get(r.row.generalCv.id) ?? null) : null;
          const found = await findCandidates(tx, { email: r.row.email, mobile: r.row.mobile });
          const c = await attachCandidate(tx, { ...r.row, at: r.row.createdAt, candidateId: hint }, found);
          if (r.kind === 'app') {
            await tx.jobApplication.update({ where: { id: r.row.id }, data: { candidateId: c.id } });
            out.applications++;
          } else {
            await tx.generalCv.update({ where: { id: r.row.id }, data: { candidateId: c.id } });
            ofCv.set(r.row.id, c.id);
            out.generalCvs++;
          }
          if (c.created) out.created++;
          else out.joined++;
          touched.add(c.id);
        }
        for (const id of touched) {
          const done = await refreshCandidate(tx, id);
          if (done.employeeId) out.employeesLinked++;
        }
        return out;
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
    if (result && (result.applications || result.generalCvs)) {
      await this.audit.record({ userId: null, action: 'backfill', entityType: CANDIDATE_ENTITY, diff: { ...result } });
    }
    return result;
  }

  /** A candidate worked out again after its application's or general CV's CV was read, or an offer answered. Never throws. */
  async refreshFor(subject: { applicationId: string } | { generalCvId: string }): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockCandidates(tx);
        const row =
          'applicationId' in subject
            ? await tx.jobApplication.findUnique({ where: { id: subject.applicationId }, select: { candidateId: true } })
            : await tx.generalCv.findUnique({ where: { id: subject.generalCvId }, select: { candidateId: true } });
        if (row?.candidateId) await refreshCandidate(tx, row.candidateId);
      });
    } catch (err) {
      this.logger.warn(`A candidate could not be refreshed: ${(err as Error).message}`);
    }
  }

  // ---------- who sees what ----------

  private assertReads(user: SessionUser): void {
    if (!user.roles.some((r) => READS.includes(r))) throw new ForbiddenException('Only HR, the CEO and a Super Admin see the candidates.');
  }

  private assertManages(user: SessionUser): void {
    if (!managesRecruitment(user)) throw new ForbiddenException('Only HR and a Super Admin merge or split candidates.');
  }

  /** The candidates the caller sees: not merged, with an application on a vacancy they see, or a general CV. */
  private visibleWhere(user: SessionUser): Prisma.CandidateWhereInput {
    return { mergedIntoId: null, OR: [{ applications: { some: { vacancy: vacancyWhere(user) } } }, { generalCvs: { some: {} } }] };
  }

  private summarySelect(user: SessionUser) {
    return {
      id: true,
      code: true,
      fullName: true,
      lastAppliedAt: true,
      _count: { select: { applications: { where: { vacancy: vacancyWhere(user) } }, generalCvs: { where: { applicationId: null } } } },
    } satisfies Prisma.CandidateSelect;
  }

  private summaryOf(c: { id: string; code: string; fullName: string; lastAppliedAt: Date | null; _count: { applications: number; generalCvs: number } }): CandidateSummary {
    return { id: c.id, code: c.code, fullName: c.fullName, applications: c._count.applications, generalCvs: c._count.generalCvs, lastAppliedAt: c.lastAppliedAt?.toISOString() ?? null };
  }

  /** The employees the candidates are linked to, as the caller may see them (a C-level person's only as a record). */
  private async employeeLinks(ids: readonly (string | null)[], user: SessionUser): Promise<Map<string, CandidateEmployeeLink>> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return new Map();
    const [view, people] = await Promise.all([
      this.confidential.view(user),
      this.prisma.employee.findMany({
        where: { id: { in: wanted } },
        select: {
          id: true,
          employeeCode: true,
          fullNameEn: true,
          employments: {
            orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }],
            select: { endDate: true, endReason: true, offboarding: { select: { rehire: true, rehireReason: true } } },
          },
        },
      }),
    ]);
    const today = todayInCairo();
    const out = new Map<string, CandidateEmployeeLink>();
    for (const p of people) {
      if (view.hidden.has(p.id)) {
        out.set(p.id, { restricted: true, employee: null, state: null, leftOn: null, endReason: null, endReasonLabel: null, rehire: null, rehireReason: null });
        continue;
      }
      const current = p.employments.some((e) => !e.endDate || fromDateOnly(e.endDate) >= today);
      const last = p.employments[0];
      const state: CandidateEmployeeState = !p.employments.length ? 'record' : current ? 'current' : 'former';
      const endReason = state === 'former' && last?.endReason ? (last.endReason as EndReason) : null;
      out.set(p.id, {
        restricted: false,
        employee: { id: p.id, employeeCode: p.employeeCode, fullNameEn: p.fullNameEn },
        state,
        leftOn: state === 'former' && last?.endDate ? fromDateOnly(last.endDate) : null,
        endReason,
        endReasonLabel: endReason ? (END_REASON_LABELS[endReason] ?? null) : null,
        rehire: state === 'former' ? ((last?.offboarding?.rehire as RehireEligibility | null | undefined) ?? null) : null,
        rehireReason: state === 'former' ? (last?.offboarding?.rehireReason ?? null) : null,
      });
    }
    return out;
  }

  private static stateOf(link: CandidateEmployeeLink | undefined): CandidateEmployeeState | 'restricted' | null {
    if (!link) return null;
    return link.restricted ? 'restricted' : link.state;
  }

  // ---------- the lists ----------

  /** The Candidates list: ?q= finds by name, email, mobile (as typed in any form), code or the CVs' text. The latest first. */
  async list(q: string | undefined, user: SessionUser): Promise<CandidateListItem[]> {
    this.assertReads(user);
    const visibleApps = { vacancy: vacancyWhere(user) };
    const text = q?.trim() ? { contains: q.trim(), mode: 'insensitive' as const } : null;
    const search: Prisma.CandidateWhereInput = text
      ? {
          OR: [
            { code: text },
            { fullName: text },
            { contacts: { some: { value: text } } },
            ...mobileSearchForms(q!).map((f) => ({ contacts: { some: { kind: 'mobile', value: { contains: f } } } })),
            { applications: { some: { AND: [visibleApps, { OR: [{ fullName: text }, { email: text }, { mobile: text }, { number: text }, { cvReading: { is: { text } } }] }] } } },
            { generalCvs: { some: { OR: [{ fullName: text }, { email: text }, { mobile: text }, { number: text }, { cvReading: { is: { text } } }] } } },
          ],
        }
      : {};
    const rows = await this.prisma.candidate.findMany({
      where: { AND: [this.visibleWhere(user), search] },
      orderBy: [{ lastAppliedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: CANDIDATE_LIMITS.list,
      select: {
        id: true,
        code: true,
        fullName: true,
        lastAppliedAt: true,
        employeeId: true,
        applications: {
          where: visibleApps,
          orderBy: { createdAt: 'desc' },
          select: { id: true, number: true, createdAt: true, stage: true, filteredOut: true, source: true, vacancy: { select: { title: true } }, generalCv: { select: { source: true } } },
        },
        generalCvs: { where: { applicationId: null }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, createdAt: true, status: true, source: true } },
      },
    });
    const ids = rows.map((r) => r.id);
    const [links, open] = await Promise.all([this.employeeLinks(rows.map((r) => r.employeeId), user), this.openCounts(ids, user)]);
    return rows.map((r): CandidateListItem => {
      const a = r.applications[0];
      const g = r.generalCvs[0];
      const latest: CandidateListItem['latest'] =
        a && (!g || a.createdAt >= g.createdAt)
          ? {
              kind: 'application',
              id: a.id,
              reference: a.number,
              title: a.vacancy.title,
              stage: a.stage as ApplicationStage,
              filteredOut: a.filteredOut,
              generalStatus: null,
              source: applicationSourceText({ source: applicationSourceOf(a.source), generalSource: a.generalCv && isGeneralCvSource(a.generalCv.source) ? a.generalCv.source : null }),
              at: a.createdAt.toISOString(),
            }
          : g
            ? {
                kind: 'general_cv',
                id: g.id,
                reference: g.number,
                title: 'General CV',
                stage: null,
                filteredOut: false,
                generalStatus: (isGeneralCvStatus(g.status) ? g.status : 'new') as GeneralCvStatus,
                source: GENERAL_CV_SOURCE_LABELS[(isGeneralCvSource(g.source) ? g.source : 'other') as GeneralCvSource],
                at: g.createdAt.toISOString(),
              }
            : null;
      return {
        id: r.id,
        code: r.code,
        fullName: r.fullName,
        applications: r.applications.length,
        generalCvs: r.generalCvs.length,
        lastAppliedAt: r.lastAppliedAt?.toISOString() ?? null,
        latest,
        employee: CandidatesService.stateOf(r.employeeId ? links.get(r.employeeId) : undefined),
        openMatches: open.get(r.id) ?? 0,
      };
    });
  }

  /** The open possible matches of each candidate (the other one visible to the caller). */
  private async openCounts(ids: readonly string[], user: SessionUser): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const visible = this.visibleWhere(user);
    const rows = await this.prisma.candidateMatch.findMany({
      where: { status: 'open', OR: [{ candidateAId: { in: [...ids] } }, { candidateBId: { in: [...ids] } }], candidateA: visible, candidateB: visible },
      select: { candidateAId: true, candidateBId: true },
    });
    const out = new Map<string, number>();
    for (const r of rows) for (const id of [r.candidateAId, r.candidateBId]) out.set(id, (out.get(id) ?? 0) + 1);
    return out;
  }

  /** The possible matches HR hasn't decided, strongest first (a name alone last): the duplicates, then the suggestions. */
  async matches(user: SessionUser): Promise<PossibleMatches> {
    this.assertReads(user);
    const views = await this.matchViews({ status: 'open' }, user);
    return { duplicates: views.filter((m) => m.kind === 'duplicate'), suggested: views.filter((m) => m.kind === 'suggested') };
  }

  private async matchViews(where: Prisma.CandidateMatchWhereInput, user: SessionUser): Promise<PossibleMatchView[]> {
    const visible = this.visibleWhere(user);
    const select = this.summarySelect(user);
    const rows = await this.prisma.candidateMatch.findMany({
      where: { AND: [where, { candidateA: visible, candidateB: visible }] },
      select: { id: true, kind: true, signals: true, score: true, updatedAt: true, candidateA: { select }, candidateB: { select } },
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
      take: CANDIDATE_LIMITS.matches,
    });
    return rankMatches(
      rows.map((m): PossibleMatchView => {
        const signals = m.signals as MatchSignal[];
        return {
          id: m.id,
          kind: m.kind as CandidateMatchKind,
          signals,
          why: matchReasons(signals),
          score: m.score,
          weak: isWeakMatch(signals),
          candidates: [this.summaryOf(m.candidateA), this.summaryOf(m.candidateB)],
          updatedAt: m.updatedAt.toISOString(),
        };
      }),
    );
  }

  /** The candidates of applicants on a list or the board, for their badges ("2 applications", "Former employee"). */
  async badges(candidateIds: readonly (string | null)[], user: SessionUser): Promise<Map<string, CandidateBadge>> {
    const ids = [...new Set(candidateIds.filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const rows = await this.prisma.candidate.findMany({ where: { id: { in: ids } }, select: { ...this.summarySelect(user), employeeId: true } });
    const links = await this.employeeLinks(
      rows.map((r) => r.employeeId),
      user,
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          code: r.code,
          applications: r._count.applications,
          generalCvs: r._count.generalCvs,
          employee: CandidatesService.stateOf(r.employeeId ? links.get(r.employeeId) : undefined),
        },
      ]),
    );
  }

  // ---------- the profile ----------

  async get(id: string, user: SessionUser): Promise<CandidateView> {
    this.assertReads(user);
    const c = await this.prisma.candidate.findUnique({ where: { id }, select: { id: true, code: true, fullName: true, mergedIntoId: true } });
    if (!c) throw new NotFoundException(NOT_FOUND);
    if (c.mergedIntoId) {
      // merged: the profile it went into, when the caller sees it
      const into = await this.prisma.candidate.findFirst({ where: { AND: [{ id: c.mergedIntoId }, this.visibleWhere(user)] }, select: { id: true, code: true, fullName: true } });
      if (!into) throw new NotFoundException(NOT_FOUND);
      return this.emptyView(c, into);
    }
    const row = await this.prisma.candidate.findFirst({
      where: { AND: [{ id }, this.visibleWhere(user)] },
      select: {
        id: true,
        code: true,
        fullName: true,
        linkedin: true,
        portfolio: true,
        employeeId: true,
        createdAt: true,
        lastAppliedAt: true,
        contacts: { orderBy: { lastSeenAt: 'desc' }, select: { kind: true, value: true, firstSeenAt: true, lastSeenAt: true } },
        applications: {
          where: { vacancy: vacancyWhere(user) },
          orderBy: { createdAt: 'desc' },
          select: { ...APP_SELECT, cv: { select: { fileName: true, mimeType: true, sizeBytes: true, createdAt: true } }, steps: { orderBy: { at: 'asc' }, select: { event: true, at: true } } },
        },
        generalCvs: {
          orderBy: { createdAt: 'desc' },
          select: { ...GCV_SELECT, file: { select: { fileName: true, mimeType: true, sizeBytes: true } }, events: { orderBy: { at: 'asc' }, select: { event: true, at: true } } },
        },
        mergesKept: { orderBy: { at: 'desc' }, select: { id: true, at: true, undoneAt: true, moved: true, by: { select: { id: true, email: true } }, merged: { select: { id: true, code: true, fullName: true } } } },
      },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    const caller = recruitmentCaller(user, await this.confidential.selfId(user));
    const links = await this.employeeLinks([row.employeeId], user);
    const employee = row.employeeId ? (links.get(row.employeeId) ?? null) : null;
    const appIds = row.applications.map((a) => a.id);
    const offerWhere = await this.confidential.offerWhere(user);
    const [interviewLists, feedbackLists, offers, matches, names] = await Promise.all([
      Promise.all(row.applications.map((a) => this.interviews.ofApplication(a.id, caller))),
      Promise.all(row.applications.map((a) => this.interviews.feedbackOf(a.id, caller.selfId))),
      this.prisma.jobOffer.findMany({
        where: { AND: [offerWhere, { OR: [{ applicationId: { in: appIds } }, ...(employee && !employee.restricted && row.employeeId ? [{ employeeId: row.employeeId }] : [])] }] },
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, status: true, applicationId: true, createdAt: true, sentAt: true, respondedAt: true, withdrawnAt: true, application: { select: { vacancy: { select: { title: true } } } } },
      }),
      this.matchViews({ status: 'open', OR: [{ candidateAId: id }, { candidateBId: id }] }, user),
      userNames(
        this.prisma,
        row.mergesKept.map((m) => m.by),
      ),
    ]);
    const titleOf = new Map(row.applications.map((a) => [a.id, a.vacancy.title]));
    const interviews: CandidateInterview[] = row.applications.flatMap((a, i) =>
      interviewLists[i].map((iv) => ({ ...iv, vacancyTitle: a.vacancy.title, feedback: feedbackLists[i].filter((f) => f.interviewId === iv.id) })),
    );
    interviews.sort((x, y) => y.startsAt.localeCompare(x.startsAt));
    // every CV they sent, the newest first: an application's, and a general CV's (an application moved from a general CV holds its copy: listed once, as the general CV's)
    const movedApps = new Set(row.generalCvs.map((g) => g.application?.id).filter((x): x is string => !!x));
    const cvs: CandidateCv[] = [
      ...row.applications
        .filter((a) => a.cv && !movedApps.has(a.id))
        .map((a): CandidateCv => ({ kind: 'application', id: a.id, reference: a.number, title: a.vacancy.title, cvFileName: a.cv!.fileName, mimeType: a.cv!.mimeType, sizeBytes: a.cv!.sizeBytes, sentAt: a.createdAt.toISOString() })),
      ...row.generalCvs
        .filter((g) => g.file)
        .map((g): CandidateCv => ({ kind: 'general_cv', id: g.id, reference: g.number, title: 'General CV', cvFileName: g.file!.fileName, mimeType: g.file!.mimeType, sizeBytes: g.file!.sizeBytes, sentAt: g.createdAt.toISOString() })),
    ].sort((x, y) => y.sentAt.localeCompare(x.sentAt));
    const offerViews: CandidateOffer[] = offers.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      applicationId: o.applicationId,
      vacancyTitle: o.application?.vacancy.title ?? (o.applicationId ? (titleOf.get(o.applicationId) ?? null) : null),
      createdAt: o.createdAt.toISOString(),
    }));
    const superAdmin = isSuperAdmin(user);
    const merges: CandidateMergeView[] = row.mergesKept.map((m) => {
      const moved = movedOf(m.moved);
      return {
        id: m.id,
        merged: m.merged,
        at: m.at.toISOString(),
        by: m.by ? (names.get(m.by.id)?.name ?? m.by.email) : null,
        undoneAt: m.undoneAt?.toISOString() ?? null,
        moved: { applications: moved.applicationIds.length, generalCvs: moved.generalCvIds.length, contacts: moved.contactIds.length },
        canUndo: superAdmin && !m.undoneAt,
      };
    });
    const timeline: CandidateTimelineItem[] = [];
    for (const a of row.applications) {
      for (const s of a.steps) {
        timeline.push({ at: s.at.toISOString(), kind: 'application', text: `${APPLICATION_EVENT_LABELS[s.event as ApplicationEvent] ?? s.event}: ${a.vacancy.title} (${a.number})`, href: `/recruitment/applicants/${a.id}` });
      }
    }
    for (const g of row.generalCvs) {
      for (const e of g.events) timeline.push({ at: e.at.toISOString(), kind: 'general_cv', text: `General CV ${g.number}: ${GENERAL_CV_EVENT_LABELS[e.event] ?? e.event}`, href: `/recruitment/general-cvs/${g.id}` });
    }
    for (const iv of interviews) {
      timeline.push({ at: iv.startsAt, kind: 'interview', text: `Interview, ${INTERVIEW_KIND_LABELS[iv.kind]} (${INTERVIEW_STATUS_LABELS[iv.status]}): ${iv.vacancyTitle}`, href: `/recruitment/applicants/${iv.application.id}` });
    }
    for (const o of offers) {
      const label = (s: string) => OFFER_STATUS_LABELS[s as keyof typeof OFFER_STATUS_LABELS] ?? s;
      timeline.push({ at: o.createdAt.toISOString(), kind: 'offer', text: `Job offer ${o.number} drafted`, href: `/offers/${o.id}` });
      if (o.sentAt) timeline.push({ at: o.sentAt.toISOString(), kind: 'offer', text: `Job offer ${o.number} sent`, href: `/offers/${o.id}` });
      if (o.respondedAt) timeline.push({ at: o.respondedAt.toISOString(), kind: 'offer', text: `Job offer ${o.number}: ${label(o.status)}`, href: `/offers/${o.id}` });
      else if (o.withdrawnAt) timeline.push({ at: o.withdrawnAt.toISOString(), kind: 'offer', text: `Job offer ${o.number}: ${label('withdrawn')}`, href: `/offers/${o.id}` });
    }
    for (const m of merges) {
      timeline.push({ at: m.at, kind: 'merge', text: `${m.merged.code} merged into this profile`, href: null });
      if (m.undoneAt) timeline.push({ at: m.undoneAt, kind: 'merge', text: `The merge of ${m.merged.code} undone`, href: `/recruitment/candidates/${m.merged.id}` });
    }
    timeline.sort((x, y) => y.at.localeCompare(x.at));
    const manages = managesRecruitment(user);
    return {
      id: row.id,
      code: row.code,
      fullName: row.fullName,
      linkedin: row.linkedin,
      portfolio: row.portfolio,
      createdAt: row.createdAt.toISOString(),
      lastAppliedAt: row.lastAppliedAt?.toISOString() ?? null,
      mergedInto: null,
      emailContacts: row.contacts.filter((x) => x.kind === 'email').map((x) => ({ email: x.value, firstSeenAt: x.firstSeenAt.toISOString(), lastSeenAt: x.lastSeenAt.toISOString() })),
      mobileContacts: row.contacts.filter((x) => x.kind === 'mobile').map((x) => ({ mobile: x.value, firstSeenAt: x.firstSeenAt.toISOString(), lastSeenAt: x.lastSeenAt.toISOString() })),
      cvs,
      applications: row.applications.map(applicationView),
      generalCvs: row.generalCvs.map(generalView),
      interviews,
      offers: offerViews,
      employee,
      matches,
      merges,
      timeline,
      can: { merge: manages, dismiss: manages, split: manages, undoMerge: superAdmin },
    };
  }

  private emptyView(c: { id: string; code: string; fullName: string }, into: { id: string; code: string; fullName: string }): CandidateView {
    return {
      ...c,
      linkedin: null,
      portfolio: null,
      createdAt: new Date(0).toISOString(),
      lastAppliedAt: null,
      mergedInto: into,
      emailContacts: [],
      mobileContacts: [],
      cvs: [],
      applications: [],
      generalCvs: [],
      interviews: [],
      offers: [],
      employee: null,
      matches: [],
      merges: [],
      timeline: [],
      can: { merge: false, dismiss: false, split: false, undoMerge: false },
    };
  }

  /**
   * On an applicant's page, for HR, the CEO and a Super Admin (never a hiring manager or an interviewer): their candidate,
   * their other applications (on the vacancies the caller sees), general CVs, the employee and the possible matches.
   */
  async ofApplication(application: { id: string; candidateId: string | null }, user: SessionUser): Promise<ApplicationCandidate | null> {
    if (!application.candidateId || !user.roles.some((r) => READS.includes(r))) return null;
    const c = await this.prisma.candidate.findUnique({
      where: { id: application.candidateId },
      select: {
        id: true,
        code: true,
        fullName: true,
        employeeId: true,
        applications: { where: { vacancy: vacancyWhere(user), id: { not: application.id } }, orderBy: { createdAt: 'desc' }, select: APP_SELECT },
        generalCvs: { orderBy: { createdAt: 'desc' }, select: GCV_SELECT },
        _count: { select: { applications: true } },
      },
    });
    if (!c) return null;
    const links = await this.employeeLinks([c.employeeId], user);
    const matches = await this.matchViews({ status: 'open', OR: [{ candidateAId: c.id }, { candidateBId: c.id }] }, user);
    const others = c._count.applications - 1 + c.generalCvs.filter((g) => g.application?.id !== application.id).length;
    return {
      id: c.id,
      code: c.code,
      fullName: c.fullName,
      otherApplications: c.applications.map(applicationView),
      generalCvs: c.generalCvs.map(generalView),
      employee: c.employeeId ? (links.get(c.employeeId) ?? null) : null,
      matches,
      canSplit: managesRecruitment(user) && others > 0,
    };
  }

  // ---------- HR's decisions ----------

  /**
   * "Merge with…" (HR, a Super Admin), or a suggested match confirmed: `otherId` merged into `keptId`. Its applications,
   * general CVs, contacts and employee move to the kept one (its links where the kept has none); it is kept, marked
   * merged, with what moved, so a Super Admin can undo it; the pairs HR dismissed carried over.
   */
  async merge(keptId: string, otherId: string, user: SessionUser): Promise<CandidateView> {
    this.assertManages(user);
    if (keptId === otherId) throw new BadRequestException(['Choose another candidate to merge with.']);
    const visible = this.visibleWhere(user);
    const [k0, o0] = await Promise.all([
      this.prisma.candidate.findFirst({ where: { AND: [{ id: keptId }, visible] }, select: { id: true } }),
      this.prisma.candidate.findFirst({ where: { AND: [{ id: otherId }, visible] }, select: { id: true } }),
    ]);
    if (!k0 || !o0) throw new NotFoundException(NOT_FOUND);
    const done = await this.prisma.$transaction(async (tx) => {
      await lockCandidates(tx);
      const select = { id: true, code: true, mergedIntoId: true, employeeId: true, linkedin: true, portfolio: true } as const;
      const [k, o] = await Promise.all([tx.candidate.findUnique({ where: { id: keptId }, select }), tx.candidate.findUnique({ where: { id: otherId }, select })]);
      if (!k || !o) throw new NotFoundException(NOT_FOUND);
      if (k.mergedIntoId || o.mergedIntoId) throw new ConflictException('One of them was merged into another candidate meanwhile. Reload the page.');
      const [apps, cvs, contacts] = await Promise.all([
        tx.jobApplication.findMany({ where: { candidateId: o.id }, select: { id: true } }),
        tx.generalCv.findMany({ where: { candidateId: o.id }, select: { id: true } }),
        tx.candidateContact.findMany({ where: { candidateId: o.id }, select: { id: true } }),
      ]);
      await tx.jobApplication.updateMany({ where: { candidateId: o.id }, data: { candidateId: k.id } });
      await tx.generalCv.updateMany({ where: { candidateId: o.id }, data: { candidateId: k.id } });
      await tx.candidateContact.updateMany({ where: { candidateId: o.id }, data: { candidateId: k.id } });
      const linkedin = !k.linkedin && o.linkedin ? o.linkedin : null;
      const portfolio = !k.portfolio && o.portfolio ? o.portfolio : null;
      if (linkedin || portfolio) await tx.candidate.update({ where: { id: k.id }, data: { ...(linkedin && { linkedin }), ...(portfolio && { portfolio }) } });
      const now = new Date();
      await tx.candidate.update({ where: { id: o.id }, data: { mergedIntoId: k.id, mergedAt: now } });
      const pair = pairOf(k.id, o.id);
      await tx.candidateMatch.upsert({
        where: { candidateAId_candidateBId: pair },
        create: { ...pair, kind: 'suggested', status: 'merged', decidedById: user.id, decidedAt: now },
        update: { status: 'merged', decidedById: user.id, decidedAt: now },
      });
      // the merged one's other pairs: the open ones go (worked out again on the kept one), the dismissed ones carried over
      const theirs = await tx.candidateMatch.findMany({ where: { OR: [{ candidateAId: o.id }, { candidateBId: o.id }] } });
      const carried: string[] = [];
      for (const m of theirs) {
        const third = m.candidateAId === o.id ? m.candidateBId : m.candidateAId;
        if (third === k.id) continue;
        if (m.status === 'open') {
          await tx.candidateMatch.delete({ where: { id: m.id } });
          continue;
        }
        if (m.status !== 'dismissed') continue;
        const p = pairOf(k.id, third);
        const there = await tx.candidateMatch.findUnique({ where: { candidateAId_candidateBId: p }, select: { id: true, status: true } });
        if (!there) {
          const made = await tx.candidateMatch.create({ data: { ...p, kind: m.kind, signals: m.signals, score: m.score, status: 'dismissed', decidedById: m.decidedById, decidedAt: m.decidedAt } });
          carried.push(made.id);
        } else if (there.status === 'open') {
          await tx.candidateMatch.update({ where: { id: there.id }, data: { status: 'dismissed', decidedById: m.decidedById, decidedAt: m.decidedAt } });
          carried.push(there.id);
        }
      }
      const moved: Moved = {
        applicationIds: apps.map((a) => a.id),
        generalCvIds: cvs.map((g) => g.id),
        contactIds: contacts.map((x) => x.id),
        employeeId: !k.employeeId && o.employeeId ? o.employeeId : null,
        linkedin,
        portfolio,
        carried,
      };
      const merge = await tx.candidateMerge.create({ data: { keptId: k.id, mergedId: o.id, moved: moved as unknown as Prisma.InputJsonValue, byId: user.id }, select: { id: true } });
      await refreshCandidate(tx, o.id);
      await refreshCandidate(tx, k.id);
      return { merge, k, o, moved };
    });
    await this.audit.record({
      userId: user.id,
      action: 'merge',
      entityType: CANDIDATE_ENTITY,
      entityId: done.k.id,
      diff: { kept: done.k.code, merged: done.o.code, applications: done.moved.applicationIds.length, generalCvs: done.moved.generalCvIds.length, contacts: done.moved.contactIds.length, mergeId: done.merge.id },
    });
    return this.get(keptId, user);
  }

  /** A merge undone (a Super Admin): what moved goes back, the merged candidate is one again. */
  async undoMerge(mergeId: string, user: SessionUser): Promise<CandidateView> {
    if (!isSuperAdmin(user)) throw new ForbiddenException('Only a Super Admin undoes a merge.');
    const done = await this.prisma.$transaction(async (tx) => {
      await lockCandidates(tx);
      const m = await tx.candidateMerge.findUnique({
        where: { id: mergeId },
        select: { id: true, undoneAt: true, moved: true, kept: { select: { id: true, code: true, mergedIntoId: true, linkedin: true, portfolio: true } }, merged: { select: { id: true, code: true, mergedIntoId: true } } },
      });
      if (!m) throw new NotFoundException('Merge not found.');
      if (m.undoneAt) throw new ConflictException('This merge was undone already.');
      if (m.kept.mergedIntoId) throw new ConflictException(`${m.kept.code} was merged into another candidate since: undo that merge first.`);
      if (m.merged.mergedIntoId !== m.kept.id) throw new ConflictException(`${m.merged.code} is no longer merged into ${m.kept.code}.`);
      const moved = movedOf(m.moved);
      const back = { candidateId: m.merged.id };
      const [apps, cvs, contacts] = await Promise.all([
        tx.jobApplication.updateMany({ where: { id: { in: moved.applicationIds }, candidateId: m.kept.id }, data: back }),
        tx.generalCv.updateMany({ where: { id: { in: moved.generalCvIds }, candidateId: m.kept.id }, data: back }),
        tx.candidateContact.updateMany({ where: { id: { in: moved.contactIds }, candidateId: m.kept.id }, data: back }),
      ]);
      const links: Prisma.CandidateUpdateInput = {
        ...(moved.linkedin && m.kept.linkedin === moved.linkedin && { linkedin: null }),
        ...(moved.portfolio && m.kept.portfolio === moved.portfolio && { portfolio: null }),
      };
      if (Object.keys(links).length) await tx.candidate.update({ where: { id: m.kept.id }, data: links });
      await tx.candidate.update({ where: { id: m.merged.id }, data: { mergedIntoId: null, mergedAt: null } });
      // the pair as before the merge: worked out again; the dismissals carried over taken back
      await tx.candidateMatch.deleteMany({ where: { ...pairOf(m.kept.id, m.merged.id), status: 'merged' } });
      if (moved.carried.length) await tx.candidateMatch.deleteMany({ where: { id: { in: moved.carried } } });
      await tx.candidateMerge.update({ where: { id: m.id }, data: { undoneAt: new Date(), undoneById: user.id } });
      await refreshCandidate(tx, m.merged.id);
      await refreshCandidate(tx, m.kept.id);
      return { m, counts: { applications: apps.count, generalCvs: cvs.count, contacts: contacts.count } };
    });
    await this.audit.record({
      userId: user.id,
      action: 'undo_merge',
      entityType: CANDIDATE_ENTITY,
      entityId: done.m.kept.id,
      diff: { kept: done.m.kept.code, merged: done.m.merged.code, ...done.counts, mergeId },
    });
    return this.get(done.m.kept.id, user);
  }

  /** "Not the same person" (HR, a Super Admin): the pair dismissed, never suggested again. */
  async dismiss(matchId: string, user: SessionUser): Promise<{ id: string; status: 'dismissed' }> {
    this.assertManages(user);
    const visible = this.visibleWhere(user);
    const m = await this.prisma.candidateMatch.findFirst({
      where: { id: matchId, candidateA: visible, candidateB: visible },
      select: { id: true, status: true, signals: true, candidateA: { select: { id: true, code: true } }, candidateB: { select: { code: true } } },
    });
    if (!m) throw new NotFoundException('Possible match not found.');
    const { count } = await this.prisma.candidateMatch.updateMany({ where: { id: matchId, status: 'open' }, data: { status: 'dismissed', decidedById: user.id, decidedAt: new Date() } });
    if (!count) throw new ConflictException(m.status === 'merged' ? 'They were merged already.' : 'This pair was dismissed already.');
    await this.audit.record({
      userId: user.id,
      action: 'dismiss_match',
      entityType: CANDIDATE_ENTITY,
      entityId: m.candidateA.id,
      diff: { candidates: [m.candidateA.code, m.candidateB.code], reasons: matchReasons(m.signals as MatchSignal[]) },
    });
    return { id: matchId, status: 'dismissed' };
  }

  /**
   * "Move to a new candidate" on an application (HR, a Super Admin): a wrong match split. The application (and the
   * general CV it was moved from) goes to a new candidate, with the contacts used only there; the two are dismissed as
   * a pair (HR said they are not the same person).
   */
  async split(applicationId: string, user: SessionUser): Promise<{ id: string; code: string }> {
    this.assertManages(user);
    const a = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, vacancy: vacancyWhere(user) }, select: { id: true } });
    if (!a) throw new NotFoundException('Applicant not found.');
    const done = await this.prisma.$transaction(async (tx) => {
      await lockCandidates(tx);
      const app = await tx.jobApplication.findUniqueOrThrow({
        where: { id: applicationId },
        select: { id: true, number: true, candidateId: true, fullName: true, email: true, mobile: true, linkedin: true, portfolio: true, createdAt: true, generalCv: { select: { id: true } } },
      });
      if (!app.candidateId) throw new ConflictException('They have no candidate profile yet. Try again in a few minutes.');
      const old = await tx.candidate.findUniqueOrThrow({ where: { id: app.candidateId }, select: { id: true, code: true } });
      const movedCv = app.generalCv?.id ?? null;
      const [restApps, restCvs] = await Promise.all([
        tx.jobApplication.findMany({ where: { candidateId: old.id, id: { not: app.id } }, select: { email: true, mobile: true } }),
        tx.generalCv.findMany({ where: { candidateId: old.id, ...(movedCv && { id: { not: movedCv } }) }, select: { email: true, mobile: true } }),
      ]);
      if (!restApps.length && !restCvs.length) throw new ConflictException('This is all their candidate profile holds: there is nothing to split.');
      const code = await nextCandidateCode(tx);
      const now = new Date();
      const made = await tx.candidate.create({
        data: { code, fullName: app.fullName, linkedin: app.linkedin, portfolio: app.portfolio, lastAppliedAt: app.createdAt, createdAt: now },
        select: { id: true, code: true },
      });
      await tx.jobApplication.update({ where: { id: app.id }, data: { candidateId: made.id } });
      if (movedCv) await tx.generalCv.update({ where: { id: movedCv }, data: { candidateId: made.id } });
      // the contacts used only there go with it
      const rest = [...restApps, ...restCvs];
      const email = candidateEmail(app.email);
      const mobile = candidateMobile(app.mobile);
      const kept = {
        email: new Set(rest.map((r) => candidateEmail(r.email)).filter(Boolean)),
        mobile: new Set(rest.map((r) => candidateMobile(r.mobile)).filter((x): x is string => !!x)),
      };
      let contacts = 0;
      for (const [kind, value] of [
        ['email', email],
        ['mobile', mobile],
      ] as const) {
        if (!value || kept[kind].has(value)) continue;
        const { count } = await tx.candidateContact.updateMany({ where: { kind, value, candidateId: old.id }, data: { candidateId: made.id } });
        contacts += count;
      }
      // HR said they are not the same person
      await tx.candidateMatch.upsert({
        where: { candidateAId_candidateBId: pairOf(old.id, made.id) },
        create: { ...pairOf(old.id, made.id), kind: 'suggested', status: 'dismissed', decidedById: user.id, decidedAt: now },
        update: { status: 'dismissed', decidedById: user.id, decidedAt: now },
      });
      await refreshCandidate(tx, made.id);
      await refreshCandidate(tx, old.id);
      return { old, made, number: app.number, contacts };
    });
    await this.audit.record({
      userId: user.id,
      action: 'split',
      entityType: CANDIDATE_ENTITY,
      entityId: done.made.id,
      diff: { from: done.old.code, to: done.made.code, application: done.number, contacts: done.contacts },
    });
    return done.made;
  }
}
