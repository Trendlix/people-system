import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { agencyMarksOf } from './agency-marks.js';
import {
  APPLICATION_STAGE_LABELS,
  BOARD_STAGES,
  HIRING_MANAGER_STAGES,
  REVIEW_REJECTION_STEPS,
  daysSince,
  feedbackSeen,
  isScreeningCallResult,
  mobileSearchForms,
  applicationStageLabel,
  decisionProblems,
  decisionText,
  isDecisionStep,
  isHoldOutcome,
  OUTCOME_EFFECT,
  rejectReasonsOf,
  rejectReasonsText,
  reviewTemplateValues,
  reviewWaitingEmail,
  reviewWaitingNotice,
  stageAfter,
  STEP_ACTOR,
  STEP_ACTOR_LABELS,
  STEP_OUTCOMES_OF,
  takesStep,
  takesStepProblem,
  type DecisionStep,
  type RejectReason,
  type StepDecisionInput,
  type StepDecisionView,
  type StepOutcome,
  offerable,
  rejectionMail,
  restorable,
  applicationSourceOf,
  cvFitFrom,
  cvUpdatedMark,
  scoreAnswers,
  stageMoveProblem,
  stageSince,
  type ApplicationCan,
  type BetterFitBadge,
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
  type ScreeningCallView,
  type WorkArrangement,
} from '@trendlix/shared';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { AuditService } from '../audit/audit.service.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CandidatesService } from './candidates.service.js';
import { CvFitsService } from './cv-fits.service.js';
import { CvPreviewsService } from './cv-previews.service.js';
import { CvReadingsService } from './cv-readings.service.js';
import { InterviewsService } from './interviews.service.js';
import { portfolioTitlesOf } from './portfolio-asks.js';
import { isConfidentialVacancy, vacancyWhere } from './recruitment-access.js';
import { recruitmentCaller, viewerOf, visibleApplications, type RecruitmentCaller } from './recruitment-scope.js';
import {
  APPLICATION_ENTITY,
  APPLICATION_LIST_SELECT,
  answersOf,
  applicationListView,
  byExperience,
  EARLIER_CV_SELECT,
  earlierCvView,
  holdWhere,
  minYearsWhere,
  money,
  questionsOf,
  skillWhere,
  userRef,
} from './recruitment-views.js';
import type { ListApplicationsDto } from './recruitment.dto.js';
import { ScreeningCommentsService } from './screening-comments.service.js';
import { NOTES_GONE } from './screening-notes.js';
import { ConfigService } from '@nestjs/config';
import { suggestionShown, type HiringBatchResult } from '@trendlix/shared';
import { reviewersOf, treeCaller, treeReviewers, type VacancyReviewers } from './recruitment-tree-access.js';
import { webOriginOf } from '../employee-access/employee-access.service.js';
import { BATCH_NOT_FOUND, batchIds, decideSkip, skippedOf } from './hiring-batches.js';
import { cvLinkedinOf } from './cv-fit-inputs.js';

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
// The recruitment tree (owner, 3 November 2026: "Recrutment tree"; 5 November 2026: Applicants the recruiter's review,
// Review 2 the Final Review, the hiring manager's review gone; packages/shared recruitment-tree.ts): each step is decided
// by whoever takes it (the vacancy's recruiter Applicants, the recruiter's manager the Final Review, HR the rest; a Super
// Admin any; one at a time or several at once), with its outcome, a rejection's reasons (none at a review) and the
// written feedback, kept as a decision; a pass moves them on (the Final Review skipped without the recruiter's manager),
// a rejection or a decline closes them, Unreachable and Pending keep them at their step (the lists' ?hold=). The
// recruiter's manager is told once a batch reaches their Final Review. Those rejected at a review are listed apart from
// the Rejected tab (?reviewRejected=only), and kept off the board.

const NOT_FOUND = 'Applicant not found.';
const LIST_CAP = 1000;
/**
 * The match first (25 October 2026): the screening questions' %, else, not asked them (added from the suggestions or by
 * HR), the CV fit's; none last. Stable: equals keep their order.
 */
function byMatch<T extends { matchPercent: number | null; cvMatchPercent: number | null }>(rows: readonly T[]): T[] {
  const key = (r: T) => r.matchPercent ?? r.cvMatchPercent;
  return rows
    .map((row, i) => ({ row, i, k: key(row) }))
    .sort((a, b) => (a.k === null ? (b.k === null ? a.i - b.i : 1) : b.k === null ? -1 : b.k - a.k || a.i - b.i))
    .map((x) => x.row);
}

/** A decision as an application's page shows it: its feedback hidden from an interviewer (3 November 2026). */
function decisionView(
  d: { id: string; stage: string; outcome: string; reasons: string[]; feedback: string | null; by: { id: string; email: string } | null; at: Date },
  names: Awaited<ReturnType<typeof userNames>>,
  hideFeedback: boolean,
): StepDecisionView {
  return {
    id: d.id,
    stage: d.stage as StepDecisionView['stage'],
    outcome: d.outcome as StepOutcome,
    reasons: d.reasons as RejectReason[],
    feedback: hideFeedback ? null : d.feedback,
    by: userRef(d.by, names),
    at: d.at.toISOString(),
  };
}

/** A job offer still open: drafted or sent. */
export const OPEN_OFFER: Prisma.JobOfferWhereInput = { status: { in: ['draft', 'sent'] } };

const DETAIL_INCLUDE = {
  // their interviews marked done: a job offer only after one (owner, 1 November 2026: "Offer only after interview")
  _count: { select: { interviews: { where: { status: 'done' } } } },
  vacancy: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      questions: true,
      grade: { select: { confidential: true } },
      // its job title's portfolio and the vacancy's own say, for the portfolio's section title (26 October 2026)
      jobTitle: { select: { id: true, titleEn: true, minGrade: { select: { confidential: true } } } },
      portfolioMode: true,
      jobTitleId: true,
      departmentId: true,
      gradeId: true,
      hiringManagerId: true,
      // its recruiter (the recruitment tree, 3 November 2026)
      recruiterId: true,
      shiftId: true,
      employmentType: true,
      workArrangement: true,
      durationMonths: true,
      keySkills: true,
    },
  },
  cv: { select: { fileName: true, mimeType: true, sizeBytes: true } },
  // the CVs it held before (applying again, 25 October 2026: "Update their application"), the newest first, never their files
  earlierCvs: { orderBy: { sentAt: 'desc' }, select: EARLIER_CV_SELECT },
  // the PDF case study sent as a portfolio (25 October 2026: "Portfolio per position")
  portfolioFile: { select: { fileName: true, sizeBytes: true } },
  // the CV read and analysed (22 October 2026)
  cvReading: { select: { status: true, method: true, readAt: true, facts: true, text: true, error: true } },
  steps: { orderBy: { at: 'asc' }, include: { by: { select: { id: true, email: true } } } },
  // an earlier one marked (25 October 2026)
  offers: { orderBy: { createdAt: 'asc' }, select: { id: true, number: true, status: true, recordedEarlier: true } },
  suggestedBy: { select: { id: true, email: true } },
  // who made HR's screening call (29 October 2026: "Screening call + result")
  screeningCallBy: { select: { id: true, email: true } },
  // every decision in the recruitment tree (3 November 2026)
  decisions: { orderBy: { at: 'asc' }, include: { by: { select: { id: true, email: true } } } },
  // moved from a general CV (22 October 2026): where that CV came from
  generalCv: { select: { source: true } },
} satisfies Prisma.JobApplicationInclude;

type DetailRow = Prisma.JobApplicationGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** What a step reads of an application (an applicant's page's row, or a batch's). */
type StepRow = Pick<DetailRow, 'id' | 'number' | 'filteredOut'> & { vacancy: Pick<DetailRow['vacancy'], 'number'> };

/** A vacancy as the batches read it: who recruits and hires for it, and whether it is C-level. */
const BATCH_VACANCY = {
  id: true,
  number: true,
  title: true,
  hiringManagerId: true,
  recruiterId: true,
  grade: { select: { confidential: true } },
  jobTitle: { select: { minGrade: { select: { confidential: true } } } },
} satisfies Prisma.VacancySelect;

/** Where the hiring manager accepts or rejects a shortlist (the site's My Hiring). */
const MY_HIRING_LINK = '/recruitment/my-hiring';
const CHANGED_MEANWHILE = 'The applicant changed meanwhile. Reload the page to see where they stand.';

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
    private readonly comments: ScreeningCommentsService,
    private readonly previews: CvPreviewsService,
    private readonly fits: CvFitsService,
    private readonly config: ConfigService,
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
    // the latest screening verdict, or none yet (24 October 2026: "Yes: Good fit / Maybe / Not a fit")
    const verdictWhere = await this.comments.applicationVerdictWhere(query.verdict);
    const rows = await this.prisma.jobApplication.findMany({
      where: {
        AND: [
          this.where(user),
          verdictWhere,
          query.vacancyId ? { vacancyId: query.vacancyId } : {},
          // the Rejected tab: rejected at HR Screening, the interview or the offer; those rejected at a review apart (5 November 2026)
          query.reviewRejected === 'only'
            ? { stage: 'rejected', rejectedFrom: { in: [...REVIEW_REJECTION_STEPS] } }
            : query.stage === 'rejected'
              ? { stage: 'rejected', rejectedFrom: { notIn: [...REVIEW_REJECTION_STEPS] } }
              : query.stage
                ? { stage: query.stage }
                : {},
          query.minMatch !== undefined ? { matchPercent: { gte: query.minMatch } } : {},
          // the years typed, else the CV's (owner, 24 October 2026: "why isn't the experience pulled off the CV?")
          query.minYears !== undefined ? minYearsWhere(query.minYears) : {},
          // a skill of the dictionary the CV names (24 October 2026)
          query.skill ? skillWhere(query.skill) : {},
          query.source ? { source: query.source } : {},
          filtered === 'hide' ? { filteredOut: false } : filtered === 'only' ? { filteredOut: true } : {},
          query.minCvMatch !== undefined ? { cvMatchPercent: { gte: query.minCvMatch } } : {},
          // kept at their step: Unreachable or Pending (the recruitment tree, 3 November 2026)
          query.hold ? holdWhere(query.hold) : {},
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
    const [badges, verdicts] = await Promise.all([
      this.candidates.badges(
        rows.map((r) => r.candidateId),
        user,
      ),
      this.comments.applicationVerdicts(rows.map((r) => r.id)),
    ]);
    // "Better fit: Media Buyer 82%" (owner, 25 October 2026: "and if it recomended to another position based on the CV")
    const better = await this.fits.badges(rows, user);
    // HR's marks of marketing agencies, for each CV's Ex-agency flag (27 October 2026)
    const marks = await agencyMarksOf(this.prisma);
    const items = rows.map((r) => ({
      ...applicationListView(r, marks),
      candidate: r.candidateId ? (badges.get(r.candidateId) ?? null) : null,
      verdict: verdicts.get(r.id) ?? null,
      betterFit: this.fits.sees(user) ? (better.get(r.id) ?? null) : undefined,
    }));
    // most experience first (24 October 2026): the years typed, else the CV's; the best match first among equals
    if (query.sort === 'years') return byExperience(items, (a) => ({ typed: a.yearsExperience, cvMonths: a.fromCv?.experienceMonths ?? null }));
    // the match: the screening's, else (not asked the screening questions) the CV fit's (25 October 2026)
    return query.sort === 'cv' ? items : byMatch(items);
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
    const names2 = await userNames(
      this.prisma,
      a.decisions.map((d) => d.by),
    );
    const stage = a.stage as ApplicationStage;
    const manages = c.manages;
    const viewer = viewerOf(c, a);
    const participant = viewer === 'hiring_manager' || viewer === 'interviewer' || viewer === 'reviewer';
    const openOffer = a.offers.some((o) => o.status === 'draft' || o.status === 'sent');
    const settled = stage === 'hired' || stage === 'rejected';
    // the recruitment tree (3 November 2026): who takes their step, and whether the caller does
    const reviewers = await reviewersOf(this.prisma, a.vacancy);
    const tree = treeCaller(c, reviewers);
    const decides = isDecisionStep(stage) && !a.filteredOut && takesStep(stage, tree);
    const can: ApplicationCan = {
      decide: decides && isDecisionStep(stage) ? { stage, outcomes: [...STEP_OUTCOMES_OF[stage]], reasons: [...rejectReasonsOf(stage)] } : null,
      reject: manages && stageMoveProblem(stage, 'rejected', { filteredOut: a.filteredOut, openOffer }) === null,
      restore: manages && restorable({ stage, filteredOut: a.filteredOut }),
      // at Offer: the Technical Interview accepted them (3 November 2026)
      makeOffer: manages && offerable({ stage, filteredOut: a.filteredOut, interviewsDone: a._count.interviews }) && !openOffer,
      // the notes became screening comments (24 October 2026): kept read only
      editNotes: false,
      // the Technical Interview's setting (3 November 2026): scheduled once HR Screening accepted them
      scheduleInterview: manages && !a.filteredOut && (stage === 'interview' || stage === 'offer'),
      suggest: viewer === 'hiring_manager' && (stage === 'interview' || stage === 'offer'),
      emailOnReject: manages && (await this.mail.ready()),
      // Delete applicant (owner, 25 October 2026: "Vacancy alone - applicant alone - superadmin only"); never a developer
      delete: isSuperAdmin(c.user) && !c.user.developer,
    };
    const [interviews, allFeedback] = await Promise.all([this.interviews.ofApplication(a.id, c), this.interviews.feedbackOf(a.id, c.selfId)]);
    const gaveOwn = allFeedback.some((f) => f.mine);
    const seen = feedbackSeen(viewer, gaveOwn);
    const feedback = seen === 'all' ? allFeedback : allFeedback.filter((f) => f.mine);
    const suggestion =
      a.suggestion && !settled
        ? { kind: a.suggestion as HiringSuggestion, note: a.suggestionNote, by: userRef(a.suggestedBy, await userNames(this.prisma, [a.suggestedBy])), at: (a.suggestedAt ?? a.updatedAt).toISOString() }
        : null;
    const verdict = (await this.comments.applicationVerdicts([a.id])).get(a.id) ?? null;
    // HR's screening call (29 October 2026: "Screening call + result"): its comment is HR's, kept from the hiring manager
    // and the interviewers as HR's notes are
    const screeningCall: ScreeningCallView | null = isScreeningCallResult(a.screeningCall)
      ? {
          result: a.screeningCall,
          note: participant ? null : a.screeningCallNote,
          by: userRef(a.screeningCallBy, await userNames(this.prisma, [a.screeningCallBy])),
          at: (a.screeningCallAt ?? a.updatedAt).toISOString(),
        }
      : null;
    return {
      ...applicationListView(
        { ...a, vacancy: { id: a.vacancy.id, number: a.vacancy.number, title: a.vacancy.title, status: a.vacancy.status, hiringManagerId: a.vacancy.hiringManagerId } },
        await agencyMarksOf(this.prisma),
      ),
      // its latest screening verdict (24 October 2026), from its own comments
      verdict,
      linkedin: a.linkedin,
      // the LinkedIn link in the CV when none was typed (owner, 29 October 2026: "the OCR is not filling the linkedin link like in the candidate profile")
      cvLinkedin: a.linkedin ? null : cvLinkedinOf(a.cvReading),
      portfolio: a.portfolio,
      // every portfolio link, the PDF case study and "Confirmed by LinkedIn" (25 October 2026)
      portfolioLinks: a.portfolioLinks.length ? a.portfolioLinks : a.portfolio ? [a.portfolio] : [],
      portfolioFile: a.portfolioFile ?? null,
      // the section title its form shows them under, as its vacancy's portfolio is set now (26 October 2026)
      portfolioTitle: (await portfolioTitlesOf(this.prisma, { applications: [a] })).get(a.id),
      emailConfirmedBy: a.emailConfirmedBy === 'linkedin' ? 'linkedin' : null,
      noticePeriod: a.noticePeriod,
      // never for a hiring manager or an interviewer (the brief: "They never see the salary range or the candidate's expected salary")
      expectedSalary: participant ? null : money(a.expectedSalary),
      answers: questions.map((q) => {
        const s = scored.get(q.key);
        return { key: q.key, text: q.text, kind: q.kind, answer: answers[q.key] ?? null, points: s?.points ?? 0, maxPoints: s?.maxPoints ?? 0, knockout: q.knockout, passed: s?.passed ?? null };
      }),
      // HR's notes of before, read only: moved into a first screening comment (24 October 2026)
      notes: participant ? null : a.notes,
      rejectReason: a.stage === 'rejected' && !participant ? a.rejectReason : null,
      consentAt: a.consentAt.toISOString(),
      cv: a.cv,
      earlierCvs: a.earlierCvs.map(earlierCvView),
      // the CV fit as kept (25 October 2026: "Full CV fit score")
      cvReading: a.cv ? this.readings.view(a.cvReading, a.vacancy.keySkills, cvFitFrom(a.cvFit), await agencyMarksOf(this.prisma)) : null,
      // Other Open Positions (25 October 2026): HR, the CEO and a Super Admin only
      openPositions: c.reads ? ((await this.fits.shownFor([{ kind: 'application', id: a.id, candidateId: a.candidateId }], c.user)).get(a.id) ?? []) : null,
      history: a.steps.map((s): ApplicationStepView => ({ event: s.event as ApplicationEvent, stage: s.stage, note: s.note, by: userRef(s.by, names), at: s.at.toISOString() })),
      offers: a.offers,
      employeeId: a.employeeId,
      viewer,
      interviews,
      feedback,
      feedbackHidden: allFeedback.length - feedback.length,
      suggestion,
      // HR's screening call of before the tree (29 October 2026), kept to read
      screeningCall,
      hasHiringManager: !!reviewers.hiringManagerId,
      // the recruitment tree (3 November 2026): every decision (its feedback never an interviewer's to read), and who
      // takes their step now
      decisions: a.decisions.map((d) => decisionView(d, names2, viewer === 'interviewer')),
      nextBy: await this.nextBy(stage, a.filteredOut, reviewers),
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

  /**
   * An earlier CV as it was sent (applying again, 25 October 2026: "Update their application"), for the caller who may
   * see the applicant (as the CV); never a developer.
   */
  async earlierCv(id: string, cvId: string, user: SessionUser): Promise<{ data: Buffer; fileName: string; mimeType: string }> {
    const c = await this.caller(user);
    const a = await this.prisma.jobApplication.findFirst({
      where: { AND: [{ id }, visibleApplications(c)] },
      select: { earlierCvs: { where: { id: cvId }, select: { data: true, fileName: true, mimeType: true } } },
    });
    if (!a) throw new NotFoundException(NOT_FOUND);
    const f = a.earlierCvs[0];
    if (!f) throw new NotFoundException('This earlier CV isn’t on record.');
    return { data: Buffer.from(f.data), fileName: f.fileName, mimeType: f.mimeType };
  }

  /** The PDF case study sent as a portfolio (25 October 2026), for the caller who may see the applicant; never a developer. */
  async portfolioFile(id: string, user: SessionUser): Promise<{ data: Buffer; fileName: string; mimeType: string }> {
    const c = await this.caller(user);
    const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id }, visibleApplications(c)] }, select: { portfolioFile: { select: { data: true, fileName: true, mimeType: true } } } });
    if (!a) throw new NotFoundException(NOT_FOUND);
    if (!a.portfolioFile) throw new NotFoundException('This applicant sent no portfolio file.');
    return { data: Buffer.from(a.portfolioFile.data), fileName: a.portfolioFile.fileName, mimeType: a.portfolioFile.mimeType };
  }

  /**
   * The CV as the CV window shows it (24 October 2026: "when opening a CV, open it in a popup window"): a PDF as sent, a
   * Word file converted and kept (cv-previews.service.ts). For the caller who may see the applicant; never a developer.
   */
  async cvPreview(id: string, user: SessionUser): Promise<{ data: Buffer; fileName: string }> {
    const file = await this.cv(id, user);
    return this.previews.pdfOf({ applicationId: id }, file);
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
   * Rejects an applicant by hand (shared stageMoveProblem; the recruitment tree, 3 November 2026; 5 November 2026: no
   * hand move to a review any more): from any step, with the reasons of HR Screening and the interview (the Offer takes
   * HR Screening's), none at a review, and the written feedback (kept as a decision at a step that takes them); refused
   * in words when it doesn't fit their stage (409).
   */
  async move(
    id: string,
    to: HandStage,
    rejection: { reasons?: string[]; feedback?: string | null } | null,
    user: SessionUser,
    email = false,
  ): Promise<ApplicationView & { emailed: RejectionEmail }> {
    const { a } = await this.managedRow(id, user);
    const stage = a.stage as ApplicationStage;
    const openOffer = a.offers.some((o) => o.status === 'draft' || o.status === 'sent');
    const problem = stageMoveProblem(stage, to, { filteredOut: a.filteredOut, openOffer });
    if (problem) throw new ConflictException(problem);
    // rejected (3 November 2026: "Reason list + feedback"; 5 November 2026: none at a review): the reasons of their step, its feedback
    const at: DecisionStep | 'offer' = isDecisionStep(stage) ? stage : 'offer';
    const problems = decisionProblems(at, { outcome: 'rejected', reasons: rejection?.reasons ?? [], feedback: rejection?.feedback ?? null });
    if (problems.length) throw new BadRequestException(problems);
    await this.decided(a, stage, at, { outcome: 'rejected', reasons: rejection?.reasons ?? [], feedback: rejection?.feedback ?? null }, 'rejected', user, stage !== 'offer');
    const emailed = email ? await this.emailRejection(a, user) : 'not_sent';
    return { ...(await this.get(id, user)), emailed };
  }

  /**
   * A step decided (the recruitment tree, 3 November 2026: "Recrutment tree"): by whoever takes it (takesStepProblem:
   * 403 for anyone else), its outcome checked with its reasons and feedback (400), the applicant still at it (409). A pass
   * moves them on (the Final Review skipped without the recruiter's manager), a rejection or a decline closes them,
   * Unreachable and Pending keep them at it. The next reviewer told. A rejection may email the candidate (HR only).
   */
  async decide(id: string, dto: StepDecisionInput & { email?: boolean }, user: SessionUser): Promise<ApplicationView & { emailed: RejectionEmail }> {
    const c = await this.caller(user);
    const a = await this.row(id, c);
    const stage = a.stage as ApplicationStage;
    if (a.filteredOut) throw new ConflictException('They failed a must-have question and were filtered out: restore them first.');
    if (!isDecisionStep(stage)) throw new ConflictException(`They are at ${APPLICATION_STAGE_LABELS[stage]}: there is no step to decide.`);
    const reviewers = await reviewersOf(this.prisma, a.vacancy);
    const refusal = takesStepProblem(stage, treeCaller(c, reviewers));
    if (refusal) throw new ForbiddenException(refusal);
    const problems = decisionProblems(stage, dto);
    if (problems.length) throw new BadRequestException(problems);
    const to = this.stageOf(stage, dto.outcome, reviewers);
    await this.decided(a, stage, stage, dto, to, user);
    await this.afterDecisions(a.vacancy, to, [a.fullName], reviewers, user);
    const emailed = dto.outcome === 'rejected' && dto.email && c.manages ? await this.emailRejection(a, user) : 'not_sent';
    return { ...(await this.view(await this.row(id, c), c)), emailed };
  }

  /** Where an outcome at a step takes the applicant: on, closed (rejected or declined), or kept there. */
  private stageOf(step: DecisionStep, outcome: StepOutcome, reviewers: VacancyReviewers): ApplicationStage {
    const effect = OUTCOME_EFFECT[outcome];
    if (effect === 'next') return stageAfter(step, treeReviewers(reviewers));
    return effect === 'hold' ? step : 'rejected';
  }

  /**
   * A decision kept: the application moved (or held) if still at `stage`, the decision (at a decision step), a step of its
   * history, the audit log. The hiring manager's suggestion is done with.
   */
  private async decided(
    a: StepRow,
    stage: ApplicationStage,
    at: DecisionStep | 'offer',
    d: StepDecisionInput,
    to: ApplicationStage,
    user: SessionUser,
    keep = true,
  ): Promise<void> {
    const effect = OUTCOME_EFFECT[d.outcome];
    const reasons = d.reasons ?? [];
    const feedback = d.feedback?.trim() || null;
    const data: Prisma.JobApplicationUpdateManyMutationInput =
      effect === 'hold'
        ? { hold: d.outcome }
        : to === 'rejected'
          ? { stage: 'rejected', rejectedFrom: stage, hold: null, rejectReason: effect === 'decline' ? 'Declined by the candidate' : rejectReasonsText(reasons) || null }
          : { stage: to, hold: null, rejectedFrom: null, rejectReason: null };
    const label = (x: string) => applicationStageLabel(x);
    const note = decisionText({ stage: at, outcome: d.outcome, reasons: reasons as RejectReason[] }, label);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.jobApplication.updateMany({
        where: { id: a.id, stage, filteredOut: a.filteredOut },
        data: { ...data, suggestion: null, suggestionNote: null, suggestedById: null, suggestedAt: null },
      });
      if (!count) throw new ConflictException(CHANGED_MEANWHILE);
      if (keep) await tx.jobApplicationDecision.create({ data: { applicationId: a.id, stage: at, outcome: d.outcome, reasons, feedback, byId: user.id } });
      await tx.jobApplicationStep.create({ data: { applicationId: a.id, event: 'decided', stage: effect === 'hold' ? stage : to, note, byId: user.id } });
    });
    await this.audit.record({
      userId: user.id,
      action: 'decide',
      entityType: APPLICATION_ENTITY,
      entityId: a.id,
      diff: {
        number: a.number,
        vacancy: a.vacancy.number,
        step: at,
        outcome: d.outcome,
        ...(reasons.length && { reasons: rejectReasonsText(reasons) }),
        ...(feedback && { feedback: '(written)' }),
        ...(effect !== 'hold' && { stage: { from: stage, to } }),
      },
    });
  }

  /** Who is told after decisions at a step (once a batch): the recruiter's manager when they moved on to the Final Review. */
  private async afterDecisions(
    v: { number: string; title: string },
    to: ApplicationStage,
    names: readonly string[],
    reviewers: VacancyReviewers,
    user: SessionUser,
  ): Promise<void> {
    if (!names.length) return;
    if (to === 'review_2') await this.tellReviewer(v, reviewers, names, user);
  }

  /** Who takes the step an applicant is at now, in words ("The recruiter’s manager: Sara Ali"); null when nobody does. */
  private async nextBy(stage: ApplicationStage, filteredOut: boolean, r: VacancyReviewers): Promise<string | null> {
    if (filteredOut || !isDecisionStep(stage)) return null;
    const actor = STEP_ACTOR[stage];
    const id = actor === 'recruiter' ? r.recruiterId : actor === 'recruiter_manager' ? r.recruiterManagerId : null;
    if (!id) return actor === 'hr' ? STEP_ACTOR_LABELS.hr : `HR (no ${STEP_ACTOR_LABELS[actor].replace(/^The /, '').toLowerCase()} named)`;
    const e = await this.prisma.employee.findUnique({ where: { id }, select: { fullNameEn: true } });
    return e ? `${STEP_ACTOR_LABELS[actor]}: ${e.fullNameEn}` : STEP_ACTOR_LABELS[actor];
  }

  /**
   * The rejection email to the candidate (the brief: "an 'Email the candidate' tick, off by default … a polite standard
   * text that an HR-editable Recruitment Settings section can change"), English then Arabic. Never fails the rejection.
   */
  private async emailRejection(a: DetailRow, user: SessionUser): Promise<RejectionEmail> {
    if (!(await this.mail.ready())) return 'not_set_up';
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
    // the Final Review is theirs to decide (the recruitment tree, 3 November 2026): a suggestion at the interview or the offer
    if (stage !== 'interview' && stage !== 'offer') throw new ConflictException(`They are at ${APPLICATION_STAGE_LABELS[stage]}: the hiring manager suggests at the Technical Interview or the Offer.`);
    await this.recordSuggestion(a, suggestion, note, user);
    // at Shortlisted, their review (29 October 2026: "Accepted by the hiring manager"); else "Hiring manager suggests: Reject"
    await this.tellHr(a.vacancy, { title: suggestionShown(suggestion, stage), body: `${a.fullName} · ${a.vacancy.title}` }, `/recruitment/applicants/${id}`);
    return this.view(await this.row(id, c), c);
  }

  /** The hiring manager's suggestion kept on an applicant still at their stage (at Shortlisted, their review), audited; 409 if they moved meanwhile. */
  private async recordSuggestion(a: { id: string; number: string; stage: string }, suggestion: HiringSuggestion, note: string | null | undefined, user: SessionUser): Promise<void> {
    const { count } = await this.prisma.jobApplication.updateMany({
      where: { id: a.id, stage: a.stage },
      data: { suggestion, suggestionNote: note ?? null, suggestedById: user.id, suggestedAt: new Date() },
    });
    if (!count) throw new ConflictException(CHANGED_MEANWHILE);
    await this.audit.record({ userId: user.id, action: 'suggest', entityType: APPLICATION_ENTITY, entityId: a.id, diff: { number: a.number, suggestion, ...(note && { note }) } });
  }

  /** HR told of the hiring manager's word: the CEO and the Super Admins for a C-level vacancy (only they see it). */
  private async tellHr(v: Parameters<typeof isConfidentialVacancy>[0], notice: { title: string; body: string }, link: string): Promise<void> {
    const roles = isConfidentialVacancy(v) ? ['ceo', 'super_admin'] : ['hr'];
    const hr = await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: roles } } } } }, select: { id: true } });
    await this.notifications.notify(
      hr.map((u) => u.id),
      { kind: 'hiring_suggestion', ...notice, link },
    );
  }

  // ---------- the batches: HR's Send to Review 1, a review's decisions (the recruitment tree, 3 November 2026) ----------
  // A batch does each applicant as their page would, skips the others with why, and tells the other side once ("Tick
  // several at once", "One message per batch").

  /**
   * Several of a vacancy's applicants at one step decided at once (a review's Pass or Reject; HR Screening's and the
   * interview's outcomes too), the same outcome, reasons and feedback for each, by whoever takes the step (403 for
   * anyone else); each as Decide on their page; the others (another step, moved meanwhile) skipped with why. The
   * recruiter's manager told once of those reaching their Final Review.
   */
  async decideMany(vacancyId: string, step: DecisionStep, ids: readonly string[], dto: StepDecisionInput, user: SessionUser): Promise<HiringBatchResult> {
    const c = await this.caller(user);
    const v = await this.prisma.vacancy.findFirst({ where: { AND: [{ id: vacancyId }, c.reads ? vacancyWhere(user) : {}] }, select: BATCH_VACANCY });
    if (!v) throw new NotFoundException('Vacancy not found.');
    const reviewers = await reviewersOf(this.prisma, v);
    const refusal = takesStepProblem(step, treeCaller(c, reviewers));
    if (refusal) throw new ForbiddenException(refusal);
    const problems = decisionProblems(step, dto);
    if (problems.length) throw new BadRequestException(problems);
    const wanted = batchIds(ids);
    const rows = await this.prisma.jobApplication.findMany({
      where: { AND: [{ id: { in: wanted } }, visibleApplications(c)] },
      select: { id: true, number: true, fullName: true, vacancyId: true, stage: true, filteredOut: true, vacancy: { select: { number: true } } },
    });
    const found = new Map(rows.map((r) => [r.id, r]));
    const result: HiringBatchResult = { done: [], skipped: [] };
    const to = this.stageOf(step, dto.outcome, reviewers);
    for (const id of wanted) {
      const a = found.get(id);
      const reason = a ? decideSkip(a, v.id, step) : BATCH_NOT_FOUND;
      if (!a || reason) {
        result.skipped.push(skippedOf(id, a, reason ?? BATCH_NOT_FOUND));
        continue;
      }
      try {
        await this.decided(a, step, step, dto, to, user);
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        result.skipped.push(skippedOf(id, a, err.message));
        continue;
      }
      result.done.push({ id, number: a.number, fullName: a.fullName });
    }
    await this.afterDecisions(
      v,
      to,
      result.done.map((d) => d.fullName),
      reviewers,
      user,
    );
    return result;
  }

  /**
   * The recruiter's manager told once a batch reaches their Final Review (owner, 29 October 2026: "One message per
   * batch"), in the app and by email when it is set up, to pass or reject them on My Hiring. Nobody when none is named for
   * it (or they have no active account), when they passed them themselves, or when nobody reached it. An email refused
   * never fails the step: it is logged. The recruiter reviews Applicants on the HR pages, where every CV lands.
   */
  private async tellReviewer(v: { number: string; title: string }, r: VacancyReviewers, names: readonly string[], user: SessionUser): Promise<void> {
    const stage = 'review_2' as const;
    const who = r.recruiterManagerId;
    if (!who || !names.length || user.employeeId === who) return;
    const account = r.accounts.get(who);
    if (!account) return;
    const path = MY_HIRING_LINK;
    await this.notifications.notify([account.id], { kind: 'shortlist_review', ...reviewWaitingNotice(v.title, names, stage), link: path });
    try {
      if (!(await this.mail.ready())) return;
      const link = `${webOriginOf(this.config)}${path}`;
      const mail = reviewWaitingEmail(v.title, names, link, stage);
      // their work email, else the one they sign in with; HR's words when they wrote them (1 November 2026)
      await this.mail.send({
        to: account.workEmail || account.email,
        replyTo: user.email,
        subject: mail.subject,
        text: mail.text,
        template: { key: 'shortlist_review', values: reviewTemplateValues(v.title, names, link) },
      });
    } catch (err) {
      this.logger.warn(`The review email of ${v.number} could not be sent: ${(err as Error).message}`);
    }
  }

  // ---------- the pipeline board ----------

  /**
   * A vacancy's pipeline board (the brief: "a board with a column per stage, and cards with name, match %, source and
   * days in stage"): HR, the CEO and a Super Admin see every applicant but those filtered out (counted apart); the
   * vacancy's hiring manager from their Final Review on, read only; 404 for anyone else.
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
      // those rejected at a review left off the board: under Applicants' "Rejected at review" (5 November 2026)
      where: { AND: [{ vacancyId }, visibleApplications(c), { filteredOut: false }, { NOT: { stage: 'rejected', rejectedFrom: { in: [...REVIEW_REJECTION_STEPS] } } }] },
      select: {
        id: true,
        number: true,
        fullName: true,
        matchPercent: true,
        cvMatchPercent: true,
        cvFit: true,
        source: true,
        stage: true,
        filteredOut: true,
        suggestion: true,
        // kept at their step: Unreachable or Pending (the recruitment tree, 3 November 2026)
        hold: true,
        createdAt: true,
        steps: { select: { stage: true, at: true }, orderBy: { at: 'asc' } },
        offers: { where: OPEN_OFFER, select: { id: true } },
        interviews: { where: { status: 'scheduled', startsAt: { gte: now } }, select: { id: true } },
        // those marked done: a job offer only after one (1 November 2026)
        _count: { select: { interviews: { where: { status: 'done' } } } },
        candidateId: true,
        cvUpdatedAt: true,
      },
      orderBy: [{ matchPercent: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    // each card's latest screening verdict (24 October 2026): its own comments, which whoever sees the card may read
    const verdicts = await this.comments.applicationVerdicts(rows.map((r) => r.id));
    const filteredOut = c.reads ? await this.prisma.jobApplication.count({ where: { vacancyId, filteredOut: true } }) : 0;
    // those rejected at a review, under Applicants' "Rejected at review" rather than on the board (5 November 2026)
    const rejectedAtReviewCount = c.reads ? await this.prisma.jobApplication.count({ where: { vacancyId, stage: 'rejected', rejectedFrom: { in: [...REVIEW_REJECTION_STEPS] } } }) : 0;
    // the candidates' badges (22 October 2026), for HR, the CEO and a Super Admin: a hiring manager keeps what they saw
    const badges = c.reads
      ? await this.candidates.badges(
          rows.map((r) => r.candidateId),
          user,
        )
      : new Map<string, CandidateBadge>();
    // another open vacancy the CV fits better (25 October 2026), as the list's badge
    const better = c.reads ? await this.fits.badges(rows, user) : new Map<string, BetterFitBadge>();
    // a hiring manager's board from HR Screening on (5 November 2026: their CV review is gone)
    const stages = viewer === 'hiring_manager' ? BOARD_STAGES.filter((s) => (HIRING_MANAGER_STAGES as readonly string[]).includes(s) || s === 'rejected') : [...BOARD_STAGES];
    const cards = rows.map(
      (r): BoardCard => ({
        id: r.id,
        number: r.number,
        fullName: r.fullName,
        matchPercent: r.matchPercent,
        cvMatchPercent: r.cvMatchPercent,
        cvFit: cvFitFrom(r.cvFit),
        betterFit: c.reads ? (better.get(r.id) ?? null) : undefined,
        // as kept: a general CV's, the suggested ones' and an invitation's too (24 October 2026)
        source: applicationSourceOf(r.source),
        stage: r.stage as ApplicationStage,
        filteredOut: r.filteredOut,
        daysInStage: daysSince(stageSince(r.steps, r.createdAt), now),
        openOffer: r.offers.length > 0,
        upcomingInterviews: r.interviews.length,
        interviewsDone: r._count.interviews,
        suggestion: (r.suggestion as HiringSuggestion | null) ?? null,
        hold: isHoldOutcome(r.hold) ? r.hold : null,
        candidate: r.candidateId ? (badges.get(r.candidateId) ?? null) : null,
        verdict: verdicts.get(r.id) ?? null,
        // a new CV sent by applying again in the last 7 days (25 October 2026)
        cvUpdated: cvUpdatedMark(r.cvUpdatedAt, now),
      }),
    );
    return {
      vacancy: { id: v.id, number: v.number, title: v.title, status: v.status },
      viewer,
      canMove: c.manages,
      // the screening match first, else the CV fit's (25 October 2026)
      columns: stages.map((stage) => ({ stage, cards: byMatch(cards.filter((x) => x.stage === stage)) })),
      filteredOut,
      rejectedAtReview: rejectedAtReviewCount,
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

  /**
   * HR's notes on an applicant: gone (410) since they became screening comments (24 October 2026: the notes "moved into
   * comments"); nothing else called it but the applicant page's notes box, retired with it. The notes kept stay read only.
   */
  /**
   * Its CV read again (owner, 29 October 2026: "what can we do if the OCR missed pulling data? can i perform a rerun for
   * example?"): as before, or as a scan (`asScan`); HR (or a Super Admin) only. Shown as being read until done.
   */
  async readAgain(id: string, asScan: boolean, user: SessionUser): Promise<ApplicationView> {
    const { a } = await this.managedRow(id, user);
    await this.readings.readAgain({ applicationId: id }, asScan);
    await this.audit.record({ userId: user.id, action: 'read_again', entityType: APPLICATION_ENTITY, entityId: id, diff: { number: a.number, ...(asScan && { asScan: true }) } });
    return this.get(id, user);
  }

  async notes(id: string, user: SessionUser): Promise<never> {
    await this.managedRow(id, user);
    throw new GoneException(NOTES_GONE);
  }

  /** One step: the application changed if it is still at `stage`, its history and the audit log. */
  private async step(
    a: StepRow,
    stage: ApplicationStage,
    data: Prisma.JobApplicationUpdateManyMutationInput,
    step: { event: ApplicationEvent; stage: ApplicationStage; note: string | null },
    user: SessionUser,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // HR acted: the hiring manager's suggestion is done with; a new stage, its hold too (3 November 2026)
      const { count } = await tx.jobApplication.updateMany({
        where: { id: a.id, stage, filteredOut: a.filteredOut },
        data: { ...data, ...(data.stage !== undefined && { hold: null }), suggestion: null, suggestionNote: null, suggestedById: null, suggestedAt: null },
      });
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
