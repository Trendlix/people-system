import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STAGE_LABELS,
  buildIcs,
  cairoClock,
  cairoDay,
  feedbackOpen,
  feedbackProblems,
  interviewChangeable,
  interviewMail,
  interviewProblems,
  INTERVIEW_KIND_LABELS,
  zonedMoment,
  type ApplicationStage,
  type FeedbackCriterion,
  type FeedbackInput,
  type FeedbackView,
  type InterviewKind,
  type InterviewMailKind,
  type InterviewSaved,
  type InterviewStatus,
  type InterviewView,
  type MyHiring,
  type Recommendation,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { accountOfEmployee } from '../users/employee-accounts.js';
import { vacancyWhere } from './recruitment-access.js';
import { hiringManagerApplications, recruitmentCaller, visibleApplications, type RecruitmentCaller } from './recruitment-scope.js';
import { APPLICATION_ENTITY } from './recruitment-views.js';
import type { FeedbackDto, InterviewDto } from './recruitment.dto.js';

// Interviews (Phase 2, owner, 22 October 2026: "where will we include the ATS?"; accepted: "interview invites go by email
// through the owner's SMTP settings"; packages/shared recruitment-hiring.ts):
// - HR (or a Super Admin) schedules one from an applicant: when (in Cairo), how long, in person (the office's address
//   unless another is given), online (its link) or by phone, the interviewers (current employees) and a note. Scheduling
//   moves the applicant to Interview if they were before it.
// - The candidate gets an invitation by email with a calendar invitation (.ics, METHOD:REQUEST, a UID kept for the
//   interview, its SEQUENCE raised on each change); the interviewers a notification and the same invitation by email
//   when they have a work email. Without email set up on the server it is saved all the same, and said. Rescheduling
//   sends the new time, cancelling a cancellation (METHOD:CANCEL).
// - Done or a no-show, once it has started. Each interviewer gives a scorecard after it; reminded the day after when
//   they haven't (remindFeedback, the round).
// Every change is audited; the emails and notifications go after it is saved, never failing it.

export const INTERVIEW_ENTITY = 'interview';

const NOT_FOUND = 'Interview not found.';
const USER = { select: { id: true, email: true } } as const;

const INCLUDE = {
  interviewers: { include: { employee: { select: { id: true, fullNameEn: true, workEmail: true } } }, orderBy: { employee: { fullNameEn: 'asc' } } },
  feedback: { select: { employeeId: true } },
  createdBy: USER,
  application: {
    select: {
      id: true,
      number: true,
      fullName: true,
      email: true,
      mobile: true,
      stage: true,
      filteredOut: true,
      vacancy: {
        select: { id: true, number: true, title: true, hiringManagerId: true, grade: { select: { confidential: true } }, jobTitle: { select: { minGrade: { select: { confidential: true } } } } },
      },
    },
  },
} satisfies Prisma.InterviewInclude;

type Row = Prisma.InterviewGetPayload<{ include: typeof INCLUDE }>;

const DAY_EN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DAY_AR = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** The interview's calendar UID: the same for its whole life, so calendars update or remove one event. */
export const interviewUid = (id: string): string => `interview-${id}@people.trendlix.com`;

/** The stages an interview may be scheduled at: before the applicant is hired or rejected. */
const SCHEDULABLE: readonly ApplicationStage[] = ['applied', 'shortlisted', 'interview', 'offer'];

@Injectable()
export class InterviewsService {
  private readonly logger = new Logger('Interviews');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly confidential: ConfidentialService,
  ) {}

  async caller(user: SessionUser): Promise<RecruitmentCaller> {
    return recruitmentCaller(user, await this.confidential.selfId(user));
  }

  // ---------- reading ----------

  /** The interviews of an application the caller may see, newest first. */
  async ofApplication(applicationId: string, c: RecruitmentCaller, now = Date.now()): Promise<InterviewView[]> {
    const rows = await this.prisma.interview.findMany({ where: { applicationId }, include: INCLUDE, orderBy: { startsAt: 'desc' } });
    return this.views(rows, c, now);
  }

  /** HR's and the CEO's: the interviews still to come (from today on), on the vacancies they see, soonest first. */
  async upcoming(user: SessionUser, now = new Date()): Promise<InterviewView[]> {
    const c = await this.caller(user);
    if (!c.reads) throw new ForbiddenException('Only HR, the CEO and a Super Admin see every interview.');
    const rows = await this.prisma.interview.findMany({
      where: { status: 'scheduled', startsAt: { gte: toDateOnly(todayInCairo()) }, application: { vacancy: vacancyWhere(user) } },
      include: INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
    return this.views(rows, c, now.getTime());
  }

  /**
   * What the caller hires for or interviews (My Hiring): the open vacancies they are the hiring manager of, with their
   * applicants by stage from Shortlisted on, and the interviews they sit on (to come, and those past in the last 60 days).
   */
  async myHiring(user: SessionUser, now = new Date()): Promise<MyHiring> {
    const c = await this.caller(user);
    if (!c.selfId) return { vacancies: [], interviews: [], feedbackDue: 0 };
    const since = new Date(now.getTime() - 60 * 86_400_000);
    const [vacancies, rows] = await Promise.all([
      this.prisma.vacancy.findMany({ where: { hiringManagerId: c.selfId, status: { in: ['open', 'on_hold'] } }, select: { id: true, number: true, title: true, status: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.interview.findMany({
        where: { interviewers: { some: { employeeId: c.selfId } }, startsAt: { gte: since } },
        include: INCLUDE,
        orderBy: { startsAt: 'asc' },
        take: 200,
      }),
    ]);
    const groups = vacancies.length
      ? await this.prisma.jobApplication.groupBy({
          by: ['vacancyId', 'stage'],
          where: { AND: [{ vacancyId: { in: vacancies.map((v) => v.id) } }, hiringManagerApplications(c.selfId)] },
          _count: { _all: true },
        })
      : [];
    const counts = (id: string) => {
      const out = { applied: 0, shortlisted: 0, interview: 0, offer: 0, hired: 0, rejected: 0 } as Record<ApplicationStage, number>;
      for (const g of groups) if (g.vacancyId === id && g.stage in out) out[g.stage as ApplicationStage] += g._count._all;
      return out;
    };
    const interviews = this.views(rows, c, now.getTime());
    const feedbackDue = interviews.filter((i) => i.can.feedback && !i.interviewers.find((x) => x.employeeId === c.selfId)?.feedbackGiven).length;
    return { vacancies: vacancies.map((v) => ({ ...v, counts: counts(v.id) })), interviews, feedbackDue };
  }

  /** The scorecards on an application, all of them (the caller's visibility is the applicants' service's). */
  async feedbackOf(applicationId: string, selfId: string | null): Promise<FeedbackView[]> {
    const rows = await this.prisma.interviewFeedback.findMany({
      where: { interview: { applicationId } },
      include: { employee: { select: { id: true, fullNameEn: true } } },
      orderBy: { submittedAt: 'asc' },
    });
    return rows.map(
      (f): FeedbackView => ({
        id: f.id,
        interviewId: f.interviewId,
        interviewer: { employeeId: f.employee.id, name: f.employee.fullNameEn },
        ratings: { skills: f.ratingSkills, experience: f.ratingExperience, communication: f.ratingCommunication, culture: f.ratingCulture },
        recommendation: f.recommendation as Recommendation,
        notes: f.notes,
        submittedAt: f.submittedAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
        mine: !!selfId && f.employeeId === selfId,
      }),
    );
  }

  private views(rows: Row[], c: RecruitmentCaller, now: number): InterviewView[] {
    return rows.map((r) => this.view(r, c, now));
  }

  private view(r: Row, c: RecruitmentCaller, now: number): InterviewView {
    const status = r.status as InterviewStatus;
    const given = new Set(r.feedback.map((f) => f.employeeId));
    const sits = !!c.selfId && r.interviewers.some((i) => i.employeeId === c.selfId);
    return {
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      minutes: r.minutes,
      kind: r.kind as InterviewKind,
      location: r.location,
      note: r.note,
      status,
      interviewers: r.interviewers.map((i) => ({ employeeId: i.employeeId, name: i.employee.fullNameEn, feedbackGiven: given.has(i.employeeId) })),
      emailedAt: r.emailedAt?.toISOString() ?? null,
      emailProblem: r.emailProblem,
      cancelReason: r.cancelReason,
      createdBy: r.createdBy ? { email: r.createdBy.email, name: null } : null,
      application: { id: r.application.id, number: r.application.number, fullName: r.application.fullName, vacancy: { id: r.application.vacancy.id, number: r.application.vacancy.number, title: r.application.vacancy.title } },
      can: {
        reschedule: c.manages && interviewChangeable(status),
        cancel: c.manages && interviewChangeable(status),
        mark: c.manages && status === 'scheduled' && r.startsAt.getTime() <= now,
        feedback: sits && feedbackOpen({ status, startsAt: r.startsAt }, now),
      },
    };
  }

  /** The interview, if the caller may see its applicant: 404 otherwise. */
  private async row(id: string, c: RecruitmentCaller): Promise<Row> {
    const r = await this.prisma.interview.findFirst({ where: { id, application: visibleApplications(c) }, include: INCLUDE });
    if (!r) throw new NotFoundException(NOT_FOUND);
    return r;
  }

  private assertManages(c: RecruitmentCaller): void {
    if (!c.manages) throw new ForbiddenException('Only HR (or a Super Admin) schedules and changes interviews.');
  }

  // ---------- scheduling ----------

  /** The interview's details checked: the moment, the place (the office's address for one in person unless given), the interviewers (current employees). */
  private async checked(dto: InterviewDto, now: number): Promise<{ startsAt: Date; location: string | null; note: string | null; interviewers: { id: string; fullNameEn: string }[] }> {
    const startsAt = zonedMoment(dto.date, dto.time);
    const problems = interviewProblems(dto, startsAt, now);
    if (problems.length) throw new BadRequestException(problems);
    const today = toDateOnly(todayInCairo());
    const interviewers = await this.prisma.employee.findMany({
      where: { id: { in: dto.interviewerIds }, employments: { some: { OR: [{ endDate: null }, { endDate: { gte: today } }] } } },
      select: { id: true, fullNameEn: true },
    });
    if (interviewers.length !== new Set(dto.interviewerIds).size) throw new BadRequestException(['Each interviewer must be a current employee: choose them from the list.']);
    let location = dto.location?.trim() || null;
    if (!location && dto.kind === 'in_person') {
      const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { addressEn: true, addressAr: true } });
      location = company?.addressEn || company?.addressAr || null;
    }
    return { startsAt: new Date(startsAt), location, note: dto.note?.trim() || null, interviewers };
  }

  /**
   * Schedules an interview with an applicant HR may see, not hired, rejected or filtered out. The applicant moves to
   * Interview if they were before it; the candidate is invited by email (with the calendar invitation) and the
   * interviewers told.
   */
  async schedule(applicationId: string, dto: InterviewDto, user: SessionUser, now = new Date()): Promise<InterviewSaved> {
    const c = await this.caller(user);
    this.assertManages(c);
    const a = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, vacancy: vacancyWhere(user) },
      select: { id: true, number: true, stage: true, filteredOut: true, vacancy: { select: { number: true } } },
    });
    if (!a) throw new NotFoundException('Applicant not found.');
    const stage = a.stage as ApplicationStage;
    if (a.filteredOut) throw new ConflictException('They failed a must-have question and were filtered out: restore them first.');
    if (!SCHEDULABLE.includes(stage)) throw new ConflictException(`They are ${APPLICATION_STAGE_LABELS[stage].toLowerCase()}: no interview can be scheduled.`);
    const d = await this.checked(dto, now.getTime());
    const id = await this.prisma.$transaction(async (tx) => {
      const made = await tx.interview.create({
        data: {
          applicationId,
          startsAt: d.startsAt,
          minutes: dto.minutes,
          kind: dto.kind,
          location: d.location,
          note: d.note,
          createdById: user.id,
          updatedById: user.id,
          interviewers: { create: d.interviewers.map((i) => ({ employeeId: i.id })) },
        },
        select: { id: true },
      });
      if (stage === 'applied' || stage === 'shortlisted') {
        const { count } = await tx.jobApplication.updateMany({ where: { id: applicationId, stage }, data: { stage: 'interview', rejectedFrom: null, rejectReason: null } });
        if (count) await tx.jobApplicationStep.create({ data: { applicationId, event: 'interview', stage: 'interview', note: `Interview on ${cairoDay(d.startsAt)}`, byId: user.id } });
      }
      return made.id;
    });
    await this.audit.record({
      userId: user.id,
      action: 'schedule',
      entityType: INTERVIEW_ENTITY,
      entityId: id,
      diff: { application: a.number, vacancy: a.vacancy.number, startsAt: d.startsAt.toISOString(), minutes: dto.minutes, kind: dto.kind, interviewers: d.interviewers.map((i) => i.fullNameEn) },
    });
    if (stage === 'applied' || stage === 'shortlisted') {
      await this.audit.record({ userId: user.id, action: 'stage', entityType: APPLICATION_ENTITY, entityId: applicationId, diff: { number: a.number, vacancy: a.vacancy.number, stage: { from: stage, to: 'interview' } } });
    }
    const row = await this.row(id, c);
    const email = await this.tell(row, 'invite', user, d.interviewers.map((i) => i.id), []);
    return { interview: this.view(await this.row(id, c), c, now.getTime()), email };
  }

  /** Moves an interview (still scheduled) to another time, place or panel: the candidate and the interviewers get the new time. */
  async reschedule(id: string, dto: InterviewDto, user: SessionUser, now = new Date()): Promise<InterviewSaved> {
    const c = await this.caller(user);
    this.assertManages(c);
    const before = await this.row(id, c);
    if (!interviewChangeable(before.status as InterviewStatus)) throw new ConflictException('Only a scheduled interview can be moved.');
    const d = await this.checked(dto, now.getTime());
    const old = new Set(before.interviewers.map((i) => i.employeeId));
    const next = new Set(d.interviewers.map((i) => i.id));
    const removed = [...old].filter((x) => !next.has(x));
    const added = [...next].filter((x) => !old.has(x));
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.interview.updateMany({
        where: { id, status: 'scheduled', sequence: before.sequence },
        data: { startsAt: d.startsAt, minutes: dto.minutes, kind: dto.kind, location: d.location, note: d.note, sequence: { increment: 1 }, updatedById: user.id },
      });
      if (!count) throw new ConflictException('The interview changed meanwhile. Reload the page to see it.');
      if (removed.length) await tx.interviewInterviewer.deleteMany({ where: { interviewId: id, employeeId: { in: removed } } });
      if (added.length) await tx.interviewInterviewer.createMany({ data: added.map((employeeId) => ({ interviewId: id, employeeId })) });
    });
    await this.audit.record({
      userId: user.id,
      action: 'reschedule',
      entityType: INTERVIEW_ENTITY,
      entityId: id,
      diff: {
        application: before.application.number,
        startsAt: { from: before.startsAt.toISOString(), to: d.startsAt.toISOString() },
        ...(before.minutes !== dto.minutes && { minutes: { from: before.minutes, to: dto.minutes } }),
        ...(before.kind !== dto.kind && { kind: { from: before.kind, to: dto.kind } }),
        ...(added.length || removed.length ? { interviewers: d.interviewers.map((i) => i.fullNameEn) } : {}),
      },
    });
    const row = await this.row(id, c);
    const email = await this.tell(row, 'moved', user, [...next], removed);
    return { interview: this.view(await this.row(id, c), c, now.getTime()), email };
  }

  /** Cancels a scheduled interview: the candidate and the interviewers get the cancellation. */
  async cancel(id: string, reason: string | null | undefined, user: SessionUser, now = new Date()): Promise<InterviewSaved> {
    const c = await this.caller(user);
    this.assertManages(c);
    const before = await this.row(id, c);
    if (!interviewChangeable(before.status as InterviewStatus)) throw new ConflictException('Only a scheduled interview can be cancelled.');
    const { count } = await this.prisma.interview.updateMany({
      where: { id, status: 'scheduled' },
      data: { status: 'cancelled', cancelledAt: now, cancelReason: reason ?? null, sequence: { increment: 1 }, updatedById: user.id },
    });
    if (!count) throw new ConflictException('The interview changed meanwhile. Reload the page to see it.');
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: INTERVIEW_ENTITY,
      entityId: id,
      diff: { application: before.application.number, status: { from: 'scheduled', to: 'cancelled' }, ...(reason && { reason }) },
    });
    const row = await this.row(id, c);
    const email = await this.tell(row, 'cancelled', user, [], row.interviewers.map((i) => i.employeeId));
    return { interview: this.view(row, c, now.getTime()), email };
  }

  /** Marks a scheduled interview done or a no-show, once it has started. */
  async mark(id: string, outcome: 'done' | 'no_show', user: SessionUser, now = new Date()): Promise<InterviewView> {
    const c = await this.caller(user);
    this.assertManages(c);
    const before = await this.row(id, c);
    if (before.status !== 'scheduled') throw new ConflictException('Only a scheduled interview can be marked.');
    if (before.startsAt.getTime() > now.getTime()) throw new ConflictException('The interview hasn’t started yet.');
    await this.prisma.interview.update({ where: { id }, data: { status: outcome, outcomeAt: now, outcomeById: user.id, updatedById: user.id } });
    await this.audit.record({
      userId: user.id,
      action: outcome === 'done' ? 'interview_done' : 'no_show',
      entityType: INTERVIEW_ENTITY,
      entityId: id,
      diff: { application: before.application.number, status: { from: 'scheduled', to: outcome } },
    });
    return this.view(await this.row(id, c), c, now.getTime());
  }

  // ---------- feedback ----------

  /**
   * An interviewer's scorecard, saved (or changed) once the interview has started, while it isn't cancelled nor a
   * no-show; only by an interviewer on it.
   */
  async feedback(id: string, dto: FeedbackDto, user: SessionUser, now = new Date()): Promise<InterviewView> {
    const c = await this.caller(user);
    const r = await this.row(id, c);
    if (!c.selfId || !r.interviewers.some((i) => i.employeeId === c.selfId)) throw new ForbiddenException('Only the interviewers give a scorecard on an interview.');
    if (!feedbackOpen({ status: r.status as InterviewStatus, startsAt: r.startsAt }, now.getTime())) {
      throw new ConflictException(r.status === 'cancelled' || r.status === 'no_show' ? 'The interview didn’t take place: there is nothing to score.' : 'Give your scorecard once the interview has started.');
    }
    const input: Partial<FeedbackInput> = { ratings: dto.ratings as Record<FeedbackCriterion, number>, recommendation: dto.recommendation, notes: dto.notes };
    const problems = feedbackProblems(input);
    if (problems.length) throw new BadRequestException(problems);
    const ratings = dto.ratings as Record<FeedbackCriterion, number>;
    const data = {
      ratingSkills: ratings.skills,
      ratingExperience: ratings.experience,
      ratingCommunication: ratings.communication,
      ratingCulture: ratings.culture,
      recommendation: dto.recommendation,
      notes: dto.notes?.trim() || null,
    };
    const existing = await this.prisma.interviewFeedback.findUnique({ where: { interviewId_employeeId: { interviewId: id, employeeId: c.selfId } }, select: { id: true } });
    const saved = existing
      ? await this.prisma.interviewFeedback.update({ where: { id: existing.id }, data, select: { id: true } })
      : await this.prisma.interviewFeedback.create({ data: { ...data, interviewId: id, employeeId: c.selfId }, select: { id: true } });
    // the scores and the recommendation, never the notes
    await this.audit.record({
      userId: user.id,
      action: existing ? 'feedback_change' : 'feedback',
      entityType: INTERVIEW_ENTITY,
      entityId: id,
      diff: { application: r.application.number, feedbackId: saved.id, recommendation: dto.recommendation, ratings },
    });
    return this.view(await this.row(id, c), c, now.getTime());
  }

  /**
   * The scorecard reminder (the brief: "a reminder notification the day after an interview without feedback"): each
   * interviewer of an interview that took place before today (in Cairo), in the last two weeks, not cancelled nor a
   * no-show, without their scorecard, told once. Answers how many were told.
   */
  async remindFeedback(now = new Date()): Promise<number> {
    const today = toDateOnly(cairoDay(now));
    const rows = await this.prisma.interviewInterviewer.findMany({
      where: {
        remindedAt: null,
        interview: { status: { in: ['scheduled', 'done'] }, startsAt: { lt: today, gte: new Date(now.getTime() - 14 * 86_400_000) } },
      },
      select: {
        interviewId: true,
        employeeId: true,
        employee: { select: { workEmail: true } },
        interview: { select: { startsAt: true, feedback: { select: { employeeId: true } }, application: { select: { id: true, fullName: true } } } },
      },
    });
    let told = 0;
    for (const r of rows) {
      if (r.interview.feedback.some((f) => f.employeeId === r.employeeId)) continue;
      // claimed first, so two rounds never tell twice
      const { count } = await this.prisma.interviewInterviewer.updateMany({ where: { interviewId: r.interviewId, employeeId: r.employeeId, remindedAt: null }, data: { remindedAt: now } });
      if (!count) continue;
      const user = await this.userOf(r.employeeId);
      if (!user) continue;
      await this.notifications.notify([user], {
        kind: 'interview_feedback',
        title: 'Your interview scorecard',
        body: `${r.interview.application.fullName}: interviewed ${cairoDay(r.interview.startsAt)}`,
        link: `/recruitment/applicants/${r.interview.application.id}`,
      });
      told++;
    }
    return told;
  }

  // ---------- telling ----------

  /** An employee's active account (users.employee_id, 22 October 2026: never by email); null without one. */
  private async userOf(employeeId: string | null | undefined): Promise<string | null> {
    const u = await accountOfEmployee(this.prisma, employeeId);
    return u?.isActive ? u.id : null;
  }

  /**
   * Tells about an interview after it is saved: the candidate by email (with the calendar invitation; the outcome kept on
   * the interview), the interviewers `told` a notification and the invitation by email when they have a work email,
   * those `dropped` the cancellation. Never throws.
   */
  private async tell(r: Row, kind: InterviewMailKind, user: SessionUser, told: readonly string[], dropped: readonly string[]): Promise<InterviewSaved['email']> {
    const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } });
    const companyName = company?.nameEn ?? 'the company';
    const job = r.application.vacancy.title;
    const facts = {
      candidate: r.application.fullName,
      job,
      company: companyName,
      day: DAY_EN.format(r.startsAt).replace(',', ''),
      dayAr: DAY_AR.format(r.startsAt),
      time: cairoClock(r.startsAt),
      minutes: r.minutes,
      kind: r.kind as InterviewKind,
      location: r.location,
      mobile: r.application.mobile,
      note: r.note,
    };
    const organizer = { name: `${companyName} HR`, email: user.email };
    const panel = r.interviewers.map((i) => ({ name: i.employee.fullNameEn, email: i.employee.workEmail ?? '' })).filter((p) => p.email);
    const ics = (method: 'REQUEST' | 'CANCEL', attendees: { name: string; email: string }[]) =>
      buildIcs({
        uid: interviewUid(r.id),
        sequence: r.sequence,
        method,
        start: r.startsAt,
        minutes: r.minutes,
        summary: `Interview: ${r.application.fullName} · ${job}`,
        description: [`${INTERVIEW_KIND_LABELS[facts.kind]} interview for ${job} (${r.application.vacancy.number}).`, r.note ?? ''].filter(Boolean).join('\n'),
        location: r.location ?? '',
        organizer,
        attendees,
        stamp: new Date(),
      });
    const attach = (method: 'REQUEST' | 'CANCEL', attendees: { name: string; email: string }[]) => ({
      filename: method === 'CANCEL' ? 'interview-cancelled.ics' : 'interview.ics',
      content: Buffer.from(ics(method, attendees), 'utf8'),
      contentType: `text/calendar; charset=UTF-8; method=${method}`,
    });
    const method = kind === 'cancelled' ? 'CANCEL' : 'REQUEST';
    const candidate = { name: r.application.fullName, email: r.application.email };

    // the candidate
    let email: InterviewSaved['email'];
    if (!(await this.mail.ready())) {
      email = 'not_set_up';
      await this.prisma.interview.update({ where: { id: r.id }, data: { emailProblem: 'Email isn’t set up on the server: tell the candidate yourself.' } });
    } else {
      try {
        const m = interviewMail(kind, facts);
        await this.mail.send({ to: candidate.email, replyTo: user.email, subject: m.subject, text: m.text, attachments: [attach(method, [candidate, ...panel])] });
        await this.prisma.interview.update({ where: { id: r.id }, data: { emailedAt: new Date(), emailProblem: null } });
        email = 'sent';
      } catch (err) {
        this.logger.warn(`The interview email to ${r.application.number} could not be sent: ${(err as Error).message}`);
        await this.prisma.interview.update({ where: { id: r.id }, data: { emailProblem: 'The email provider refused it: tell the candidate yourself.' } });
        email = 'failed';
      }
    }

    // the interviewers: a notification, and the invitation by email to those with a work email
    const when = `${cairoDay(r.startsAt)} ${cairoClock(r.startsAt)}`;
    const link = `/recruitment/applicants/${r.application.id}`;
    const notifyEmployees = async (ids: readonly string[], title: string, body: string, m: 'REQUEST' | 'CANCEL') => {
      const employees = ids.length ? await this.prisma.employee.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullNameEn: true, workEmail: true } }) : [];
      const users = (await Promise.all(employees.map((e) => this.userOf(e.id)))).filter((u): u is string => !!u);
      await this.notifications.notify(users, { kind: 'interview_scheduled', title, body, link });
      if (!(await this.mail.ready())) return;
      for (const e of employees) {
        if (!e.workEmail) continue;
        try {
          await this.mail.send({
            to: e.workEmail,
            replyTo: user.email,
            subject: `${title}: ${r.application.fullName} · ${job}`,
            text: `${body}\n\n${INTERVIEW_KIND_LABELS[facts.kind]}${r.location ? `: ${r.location}` : ''}\n\nOpen the applicant in People System → Recruitment → My Hiring.`,
            attachments: [attach(m, [candidate, ...panel])],
          });
        } catch (err) {
          this.logger.warn(`The interview email to an interviewer could not be sent: ${(err as Error).message}`);
        }
      }
    };
    try {
      if (kind === 'cancelled') {
        await notifyEmployees(dropped, 'Interview cancelled', `${r.application.fullName} on ${when}`, 'CANCEL');
      } else {
        await notifyEmployees(told, kind === 'moved' ? 'Interview moved' : 'Interview scheduled', `${r.application.fullName} on ${when}, ${r.minutes} minutes`, 'REQUEST');
        if (dropped.length) await notifyEmployees(dropped, 'Interview cancelled for you', `${r.application.fullName}: you are no longer on the panel`, 'CANCEL');
      }
    } catch (err) {
      this.logger.warn(`The interviewers of ${r.application.number} could not be told: ${(err as Error).message}`);
    }
    return email;
  }
}
