import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STAGE_LABELS,
  BOARD_STAGES,
  daysSince,
  feedbackSeen,
  HIRING_SUGGESTION_LABELS,
  mobileSearchForms,
  offerable,
  rejectionMail,
  restorable,
  scoreAnswers,
  sourceOf,
  stageMoveProblem,
  stageSince,
  type ApplicationCan,
  type CandidateBadge,
  type BoardCard,
  type HiringSuggestion,
  type VacancyBoard,
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
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CandidatesService } from './candidates.service.js';
import { CvReadingsService } from './cv-readings.service.js';
import { InterviewsService } from './interviews.service.js';
import { isConfidentialVacancy, vacancyWhere } from './recruitment-access.js';
import { recruitmentCaller, viewerOf, visibleApplications, type RecruitmentCaller } from './recruitment-scope.js';
import { APPLICATION_ENTITY, APPLICATION_LIST_SELECT, answersOf, applicationListView, money, questionsOf, userRef } from './recruitment-views.js';
import type { ListApplicationsDto } from './recruitment.dto.js';

// The applicants (owner, 22 October 2026: "where will we include the ATS?"; packages/shared recruitment.ts): listed by
// vacancy or all together, with their match and stage; an applicant's page with their answers (how each did), their CV,
// HR's notes, their history and the job offers made to them. HR (and a Super Admin) shortlists, moves to interview,
// rejects with a reason and restores (one filtered out by a must-have, or one rejected); the job offer's stages follow
// the offer (RecruitmentOffersService). HR and the CEO read; a C-level vacancy's applicants only the CEO and a Super
// Admin. Each step is kept in the application's history and the audit log.
// Phase 2 (owner, 22 October 2026; packages/shared recruitment-hiring.ts): a vacancy's hiring manager opens its applicants
// from Shortlisted on, an interviewer those they interview (recruitment-scope.ts), neither with the expected salary nor
// HR's notes; the interviews and the scorecards (an interviewer sees the others' once they gave theirs); the hiring
// manager's suggestion (the next step or a rejection) for HR, cleared once HR moves the applicant; the rejection email
// (an "Email the candidate" tick, off unless ticked); and the pipeline board.

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
      status: true,
      questions: true,
      grade: { select: { confidential: true } },
      jobTitle: { select: { minGrade: { select: { confidential: true } } } },
      jobTitleId: true,
      departmentId: true,
      gradeId: true,
      hiringManagerId: true,
      shiftId: true,
      employmentType: true,
      workArrangement: true,
      durationMonths: true,
      keySkills: true,
    },
  },
  cv: { select: { fileName: true, mimeType: true, sizeBytes: true } },
  // the CV read and analysed (22 October 2026)
  cvReading: { select: { status: true, method: true, readAt: true, facts: true, text: true } },
  steps: { orderBy: { at: 'asc' }, include: { by: { select: { id: true, email: true } } } },
  offers: { orderBy: { createdAt: 'asc' }, select: { id: true, number: true, status: true } },
  suggestedBy: { select: { id: true, email: true } },
  // moved from a general CV (22 October 2026): where that CV came from
  generalCv: { select: { source: true } },
} satisfies Prisma.JobApplicationInclude;

type DetailRow = Prisma.JobApplicationGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** What a rejection's email did: sent, not asked for, email not set up on the server, or the provider refused it. */
export type RejectionEmail = 'sent' | 'not_sent' | 'not_set_up' | 'failed';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger('Applicants');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly interviews: InterviewsService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly readings: CvReadingsService,
    private readonly candidates: CandidatesService,
  ) {}

  /** The applications the caller may see on the lists: those of the vacancies they see (HR, the CEO, a Super Admin). */
  where(user: SessionUser): Prisma.JobApplicationWhereInput {
    return { vacancy: vacancyWhere(user) };
  }

  async caller(user: SessionUser): Promise<RecruitmentCaller> {
    return recruitmentCaller(user, await this.confidential.selfId(user));
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
          query.minCvMatch !== undefined ? { cvMatchPercent: { gte: query.minCvMatch } } : {},
          // the search also looks in the CVs' text (22 October 2026: "search by CV content"), and a mobile as typed in
          // any form (kept as +201012345678 since the careers form's mobile field, 22 October 2026)
          text
            ? {
                OR: [
                  { fullName: text },
                  { email: text },
                  { number: text },
                  { mobile: text },
                  ...mobileSearchForms(query.q!).map((f) => ({ mobile: { contains: f } })),
                  { cvReading: { is: { text } } },
                ],
              }
            : {},
        ],
      },
      select: APPLICATION_LIST_SELECT,
      orderBy:
        query.sort === 'cv'
          ? [{ cvMatchPercent: { sort: 'desc', nulls: 'last' } }, { matchPercent: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]
          : [{ matchPercent: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: LIST_CAP,
    });
    // their candidates' badges: "2 applications", "Former employee" (22 October 2026)
    const badges = await this.candidates.badges(
      rows.map((r) => r.candidateId),
      user,
    );
    return rows.map((r) => ({ ...applicationListView(r), candidate: r.candidateId ? (badges.get(r.candidateId) ?? null) : null }));
  }

  /** An applicant, as the caller may see them: HR, the CEO and a Super Admin in full; their hiring manager and interviewers without the expected salary and HR's notes; 404 for anyone else. */
  async get(id: string, user: SessionUser): Promise<ApplicationView> {
    const c = await this.caller(user);
    return this.view(await this.row(id, c), c);
  }

  private async row(id: string, c: RecruitmentCaller): Promise<DetailRow> {
    const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id }, visibleApplications(c)] }, include: DETAIL_INCLUDE });
    if (!a) throw new NotFoundException(NOT_FOUND);
    return a;
  }

  /** HR's (or a Super Admin's) applicant: 404 for anyone else who may not see it, 403 for one who may but doesn't manage. */
  private async managedRow(id: string, user: SessionUser): Promise<{ a: DetailRow; c: RecruitmentCaller }> {
    const c = await this.caller(user);
    const a = await this.row(id, c);
    if (!c.manages) throw new ForbiddenException('Only HR (or a Super Admin) moves applicants.');
    return { a, c };
  }

  private async view(a: DetailRow, c: RecruitmentCaller): Promise<ApplicationView> {
    const questions = questionsOf(a.vacancy.questions);
    const answers = answersOf(a.answers);
    const scored = new Map(scoreAnswers(questions, answers).answers.map((s) => [s.key, s]));
    const names = await userNames(
      this.prisma,
      a.steps.map((s) => s.by),
    );
    const stage = a.stage as ApplicationStage;
    const manages = c.manages;
    const viewer = viewerOf(c, a);
    const participant = viewer === 'hiring_manager' || viewer === 'interviewer';
    const openOffer = a.offers.some((o) => o.status === 'draft' || o.status === 'sent');
    const settled = stage === 'hired' || stage === 'rejected';
    const can: ApplicationCan = {
      shortlist: manages && stageMoveProblem(stage, 'shortlisted', { filteredOut: a.filteredOut, openOffer }) === null,
      interview: manages && stageMoveProblem(stage, 'interview', { filteredOut: a.filteredOut, openOffer }) === null,
      reject: manages && stageMoveProblem(stage, 'rejected', { filteredOut: a.filteredOut, openOffer }) === null,
      restore: manages && restorable({ stage, filteredOut: a.filteredOut }),
      makeOffer: manages && offerable({ stage, filteredOut: a.filteredOut }) && !openOffer,
      editNotes: manages,
      scheduleInterview: manages && !a.filteredOut && !settled,
      suggest: viewer === 'hiring_manager' && !settled,
      emailOnReject: manages && this.mail.configured,
    };
    const [interviews, allFeedback] = await Promise.all([this.interviews.ofApplication(a.id, c), this.interviews.feedbackOf(a.id, c.selfId)]);
    const gaveOwn = allFeedback.some((f) => f.mine);
    const seen = feedbackSeen(viewer, gaveOwn);
    const feedback = seen === 'all' ? allFeedback : allFeedback.filter((f) => f.mine);
    const suggestion =
      a.suggestion && !settled
        ? { kind: a.suggestion as HiringSuggestion, note: a.suggestionNote, by: userRef(a.suggestedBy, await userNames(this.prisma, [a.suggestedBy])), at: (a.suggestedAt ?? a.updatedAt).toISOString() }
        : null;
    return {
      ...applicationListView({ ...a, vacancy: { id: a.vacancy.id, number: a.vacancy.number, title: a.vacancy.title, status: a.vacancy.status } }),
      linkedin: a.linkedin,
      portfolio: a.portfolio,
      noticePeriod: a.noticePeriod,
      // never for a hiring manager or an interviewer (the brief: "They never see the salary range or the candidate's expected salary")
      expectedSalary: participant ? null : money(a.expectedSalary),
      answers: questions.map((q) => {
        const s = scored.get(q.key);
        return { key: q.key, text: q.text, kind: q.kind, answer: answers[q.key] ?? null, points: s?.points ?? 0, maxPoints: s?.maxPoints ?? 0, knockout: q.knockout, passed: s?.passed ?? null };
      }),
      notes: participant ? null : a.notes,
      rejectReason: a.stage === 'rejected' && !participant ? a.rejectReason : null,
      consentAt: a.consentAt.toISOString(),
      cv: a.cv,
      cvReading: a.cv ? this.readings.view(a.cvReading, a.vacancy.keySkills) : null,
      history: a.steps.map(
        (s): ApplicationStepView => ({ event: s.event as ApplicationEvent, stage: s.stage as ApplicationStage, note: s.note, by: userRef(s.by, names), at: s.at.toISOString() }),
      ),
      offers: a.offers,
      employeeId: a.employeeId,
      viewer,
      interviews,
      feedback,
      feedbackHidden: allFeedback.length - feedback.length,
      suggestion,
      // their candidate profile (22 October 2026): HR, the CEO and a Super Admin only, never a hiring manager or an interviewer
      candidateProfile: c.reads ? await this.candidates.ofApplication({ id: a.id, candidateId: a.candidateId }, c.user) : null,
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
    const c = await this.caller(user);
    const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id }, visibleApplications(c)] }, select: { cv: { select: { data: true, fileName: true, mimeType: true } } } });
    if (!a) throw new NotFoundException(NOT_FOUND);
    if (!a.cv) throw new NotFoundException('This applicant sent no CV.');
    return { data: Buffer.from(a.cv.data), fileName: a.cv.fileName, mimeType: a.cv.mimeType };
  }

  /** The CV's text and the contacts found in it, for the caller who may see the CV (never a developer: the route refuses them). */
  async cvText(id: string, user: SessionUser) {
    const c = await this.caller(user);
    const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id }, visibleApplications(c)] }, select: { id: true } });
    if (!a) throw new NotFoundException(NOT_FOUND);
    const t = await this.readings.textOf({ applicationId: id });
    if (!t) throw new NotFoundException('This CV hasn’t been read yet.');
    return t;
  }

  /**
   * Moves an applicant by hand (shared stageMoveProblem): shortlisted, interview, or rejected with a reason; refused in
   * words when the move doesn't fit their stage (409).
   */
  async move(id: string, to: HandStage, reason: string | null | undefined, user: SessionUser, email = false): Promise<ApplicationView & { emailed: RejectionEmail }> {
    const { a } = await this.managedRow(id, user);
    const stage = a.stage as ApplicationStage;
    const openOffer = a.offers.some((o) => o.status === 'draft' || o.status === 'sent');
    const problem = stageMoveProblem(stage, to, { filteredOut: a.filteredOut, openOffer });
    if (problem) throw new ConflictException(problem);
    if (to === 'rejected' && !reason) throw new BadRequestException(['Say why they are rejected.']);
    const data: Prisma.JobApplicationUpdateManyMutationInput =
      to === 'rejected' ? { stage: 'rejected', rejectedFrom: stage, rejectReason: reason ?? null } : { stage: to, rejectedFrom: null, rejectReason: null };
    await this.step(a, stage, data, { event: to, stage: to, note: to === 'rejected' ? (reason ?? null) : null }, user);
    const emailed = to === 'rejected' && email ? await this.emailRejection(a, user) : 'not_sent';
    return { ...(await this.get(id, user)), emailed };
  }

  /**
   * The rejection email to the candidate (the brief: "an 'Email the candidate' tick, off by default … a polite standard
   * text that an HR-editable Recruitment Settings section can change"), English then Arabic. Never fails the rejection.
   */
  private async emailRejection(a: DetailRow, user: SessionUser): Promise<RejectionEmail> {
    if (!this.mail.configured) return 'not_set_up';
    const [settings, company] = await Promise.all([
      this.prisma.recruitmentSettings.findUnique({ where: { id: 1 } }),
      this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } }),
    ]);
    const mail = rejectionMail(
      { subject: settings?.rejectionSubject ?? null, en: settings?.rejectionEn ?? null, ar: settings?.rejectionAr ?? null },
      { name: a.fullName, job: a.vacancy.title, company: company?.nameEn ?? 'the company' },
    );
    try {
      await this.mail.send({ to: a.email, replyTo: user.email, subject: mail.subject, text: mail.text });
    } catch (err) {
      this.logger.warn(`The rejection email of ${a.number} could not be sent: ${(err as Error).message}`);
      await this.audit.record({ userId: user.id, action: 'rejection_email', entityType: APPLICATION_ENTITY, entityId: a.id, diff: { number: a.number, sent: false } });
      return 'failed';
    }
    await this.audit.record({ userId: user.id, action: 'rejection_email', entityType: APPLICATION_ENTITY, entityId: a.id, diff: { number: a.number, sent: true } });
    return 'sent';
  }

  /**
   * The hiring manager's suggestion (the brief: "They can suggest Reject or Next step, which HR acts on"): kept on the
   * applicant until HR moves them, and HR told (the CEO and the Super Admins for a C-level vacancy).
   */
  async suggest(id: string, suggestion: HiringSuggestion, note: string | null | undefined, user: SessionUser): Promise<ApplicationView> {
    const c = await this.caller(user);
    const a = await this.row(id, c);
    if (viewerOf(c, a) !== 'hiring_manager') throw new ForbiddenException('Only the vacancy’s hiring manager suggests what happens next.');
    const stage = a.stage as ApplicationStage;
    if (stage === 'hired' || stage === 'rejected') throw new ConflictException(`They are ${APPLICATION_STAGE_LABELS[stage].toLowerCase()}: there is nothing to suggest.`);
    await this.prisma.jobApplication.update({ where: { id }, data: { suggestion, suggestionNote: note ?? null, suggestedById: user.id, suggestedAt: new Date() } });
    await this.audit.record({ userId: user.id, action: 'suggest', entityType: APPLICATION_ENTITY, entityId: id, diff: { number: a.number, suggestion, ...(note && { note }) } });
    const roles = isConfidentialVacancy(a.vacancy) ? ['ceo', 'super_admin'] : ['hr'];
    const hr = await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: roles } } } } }, select: { id: true } });
    await this.notifications.notify(
      hr.map((u) => u.id),
      { kind: 'hiring_suggestion', title: `Hiring manager suggests: ${HIRING_SUGGESTION_LABELS[suggestion]}`, body: `${a.fullName} · ${a.vacancy.title}`, link: `/recruitment/applicants/${id}` },
    );
    return this.view(await this.row(id, c), c);
  }

  // ---------- the pipeline board ----------

  /**
   * A vacancy's pipeline board (the brief: "a board with a column per stage, and cards with name, match %, source and
   * days in stage"): HR, the CEO and a Super Admin see every applicant but those filtered out (counted apart); the
   * vacancy's hiring manager from Shortlisted on, read only; 404 for anyone else.
   */
  async board(vacancyId: string, user: SessionUser, now = new Date()): Promise<VacancyBoard> {
    const c = await this.caller(user);
    const v = await this.prisma.vacancy.findFirst({
      where: { id: vacancyId, ...(c.reads ? vacancyWhere(user) : { hiringManagerId: c.selfId ?? '00000000-0000-0000-0000-000000000000' }) },
      select: { id: true, number: true, title: true, status: true, hiringManagerId: true },
    });
    if (!v) throw new NotFoundException('Vacancy not found.');
    const viewer = c.manages ? 'manages' : c.reads ? 'reads' : 'hiring_manager';
    const rows = await this.prisma.jobApplication.findMany({
      where: { AND: [{ vacancyId }, visibleApplications(c), { filteredOut: false }] },
      select: {
        id: true,
        number: true,
        fullName: true,
        matchPercent: true,
        cvMatchPercent: true,
        source: true,
        stage: true,
        filteredOut: true,
        suggestion: true,
        createdAt: true,
        steps: { select: { stage: true, at: true }, orderBy: { at: 'asc' } },
        offers: { where: OPEN_OFFER, select: { id: true } },
        interviews: { where: { status: 'scheduled', startsAt: { gte: now } }, select: { id: true } },
        candidateId: true,
      },
      orderBy: [{ matchPercent: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const filteredOut = c.reads ? await this.prisma.jobApplication.count({ where: { vacancyId, filteredOut: true } }) : 0;
    // the candidates' badges (22 October 2026), for HR, the CEO and a Super Admin: a hiring manager keeps what they saw
    const badges = c.reads
      ? await this.candidates.badges(
          rows.map((r) => r.candidateId),
          user,
        )
      : new Map<string, CandidateBadge>();
    const stages = viewer === 'hiring_manager' ? BOARD_STAGES.filter((s) => s !== 'applied') : [...BOARD_STAGES];
    const cards = rows.map(
      (r): BoardCard => ({
        id: r.id,
        number: r.number,
        fullName: r.fullName,
        matchPercent: r.matchPercent,
        cvMatchPercent: r.cvMatchPercent,
        source: sourceOf(r.source),
        stage: r.stage as ApplicationStage,
        filteredOut: r.filteredOut,
        daysInStage: daysSince(stageSince(r.steps, r.createdAt), now),
        openOffer: r.offers.length > 0,
        upcomingInterviews: r.interviews.length,
        suggestion: (r.suggestion as HiringSuggestion | null) ?? null,
        candidate: r.candidateId ? (badges.get(r.candidateId) ?? null) : null,
      }),
    );
    return {
      vacancy: { id: v.id, number: v.number, title: v.title, status: v.status },
      viewer,
      canMove: c.manages,
      columns: stages.map((stage) => ({ stage, cards: cards.filter((x) => x.stage === stage) })),
      filteredOut,
    };
  }

  /** Restores one filtered out by a must-have (kept at Applied), or one rejected (back to the stage they were rejected at). */
  async restore(id: string, user: SessionUser): Promise<ApplicationView> {
    const { a } = await this.managedRow(id, user);
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
    const { a } = await this.managedRow(id, user);
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
      // HR acted: the hiring manager's suggestion is done with
      const { count } = await tx.jobApplication.updateMany({ where: { id: a.id, stage, filteredOut: a.filteredOut }, data: { ...data, suggestion: null, suggestionNote: null, suggestedById: null, suggestedAt: null } });
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
