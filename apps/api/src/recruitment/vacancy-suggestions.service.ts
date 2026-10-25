import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cvFactsOf,
  cvSkillsMatcher,
  inviteLink,
  inviteMail,
  isOpenSuggestion,
  latestVerdictsBy,
  minYearsWanted,
  OPEN_SUGGESTIONS,
  SUGGESTION_LIMITS,
  SUGGESTION_STATUS_LABELS,
  SUGGESTION_STATUSES,
  suggestionsFor,
  suggestionsNotice,
  takesApplications,
  type RehireEligibility,
  type ScreeningCv,
  type ScreeningVerdict,
  type SuggestionAdded,
  type SuggestionPerson,
  type SuggestionReason,
  type SuggestionRecord,
  type SuggestionStatus,
  type SuggestionVacancy,
  type VacancySuggestions,
  type VacancySuggestionView,
  type VacancyStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, dayInCairo, todayInCairo, toDateOnly } from '../common/date-only.js';
import { webOriginOf } from '../employee-access/employee-access.service.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CvReadingsService } from './cv-readings.service.js';
import { GeneralCvsService } from './general-cvs.service.js';
import { createHrApplication } from './hr-applications.js';
import { CONFIDENTIAL_VACANCY, decidesSuggestions, isConfidentialVacancy, READS, vacancyWhere } from './recruitment-access.js';
import { APPLICATION_ENTITY, money, questionsOf, userRef } from './recruitment-views.js';
import type { MoveGeneralCvDto } from './recruitment.dto.js';
import { ScreeningCommentsService } from './screening-comments.service.js';

// Suggested From Earlier CVs on each open vacancy (owner, 24 October 2026: "does the system automatically add recomended
// general cv's to the opened posts?" and "is there a run to fetch previously updated CV's?"; asked, "Suggest; HR adds",
// "General CVs + past applicants", "Yes, HR presses 'Invite to apply'"; packages/shared suggested-cvs.ts):
// - Worked out (suggestionsFor) for each open vacancy taking applications, never a C-level one: the general CVs (new or
//   reviewed) and the applications to other jobs of the last months (Recruitment Settings, 12 unless changed), one a
//   candidate, scored with their reasons; the top 50 kept in vacancy_suggestions. Decided ones stay, so a dismissed one
//   never comes back; a suggested one no longer matching is deleted; one now on the vacancy (applied, or added another
//   way) closed as applied. A general CV's position (owner, 25 October 2026: "Position, grouped by team"), the one chosen
//   or written for Other, counts as a title beside its CV's latest, the better taken; its team counts as the area did.
// - When: the vacancy's page opens (kept 2 minutes; never for a developer, who changes nothing); a vacancy approved or
//   opened again; a round of the CV readings that read an application's or a general CV's CV; the recruitment round,
//   every hour. HR told once a batch ("5 earlier CVs match Video Editor"): the new ones nobody was told of, never those
//   HR worked out by opening the page (they saw them).
// - HR (or a Super Admin) adds one (a general CV moved as "General CV (suggested)"; an earlier applicant's newest CV
//   made into an application as "Earlier applicant (suggested)", its contacts and CV copied, no new upload), invites one
//   by email (only when HR presses it, with email set up and the vacancy taking applications: the job and its link with
//   ?src=invite; applying through it closes the suggestion), or dismisses one (an optional reason). Each in the audit log
//   (an invitation by its address, never its words). The CEO reads; a hiring manager never sees them.

export const SUGGESTION_ENTITY = 'vacancy_suggestion';

const NOT_FOUND = 'Suggestion not found.';
const VACANCY_NOT_FOUND = 'Vacancy not found.';

/** What a vacancy is read with to work its suggestions out. */
const VACANCY_SELECT = {
  id: true,
  number: true,
  slug: true,
  title: true,
  status: true,
  closingDate: true,
  departmentId: true,
  keySkills: true,
  questions: true,
  grade: { select: { confidential: true } },
  jobTitle: { select: { minGrade: { select: { confidential: true } } } },
} satisfies Prisma.VacancySelect;

type VacancyRow = Prisma.VacancyGetPayload<{ select: typeof VACANCY_SELECT }>;

const READING = { select: { status: true, text: true, facts: true } } as const;
const CV_FILE = { select: { fileName: true, mimeType: true, sizeBytes: true } } as const;

/** What a suggestion is read with for its row. */
const ROW_SELECT = {
  id: true,
  vacancyId: true,
  candidateId: true,
  status: true,
  score: true,
  reasons: true,
  invitedAt: true,
  invitedTo: true,
  dismissReason: true,
  decidedAt: true,
  createdAt: true,
  candidate: { select: { id: true, code: true, fullName: true } },
  generalCv: {
    select: {
      id: true,
      number: true,
      status: true,
      fullName: true,
      email: true,
      createdAt: true,
      areaOther: true,
      department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
      // the position chosen, or written for Other (25 October 2026)
      positionName: true,
      positionOther: true,
      file: CV_FILE,
    },
  },
  sourceApplication: { select: { id: true, number: true, fullName: true, email: true, createdAt: true, vacancy: { select: { id: true, number: true, title: true } }, cv: CV_FILE } },
  application: { select: { id: true, number: true } },
  decidedBy: { select: { id: true, email: true } },
} satisfies Prisma.VacancySuggestionSelect;

type SuggestionRow = Prisma.VacancySuggestionGetPayload<{ select: typeof ROW_SELECT }>;

/** The pool every open vacancy's suggestions are worked out from, read once a refresh. */
interface Pool {
  now: Date;
  recencyMonths: number;
  people: Map<string, SuggestionPerson>;
  records: SuggestionRecord[];
  topOf: (departmentId: string | null) => string | null;
  isTeam: (departmentId: string | null) => boolean;
}

/** A team as an area: "Video · Production"; a department as itself; Other in words. */
const areaOf = (g: { department: { nameEn: string; parent: { nameEn: string } | null } | null; areaOther: string | null }) =>
  g.department ? (g.department.parent ? `${g.department.nameEn} · ${g.department.parent.nameEn}` : g.department.nameEn) : (g.areaOther ?? 'Other');

const reasonsOf = (value: Prisma.JsonValue): SuggestionReason[] => (Array.isArray(value) ? (value as unknown as SuggestionReason[]) : []);

@Injectable()
export class VacancySuggestionsService implements OnModuleInit {
  private readonly logger = new Logger('SuggestedCvs');
  /** When each vacancy's suggestions were last worked out (ms): its page works them out again after 2 minutes. */
  private readonly fresh = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly confidential: ConfidentialService,
    private readonly readings: CvReadingsService,
    private readonly generalCvs: GeneralCvsService,
    private readonly comments: ScreeningCommentsService,
    private readonly config: ConfigService,
  ) {}

  /** A round of the CV readings that read new CVs: matched with the open vacancies, HR told of new matches. */
  onModuleInit(): void {
    this.readings.onCvsRead(() => this.refreshAll({ notify: true }).then(() => undefined));
  }

  // ---------- working them out ----------

  /** Why none are worked out for a vacancy now: C-level (never), not taking applications; null: they are. */
  private pausedOf(v: VacancyRow): VacancySuggestions['paused'] {
    if (isConfidentialVacancy(v)) return 'c_level';
    return takesApplications({ status: v.status, closingDate: fromDateOnly(v.closingDate) }, todayInCairo()) ? null : 'not_open';
  }

  /** The open vacancies taking applications, never a C-level one. */
  private openVacancies(): Promise<VacancyRow[]> {
    const today = toDateOnly(todayInCairo());
    return this.prisma.vacancy.findMany({
      where: { AND: [{ status: 'open' }, { OR: [{ closingDate: null }, { closingDate: { gte: today } }] }, { NOT: CONFIDENTIAL_VACANCY }] },
      select: VACANCY_SELECT,
    });
  }

  /**
   * Every open vacancy's suggestions worked out again (the recruitment round, a round of the CV readings); `notify`: HR
   * told of the new ones. How many vacancies. Never throws.
   */
  async refreshAll(opts: { notify: boolean }): Promise<number> {
    try {
      const vacancies = await this.openVacancies();
      if (!vacancies.length) return 0;
      const pool = await this.pool();
      for (const v of vacancies) await this.apply(v, pool, { notify: opts.notify, seen: false });
      return vacancies.length;
    } catch (err) {
      this.logger.error(`The suggested CVs could not be worked out: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * One vacancy's suggestions worked out again, when it takes applications and isn't C-level (approved, opened again, or
   * its page opened): `notify` HR told of the new ones; `seen` (HR opened its page) the new ones counted as told. Never throws.
   */
  async refreshVacancy(id: string, opts: { notify: boolean; seen?: boolean }): Promise<void> {
    try {
      const v = await this.prisma.vacancy.findUnique({ where: { id }, select: VACANCY_SELECT });
      if (!v || this.pausedOf(v)) return;
      await this.apply(v, await this.pool(), { notify: opts.notify, seen: opts.seen ?? false });
    } catch (err) {
      this.logger.error(`The suggested CVs of a vacancy could not be worked out: ${(err as Error).message}`);
    }
  }

  /** The vacancy's page opened by HR, the CEO or a Super Admin: its suggestions worked out unless they were in the last 2 minutes. */
  async refreshIfStale(id: string, user: SessionUser): Promise<void> {
    if (user.developer) return;
    const at = this.fresh.get(id);
    if (at !== undefined && Date.now() - at < SUGGESTION_LIMITS.freshMinutes * 60_000) return;
    await this.refreshVacancy(id, { notify: false, seen: decidesSuggestions(user) });
  }

  /** The months back CVs count (Recruitment Settings). */
  private async recencyMonths(): Promise<number> {
    const row = await this.prisma.recruitmentSettings.findUnique({ where: { id: 1 }, select: { suggestMonths: true } });
    return row?.suggestMonths ?? SUGGESTION_LIMITS.recencyMonths;
  }

  /**
   * The pool: the general CVs (new or reviewed) and the applications of the last months, each with its area, years, CV's
   * facts and own verdict; their candidates with what excludes them (merged, the employee they are, C-level, their
   * latest verdict, in the running elsewhere).
   */
  private async pool(now = new Date()): Promise<Pool> {
    const recencyMonths = await this.recencyMonths();
    const since = new Date(now.getTime());
    since.setUTCMonth(since.getUTCMonth() - recencyMonths);
    const [departments, generalCvs, applications] = await Promise.all([
      this.prisma.department.findMany({ select: { id: true, parentId: true } }),
      this.prisma.generalCv.findMany({
        where: { status: { in: ['new', 'reviewed'] }, createdAt: { gte: since }, candidateId: { not: null } },
        // the position chosen counts as a title (25 October 2026: "Position, grouped by team")
        select: { id: true, candidateId: true, createdAt: true, status: true, departmentId: true, positionName: true, positionOther: true, yearsExperience: true, cvReading: READING },
      }),
      this.prisma.jobApplication.findMany({
        where: { createdAt: { gte: since }, candidateId: { not: null } },
        select: {
          id: true,
          candidateId: true,
          createdAt: true,
          vacancyId: true,
          stage: true,
          filteredOut: true,
          yearsExperience: true,
          vacancy: { select: { title: true, departmentId: true, grade: { select: { confidential: true } }, jobTitle: { select: { minGrade: { select: { confidential: true } } } } } },
          cvReading: READING,
        },
      }),
    ]);
    const parentOf = new Map(departments.map((d) => [d.id, d.parentId]));
    const topOf = (id: string | null): string | null => {
      let at = id;
      for (let hops = 0; at && parentOf.get(at) && hops < 10; hops++) at = parentOf.get(at) ?? null;
      return at;
    };
    const isTeam = (id: string | null) => !!id && !!parentOf.get(id);
    const ids = [...new Set([...generalCvs, ...applications].map((r) => r.candidateId!))];
    const [candidates, cLevelIds, inProcess, cLevelApplicants, verdicts] = await Promise.all([
      this.prisma.candidate.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          mergedIntoId: true,
          employee: {
            select: {
              id: true,
              employments: { orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }], select: { endDate: true, offboarding: { select: { rehire: true } } } },
            },
          },
        },
      }),
      this.confidential.ids(),
      this.prisma.jobApplication.findMany({ where: { candidateId: { in: ids }, stage: { in: ['interview', 'offer'] }, filteredOut: false }, select: { candidateId: true }, distinct: ['candidateId'] }),
      this.prisma.jobApplication.findMany({ where: { candidateId: { in: ids }, vacancy: CONFIDENTIAL_VACANCY }, select: { candidateId: true }, distinct: ['candidateId'] }),
      this.prisma.screeningComment.findMany({
        where: { candidateId: { in: ids }, verdict: { not: null } },
        select: { id: true, candidateId: true, applicationId: true, generalCvId: true, verdict: true, createdAt: true },
      }),
    ]);
    const today = todayInCairo();
    const busy = new Set(inProcess.map((r) => r.candidateId));
    const cLevel = new Set(cLevelApplicants.map((r) => r.candidateId));
    const ofCandidate = latestVerdictsBy(verdicts, (r) => r.candidateId);
    const ofApplication = latestVerdictsBy(verdicts, (r) => r.applicationId);
    const ofGeneralCv = latestVerdictsBy(verdicts, (r) => r.generalCvId);
    const people = new Map<string, SuggestionPerson>();
    for (const c of candidates) {
      const e = c.employee;
      people.set(c.id, {
        candidateId: c.id,
        merged: !!c.mergedIntoId,
        employee: e
          ? {
              // on file without an employment yet counts as current: they are the company's already
              current: !e.employments.length || e.employments.some((x) => !x.endDate || (fromDateOnly(x.endDate) ?? '') >= today),
              rehire: (e.employments[0]?.offboarding?.rehire as RehireEligibility | null | undefined) ?? null,
              cLevel: cLevelIds.has(e.id),
            }
          : null,
        verdict: ofCandidate.get(c.id) ?? null,
        cLevelApplicant: cLevel.has(c.id),
        inProcess: busy.has(c.id),
      });
    }
    const cv = (reading: { status: string; text: string | null; facts: Prisma.JsonValue | null } | null) => {
      const read = reading?.status === 'read';
      const facts = read ? cvFactsOf(reading.facts) : null;
      const text = read ? reading.text : null;
      let matcher: ReturnType<typeof cvSkillsMatcher> | null = null;
      return {
        cvMonths: facts?.experienceMonths ?? null,
        cvLatestTitle: facts?.latestTitle ?? null,
        skillsFound: text ? (skills: readonly string[]) => (matcher ??= cvSkillsMatcher(text))(skills) : null,
      };
    };
    const records: SuggestionRecord[] = [
      ...generalCvs.map(
        (g): SuggestionRecord => ({
          kind: 'general_cv',
          id: g.id,
          candidateId: g.candidateId!,
          at: g.createdAt,
          status: g.status,
          verdict: ofGeneralCv.get(g.id) ?? null,
          departmentId: g.departmentId,
          topDepartmentId: topOf(g.departmentId),
          yearsTyped: money(g.yearsExperience),
          ...cv(g.cvReading),
          positionTitle: g.positionName ?? g.positionOther,
        }),
      ),
      ...applications.map(
        (a): SuggestionRecord => ({
          kind: 'application',
          id: a.id,
          candidateId: a.candidateId!,
          at: a.createdAt,
          vacancyId: a.vacancyId,
          vacancyTitle: a.vacancy.title,
          vacancyCLevel: isConfidentialVacancy(a.vacancy),
          stage: a.stage,
          filteredOut: a.filteredOut,
          verdict: ofApplication.get(a.id) ?? null,
          departmentId: a.vacancy.departmentId,
          topDepartmentId: topOf(a.vacancy.departmentId),
          yearsTyped: money(a.yearsExperience),
          ...cv(a.cvReading),
        }),
      ),
    ];
    return { now, recencyMonths, people, records, topOf, isTeam };
  }

  /**
   * A vacancy's suggestions worked out from the pool and kept, under the vacancy's lock: those now on the vacancy closed
   * as applied; the decided left as they are; the suggested ones changed, added (`seen`: counted as told) or, no longer
   * matching, deleted. Then HR told of the new ones (`notify`).
   */
  private async apply(v: VacancyRow, pool: Pool, opts: { notify: boolean; seen: boolean }): Promise<void> {
    const target: SuggestionVacancy = {
      id: v.id,
      title: v.title,
      departmentId: v.departmentId,
      topDepartmentId: pool.topOf(v.departmentId),
      ofTeam: pool.isTeam(v.departmentId),
      keySkills: v.keySkills,
      minYears: minYearsWanted(questionsOf(v.questions)),
    };
    const [here, kept] = await Promise.all([
      this.prisma.jobApplication.findMany({ where: { vacancyId: v.id }, select: { id: true, number: true, candidateId: true, email: true, createdAt: true } }),
      this.prisma.vacancySuggestion.findMany({ where: { vacancyId: v.id }, select: { candidateId: true, status: true, generalCvId: true, sourceApplicationId: true } }),
    ]);
    const byCandidate = new Map(here.filter((a) => a.candidateId).map((a) => [a.candidateId!, a]));
    const byEmail = new Map(here.map((a) => [a.email, a]));
    const decidedCandidates = new Set(kept.filter((k) => k.status !== 'suggested').map((k) => k.candidateId));
    const decidedRecords = new Set(kept.filter((k) => k.status !== 'suggested').flatMap((k) => [k.generalCvId, k.sourceApplicationId].filter((x): x is string => !!x)));
    const found = suggestionsFor(target, pool.people, pool.records, {
      now: pool.now,
      recencyMonths: pool.recencyMonths,
      appliedHere: (candidateId) => byCandidate.has(candidateId),
      decided: (candidateId, recordIds) => decidedCandidates.has(candidateId) || recordIds.some((id) => decidedRecords.has(id)),
    });
    const now = new Date();
    const closed = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-system:suggestions:${v.id}`}))`;
        const rows = await tx.vacancySuggestion.findMany({ where: { vacancyId: v.id }, select: { id: true, candidateId: true, status: true, invitedTo: true } });
        // on the vacancy now (applied, or added another way): closed as applied
        const done: { id: string; from: string; application: string }[] = [];
        for (const r of rows) {
          if (!isOpenSuggestion(r.status)) continue;
          const a = byCandidate.get(r.candidateId) ?? (r.invitedTo ? byEmail.get(r.invitedTo) : undefined);
          if (!a) continue;
          const { count } = await tx.vacancySuggestion.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'applied', applicationId: a.id, decidedAt: a.createdAt } });
          if (count) done.push({ id: r.id, from: r.status, application: a.number });
        }
        const closedIds = new Set(done.map((d) => d.id));
        const decided = new Set(rows.filter((r) => r.status !== 'suggested' || closedIds.has(r.id)).map((r) => r.candidateId));
        const suggested = new Map(rows.filter((r) => r.status === 'suggested' && !closedIds.has(r.id)).map((r) => [r.candidateId, r.id]));
        const keep = new Set<string>();
        for (const f of found) {
          if (decided.has(f.candidateId)) continue;
          keep.add(f.candidateId);
          const data = {
            sourceKind: f.record.kind,
            generalCvId: f.record.kind === 'general_cv' ? f.record.id : null,
            sourceApplicationId: f.record.kind === 'application' ? f.record.id : null,
            score: f.score,
            reasons: f.reasons as unknown as Prisma.InputJsonValue,
          };
          const id = suggested.get(f.candidateId);
          if (id) await tx.vacancySuggestion.update({ where: { id }, data });
          else await tx.vacancySuggestion.create({ data: { vacancyId: v.id, candidateId: f.candidateId, ...data, notifiedAt: opts.seen ? now : null } });
        }
        // no longer matching (or past the top 50): never decided, so deleted
        const gone = [...suggested.entries()].filter(([candidateId]) => !keep.has(candidateId)).map(([, id]) => id);
        if (gone.length) await tx.vacancySuggestion.deleteMany({ where: { id: { in: gone }, status: 'suggested' } });
        return done;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    this.fresh.set(v.id, Date.now());
    for (const c of closed) {
      await this.audit.record({ userId: null, action: 'close', entityType: SUGGESTION_ENTITY, entityId: c.id, diff: { vacancy: v.number, application: c.application, status: { from: c.from, to: 'applied' } } });
    }
    if (opts.notify) await this.tell(v);
  }

  /** HR told of a vacancy's new suggestions nobody was told of, once: "5 earlier CVs match Video Editor". Never throws. */
  private async tell(v: { id: string; number: string; title: string }): Promise<void> {
    try {
      const { count } = await this.prisma.vacancySuggestion.updateMany({ where: { vacancyId: v.id, status: 'suggested', notifiedAt: null }, data: { notifiedAt: new Date() } });
      if (!count) return;
      const hr = await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: 'hr' } } } }, select: { id: true } });
      await this.notifications.notify(
        hr.map((u) => u.id),
        { kind: 'cv_suggestions', ...suggestionsNotice(count, v), link: `/recruitment/vacancies/${v.id}?view=suggested` },
      );
    } catch (err) {
      this.logger.warn(`Telling HR of the suggested CVs for ${v.number} failed: ${(err as Error).message}`);
    }
  }

  /** An application made (the careers page, an invitation's link or not): the vacancy's open suggestion of the person closed as applied. Never throws. */
  async closeFor(applicationId: string): Promise<void> {
    try {
      const a = await this.prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { id: true, number: true, vacancyId: true, candidateId: true, email: true, createdAt: true, source: true, vacancy: { select: { number: true } } },
      });
      if (!a) return;
      const rows = await this.prisma.vacancySuggestion.findMany({
        where: { vacancyId: a.vacancyId, status: { in: [...OPEN_SUGGESTIONS] }, OR: [{ invitedTo: a.email }, ...(a.candidateId ? [{ candidateId: a.candidateId }] : [])] },
        select: { id: true, status: true },
      });
      for (const r of rows) {
        const { count } = await this.prisma.vacancySuggestion.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'applied', applicationId: a.id, decidedAt: a.createdAt } });
        if (count) {
          await this.audit.record({
            userId: null,
            action: 'close',
            entityType: SUGGESTION_ENTITY,
            entityId: r.id,
            diff: { vacancy: a.vacancy.number, application: a.number, source: a.source, status: { from: r.status, to: 'applied' } },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Closing the suggestion of an application failed: ${(err as Error).message}`);
    }
  }

  // ---------- reading them ----------

  /** The open suggestions of each vacancy given (the list's "Suggestions: N"); a C-level one's never counted. */
  async counts(vacancyIds: readonly string[]): Promise<Map<string, number>> {
    if (!vacancyIds.length) return new Map();
    const groups = await this.prisma.vacancySuggestion.groupBy({
      by: ['vacancyId'],
      where: { vacancyId: { in: [...vacancyIds] }, status: 'suggested', vacancy: { NOT: CONFIDENTIAL_VACANCY } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.vacancyId, g._count._all]));
  }

  /**
   * GET /recruitment/vacancies/:id/suggestions?status= (suggested unless asked): HR, the CEO and a Super Admin (403 for
   * anyone else, a hiring manager too); worked out first unless they were in the last 2 minutes. None for a C-level
   * vacancy.
   */
  async list(vacancyId: string, status: SuggestionStatus | undefined, user: SessionUser): Promise<VacancySuggestions> {
    this.assertReads(user);
    const v = await this.prisma.vacancy.findFirst({ where: { AND: [{ id: vacancyId }, vacancyWhere(user)] }, select: VACANCY_SELECT });
    if (!v) throw new NotFoundException(VACANCY_NOT_FOUND);
    const paused = this.pausedOf(v);
    if (!paused) await this.refreshIfStale(v.id, user);
    const shown: SuggestionStatus = status ?? 'suggested';
    const counts = Object.fromEntries(SUGGESTION_STATUSES.map((s) => [s, 0])) as Record<SuggestionStatus, number>;
    const [emailReady, recencyMonths] = await Promise.all([this.mail.ready(), this.recencyMonths()]);
    const decide = decidesSuggestions(user) && paused !== 'c_level';
    const invite = decide && emailReady && paused === null;
    const base = { vacancy: { id: v.id, number: v.number, title: v.title, status: v.status as VacancyStatus }, status: shown, paused, emailReady, recencyMonths, can: { decide, invite } };
    // never for or from a C-level vacancy (owner, 19 October 2026: "make C level Employees details not visible to HR")
    if (paused === 'c_level') return { ...base, rows: [], counts };
    const [rows, groups] = await Promise.all([
      this.prisma.vacancySuggestion.findMany({
        where: { vacancyId: v.id, status: shown },
        select: ROW_SELECT,
        orderBy: shown === 'suggested' ? [{ score: 'desc' }, { createdAt: 'desc' }] : [{ decidedAt: { sort: 'desc', nulls: 'last' } }, { score: 'desc' }],
        take: shown === 'suggested' ? SUGGESTION_LIMITS.shown : 200,
      }),
      this.prisma.vacancySuggestion.groupBy({ by: ['status'], where: { vacancyId: v.id }, _count: { _all: true } }),
    ]);
    for (const g of groups) if (g.status in counts) counts[g.status as SuggestionStatus] = g._count._all;
    const [verdicts, names] = await Promise.all([
      this.comments.candidateVerdicts(
        rows.map((r) => r.candidateId),
        user,
      ),
      userNames(
        this.prisma,
        rows.map((r) => r.decidedBy),
      ),
    ]);
    const addable = v.status === 'open' || v.status === 'on_hold';
    return { ...base, counts, rows: rows.map((r) => this.view(r, { decide: decide && addable, invite, verdict: verdicts.get(r.candidateId) ?? null, names })) };
  }

  private view(r: SuggestionRow, c: { decide: boolean; invite: boolean; verdict: ScreeningVerdict | null; names: ReadonlyMap<string, { name: string }> }): VacancySuggestionView {
    const g = r.generalCv;
    const a = r.sourceApplication;
    const status = r.status as SuggestionStatus;
    const open = isOpenSuggestion(status);
    const email = g?.email ?? a?.email ?? null;
    const source: VacancySuggestionView['source'] = g
      ? {
          kind: 'general_cv',
          id: g.id,
          number: g.number,
          area: areaOf(g),
          position: g.positionName ?? (g.positionOther ? `Other: ${g.positionOther}` : null),
          receivedAt: g.createdAt.toISOString(),
        }
      : a
        ? { kind: 'application', id: a.id, number: a.number, vacancy: a.vacancy, appliedAt: a.createdAt.toISOString() }
        : null;
    const cv: ScreeningCv | null = g?.file
      ? { kind: 'general_cv', id: g.id, reference: g.number, title: 'General CV', cvFileName: g.file.fileName, mimeType: g.file.mimeType, sizeBytes: g.file.sizeBytes, sentAt: g.createdAt.toISOString(), key: `general_cv:${g.id}`, linkedKey: null }
      : a?.cv
        ? { kind: 'application', id: a.id, reference: a.number, title: a.vacancy.title, cvFileName: a.cv.fileName, mimeType: a.cv.mimeType, sizeBytes: a.cv.sizeBytes, sentAt: a.createdAt.toISOString(), key: `application:${a.id}`, linkedKey: null }
        : null;
    const usable = g ? g.status === 'new' || g.status === 'reviewed' : !!a;
    return {
      id: r.id,
      candidate: r.candidate,
      email,
      source,
      score: r.score,
      reasons: reasonsOf(r.reasons),
      status,
      verdict: c.verdict,
      cv,
      invitedAt: r.invitedAt?.toISOString() ?? null,
      sentTo: r.invitedTo,
      dismissReason: r.dismissReason,
      application: r.application,
      decidedBy: userRef(r.decidedBy, c.names),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      suggestedAt: r.createdAt.toISOString(),
      can: { add: c.decide && open && usable, invite: c.invite && status === 'suggested' && !!email, dismiss: c.decide && open },
    };
  }

  // ---------- HR's decisions ----------

  /** A suggestion HR may decide on: its vacancy one the caller sees and not C-level (404 otherwise), still open (409 otherwise). */
  private async decidable(id: string, user: SessionUser) {
    this.assertManages(user);
    const r = await this.prisma.vacancySuggestion.findUnique({
      where: { id },
      select: {
        ...ROW_SELECT,
        decidedById: true,
        generalCvId: true,
        sourceApplicationId: true,
        vacancy: { select: { ...VACANCY_SELECT } },
      },
    });
    if (!r || !(await this.prisma.vacancy.count({ where: { AND: [{ id: r.vacancyId }, vacancyWhere(user)] } })) || isConfidentialVacancy(r.vacancy)) throw new NotFoundException(NOT_FOUND);
    if (!isOpenSuggestion(r.status)) {
      throw new ConflictException(`It was ${SUGGESTION_STATUS_LABELS[r.status as SuggestionStatus]?.toLowerCase() ?? r.status} already${r.decidedAt ? ` on ${shownDate(dayInCairo(r.decidedAt))}` : ''}.`);
    }
    return r;
  }

  /**
   * Add to this vacancy (HR, a Super Admin): a general CV moved as an application, source "General CV (suggested)"; an
   * earlier applicant's newest CV made into an application, source "Earlier applicant (suggested)", their contacts and CV
   * copied (no new upload). Either at Applied, without screening answers. The vacancy open or on hold.
   */
  async add(id: string, user: SessionUser): Promise<SuggestionAdded> {
    const r = await this.decidable(id, user);
    const v = r.vacancy;
    if (v.status !== 'open' && v.status !== 'on_hold') throw new ConflictException('The vacancy isn’t open, so nobody can be added to it now.');
    const now = new Date();
    const claimed = await this.prisma.vacancySuggestion.updateMany({ where: { id, status: r.status }, data: { status: 'added', decidedById: user.id, decidedAt: now } });
    if (!claimed.count) throw new ConflictException('Someone decided on it meanwhile. Reload the page to see where it stands.');
    let made: { id: string; number: string; from: string };
    try {
      made = r.generalCvId ? await this.addGeneralCv(r.generalCvId, v.id, user) : await this.addEarlierApplicant(r.candidateId, v, user);
    } catch (err) {
      // nothing was made: back as it was
      await this.prisma.vacancySuggestion.updateMany({ where: { id, status: 'added', applicationId: null }, data: { status: r.status, decidedById: r.decidedById, decidedAt: r.decidedAt } });
      throw err;
    }
    await this.prisma.vacancySuggestion.update({ where: { id }, data: { applicationId: made.id } });
    await this.audit.record({
      userId: user.id,
      action: 'add_suggestion',
      entityType: SUGGESTION_ENTITY,
      entityId: id,
      diff: { vacancy: v.number, candidate: r.candidate.code, from: made.from, application: made.number, status: { from: r.status, to: 'added' } },
    });
    return { applicationId: made.id, number: made.number };
  }

  /** A general CV moved to the vacancy as a suggested one (GeneralCvsService.move: its reference kept, its CV and reading with it). */
  private async addGeneralCv(generalCvId: string, vacancyId: string, user: SessionUser): Promise<{ id: string; number: string; from: string }> {
    const dto: MoveGeneralCvDto = { vacancyId, stage: 'applied' };
    const moved = await this.generalCvs.move(generalCvId, dto, user, true);
    if (!moved.movedTo) throw new ConflictException('The general CV couldn’t be added.');
    return { id: moved.movedTo.applicationId, number: moved.movedTo.reference, from: `general CV ${moved.number}` };
  }

  /** An earlier applicant's application to this vacancy, from their newest application's CV (never a C-level vacancy's). */
  private async addEarlierApplicant(candidateId: string, v: { id: string; number: string }, user: SessionUser): Promise<{ id: string; number: string; from: string }> {
    const earlier = await this.prisma.jobApplication.findFirst({
      where: { candidateId, vacancyId: { not: v.id }, cv: { isNot: null }, vacancy: { NOT: CONFIDENTIAL_VACANCY } },
      orderBy: { createdAt: 'desc' },
      include: { cv: true },
    });
    if (!earlier?.cv) throw new ConflictException('Their earlier CV is gone, so they can’t be added from it. Add their CV with Bulk upload instead.');
    const cv = earlier.cv;
    const app = await this.prisma.$transaction(async (tx) => {
      const made = await createHrApplication(tx, {
        vacancyId: v.id,
        stage: 'applied',
        fullName: earlier.fullName,
        email: earlier.email,
        mobile: earlier.mobile,
        linkedin: earlier.linkedin,
        portfolio: earlier.portfolio,
        yearsExperience: earlier.yearsExperience,
        noticePeriod: earlier.noticePeriod,
        expectedSalary: earlier.expectedSalary,
        source: 'earlier_applicant',
        // their consent of then: "this job and similar ones" (APPLY_CONSENT_TEXT)
        consentAt: earlier.consentAt,
        consentById: earlier.consentById,
        consentNote: `From earlier application ${earlier.number}`,
        cv: { fileName: cv.fileName, mimeType: cv.mimeType, sizeBytes: cv.sizeBytes, data: cv.data },
        note: `Added from Suggested From Earlier CVs: an earlier applicant (${earlier.number}), without screening answers`,
        byId: user.id,
        candidateId,
        sentAt: earlier.createdAt,
      });
      // its CV's reading goes with it, so it isn't read again
      await this.readings.carry(tx, { applicationId: earlier.id }, { applicationId: made.id });
      return made;
    });
    await this.readings.rescoreApplication(app.id);
    this.readings.kick();
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: APPLICATION_ENTITY,
      entityId: app.id,
      diff: { number: app.number, vacancy: v.number, source: 'earlier_applicant', stage: 'applied', from: `earlier application ${earlier.number}` },
    });
    return { id: app.id, number: app.number, from: `application ${earlier.number}` };
  }

  /**
   * Invite to apply (HR, a Super Admin; only when they press it): the email to the address of the CV it came from, the
   * job and its apply link (?src=invite), English then Arabic with the words of Recruitment Settings. Refused while the
   * vacancy doesn't take applications (409) or email isn't set up (503); the suggestion stays suggested if sending fails.
   */
  async invite(id: string, user: SessionUser): Promise<VacancySuggestionView> {
    const r = await this.decidable(id, user);
    const v = r.vacancy;
    if (r.status !== 'suggested') throw new ConflictException(`They were invited${r.invitedAt ? ` on ${shownDate(dayInCairo(r.invitedAt))}` : ''} already.`);
    if (this.pausedOf(v)) throw new ConflictException('The vacancy isn’t taking applications now, so its link wouldn’t open. Invite them once it is open.');
    if (!(await this.mail.ready())) throw new ServiceUnavailableException('Email isn’t set up yet (Organization → Email Settings), so the invitation can’t be sent.');
    const to = r.generalCv?.email ?? r.sourceApplication?.email ?? null;
    if (!to) throw new ConflictException('There is no email address to invite them at.');
    const now = new Date();
    const claimed = await this.prisma.vacancySuggestion.updateMany({ where: { id, status: 'suggested' }, data: { status: 'invited', invitedAt: now, invitedTo: to, decidedById: user.id, decidedAt: now } });
    if (!claimed.count) throw new ConflictException('Someone decided on it meanwhile. Reload the page to see where it stands.');
    const [settings, company] = await Promise.all([
      this.prisma.recruitmentSettings.findUnique({ where: { id: 1 }, select: { inviteSubject: true, inviteEn: true, inviteAr: true } }),
      this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } }),
    ]);
    const mail = inviteMail(
      { subject: settings?.inviteSubject ?? null, en: settings?.inviteEn ?? null, ar: settings?.inviteAr ?? null },
      { name: r.generalCv?.fullName ?? r.sourceApplication?.fullName ?? r.candidate.fullName, job: v.title, company: company?.nameEn || 'the company', link: inviteLink(webOriginOf(this.config), v.slug) },
    );
    try {
      await this.mail.send({ to, replyTo: user.email, subject: mail.subject, text: mail.text });
    } catch (err) {
      await this.prisma.vacancySuggestion.updateMany({ where: { id, status: 'invited', invitedAt: now }, data: { status: 'suggested', invitedAt: null, invitedTo: null, decidedById: null, decidedAt: null } });
      throw err;
    }
    // to whom, never the words
    await this.audit.record({ userId: user.id, action: 'invite_to_apply', entityType: SUGGESTION_ENTITY, entityId: id, diff: { vacancy: v.number, candidate: r.candidate.code, sentTo: to, status: { from: 'suggested', to: 'invited' } } });
    return this.one(id, user);
  }

  /** Dismiss (HR, a Super Admin), with an optional reason: never suggested again for the vacancy. */
  async dismiss(id: string, reason: string | null | undefined, user: SessionUser): Promise<VacancySuggestionView> {
    const r = await this.decidable(id, user);
    const { count } = await this.prisma.vacancySuggestion.updateMany({
      where: { id, status: r.status },
      data: { status: 'dismissed', dismissReason: reason?.trim() || null, decidedById: user.id, decidedAt: new Date() },
    });
    if (!count) throw new ConflictException('Someone decided on it meanwhile. Reload the page to see where it stands.');
    await this.audit.record({
      userId: user.id,
      action: 'dismiss_suggestion',
      entityType: SUGGESTION_ENTITY,
      entityId: id,
      diff: { vacancy: r.vacancy.number, candidate: r.candidate.code, status: { from: r.status, to: 'dismissed' }, ...(reason?.trim() && { reason: reason.trim() }) },
    });
    return this.one(id, user);
  }

  /** One suggestion's row, as the list shows it. */
  private async one(id: string, user: SessionUser): Promise<VacancySuggestionView> {
    const r = await this.prisma.vacancySuggestion.findUniqueOrThrow({ where: { id }, select: { ...ROW_SELECT, vacancy: { select: VACANCY_SELECT } } });
    const [verdicts, names, emailReady] = await Promise.all([this.comments.candidateVerdicts([r.candidateId], user), userNames(this.prisma, [r.decidedBy]), this.mail.ready()]);
    const decide = decidesSuggestions(user) && (r.vacancy.status === 'open' || r.vacancy.status === 'on_hold');
    return this.view(r, { decide, invite: decidesSuggestions(user) && emailReady && this.pausedOf(r.vacancy) === null, verdict: verdicts.get(r.candidateId) ?? null, names });
  }

  // ---------- helpers ----------

  private assertReads(user: SessionUser): void {
    if (!user.roles.some((r) => READS.includes(r))) throw new ForbiddenException('Only HR, the CEO and a Super Admin see the suggested CVs.');
  }

  private assertManages(user: SessionUser): void {
    if (!decidesSuggestions(user)) throw new ForbiddenException('Only HR, the CEO and a Super Admin add, invite or dismiss suggested CVs.');
  }
}
