import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STAGE_LABELS,
  offerable,
  restorable,
  scoreAnswers,
  stageMoveProblem,
  type ApplicationCan,
  type ApplicationEvent,
  type ApplicationListItem,
  type ApplicationStage,
  type ApplicationStepView,
  type ApplicationView,
  type EmploymentType,
  type HandStage,
  type WorkArrangement,
} from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { managesRecruitment, vacancyWhere } from './recruitment-access.js';
import { APPLICATION_ENTITY, APPLICATION_LIST_SELECT, answersOf, applicationListView, money, questionsOf, userRef } from './recruitment-views.js';
import type { ListApplicationsDto } from './recruitment.dto.js';

// The applicants (owner, 22 October 2026: "where will we include the ATS?"; packages/shared recruitment.ts): listed by
// vacancy or all together, with their match and stage; an applicant's page with their answers (how each did), their CV,
// HR's notes, their history and the job offers made to them. HR (and a Super Admin) shortlists, moves to interview,
// rejects with a reason and restores (one filtered out by a must-have, or one rejected); the job offer's stages follow
// the offer (RecruitmentOffersService). HR and the CEO read; a C-level vacancy's applicants only the CEO and a Super
// Admin. Each step is kept in the application's history and the audit log.

const NOT_FOUND = 'Applicant not found.';
const LIST_CAP = 1000;
/** A job offer still open: drafted or sent. */
export const OPEN_OFFER: Prisma.JobOfferWhereInput = { status: { in: ['draft', 'sent'] } };

const DETAIL_INCLUDE = {
  vacancy: {
    select: {
      id: true,
      number: true,
      title: true,
      questions: true,
      jobTitleId: true,
      departmentId: true,
      gradeId: true,
      hiringManagerId: true,
      shiftId: true,
      employmentType: true,
      workArrangement: true,
      durationMonths: true,
    },
  },
  cv: { select: { fileName: true, mimeType: true, sizeBytes: true } },
  steps: { orderBy: { at: 'asc' }, include: { by: { select: { id: true, email: true } } } },
  offers: { orderBy: { createdAt: 'asc' }, select: { id: true, number: true, status: true } },
} satisfies Prisma.JobApplicationInclude;

type DetailRow = Prisma.JobApplicationGetPayload<{ include: typeof DETAIL_INCLUDE }>;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The applications the caller may see: those of the vacancies they see. */
  where(user: SessionUser): Prisma.JobApplicationWhereInput {
    return { vacancy: vacancyWhere(user) };
  }

  async list(query: ListApplicationsDto, user: SessionUser): Promise<ApplicationListItem[]> {
    const text = query.q ? { contains: query.q, mode: 'insensitive' as const } : null;
    const filtered = query.filtered ?? 'hide';
    const rows = await this.prisma.jobApplication.findMany({
      where: {
        AND: [
          this.where(user),
          query.vacancyId ? { vacancyId: query.vacancyId } : {},
          query.stage ? { stage: query.stage } : {},
          query.minMatch !== undefined ? { matchPercent: { gte: query.minMatch } } : {},
          query.minYears !== undefined ? { yearsExperience: { gte: query.minYears } } : {},
          query.source ? { source: query.source } : {},
          filtered === 'hide' ? { filteredOut: false } : filtered === 'only' ? { filteredOut: true } : {},
          text ? { OR: [{ fullName: text }, { email: text }, { number: text }, { mobile: text }] } : {},
        ],
      },
      select: APPLICATION_LIST_SELECT,
      orderBy: [{ matchPercent: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: LIST_CAP,
    });
    return rows.map(applicationListView);
  }

  async get(id: string, user: SessionUser): Promise<ApplicationView> {
    return this.view(await this.row(id, user), user);
  }

  private async row(id: string, user: SessionUser): Promise<DetailRow> {
    const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id }, this.where(user)] }, include: DETAIL_INCLUDE });
    if (!a) throw new NotFoundException(NOT_FOUND);
    return a;
  }

  private async view(a: DetailRow, user: SessionUser): Promise<ApplicationView> {
    const questions = questionsOf(a.vacancy.questions);
    const answers = answersOf(a.answers);
    const scored = new Map(scoreAnswers(questions, answers).answers.map((s) => [s.key, s]));
    const names = await userNames(
      this.prisma,
      a.steps.map((s) => s.by),
    );
    const stage = a.stage as ApplicationStage;
    const manages = managesRecruitment(user);
    const openOffer = a.offers.some((o) => o.status === 'draft' || o.status === 'sent');
    const can: ApplicationCan = {
      shortlist: manages && stageMoveProblem(stage, 'shortlisted', { filteredOut: a.filteredOut, openOffer }) === null,
      interview: manages && stageMoveProblem(stage, 'interview', { filteredOut: a.filteredOut, openOffer }) === null,
      reject: manages && stageMoveProblem(stage, 'rejected', { filteredOut: a.filteredOut, openOffer }) === null,
      restore: manages && restorable({ stage, filteredOut: a.filteredOut }),
      makeOffer: manages && offerable({ stage, filteredOut: a.filteredOut }) && !openOffer,
      editNotes: manages,
    };
    return {
      ...applicationListView({ ...a, vacancy: { id: a.vacancy.id, number: a.vacancy.number, title: a.vacancy.title } }),
      linkedin: a.linkedin,
      portfolio: a.portfolio,
      noticePeriod: a.noticePeriod,
      expectedSalary: money(a.expectedSalary),
      answers: questions.map((q) => {
        const s = scored.get(q.key);
        return { key: q.key, text: q.text, kind: q.kind, answer: answers[q.key] ?? null, points: s?.points ?? 0, maxPoints: s?.maxPoints ?? 0, knockout: q.knockout, passed: s?.passed ?? null };
      }),
      notes: a.notes,
      rejectReason: a.stage === 'rejected' ? a.rejectReason : null,
      consentAt: a.consentAt.toISOString(),
      cv: a.cv,
      history: a.steps.map(
        (s): ApplicationStepView => ({ event: s.event as ApplicationEvent, stage: s.stage as ApplicationStage, note: s.note, by: userRef(s.by, names), at: s.at.toISOString() }),
      ),
      offers: a.offers,
      employeeId: a.employeeId,
      position: {
        jobTitleId: a.vacancy.jobTitleId,
        departmentId: a.vacancy.departmentId,
        gradeId: a.vacancy.gradeId,
        hiringManagerId: a.vacancy.hiringManagerId,
        shiftId: a.vacancy.shiftId,
        employmentType: a.vacancy.employmentType as EmploymentType,
        workArrangement: a.vacancy.workArrangement as WorkArrangement,
        durationMonths: a.vacancy.durationMonths,
      },
      can,
    };
  }

  /** The CV as it was sent, for the caller who may see the applicant. */
  async cv(id: string, user: SessionUser): Promise<{ data: Buffer; fileName: string; mimeType: string }> {
    const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id }, this.where(user)] }, select: { cv: { select: { data: true, fileName: true, mimeType: true } } } });
    if (!a) throw new NotFoundException(NOT_FOUND);
    if (!a.cv) throw new NotFoundException('This applicant sent no CV.');
    return { data: Buffer.from(a.cv.data), fileName: a.cv.fileName, mimeType: a.cv.mimeType };
  }

  /**
   * Moves an applicant by hand (shared stageMoveProblem): shortlisted, interview, or rejected with a reason; refused in
   * words when the move doesn't fit their stage (409).
   */
  async move(id: string, to: HandStage, reason: string | null | undefined, user: SessionUser): Promise<ApplicationView> {
    const a = await this.row(id, user);
    const stage = a.stage as ApplicationStage;
    const openOffer = a.offers.some((o) => o.status === 'draft' || o.status === 'sent');
    const problem = stageMoveProblem(stage, to, { filteredOut: a.filteredOut, openOffer });
    if (problem) throw new ConflictException(problem);
    if (to === 'rejected' && !reason) throw new BadRequestException(['Say why they are rejected.']);
    const data: Prisma.JobApplicationUpdateManyMutationInput =
      to === 'rejected' ? { stage: 'rejected', rejectedFrom: stage, rejectReason: reason ?? null } : { stage: to, rejectedFrom: null, rejectReason: null };
    await this.step(a, stage, data, { event: to, stage: to, note: to === 'rejected' ? (reason ?? null) : null }, user);
    return this.get(id, user);
  }

  /** Restores one filtered out by a must-have (kept at Applied), or one rejected (back to the stage they were rejected at). */
  async restore(id: string, user: SessionUser): Promise<ApplicationView> {
    const a = await this.row(id, user);
    const stage = a.stage as ApplicationStage;
    if (!restorable({ stage, filteredOut: a.filteredOut })) throw new ConflictException('They are neither filtered out nor rejected: there is nothing to restore.');
    if (stage === 'rejected') {
      const back = (a.rejectedFrom ?? 'applied') as ApplicationStage;
      await this.step(a, stage, { stage: back, rejectedFrom: null, rejectReason: null }, { event: 'restored', stage: back, note: `Back to ${APPLICATION_STAGE_LABELS[back]}` }, user);
    } else {
      await this.step(a, stage, { filteredOut: false }, { event: 'restored', stage, note: 'Restored after a must-have question' }, user);
    }
    return this.get(id, user);
  }

  /** HR's notes on an applicant. */
  async notes(id: string, notes: string | null | undefined, user: SessionUser): Promise<ApplicationView> {
    const a = await this.row(id, user);
    const next = notes ?? null;
    if (next !== a.notes) {
      await this.prisma.jobApplication.update({ where: { id }, data: { notes: next } });
      await this.audit.record({ userId: user.id, action: 'notes', entityType: APPLICATION_ENTITY, entityId: id, diff: { number: a.number, notes: { from: a.notes ? '(text)' : null, to: next ? '(text)' : null } } });
    }
    return this.get(id, user);
  }

  /** One step: the application changed if it is still at `stage`, its history and the audit log. */
  private async step(
    a: DetailRow,
    stage: ApplicationStage,
    data: Prisma.JobApplicationUpdateManyMutationInput,
    step: { event: ApplicationEvent; stage: ApplicationStage; note: string | null },
    user: SessionUser,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.jobApplication.updateMany({ where: { id: a.id, stage, filteredOut: a.filteredOut }, data });
      if (!count) throw new ConflictException('The applicant changed meanwhile. Reload the page to see where they stand.');
      await tx.jobApplicationStep.create({ data: { applicationId: a.id, ...step, byId: user.id } });
    });
    await this.audit.record({
      userId: user.id,
      action: step.event === 'restored' ? 'restore' : 'stage',
      entityType: APPLICATION_ENTITY,
      entityId: a.id,
      diff: { number: a.number, vacancy: a.vacancy.number, stage: { from: stage, to: step.stage }, ...(step.note && { note: step.note }) },
    });
  }
}
