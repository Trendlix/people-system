import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canMoveVacancy,
  seesConfidential,
  tidyQuestions,
  VACANCY_MOVE_TO,
  VACANCY_STATUS_LABELS,
  vacancyEditable,
  vacancyNumber,
  vacancyProblems,
  vacancyQuestionsProblems,
  keySkillsOf,
  keySkillsProblems,
  vacancySlug,
  type VacancyCan,
  type VacancyListItem,
  type VacancyMove,
  type VacancyQuestion,
  type VacancyStatus,
  type VacancyView,
  AGENCY_BACKGROUND_DEFAULT,
  AGENCY_BACKGROUNDS,
  type AgencyBackgroundWanted,
} from '@trendlix/shared';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { AuditService, changes } from '../audit/audit.service.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { sanitizeJdHtml } from '../organisation/job-titles/jd-html.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { careersSiteIn } from './careers-site.js';
import { CvReadingsService } from './cv-readings.service.js';
import { approvesVacancies, isConfidentialVacancy, managesRecruitment, vacancyWhere } from './recruitment-access.js';
import { emptyCounts, money, questionsOf, userRef, VACANCY_ENTITY, VACANCY_INCLUDE, vacancyListView, type VacancyCounts, type VacancyRow } from './recruitment-views.js';
import { titleAsk } from './portfolio-settings.service.js';
import type { CreateVacancyDto, ListVacanciesDto, UpdateVacancyDto } from './recruitment.dto.js';
import { RecruitmentDeletesService } from './recruitment-deletes.service.js';
import { VacancySuggestionsService } from './vacancy-suggestions.service.js';

// Vacancies (owner, 22 October 2026: "where will we include the ATS?"; "HR creates a vacancy and the CEO approves it";
// packages/shared recruitment.ts). HR drafts one from a job title (its JD filled into the public description), sends it
// to the CEO, who approves it (it is published on the careers page) or sends it back with a reason; HR holds, reopens
// and closes it; it is filled once its hires reach the headcount (RecruitmentOffersService). Each change is audited, the
// CEO told of one waiting, its makers of the CEO's decision. A C-level one is the CEO's and a Super Admin's only.
// Suggested From Earlier CVs (owner, 24 October 2026: "Suggest; HR adds"; vacancy-suggestions.service.ts): worked out
// when one is approved or opened again (HR told of the matches) and when its page opens; the list counts those waiting.

const NOT_FOUND = 'Vacancy not found.';
const LIST_CAP = 500;
/** What a vacancy's CV fits read (25 October 2026; cv-fit-inputs.ts): a change scores its applications again. */
/** A vacancy's agency background as kept (the column's check keeps it one of these). */
const isAgencyBackground = (v: string): v is AgencyBackgroundWanted => (AGENCY_BACKGROUNDS as readonly string[]).includes(v);

const FIT_FIELDS = ['title', 'keySkills', 'requirements', 'responsibilities', 'about', 'questions', 'gradeId', 'jobTitleId', 'agencyBackground'] as const;
const ACTIVE: VacancyStatus[] = ['draft', 'pending', 'open', 'on_hold'];

/** The public description's fields, cleaned as job descriptions are. */
const html = (v: string | null | undefined) => (v === undefined ? undefined : sanitizeJdHtml(v));

/** What the audit log keeps of a vacancy's fields: the salary range masked, the description by whether it changed. */
function auditFields(v: Partial<Record<string, unknown>>): Record<string, unknown> {
  const { salaryMin, salaryMax, about, responsibilities, requirements, questions, ...rest } = v;
  return {
    ...rest,
    ...(salaryMin !== undefined && { salaryMin: salaryMin === null ? null : '(hidden)' }),
    ...(salaryMax !== undefined && { salaryMax: salaryMax === null ? null : '(hidden)' }),
    ...(about !== undefined && { about: about ? '(text)' : null }),
    ...(responsibilities !== undefined && { responsibilities: responsibilities ? '(text)' : null }),
    ...(requirements !== undefined && { requirements: requirements ? '(text)' : null }),
    ...(questions !== undefined && { questions: Array.isArray(questions) ? (questions as VacancyQuestion[]).map((q) => q.text) : questions }),
  };
}

@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notifications: NotificationsService,
    private readonly readings: CvReadingsService,
    private readonly suggestions: VacancySuggestionsService,
    private readonly deletes: RecruitmentDeletesService,
  ) {}

  // ---------- reading ----------

  async list(query: ListVacanciesDto, user: SessionUser): Promise<VacancyListItem[]> {
    const status = query.status ?? 'active';
    const text = query.q ? { contains: query.q, mode: 'insensitive' as const } : null;
    const rows = await this.prisma.vacancy.findMany({
      where: {
        AND: [
          status === 'all' ? {} : status === 'active' ? { status: { in: ACTIVE } } : { status },
          text ? { OR: [{ title: text }, { number: text }, { jobTitle: { titleEn: text } }] } : {},
          vacancyWhere(user),
        ],
      },
      include: VACANCY_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: LIST_CAP,
    });
    const counts = await this.counts(rows.map((r) => r.id));
    // the earlier CVs waiting for HR (24 October 2026), never a C-level vacancy's
    const suggested = await this.suggestions.counts(rows.map((r) => r.id));
    return rows.map((r) => ({ ...vacancyListView(r, counts.get(r.id) ?? emptyCounts()), suggestions: suggested.get(r.id) ?? 0 }));
  }

  /**
   * A vacancy: in full for HR, the CEO and a Super Admin; for its hiring manager (Phase 2, 22 October 2026: "They never
   * see the salary range"), without the salary range and with nothing to do; 404 for anyone else.
   */
  async get(id: string, user: SessionUser): Promise<VacancyView> {
    if (user.roles.some((r) => r === 'hr' || r === 'ceo' || r === 'super_admin')) {
      const v = await this.row(id, user);
      // its suggested CVs worked out as its page opens, unless they were in the last 2 minutes (24 October 2026)
      await this.suggestions.refreshIfStale(v.id, user);
      return { ...(await this.view(v, user)), suggestions: (await this.suggestions.counts([v.id])).get(v.id) ?? 0 };
    }
    const selfId = await this.confidential.selfId(user);
    const v = selfId ? await this.prisma.vacancy.findFirst({ where: { id, hiringManagerId: selfId }, include: VACANCY_INCLUDE }) : null;
    if (!v) throw new NotFoundException(NOT_FOUND);
    const view = await this.view(v, user);
    const nothing = Object.fromEntries(Object.keys(view.can).map((k) => [k, false])) as unknown as VacancyCan;
    return { ...view, salaryMin: null, salaryMax: null, can: nothing, viewer: 'hiring_manager' };
  }

  /** The vacancy, if the caller may see it: 404 otherwise. */
  async row(id: string, user: SessionUser, db: PrismaService | Prisma.TransactionClient = this.prisma): Promise<VacancyRow> {
    const v = await db.vacancy.findFirst({ where: { AND: [{ id }, vacancyWhere(user)] }, include: VACANCY_INCLUDE });
    if (!v) throw new NotFoundException(NOT_FOUND);
    return v;
  }

  /** Applicants by stage and those filtered out, of each vacancy. */
  async counts(ids: readonly string[]): Promise<Map<string, VacancyCounts>> {
    const out = new Map<string, VacancyCounts>();
    if (!ids.length) return out;
    const groups = await this.prisma.jobApplication.groupBy({ by: ['vacancyId', 'stage', 'filteredOut'], where: { vacancyId: { in: [...ids] } }, _count: { _all: true } });
    for (const g of groups) {
      const c = out.get(g.vacancyId) ?? emptyCounts();
      const n = g._count._all;
      c.total += n;
      if (g.stage in c.byStage) c.byStage[g.stage as keyof VacancyCounts['byStage']] += n;
      if (g.filteredOut) c.filteredOut += n;
      out.set(g.vacancyId, c);
    }
    return out;
  }

  private async view(v: VacancyRow, user: SessionUser): Promise<VacancyView> {
    const counts = (await this.counts([v.id])).get(v.id) ?? emptyCounts();
    // its applicants by source (22 October 2026: the posted links apart from the careers page reached directly)
    const bySource = await this.prisma.jobApplication.groupBy({ by: ['source'], where: { vacancyId: v.id }, _count: { _all: true } });
    const names = await userNames(this.prisma, [v.submittedBy, v.decidedBy, v.createdBy]);
    const status = v.status as VacancyStatus;
    const manages = managesRecruitment(user);
    const approves = approvesVacancies(user);
    const editable = vacancyEditable(status);
    const can: VacancyCan = {
      edit: manages && editable !== 'none',
      editQuestions: manages && (editable === 'all' || (editable === 'published' && counts.total === 0)),
      submit: manages && canMoveVacancy('submit', status),
      approve: approves && canMoveVacancy('approve', status),
      sendBack: approves && canMoveVacancy('send_back', status),
      hold: manages && canMoveVacancy('hold', status),
      reopen: manages && canMoveVacancy('reopen', status),
      close: manages && canMoveVacancy('close', status),
      // also once people applied (owner, 25 October 2026: "Vacancy alone - applicant alone - superadmin only"); never a developer
      delete: isSuperAdmin(user) && !user.developer,
    };
    return {
      ...vacancyListView(v, counts),
      grade: v.grade && { id: v.grade.id, code: v.grade.code, levelEn: v.grade.levelEn },
      hiringManager: v.hiringManager && { id: v.hiringManager.id, name: v.hiringManager.fullNameEn },
      workArrangement: v.workArrangement,
      shift: v.shift,
      durationMonths: v.durationMonths,
      salaryMin: money(v.salaryMin),
      salaryMax: money(v.salaryMax),
      about: v.about,
      responsibilities: v.responsibilities,
      requirements: v.requirements,
      questions: questionsOf(v.questions),
      keySkills: v.keySkills,
      // its form's portfolio (25 October 2026): its own mode (none: as the job title), and the job title's
      portfolioMode: v.portfolioMode === 'hidden' || v.portfolioMode === 'optional' || v.portfolioMode === 'required' ? v.portfolioMode : null,
      jobTitlePortfolio: await titleAsk(this.prisma, v.jobTitle),
      // marketing agency background in its CV fit (27 October 2026: "Set per job")
      agencyBackground: (isAgencyBackground(v.agencyBackground) ? v.agencyBackground : AGENCY_BACKGROUND_DEFAULT) as AgencyBackgroundWanted,
      stageCounts: counts.byStage,
      filteredOut: counts.filteredOut,
      sourceCounts: Object.fromEntries(bySource.map((g) => [g.source, g._count._all])),
      submittedAt: v.submittedAt?.toISOString() ?? null,
      submittedBy: userRef(v.submittedBy, names),
      decidedAt: v.decidedAt?.toISOString() ?? null,
      decidedBy: userRef(v.decidedBy, names),
      sentBackReason: v.status === 'draft' ? v.sentBackReason : null,
      closedAt: v.closedAt?.toISOString() ?? null,
      closeReason: v.closeReason,
      createdBy: userRef(v.createdBy, names),
      updatedAt: v.updatedAt.toISOString(),
      can,
      viewer: manages ? 'manages' : 'reads',
      // the careers site its public links are built on (Recruitment Settings, 25 October 2026)
      careersSite: await careersSiteIn(this.prisma),
    };
  }

  // ---------- writing ----------

  /** A new draft, numbered VAC-<year>-<4 digits>; its description from the job title's JD unless sent. */
  async create(dto: CreateVacancyDto, user: SessionUser): Promise<VacancyView> {
    const job = await this.prisma.jobTitle.findUnique({
      where: { id: dto.jobTitleId },
      select: { id: true, titleEn: true, departmentId: true, jdPurpose: true, jdDuties: true, jdRequirements: true, minGrade: { select: { confidential: true } } },
    });
    if (!job) throw new BadRequestException(['Choose the job title.']);
    // a C-level one only by those who see C-level people (owner, 19 October 2026)
    if (job.minGrade?.confidential && !seesConfidential(user)) throw new ForbiddenException('Only the CEO or a Super Admin sees C-level positions, so only they open a vacancy for one.');
    await this.confidential.assertMayGiveGrade(user, dto.gradeId);
    const questions = this.checkedQuestions(dto.questions);
    const keySkills = this.checkedSkills(dto.keySkills);
    const title = dto.title?.trim() || job.titleEn;
    const problems = vacancyProblems({ title, headcount: dto.headcount ?? 1, durationMonths: dto.durationMonths ?? null, salaryMin: dto.salaryMin ?? null, salaryMax: dto.salaryMax ?? null, closingDate: dto.closingDate ?? null }, todayInCairo());
    if (problems.length) throw new BadRequestException(problems);
    await this.checkLinks(dto);
    const data = {
      title,
      jobTitleId: job.id,
      departmentId: job.departmentId,
      gradeId: dto.gradeId ?? null,
      hiringManagerId: dto.hiringManagerId ?? null,
      headcount: dto.headcount ?? 1,
      employmentType: dto.employmentType,
      workArrangement: dto.workArrangement ?? 'office',
      shiftId: dto.shiftId ?? null,
      durationMonths: dto.durationMonths ?? null,
      closingDate: dto.closingDate ? toDateOnly(dto.closingDate) : null,
      salaryMin: dto.salaryMin ?? null,
      salaryMax: dto.salaryMax ?? null,
      about: dto.about === undefined ? sanitizeJdHtml(job.jdPurpose) : html(dto.about),
      responsibilities: dto.responsibilities === undefined ? sanitizeJdHtml(job.jdDuties) : html(dto.responsibilities),
      requirements: dto.requirements === undefined ? sanitizeJdHtml(job.jdRequirements) : html(dto.requirements),
      questions: (questions ?? []) as unknown as Prisma.InputJsonValue,
      keySkills: keySkills ?? [],
      portfolioMode: dto.portfolioMode ?? null,
      agencyBackground: dto.agencyBackground ?? AGENCY_BACKGROUND_DEFAULT,
    };
    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:vacancy-number'))`;
      const year = todayInCairo().slice(0, 4);
      const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT max(substring(number from 10)::int) AS max FROM vacancies WHERE number ~ ${`^VAC-${year}-[0-9]+$`}`;
      const number = vacancyNumber(year, (max ?? 0) + 1);
      return tx.vacancy.create({ data: { ...data, number, slug: vacancySlug(title, number), createdById: user.id }, select: { id: true, number: true } });
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: VACANCY_ENTITY,
      entityId: made.id,
      diff: auditFields({ number: made.number, ...data, closingDate: dto.closingDate ?? null }),
    });
    return this.get(made.id, user);
  }

  /** Changes a vacancy as its status allows (shared vacancyEditable): everything while a draft; while open or on hold, all but the job title and the employment type, the questions only until someone applied. */
  async update(id: string, dto: UpdateVacancyDto, user: SessionUser): Promise<VacancyView> {
    const v = await this.row(id, user);
    const editable = vacancyEditable(v.status as VacancyStatus);
    if (editable === 'none') {
      throw new ConflictException(
        v.status === 'pending'
          ? 'The vacancy is waiting for the CEO: ask them to send it back to change it.'
          : `The vacancy is ${VACANCY_STATUS_LABELS[v.status as VacancyStatus].toLowerCase()}, so it can't be changed.`,
      );
    }
    if (editable === 'published') {
      if (dto.jobTitleId !== undefined && dto.jobTitleId !== v.jobTitleId) throw new ConflictException('The vacancy is published: its job title stays. Close it and open a new one instead.');
      if (dto.employmentType !== undefined && dto.employmentType !== v.employmentType) throw new ConflictException('The vacancy is published: its employment type stays. Close it and open a new one instead.');
    }
    if (dto.questions !== undefined && editable === 'published' && (await this.prisma.jobApplication.count({ where: { vacancyId: id } }))) {
      throw new ConflictException('People have applied already: the questions stay as they answered them.');
    }
    if (dto.gradeId !== undefined && dto.gradeId !== v.gradeId) await this.confidential.assertMayGiveGrade(user, dto.gradeId);
    const questions = this.checkedQuestions(dto.questions);
    // the key skills (22 October 2026): changed even after people applied, every application scored again
    const keySkills = this.checkedSkills(dto.keySkills);
    let job: { id: string; departmentId: string; minGrade: { confidential: boolean } | null } | null = null;
    if (dto.jobTitleId !== undefined && dto.jobTitleId !== v.jobTitleId) {
      job = await this.prisma.jobTitle.findUnique({ where: { id: dto.jobTitleId }, select: { id: true, departmentId: true, minGrade: { select: { confidential: true } } } });
      if (!job) throw new BadRequestException(['Choose the job title.']);
      if (job.minGrade?.confidential && !seesConfidential(user)) throw new ForbiddenException('Only the CEO or a Super Admin sees C-level positions, so only they open a vacancy for one.');
    }
    const next = {
      title: dto.title,
      headcount: dto.headcount,
      durationMonths: dto.durationMonths,
      salaryMin: dto.salaryMin === undefined ? undefined : dto.salaryMin,
      salaryMax: dto.salaryMax === undefined ? undefined : dto.salaryMax,
      closingDate: dto.closingDate === undefined || dto.closingDate === fromDateOnly(v.closingDate) ? undefined : dto.closingDate,
    };
    const merged = {
      salaryMin: next.salaryMin === undefined ? money(v.salaryMin) : next.salaryMin,
      salaryMax: next.salaryMax === undefined ? money(v.salaryMax) : next.salaryMax,
    };
    const problems = vacancyProblems({ ...next, ...merged }, todayInCairo());
    if (problems.length) throw new BadRequestException(problems);
    await this.checkLinks(dto);
    const data: Prisma.VacancyUncheckedUpdateInput = {
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(job && { jobTitleId: job.id, departmentId: job.departmentId }),
      ...(dto.gradeId !== undefined && { gradeId: dto.gradeId }),
      ...(dto.hiringManagerId !== undefined && { hiringManagerId: dto.hiringManagerId }),
      ...(dto.headcount !== undefined && { headcount: dto.headcount }),
      ...(dto.employmentType !== undefined && { employmentType: dto.employmentType }),
      ...(dto.workArrangement !== undefined && { workArrangement: dto.workArrangement }),
      ...(dto.shiftId !== undefined && { shiftId: dto.shiftId }),
      ...(dto.durationMonths !== undefined && { durationMonths: dto.durationMonths }),
      ...(dto.closingDate !== undefined && { closingDate: dto.closingDate ? toDateOnly(dto.closingDate) : null }),
      ...(dto.salaryMin !== undefined && { salaryMin: dto.salaryMin }),
      ...(dto.salaryMax !== undefined && { salaryMax: dto.salaryMax }),
      ...(dto.about !== undefined && { about: html(dto.about) }),
      ...(dto.responsibilities !== undefined && { responsibilities: html(dto.responsibilities) }),
      ...(dto.requirements !== undefined && { requirements: html(dto.requirements) }),
      ...(questions !== undefined && { questions: questions as unknown as Prisma.InputJsonValue }),
      ...(keySkills !== undefined && { keySkills }),
      ...(dto.portfolioMode !== undefined && { portfolioMode: dto.portfolioMode }),
      ...(dto.agencyBackground !== undefined && { agencyBackground: dto.agencyBackground }),
    };
    const before = {
      title: v.title,
      jobTitleId: v.jobTitleId,
      gradeId: v.gradeId,
      hiringManagerId: v.hiringManagerId,
      headcount: v.headcount,
      employmentType: v.employmentType,
      workArrangement: v.workArrangement,
      shiftId: v.shiftId,
      durationMonths: v.durationMonths,
      closingDate: fromDateOnly(v.closingDate),
      salaryMin: money(v.salaryMin),
      salaryMax: money(v.salaryMax),
      about: v.about,
      responsibilities: v.responsibilities,
      requirements: v.requirements,
      questions: questionsOf(v.questions),
      keySkills: v.keySkills,
      portfolioMode: v.portfolioMode,
      agencyBackground: v.agencyBackground,
    };
    const after = { ...before };
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (key in data) (after as Record<string, unknown>)[key] = key === 'closingDate' ? (dto.closingDate ?? null) : (data as Record<string, unknown>)[key];
    }
    const diff = changes(auditFields(before), auditFields(after));
    // a description's text changed though "(text)" before and after (found 25 October 2026, as the CV fit reads them)
    for (const key of ['about', 'responsibilities', 'requirements'] as const) {
      if (!(key in diff) && before[key] && after[key] && before[key] !== after[key]) diff[key] = { from: '(text)', to: '(text changed)' };
    }
    if (!Object.keys(diff).length) return this.view(v, user);
    const { count } = await this.prisma.vacancy.updateMany({ where: { id, status: v.status }, data: data as Prisma.VacancyUpdateManyMutationInput });
    if (!count) throw new ConflictException('The vacancy changed meanwhile. Reload the page to see where it stands.');
    await this.audit.record({ userId: user.id, action: 'update', entityType: VACANCY_ENTITY, entityId: id, diff: { number: v.number, ...diff } });
    // what the CV fit reads changed (owner, 25 October 2026: "Full CV fit score"): its applications scored again, and its
    // earlier CVs' fits (Suggested From Earlier CVs and the person's side) worked out again while it is open
    if (FIT_FIELDS.some((f) => f in diff)) {
      await this.readings.rescoreVacancy(id);
      await this.suggestions.refreshVacancy(id, { notify: false });
    }
    return this.get(id, user);
  }

  /**
   * Moves a vacancy on (shared VACANCY_MOVES): HR sends it for approval, holds, reopens and closes it; the CEO (or a
   * Super Admin) approves it, publishing it, or sends it back with a reason. The CEO is told of one waiting, its maker
   * and sender of the decision.
   */
  async move(id: string, move: VacancyMove, reason: string | null | undefined, user: SessionUser): Promise<VacancyView> {
    const deciding = move === 'approve' || move === 'send_back';
    if (deciding ? !approvesVacancies(user) : !managesRecruitment(user)) {
      throw new ForbiddenException(deciding ? 'Only the CEO (or a Super Admin) approves a vacancy or sends it back.' : 'Only HR (or a Super Admin) does this.');
    }
    const v = await this.row(id, user);
    const status = v.status as VacancyStatus;
    if (!canMoveVacancy(move, status)) throw new ConflictException(`The vacancy is ${VACANCY_STATUS_LABELS[status].toLowerCase()}, so this can't be done now.`);
    const today = todayInCairo();
    if ((move === 'submit' || move === 'approve' || move === 'reopen') && v.closingDate && fromDateOnly(v.closingDate) < today) {
      throw new BadRequestException(['Its closing date has passed: set a later one first.']);
    }
    if (move === 'submit' && !v.about && !v.responsibilities && !v.requirements) {
      throw new BadRequestException(['Write what the job is about, its responsibilities or its requirements first: the careers page shows them.']);
    }
    if (move === 'send_back' && !reason) throw new BadRequestException(['Say why it goes back, so HR knows what to change.']);
    const now = new Date();
    const to = VACANCY_MOVE_TO[move];
    const data: Prisma.VacancyUncheckedUpdateManyInput = {
      status: to,
      ...(move === 'submit' && { submittedAt: now, submittedById: user.id, sentBackReason: null }),
      ...(move === 'approve' && { decidedAt: now, decidedById: user.id, publishedAt: v.publishedAt ?? now, sentBackReason: null }),
      ...(move === 'send_back' && { decidedAt: now, decidedById: user.id, sentBackReason: reason ?? null }),
      ...(move === 'close' && { closedAt: now, closedById: user.id, closeReason: reason ?? null }),
    };
    const { count } = await this.prisma.vacancy.updateMany({ where: { id, status }, data });
    if (!count) throw new ConflictException('The vacancy changed meanwhile. Reload the page to see where it stands.');
    await this.audit.record({
      userId: user.id,
      action: move,
      entityType: VACANCY_ENTITY,
      entityId: id,
      diff: { number: v.number, status: { from: status, to }, ...(reason && { reason }) },
    });
    await this.notifyMove(v, move);
    // published or open again: its suggested CVs worked out, HR told of the matches (24 October 2026: "Suggest; HR adds")
    if (move === 'approve' || move === 'reopen') await this.suggestions.refreshVacancy(id, { notify: true });
    return this.get(id, user);
  }

  /**
   * Deletes a vacancy (a Super Admin only). Since 25 October 2026 (owner, on a closed vacancy with one rejected applicant:
   * "i want to delete this"; "Vacancy alone - applicant alone - superadmin only") also once people applied: its
   * applications go with it, `confirm` its number typed (recruitment-deletes.service.ts); refused while any of them stays
   * on record (hired, an offer sent, an interview to come).
   */
  async remove(id: string, confirm: string | null | undefined, user: SessionUser): Promise<void> {
    await this.deletes.removeVacancy(id, confirm, user);
  }

  // ---------- helpers ----------

  /** The key skills sent (a list, or text with commas), checked and tidied; undefined when none were sent. */
  private checkedSkills(sent: unknown): string[] | undefined {
    if (sent === undefined) return undefined;
    const skills = keySkillsOf(sent);
    const problems = keySkillsProblems(skills);
    if (problems.length) throw new BadRequestException(problems);
    return skills;
  }

  /** The questions sent, checked and tidied; undefined when none were sent. */
  private checkedQuestions(questions: unknown[] | undefined): VacancyQuestion[] | undefined {
    if (questions === undefined) return undefined;
    const problems = vacancyQuestionsProblems(questions);
    if (problems.length) throw new BadRequestException(problems);
    return tidyQuestions(questions as VacancyQuestion[]);
  }

  /** The grade, hiring manager and shift chosen exist (the hiring manager a current employee). */
  private async checkLinks(dto: { gradeId?: string | null; hiringManagerId?: string | null; shiftId?: string | null }): Promise<void> {
    const problems: string[] = [];
    if (dto.gradeId && !(await this.prisma.grade.count({ where: { id: dto.gradeId } }))) problems.push('Choose the grade, or leave it empty.');
    if (dto.shiftId && !(await this.prisma.shift.count({ where: { id: dto.shiftId } }))) problems.push('Choose the shift, or leave it empty.');
    if (dto.hiringManagerId && !(await this.prisma.employee.count({ where: { id: dto.hiringManagerId, employments: { some: { endDate: null } } } }))) {
      problems.push('The hiring manager must be a current employee.');
    }
    if (problems.length) throw new BadRequestException(problems);
  }

  /** The CEO told of a vacancy waiting; its maker and sender of the CEO's decision (never the reason: it may show on a locked phone). Never fails the move. */
  private async notifyMove(v: VacancyRow, move: VacancyMove): Promise<void> {
    const link = `/recruitment/vacancies/${v.id}`;
    if (move === 'submit') {
      const ceos = await this.usersWithRoles(isConfidentialVacancy(v) ? ['ceo', 'super_admin'] : ['ceo']);
      // on WhatsApp too for the CEO who opted in (24 October 2026: "Approvals waiting"); a C-level one's never shown to HR
      await this.notifications.notify(ceos, {
        kind: 'vacancy_waiting',
        title: 'A vacancy waits for your approval',
        body: `${v.title} (${v.number})`,
        link,
        whatsapp: { facts: { template: 'approval_waiting', what: 'vacancy', who: { en: `${v.title} (${v.number})` } }, confidential: isConfidentialVacancy(v) },
      });
    } else if (move === 'approve' || move === 'send_back') {
      const makers = [v.createdById, v.submittedById];
      await this.notifications.notify(makers, {
        kind: 'vacancy_decided',
        title: move === 'approve' ? 'Vacancy approved and published' : 'Vacancy sent back',
        body: move === 'approve' ? `${v.title} (${v.number}) is on the careers page.` : `${v.title} (${v.number}): see why on the vacancy.`,
        link,
      });
    }
  }

  private async usersWithRoles(keys: string[]): Promise<string[]> {
    const rows = await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: keys } } } } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
}
