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
  INTERVIEW_LIMITS,
  MEETING_KEEP,
  MEETING_PROVIDER_LABELS,
  parseMeetingChoice,
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
  type MeetingOutcome,
  type MeetingProvider,
  type MyHiring,
  type Recommendation,
  type WhatsAppPanelChange,
} from '@trendlix/shared';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import type { MeetingDetails } from '../meetings/meeting-providers.js';
import { MeetingsService, type MadeMeeting, type MeetingRef } from '../meetings/meetings.service.js';
import { keptNotification, NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { accountOfEmployee } from '../users/employee-accounts.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { AvailabilityService } from '../interview-hours/availability.service.js';
import { isConfidentialVacancy, vacancyWhere } from './recruitment-access.js';
import { hiringManagerApplications, HIRING_MANAGER_SEES, recruitmentCaller, visibleApplications, type RecruitmentCaller } from './recruitment-scope.js';
import { APPLICATION_ENTITY } from './recruitment-views.js';
import { shortlistsToReview } from './shortlist-review.js';
import type { FeedbackDto, InterviewDto, InterviewMeetingDto } from './recruitment.dto.js';
import { givenScorecardRole, NO_PROFILE_FOR_SCORECARD, NOT_A_SCORER, scorecardRole, scoresAsHr, type InterviewAnswer, type ScorecardRole } from './scorecard-givers.js';

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
// - The hiring manager and HR give one too (owner, 29 October 2026: "then there should be interview comment and status
//   for HR and hiring manager"; asked, "Score Card for each of them"; scorecard-givers.ts), even when not among its
//   interviewers, each with their own employee profile; each scorecard says whose it is. The hiring manager finds the
//   interviews of their vacancy's applicants on My Hiring and is reminded the day after as the interviewers are; HR
//   is not reminded.
// Every change is audited; the emails and notifications go after it is saved, never failing it.
//
// Online meetings made by the system (owner, 24 October 2026: "can i link an online meeting service provider to
// automatically generate meeting links?"; "Google Meet, Microsoft Teams, Zoom"; "make it both"; meetings.service.ts): HR
// chooses what creates the meeting (the company's connection or their own), or pastes a link as before. The meeting is
// made once the interview is saved, with its title, start and length, and its join link becomes the location, so the
// candidate's email, the interviewers' and the .ics carry it; moving the interview moves the meeting, cancelling it
// deletes it, and changing the choice replaces it. When the provider refuses, the interview is saved all the same and
// HR is told in plain words ("Google refused: …"); an online interview without its link tells nobody until it has one
// (Try again, or Paste a link: retryMeeting). Each meeting made, moved, deleted or refused is audited with its provider
// and its id there, never a token.
//
// The interviewers' availability (owner, 25 October 2026: "Hours + calendar"; "HR only"; interview-hours/
// availability.service.ts): HR finds the times every interviewer is free and books one, or types a time by hand; either
// way the time is checked on scheduling and moving (their leave as "unavailable", holidays, days from home for an
// in-person one, their other interviews with the buffer, their interview hours and calendars) and saved all the same,
// the warnings in the answer and the audit entry.

export const INTERVIEW_ENTITY = 'interview';

const NOT_FOUND = 'Interview not found.';
const USER = { select: { id: true, email: true } } as const;

const INCLUDE = {
  interviewers: { include: { employee: { select: { id: true, fullNameEn: true, workEmail: true } } }, orderBy: { employee: { fullNameEn: 'asc' } } },
  feedback: { select: { employeeId: true } },
  createdBy: USER,
  meetingConnection: { select: { userId: true } },
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

/** An online interview still without its link (its meeting refused, or not made yet): nobody is told until it has one. */
const linkless = (r: { kind: string; location: string | null }): boolean => r.kind === 'online' && !r.location;

/** An interview's made meeting, to move or delete it; null for none (a pasted link, or not online). */
const meetingRefOf = (r: { meetingProvider: string | null; meetingConnectionId: string | null; meetingId: string | null; meetingHost: string | null }): MeetingRef | null =>
  r.meetingProvider && r.meetingId ? { provider: r.meetingProvider as MeetingProvider, connectionId: r.meetingConnectionId, meetingId: r.meetingId, host: r.meetingHost } : null;

/** The interview's columns for a made meeting, its join link the location; and for none. */
const madeColumns = (m: MadeMeeting) => ({ location: m.joinUrl, meetingProvider: m.provider, meetingConnectionId: m.connectionId, meetingId: m.meetingId, meetingHost: m.host, meetingProblem: null });
const NO_MEETING = { meetingProvider: null, meetingConnectionId: null, meetingId: null, meetingHost: null } as const;

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
    private readonly meetings: MeetingsService,
    private readonly whatsapp: WhatsAppService,
    private readonly availability: AvailabilityService,
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
   * Since 29 October 2026 ("Score Card for each of them"), the interviews of the applicants they see as a hiring manager
   * too, so they give their scorecard on them; `feedbackDue` counts those past without theirs.
   */
  async myHiring(user: SessionUser, now = new Date()): Promise<MyHiring> {
    const c = await this.caller(user);
    if (!c.selfId) return { vacancies: [], interviews: [], feedbackDue: 0 };
    const since = new Date(now.getTime() - 60 * 86_400_000);
    const [vacancies, rows] = await Promise.all([
      this.prisma.vacancy.findMany({ where: { hiringManagerId: c.selfId, status: { in: ['open', 'on_hold'] } }, select: { id: true, number: true, title: true, status: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.interview.findMany({
        where: { startsAt: { gte: since }, OR: [{ interviewers: { some: { employeeId: c.selfId } } }, { application: hiringManagerApplications(c.selfId) }] },
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
    const feedbackDue = interviews.filter((i) => i.can.feedback && !i.myFeedbackGiven).length;
    // the shortlists waiting for their review (29 October 2026: "Manager view the shortlisted and accept or reject them")
    const toReview = await shortlistsToReview(this.prisma, vacancies, c.selfId);
    return { vacancies: vacancies.map((v) => ({ ...v, counts: counts(v.id) })), interviews, feedbackDue, toReview };
  }

  /**
   * The scorecards on an application, all of them (the caller's visibility is the applicants' service's), each with
   * whose it is (29 October 2026): an interviewer's, the hiring manager's, or HR's.
   */
  async feedbackOf(applicationId: string, selfId: string | null): Promise<FeedbackView[]> {
    const rows = await this.prisma.interviewFeedback.findMany({
      where: { interview: { applicationId } },
      include: {
        employee: { select: { id: true, fullNameEn: true } },
        interview: { select: { interviewers: { select: { employeeId: true } }, application: { select: { vacancy: { select: { hiringManagerId: true } } } } } },
      },
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
        role: givenScorecardRole(f.employeeId, { interviewerIds: f.interview.interviewers.map((i) => i.employeeId), hiringManagerId: f.interview.application.vacancy.hiringManagerId }),
      }),
    );
  }

  private views(rows: Row[], c: RecruitmentCaller, now: number): InterviewAnswer[] {
    return rows.map((r) => this.view(r, c, now));
  }

  /**
   * Whose scorecard the caller gives on the interview (29 October 2026): as one of its interviewers, the vacancy's
   * hiring manager or HR; null: none.
   */
  private scorerOf(r: Row, c: RecruitmentCaller): ScorecardRole | null {
    const asHr = scoresAsHr(c, isConfidentialVacancy(r.application.vacancy));
    return scorecardRole(c.selfId, { interviewerIds: r.interviewers.map((i) => i.employeeId), hiringManagerId: r.application.vacancy.hiringManagerId }, asHr);
  }

  private view(r: Row, c: RecruitmentCaller, now: number): InterviewAnswer {
    const status = r.status as InterviewStatus;
    const given = new Set(r.feedback.map((f) => f.employeeId));
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
      meeting: r.meetingProvider
        ? { provider: r.meetingProvider as MeetingProvider, owner: r.meetingConnection ? (r.meetingConnection.userId ? 'personal' : 'company') : null, joinUrl: r.location }
        : null,
      meetingProblem: r.meetingProblem,
      can: {
        reschedule: c.manages && interviewChangeable(status),
        cancel: c.manages && interviewChangeable(status),
        mark: c.manages && status === 'scheduled' && r.startsAt.getTime() <= now,
        // its interviewers, the hiring manager and HR (29 October 2026), once it has started
        feedback: !!this.scorerOf(r, c) && feedbackOpen({ status, startsAt: r.startsAt }, now),
        meeting: c.manages && status === 'scheduled' && linkless(r),
      },
      // theirs given (29 October 2026): "Scorecard due" for those not on its interviewers' list too
      myFeedbackGiven: !!c.selfId && given.has(c.selfId),
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
    if (dto.meeting === MEETING_KEEP) throw new BadRequestException(['Choose what creates the meeting, or paste its link.']);
    const d = await this.checked(dto, now.getTime());
    // the interviewers' availability (owner, 25 October 2026: "hand-typed times get conflict warnings, never blocks"):
    // their leave, holidays, interviews, hours and calendars, said in words; saved all the same
    const warnings = await this.availability.warningsFor({ interviewerIds: dto.interviewerIds, startsAt: d.startsAt, minutes: dto.minutes, kind: dto.kind }, user, now);
    // online with a choice: the connection checked before anything is saved; the meeting made once it is
    const connection = dto.kind === 'online' && parseMeetingChoice(dto.meeting) ? await this.meetings.connectionFor(dto.meeting!, user) : null;
    const id = await this.prisma.$transaction(async (tx) => {
      const made = await tx.interview.create({
        data: {
          applicationId,
          startsAt: d.startsAt,
          minutes: dto.minutes,
          kind: dto.kind,
          location: connection ? null : d.location,
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
      diff: { application: a.number, vacancy: a.vacancy.number, startsAt: d.startsAt.toISOString(), minutes: dto.minutes, kind: dto.kind, interviewers: d.interviewers.map((i) => i.fullNameEn), ...(warnings.length && { warnings }) },
    });
    if (stage === 'applied' || stage === 'shortlisted') {
      await this.audit.record({ userId: user.id, action: 'stage', entityType: APPLICATION_ENTITY, entityId: applicationId, diff: { number: a.number, vacancy: a.vacancy.number, stage: { from: stage, to: 'interview' } } });
    }
    let meeting: MeetingOutcome = 'none';
    if (connection) meeting = await this.makeMeeting(await this.row(id, c), connection, user);
    const row = await this.row(id, c);
    const email = await this.tell(row, 'invite', user, d.interviewers.map((i) => i.id), []);
    return { interview: this.view(await this.row(id, c), c, now.getTime()), email, meeting, meetingProblem: row.meetingProblem, warnings };
  }

  /** Moves an interview (still scheduled) to another time, place or panel: the candidate and the interviewers get the new time. */
  async reschedule(id: string, dto: InterviewDto, user: SessionUser, now = new Date()): Promise<InterviewSaved> {
    const c = await this.caller(user);
    this.assertManages(c);
    const before = await this.row(id, c);
    if (!interviewChangeable(before.status as InterviewStatus)) throw new ConflictException('Only a scheduled interview can be moved.');
    // its meeting (24 October 2026): kept and moved, replaced by another choice's, or deleted (a pasted link, not online)
    const had = meetingRefOf(before);
    const online = dto.kind === 'online';
    // nothing said (an older page) and the link left as it was: the meeting it has is kept
    const unsaid = !dto.meeting && !!had && online && (!dto.location || dto.location === before.location);
    const choice = unsaid ? MEETING_KEEP : dto.meeting;
    if (online && choice === MEETING_KEEP && !had && !(before.kind === 'online' && before.location)) throw new BadRequestException(['It has no meeting to keep: choose what creates one, or paste its link.']);
    const d = await this.checked(
      { date: dto.date, time: dto.time, minutes: dto.minutes, kind: dto.kind, location: dto.location, interviewerIds: dto.interviewerIds, note: dto.note, meeting: choice },
      now.getTime(),
    );
    // the same checks on a move (25 October 2026), the interview itself left out of their booked ones
    const warnings = await this.availability.warningsFor({ interviewerIds: dto.interviewerIds, startsAt: d.startsAt, minutes: dto.minutes, kind: dto.kind, excludeId: id }, user, now);
    let connection = online && parseMeetingChoice(choice) ? await this.meetings.connectionFor(choice!, user) : null;
    // the same connection as its meeting's: moved, not made again
    let keep = online && choice === MEETING_KEEP;
    if (connection && had && had.connectionId === connection.id) {
      keep = true;
      connection = null;
    }
    const location = keep ? before.location : connection ? null : d.location;
    const old = new Set(before.interviewers.map((i) => i.employeeId));
    const next = new Set(d.interviewers.map((i) => i.id));
    const removed = [...old].filter((x) => !next.has(x));
    const added = [...next].filter((x) => !old.has(x));
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.interview.updateMany({
        where: { id, status: 'scheduled', sequence: before.sequence },
        data: { startsAt: d.startsAt, minutes: dto.minutes, kind: dto.kind, location, note: d.note, sequence: { increment: 1 }, updatedById: user.id },
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
        ...(warnings.length && { warnings }),
      },
    });
    let meeting: MeetingOutcome = 'none';
    if (had && keep) {
      meeting = await this.moveMeeting(await this.row(id, c), had, user);
    } else if (had) {
      meeting = await this.deleteMeeting(await this.row(id, c), had, user, 'replaced');
    } else {
      await this.prisma.interview.update({ where: { id }, data: { meetingProblem: null } });
    }
    // a new meeting; an earlier one that couldn't be deleted stays said beside it
    if (connection) meeting = await this.makeMeeting(await this.row(id, c), connection, user, meeting === 'failed');
    const row = await this.row(id, c);
    const email = await this.tell(row, 'moved', user, [...next], removed);
    return { interview: this.view(await this.row(id, c), c, now.getTime()), email, meeting, meetingProblem: row.meetingProblem, warnings };
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
    const had = meetingRefOf(before);
    const meeting: MeetingOutcome = had ? await this.deleteMeeting(await this.row(id, c), had, user, 'cancelled') : 'none';
    const row = await this.row(id, c);
    const email = await this.tell(row, 'cancelled', user, [], row.interviewers.map((i) => i.employeeId));
    return { interview: this.view(row, c, now.getTime()), email, meeting, meetingProblem: row.meetingProblem };
  }

  /**
   * An online interview still without its link (its meeting refused): "Try again" with a choice, or "Paste a link".
   * Once it has one, the candidate and the interviewers are told (invited, or told of the move when they had been told
   * before).
   */
  async retryMeeting(id: string, dto: InterviewMeetingDto, user: SessionUser, now = new Date()): Promise<InterviewSaved> {
    const c = await this.caller(user);
    this.assertManages(c);
    const before = await this.row(id, c);
    if (before.status !== 'scheduled') throw new ConflictException('Only a scheduled interview gets a meeting.');
    if (!linkless(before)) throw new ConflictException(before.kind === 'online' ? 'It has its link already: move the interview to change its meeting.' : 'Only an online interview gets a meeting.');
    const link = dto.link?.trim() || null;
    if (!link === !dto.meeting) throw new BadRequestException(['Choose what creates the meeting, or paste its link.']);
    let meeting: MeetingOutcome = 'none';
    if (link) {
      if (link.length > INTERVIEW_LIMITS.location || !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(link)) throw new BadRequestException(['Give the meeting’s link in full, starting with https://.']);
      await this.prisma.interview.update({ where: { id }, data: { location: link, ...NO_MEETING, meetingProblem: null, updatedById: user.id } });
      await this.audit.record({ userId: user.id, action: 'meeting_link', entityType: INTERVIEW_ENTITY, entityId: id, diff: { application: before.application.number } });
    } else {
      const connection = await this.meetings.connectionFor(dto.meeting!, user);
      meeting = await this.makeMeeting(before, connection, user);
    }
    const row = await this.row(id, c);
    const email = await this.tell(row, row.emailedAt ? 'moved' : 'invite', user, row.interviewers.map((i) => i.employeeId), []);
    return { interview: this.view(await this.row(id, c), c, now.getTime()), email, meeting, meetingProblem: row.meetingProblem };
  }

  // ---------- the meeting (24 October 2026) ----------

  /** What a meeting is made (or moved) with: the interview's title, start and length; a note it came from here. */
  private meetingDetails(r: Row): MeetingDetails {
    const job = r.application.vacancy.title;
    return {
      title: `Interview: ${r.application.fullName} · ${job}`,
      description: `Online interview for ${job} (${r.application.vacancy.number}), scheduled in People System. The candidate and the interviewers get People System’s invitation.`,
      start: r.startsAt,
      minutes: r.minutes,
      requestId: randomUUID(),
    };
  }

  /**
   * Makes the interview's meeting with the connection: its link becomes the location; refused, the problem is kept on
   * the interview (`also`: keep the problem already there beside it). Audited either way.
   */
  private async makeMeeting(r: Row, connection: Awaited<ReturnType<MeetingsService['connectionFor']>>, user: SessionUser, also = false): Promise<MeetingOutcome> {
    const provider = connection.provider as MeetingProvider;
    const made = await this.meetings.make(connection, this.meetingDetails(r));
    if (made.ok) {
      await this.prisma.interview.update({ where: { id: r.id }, data: { ...madeColumns(made.value), ...(also && { meetingProblem: r.meetingProblem }) } });
      await this.audit.record({
        userId: user.id,
        action: 'meeting_create',
        entityType: INTERVIEW_ENTITY,
        entityId: r.id,
        diff: { application: r.application.number, provider, owner: made.value.owner, meetingId: made.value.meetingId },
      });
      return 'created';
    }
    const problem = `${made.problem} Nobody was told yet: try again, or paste a link.`;
    await this.prisma.interview.update({ where: { id: r.id }, data: { meetingProblem: also && r.meetingProblem ? `${r.meetingProblem} ${problem}` : problem } });
    await this.audit.record({ userId: user.id, action: 'meeting_failed', entityType: INTERVIEW_ENTITY, entityId: r.id, diff: { application: r.application.number, provider, step: 'create', reason: made.problem } });
    return 'failed';
  }

  /** Moves the interview's meeting to its new time; refused, the link stays and the problem is said. */
  private async moveMeeting(r: Row, ref: MeetingRef, user: SessionUser): Promise<MeetingOutcome> {
    const moved = await this.meetings.move(ref, this.meetingDetails(r));
    if (moved.ok) {
      await this.prisma.interview.update({ where: { id: r.id }, data: { meetingProblem: null } });
      await this.audit.record({ userId: user.id, action: 'meeting_update', entityType: INTERVIEW_ENTITY, entityId: r.id, diff: { application: r.application.number, provider: ref.provider, meetingId: ref.meetingId, ...(moved.value === 'gone' && { gone: true }) } });
      return 'updated';
    }
    const label = MEETING_PROVIDER_LABELS[ref.provider];
    await this.prisma.interview.update({ where: { id: r.id }, data: { meetingProblem: `${moved.problem} The ${label} link stays the same; move the meeting there yourself if it matters.` } });
    await this.audit.record({ userId: user.id, action: 'meeting_failed', entityType: INTERVIEW_ENTITY, entityId: r.id, diff: { application: r.application.number, provider: ref.provider, meetingId: ref.meetingId, step: 'update', reason: moved.problem } });
    return 'failed';
  }

  /**
   * Deletes the interview's meeting (`why`: the interview cancelled, or its meeting replaced by another or by a pasted
   * link): it comes off the interview either way; refused, the problem is said, to delete it there by hand.
   */
  private async deleteMeeting(r: Row, ref: MeetingRef, user: SessionUser, why: 'cancelled' | 'replaced'): Promise<MeetingOutcome> {
    const removed = await this.meetings.remove(ref);
    const label = MEETING_PROVIDER_LABELS[ref.provider];
    const problem = removed.ok ? null : `The earlier ${label} meeting couldn’t be deleted: ${removed.problem} Delete it there yourself.`;
    await this.prisma.interview.update({ where: { id: r.id }, data: { ...NO_MEETING, meetingProblem: problem } });
    await this.audit.record({
      userId: user.id,
      action: removed.ok ? 'meeting_delete' : 'meeting_failed',
      entityType: INTERVIEW_ENTITY,
      entityId: r.id,
      diff: { application: r.application.number, provider: ref.provider, meetingId: ref.meetingId, step: why === 'cancelled' ? 'delete' : 'replace', ...(!removed.ok && { reason: removed.problem }) },
    });
    return removed.ok ? 'deleted' : 'failed';
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
   * A scorecard, saved (or changed) once the interview has started, while it isn't cancelled nor a no-show; by an
   * interviewer on it, and since 29 October 2026 ("Score Card for each of them") by the vacancy's hiring manager and HR
   * too, through their own employee profile: one each.
   */
  async feedback(id: string, dto: FeedbackDto, user: SessionUser, now = new Date()): Promise<InterviewView> {
    const c = await this.caller(user);
    const r = await this.row(id, c);
    const role = this.scorerOf(r, c);
    const selfId = c.selfId;
    if (!role || !selfId) {
      // HR (or the CEO on a C-level vacancy) whose user has no employee profile: a scorecard is a person's
      if (!selfId && scoresAsHr(c, isConfidentialVacancy(r.application.vacancy))) throw new ConflictException(NO_PROFILE_FOR_SCORECARD);
      throw new ForbiddenException(NOT_A_SCORER);
    }
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
    const existing = await this.prisma.interviewFeedback.findUnique({ where: { interviewId_employeeId: { interviewId: id, employeeId: selfId } }, select: { id: true } });
    const saved = existing
      ? await this.prisma.interviewFeedback.update({ where: { id: existing.id }, data, select: { id: true } })
      : await this.prisma.interviewFeedback.create({ data: { ...data, interviewId: id, employeeId: selfId }, select: { id: true } });
    // the scores and the recommendation, never the notes; whose it is (29 October 2026)
    await this.audit.record({
      userId: user.id,
      action: existing ? 'feedback_change' : 'feedback',
      entityType: INTERVIEW_ENTITY,
      entityId: id,
      diff: { application: r.application.number, feedbackId: saved.id, givenAs: role, recommendation: dto.recommendation, ratings },
    });
    return this.view(await this.row(id, c), c, now.getTime());
  }

  /**
   * The scorecard reminder (the brief: "a reminder notification the day after an interview without feedback"): each
   * interviewer of an interview that took place before today (in Cairo), in the last two weeks, not cancelled nor a
   * no-show, without their scorecard, told once; and its vacancy's hiring manager the same way (29 October 2026: "Score
   * Card for each of them"; remindHiringManagers), never all of HR. Answers how many were told.
   */
  async remindFeedback(now = new Date()): Promise<number> {
    const today = toDateOnly(cairoDay(now));
    const window = { status: { in: ['scheduled', 'done'] }, startsAt: { lt: today, gte: new Date(now.getTime() - 14 * 86_400_000) } } satisfies Prisma.InterviewWhereInput;
    const rows = await this.prisma.interviewInterviewer.findMany({
      where: {
        remindedAt: null,
        interview: window,
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
    return told + (await this.remindHiringManagers(window));
  }

  /**
   * The hiring manager's scorecard reminder (29 October 2026): of an interview of their vacancy's (in `window`) that they
   * don't sit on (an interviewer is reminded as one), on an applicant they see, without their scorecard. Told once: with
   * no row of theirs on the interview to claim, the notification itself is the record (it says the day and time, so
   * each interview has its own), looked for and made under a lock, so two rounds never tell twice.
   */
  private async remindHiringManagers(window: Prisma.InterviewWhereInput): Promise<number> {
    const rows = await this.prisma.interview.findMany({
      where: { ...window, application: { ...HIRING_MANAGER_SEES, vacancy: { hiringManagerId: { not: null } } } },
      select: {
        id: true,
        startsAt: true,
        interviewers: { select: { employeeId: true } },
        feedback: { select: { employeeId: true } },
        application: { select: { id: true, fullName: true, vacancy: { select: { hiringManagerId: true } } } },
      },
    });
    let told = 0;
    for (const r of rows) {
      const hm = r.application.vacancy.hiringManagerId;
      if (!hm || r.interviewers.some((i) => i.employeeId === hm) || r.feedback.some((f) => f.employeeId === hm)) continue;
      const user = await this.userOf(hm);
      if (!user) continue;
      const notice = {
        kind: 'interview_feedback' as const,
        title: 'Your interview scorecard',
        body: `${r.application.fullName}: interviewed ${cairoDay(r.startsAt)} at ${cairoClock(r.startsAt)}`,
        link: `/recruitment/applicants/${r.application.id}`,
      };
      // looked for as it is kept (its body cut to the inbox's length)
      const kept = keptNotification(notice);
      if (!kept) continue;
      const sent = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-system:scorecard-reminder:${r.id}:${hm}`}))`;
        if (await tx.notification.count({ where: { userId: user, kind: kept.kind, link: kept.link, body: kept.body } })) return false;
        // kept (committed) before the lock is let go, so the next round finds it
        await this.notifications.notify([user], notice);
        return true;
      });
      if (sent) told++;
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
    // online without its link yet (its meeting refused, 24 October 2026): nobody is invited until it has one; those taken
    // off the panel are still told
    const silent = kind !== 'cancelled' && linkless(r);
    const meetingName = r.kind === 'online' && r.meetingProvider ? MEETING_PROVIDER_LABELS[r.meetingProvider as MeetingProvider] : null;
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
      meetingName,
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
        description: [
          `${INTERVIEW_KIND_LABELS[facts.kind]} interview for ${job} (${r.application.vacancy.number}).`,
          r.kind === 'online' && r.location ? `Join${meetingName ? ` on ${meetingName}` : ''}: ${r.location}` : '',
          r.note ?? '',
        ]
          .filter(Boolean)
          .join('\n'),
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
    if (silent) {
      email = 'not_sent';
    } else if (!(await this.mail.ready())) {
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
    // on WhatsApp too, when they ticked it on the careers form (owner, 24 October 2026: "Interviews"): the invitation,
    // a change, or the cancellation; never for an online one still without its link (never throws)
    if (!silent) await this.whatsapp.interview(kind, r.id);

    // the interviewers: a notification, and the invitation by email to those with a work email
    const when = `${cairoDay(r.startsAt)} ${cairoClock(r.startsAt)}`;
    const link = `/recruitment/applicants/${r.application.id}`;
    // a C-level vacancy's interview is never shown in HR's WhatsApp log (24 October 2026)
    const cLevel = r.application.vacancy.grade?.confidential === true || r.application.vacancy.jobTitle.minGrade?.confidential === true;
    const notifyEmployees = async (ids: readonly string[], title: string, body: string, m: 'REQUEST' | 'CANCEL', change: WhatsAppPanelChange) => {
      const employees = ids.length ? await this.prisma.employee.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullNameEn: true, workEmail: true } }) : [];
      const users = (await Promise.all(employees.map((e) => this.userOf(e.id)))).filter((u): u is string => !!u);
      await this.notifications.notify(users, {
        kind: 'interview_scheduled',
        title,
        body,
        link,
        // on WhatsApp for interviewers who opted in (24 October 2026: "Interviews"): the candidate, the job and when
        whatsapp: { facts: { template: 'interview_panel', change, candidate: r.application.fullName, job, at: r.startsAt.toISOString() }, confidential: cLevel },
      });
      if (!(await this.mail.ready())) return;
      for (const e of employees) {
        if (!e.workEmail) continue;
        try {
          await this.mail.send({
            to: e.workEmail,
            replyTo: user.email,
            subject: `${title}: ${r.application.fullName} · ${job}`,
            text: `${body}\n\n${INTERVIEW_KIND_LABELS[facts.kind]}${meetingName ? ` (${meetingName})` : ''}${r.location ? `: ${r.location}` : ''}\n\nOpen the applicant in People System → Recruitment → My Hiring.`,
            attachments: [attach(m, [candidate, ...panel])],
          });
        } catch (err) {
          this.logger.warn(`The interview email to an interviewer could not be sent: ${(err as Error).message}`);
        }
      }
    };
    try {
      if (kind === 'cancelled') {
        await notifyEmployees(dropped, 'Interview cancelled', `${r.application.fullName} on ${when}`, 'CANCEL', 'cancelled');
      } else {
        // the meeting's service beside it (24 October 2026); its link is on the applicant's page and in the email, never in
        // a notification (they show on a locked phone)
        if (!silent) {
          await notifyEmployees(told, kind === 'moved' ? 'Interview moved' : 'Interview scheduled', `${r.application.fullName} on ${when}, ${r.minutes} minutes${meetingName ? `, on ${meetingName}` : ''}`, 'REQUEST', kind === 'moved' ? 'moved' : 'scheduled');
        }
        if (dropped.length) await notifyEmployees(dropped, 'Interview cancelled for you', `${r.application.fullName}: you are no longer on the panel`, 'CANCEL', 'dropped');
      }
    } catch (err) {
      this.logger.warn(`The interviewers of ${r.application.number} could not be told: ${(err as Error).message}`);
    }
    return email;
  }
}
