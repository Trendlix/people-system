import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  aboutKey,
  aboutLabel,
  applicationKey,
  applicationVerdicts,
  candidateVerdicts,
  canEditComment,
  cvFitFrom,
  editableUntil,
  generalCvKey,
  latestVerdict,
  latestVerdictsBy,
  mentionNotice,
  newlyMentioned,
  readerRoleOf,
  refusedMentions,
  SCREENING_VERDICT_LABELS,
  screeningCommentProblems,
  uniqueMentions,
  type CandidateTimelineItem,
  type ScreeningAbout,
  type ScreeningAuthorRole,
  type ScreeningCommentView,
  type ScreeningComments,
  type ScreeningCv,
  type ScreeningPerson,
  type ScreeningTarget,
  type ScreeningVerdict,
  type VerdictFilter,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { assertDeletes, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeAccountsOf } from '../users/employee-accounts.js';
import { CvFitsService } from './cv-fits.service.js';
import { isConfidentialVacancy, READS, vacancyWhere } from './recruitment-access.js';
import { recruitmentCaller, visibleApplications, type RecruitmentCaller } from './recruitment-scope.js';
import { EARLIER_CV_SELECT, earlierCvView } from './recruitment-views.js';
import { applicationReaders, authorRoleOf, commentWhere, generalReaders, readerCandidates, type ReaderAccount } from './screening-access.js';
import { moveEarlierNotes, SCREENING_ENTITY } from './screening-notes.js';

// Screening comments (owner, 24 October 2026, on a candidate's profile: "is there a way to add screening comments?",
// "and i can add genearrl comments"; asked, "Yes: Good fit / Maybe / Not a fit" and "HR + hiring manager &
// interviewers"; packages/shared screening.ts). A comment is about one of a candidate's applications or general CVs, or
// the person in general; it may carry a verdict and @mention colleagues who may read it, each told (in the inbox and on
// their phone: names only, never the comment). Who reads and writes: screening-access.ts. Its author edits it for 24
// hours; only a Super Admin deletes one; each write audited (without the text). The latest verdict of an application, a
// general CV and a candidate for the lists' badges and their Verdict filter; the profile's timeline lines. HR's notes of
// before moved into first comments (screening-notes.ts).

const NOT_FOUND = 'Comment not found.';
const NO_CANDIDATE = 'They have no candidate profile yet. Try again in a few minutes.';
const ONLY_READERS = 'Only HR, the CEO and a Super Admin comment on general CVs and on a candidate in general.';

const ROW_SELECT = {
  id: true,
  candidateId: true,
  applicationId: true,
  generalCvId: true,
  authorId: true,
  authorLabel: true,
  authorRole: true,
  text: true,
  verdict: true,
  mentions: true,
  createdAt: true,
  editedAt: true,
  author: { select: { id: true, email: true } },
  application: { select: { number: true, vacancy: { select: { title: true } } } },
  generalCv: { select: { number: true } },
} satisfies Prisma.ScreeningCommentSelect;
type Row = Prisma.ScreeningCommentGetPayload<{ select: typeof ROW_SELECT }>;

/** An application as the comments read it: what it is, its CV, who may read its comments, the general CV it came from. */
const APP_SELECT = {
  id: true,
  number: true,
  createdAt: true,
  candidateId: true,
  fullName: true,
  stage: true,
  rejectedFrom: true,
  filteredOut: true,
  vacancy: { select: { title: true, hiringManagerId: true, grade: { select: { confidential: true } }, jobTitle: { select: { minGrade: { select: { confidential: true } } } } } },
  interviews: { select: { interviewers: { select: { employeeId: true } } } },
  cv: { select: { fileName: true, mimeType: true, sizeBytes: true } },
  // the portfolio links, for the CV window (25 October 2026: "Portfolio per position")
  portfolioLinks: true,
  generalCv: { select: { id: true } },
  // the CV window's CV Fit (25 October 2026)
  cvFit: true,
  // applying again (25 October 2026: "Update their application"): when the current CV came, and the earlier ones
  cvUpdatedAt: true,
  earlierCvs: { orderBy: { sentAt: 'desc' }, select: EARLIER_CV_SELECT },
} satisfies Prisma.JobApplicationSelect;
type AppRow = Prisma.JobApplicationGetPayload<{ select: typeof APP_SELECT }>;

const GCV_SELECT = {
  id: true,
  number: true,
  createdAt: true,
  candidateId: true,
  fullName: true,
  applicationId: true,
  file: { select: { fileName: true, mimeType: true, sizeBytes: true } },
  portfolioLinks: true,
} satisfies Prisma.GeneralCvSelect;
type GcvRow = Prisma.GeneralCvGetPayload<{ select: typeof GCV_SELECT }>;

const aboutOf = (r: Pick<Row, 'applicationId' | 'generalCvId' | 'application' | 'generalCv'>): ScreeningAbout =>
  r.applicationId
    ? { kind: 'application', id: r.applicationId, reference: r.application?.number ?? null, title: r.application?.vacancy.title ?? null }
    : r.generalCvId
      ? { kind: 'general_cv', id: r.generalCvId, reference: r.generalCv?.number ?? null, title: null }
      : { kind: 'general', id: null, reference: null, title: null };

const appAbout = (a: { id: string; number: string; vacancy: { title: string } }): ScreeningAbout => ({ kind: 'application', id: a.id, reference: a.number, title: a.vacancy.title });
const gcvAbout = (g: { id: string; number: string }): ScreeningAbout => ({ kind: 'general_cv', id: g.id, reference: g.number, title: null });
const GENERAL: ScreeningAbout = { kind: 'general', id: null, reference: null, title: null };

/** Where a mention's notification opens: the record's page, at its comments. */
const linkOf = (candidateId: string, about: ScreeningAbout) =>
  about.kind === 'application'
    ? `/recruitment/applicants/${about.id}#screening-comments`
    : about.kind === 'general_cv'
      ? `/recruitment/general-cvs/${about.id}#screening-comments`
      : `/recruitment/candidates/${candidateId}#screening-comments`;

/** Who a comment is written on, and who may read it (so may be mentioned). */
interface Target {
  candidateId: string;
  candidateName: string;
  about: ScreeningAbout;
  application: AppRow | null;
  mayRead: Set<string>;
}

/** A body of POST /recruitment/comments. */
export interface CommentCreate {
  applicationId?: string;
  generalCvId?: string;
  candidateId?: string;
  comment?: string;
  verdict?: ScreeningVerdict | null;
  mentions?: string[];
}

/** A body of PATCH /recruitment/comments/:id: what changes. */
export interface CommentEdit {
  comment?: string;
  verdict?: ScreeningVerdict | null;
  mentions?: string[];
}

@Injectable()
export class ScreeningCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notifications: NotificationsService,
    private readonly fits: CvFitsService,
  ) {}

  /**
   * The CV window's CV Fit and Other Open Positions (owner, 25 October 2026: "Full CV fit score"; "and if it recomended
   * to another position based on the CV"): an application's fit for its vacancy (a general CV moved to one, that
   * application's), and each CV's open positions for HR, the CEO and a Super Admin.
   */
  private async withFits(cvs: ScreeningCv[], apps: readonly AppRow[], candidateId: string | null, c: RecruitmentCaller): Promise<ScreeningCv[]> {
    const appOf = new Map(apps.map((a) => [a.id, a]));
    const recordOf = (cv: ScreeningCv) => (cv.kind === 'general_cv' && cv.linkedKey?.startsWith('application:') ? cv.linkedKey.slice('application:'.length) : null);
    const positions = c.reads
      ? await this.fits.shownFor(
          cvs.flatMap((cv) => [{ kind: cv.kind, id: cv.id, candidateId }, ...(recordOf(cv) ? [{ kind: 'application' as const, id: recordOf(cv)!, candidateId }] : [])]),
          c.user,
        )
      : new Map();
    return cvs.map((cv) => {
      const app = appOf.get(cv.kind === 'application' ? cv.id : (recordOf(cv) ?? ''));
      const linked = recordOf(cv);
      const open = positions.get(cv.id)?.length ? positions.get(cv.id) : linked ? positions.get(linked) : undefined;
      return { ...cv, fit: app ? cvFitFrom(app.cvFit) : null, ...(c.reads && { openPositions: open ?? [] }) };
    });
  }

  private async caller(user: SessionUser): Promise<RecruitmentCaller> {
    return recruitmentCaller(user, await this.confidential.selfId(user));
  }

  private assertReads(user: SessionUser): void {
    if (!user.roles.some((r) => READS.includes(r))) throw new ForbiddenException(ONLY_READERS);
  }

  // ---------- who may read ----------

  /** HR, the CEO and the Super Admins: the active accounts holding one of those roles. */
  private async readers(): Promise<ReaderAccount[]> {
    const rows = await this.prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: { key: { in: [...READS] } } } } },
      select: { id: true, roles: { select: { role: { select: { key: true } } } } },
    });
    return rows.map((u) => ({ id: u.id, roles: u.roles.map((r) => r.role.key) }));
  }

  /** The active accounts of the applications' hiring managers and interviewers, by employee id. */
  private async participantAccounts(apps: readonly AppRow[]): Promise<Map<string, string>> {
    const ids = apps.flatMap((a) => [...(a.vacancy.hiringManagerId ? [a.vacancy.hiringManagerId] : []), ...a.interviews.flatMap((i) => i.interviewers.map((x) => x.employeeId))]);
    return activeAccountsOf(this.prisma, ids);
  }

  /** Whether HR sees the candidate (so a general comment's): an application on a vacancy that isn't C-level, or a general CV. */
  private async hrSees(candidateId: string): Promise<boolean> {
    const n = await this.prisma.candidate.count({ where: { id: candidateId, ...readerCandidates({ roles: ['hr'] }) } });
    return n > 0;
  }

  /** The target a comment goes on, checked for the caller; with who may read it. */
  private async target(c: RecruitmentCaller, about: { applicationId?: string; generalCvId?: string; candidateId?: string }): Promise<Target> {
    const given = [about.applicationId, about.generalCvId, about.candidateId].filter(Boolean).length;
    if (given !== 1) throw new BadRequestException(['Say what the comment is about: an application, a general CV, or the candidate in general.']);
    const readers = await this.readers();
    if (about.applicationId) {
      const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id: about.applicationId }, visibleApplications(c)] }, select: APP_SELECT });
      if (!a) throw new NotFoundException('Applicant not found.');
      if (!a.candidateId) throw new ConflictException(NO_CANDIDATE);
      return { candidateId: a.candidateId, candidateName: a.fullName, about: appAbout(a), application: a, mayRead: applicationReaders(a, readers, await this.participantAccounts([a])) };
    }
    this.assertReads(c.user);
    if (about.generalCvId) {
      const g = await this.prisma.generalCv.findUnique({ where: { id: about.generalCvId }, select: GCV_SELECT });
      if (!g) throw new NotFoundException('CV not found.');
      if (!g.candidateId) throw new ConflictException(NO_CANDIDATE);
      return { candidateId: g.candidateId, candidateName: g.fullName, about: gcvAbout(g), application: null, mayRead: generalReaders(readers, true) };
    }
    const cand = await this.prisma.candidate.findFirst({ where: { AND: [{ id: about.candidateId, mergedIntoId: null }, readerCandidates(c.user)] }, select: { id: true, fullName: true } });
    if (!cand) throw new NotFoundException('Candidate not found.');
    return { candidateId: cand.id, candidateName: cand.fullName, about: GENERAL, application: null, mayRead: generalReaders(readers, await this.hrSees(cand.id)) };
  }

  /** The mentions given, each once, every one of them someone who may read the comment (400 naming those who may not). */
  private async checkedMentions(ids: readonly string[] | null | undefined, mayRead: ReadonlySet<string>): Promise<string[]> {
    const mentions = uniqueMentions(ids);
    const refused = refusedMentions(mentions, mayRead);
    if (refused.length) {
      const known = await this.prisma.user.findMany({ where: { id: { in: refused } }, select: { id: true, email: true } });
      const names = await userNames(this.prisma, known);
      const who = known.map((u) => names.get(u.id)?.name ?? u.email);
      throw new BadRequestException([
        who.length ? `${who.join(', ')} can’t read this comment, so they can’t be mentioned.` : 'Someone mentioned can’t read this comment, so they can’t be mentioned.',
      ]);
    }
    return mentions;
  }

  // ---------- reading ----------

  /** GET /recruitment/candidates/:id/comments: every comment, CV and target of a candidate the caller sees (HR, the CEO, a Super Admin). */
  async forCandidate(id: string, user: SessionUser): Promise<ScreeningComments> {
    this.assertReads(user);
    const cand = await this.prisma.candidate.findFirst({ where: { AND: [{ id, mergedIntoId: null }, readerCandidates(user)] }, select: { id: true } });
    if (!cand) throw new NotFoundException('Candidate not found.');
    return this.ofCandidate(cand.id, await this.caller(user));
  }

  /** GET /recruitment/applications/:id/comments: their candidate's for HR, the CEO and a Super Admin; the application's own for its hiring manager and interviewers. */
  async forApplication(id: string, user: SessionUser): Promise<ScreeningComments> {
    const c = await this.caller(user);
    const a = await this.prisma.jobApplication.findFirst({ where: { AND: [{ id }, visibleApplications(c)] }, select: APP_SELECT });
    if (!a) throw new NotFoundException('Applicant not found.');
    if (c.reads && a.candidateId) return this.ofCandidate(a.candidateId, c);
    return this.ofApplication(a, c);
  }

  /** GET /recruitment/general-cvs/:id/comments: the general CV's candidate's (HR, the CEO, a Super Admin). */
  async forGeneralCv(id: string, user: SessionUser): Promise<ScreeningComments> {
    this.assertReads(user);
    const g = await this.prisma.generalCv.findUnique({ where: { id }, select: GCV_SELECT });
    if (!g) throw new NotFoundException('CV not found.');
    const c = await this.caller(user);
    if (g.candidateId) return this.ofCandidate(g.candidateId, c);
    // not joined to a candidate yet (the backfill does it within minutes): its CV, nothing to write on yet
    return { candidateId: null, comments: [], targets: [], people: [], cvs: g.file ? [this.gcvCv(g, null)] : [], verdict: null, can: { add: false } };
  }

  private appCv(a: AppRow, linkedKey: string | null): ScreeningCv {
    return {
      kind: 'application',
      id: a.id,
      reference: a.number,
      title: a.vacancy.title,
      cvFileName: a.cv!.fileName,
      mimeType: a.cv!.mimeType,
      sizeBytes: a.cv!.sizeBytes,
      // the current CV's: a new one sent by applying again, else the application's own (25 October 2026)
      sentAt: (a.cvUpdatedAt ?? a.createdAt).toISOString(),
      portfolioLinks: a.portfolioLinks,
      key: applicationKey(a.id),
      linkedKey,
      ...(a.earlierCvs.length && { earlierCvs: a.earlierCvs.map(earlierCvView) }),
    };
  }

  private gcvCv(g: GcvRow, linkedKey: string | null): ScreeningCv {
    return {
      kind: 'general_cv',
      id: g.id,
      reference: g.number,
      title: 'General CV',
      cvFileName: g.file!.fileName,
      mimeType: g.file!.mimeType,
      sizeBytes: g.file!.sizeBytes,
      sentAt: g.createdAt.toISOString(),
      portfolioLinks: g.portfolioLinks,
      key: generalCvKey(g.id),
      linkedKey,
    };
  }

  /** A candidate's, as HR, the CEO or a Super Admin see it: General, every application they see, every general CV. */
  private async ofCandidate(candidateId: string, c: RecruitmentCaller): Promise<ScreeningComments> {
    const [apps, gcvs, rows, readers] = await Promise.all([
      this.prisma.jobApplication.findMany({ where: { candidateId, vacancy: vacancyWhere(c.user) }, orderBy: { createdAt: 'desc' }, select: APP_SELECT }),
      this.prisma.generalCv.findMany({ where: { candidateId }, orderBy: { createdAt: 'desc' }, select: GCV_SELECT }),
      this.prisma.screeningComment.findMany({ where: { AND: [{ candidateId }, commentWhere(c)] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: ROW_SELECT }),
      this.readers(),
    ]);
    const accounts = await this.participantAccounts(apps);
    const appIds = new Set(apps.map((a) => a.id));
    const hrSees = gcvs.length > 0 || apps.some((a) => !isConfidentialVacancy(a.vacancy));
    // a general CV and the application made from it hold the same CV: listed once (the general CV's), their comments
    // together; unless the person sent the application a new CV since (applying again, 25 October 2026): then both
    const linkOfApp = new Map(gcvs.filter((g) => g.applicationId && appIds.has(g.applicationId)).map((g) => [g.applicationId!, g.id]));
    const all = new Set<string>();
    const targets: ScreeningTarget[] = [];
    const add = (about: ScreeningAbout, linkedKey: string | null, mayRead: Set<string>) => {
      const key = aboutKey(about);
      const own = rows.filter((r) => aboutKey(aboutOf(r)) === key);
      for (const id of mayRead) all.add(id);
      targets.push({ key, about, label: aboutLabel(about), linkedKey, count: own.length, verdict: latestVerdict(own), mentionable: [...mayRead].filter((id) => id !== c.user.id) });
    };
    add(GENERAL, null, generalReaders(readers, hrSees));
    for (const a of apps) add(appAbout(a), linkOfApp.has(a.id) ? generalCvKey(linkOfApp.get(a.id)!) : null, applicationReaders(a, readers, accounts));
    for (const g of gcvs) add(gcvAbout(g), g.applicationId && appIds.has(g.applicationId) ? applicationKey(g.applicationId) : null, generalReaders(readers, true));
    const cvs: ScreeningCv[] = [
      ...apps.filter((a) => a.cv && (!linkOfApp.has(a.id) || a.cvUpdatedAt)).map((a) => this.appCv(a, linkOfApp.has(a.id) ? generalCvKey(linkOfApp.get(a.id)!) : null)),
      ...gcvs.filter((g) => g.file).map((g) => this.gcvCv(g, g.applicationId && appIds.has(g.applicationId) ? applicationKey(g.applicationId) : null)),
    ].sort((x, y) => y.sentAt.localeCompare(x.sentAt));
    return {
      candidateId,
      comments: await this.views(rows, c),
      targets,
      people: await this.people([...all].filter((id) => id !== c.user.id), readers, apps),
      cvs: await this.withFits(cvs, apps, candidateId, c),
      verdict: latestVerdict(rows),
      can: { add: true },
    };
  }

  /** An application's own, as its hiring manager or an interviewer see it (or HR before its candidate is joined). */
  private async ofApplication(a: AppRow, c: RecruitmentCaller): Promise<ScreeningComments> {
    const [rows, readers, accounts] = await Promise.all([
      this.prisma.screeningComment.findMany({ where: { AND: [{ applicationId: a.id }, commentWhere(c)] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: ROW_SELECT }),
      this.readers(),
      this.participantAccounts([a]),
    ]);
    const mayRead = applicationReaders(a, readers, accounts);
    const about = appAbout(a);
    const mentionable = [...mayRead].filter((id) => id !== c.user.id);
    return {
      candidateId: a.candidateId,
      comments: await this.views(rows, c),
      targets: [{ key: aboutKey(about), about, label: aboutLabel(about), linkedKey: null, count: rows.length, verdict: latestVerdict(rows), mentionable }],
      people: await this.people(mentionable, readers, [a]),
      cvs: a.cv ? await this.withFits([this.appCv(a, null)], [a], a.candidateId, c) : [],
      verdict: latestVerdict(rows),
      can: { add: !!a.candidateId },
    };
  }

  /** The colleagues who may be mentioned, named, with their role: HR, the CEO or a Super Admin by their roles; else the hiring manager or an interviewer. */
  private async people(ids: readonly string[], readers: readonly ReaderAccount[], apps: readonly AppRow[]): Promise<ScreeningPerson[]> {
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, email: true, employeeId: true } });
    const names = await userNames(this.prisma, users);
    const roleOf = new Map(readers.map((r) => [r.id, readerRoleOf(r.roles)]));
    const managers = new Set(apps.map((a) => a.vacancy.hiringManagerId).filter((x): x is string => !!x));
    return users
      .map((u): ScreeningPerson => ({
        id: u.id,
        name: names.get(u.id)?.name ?? u.email,
        email: u.email,
        role: roleOf.get(u.id) ?? (u.employeeId && managers.has(u.employeeId) ? 'hiring_manager' : 'interviewer'),
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /** The comments as the caller sees them: the authors and those mentioned named, what each may do now. */
  private async views(rows: readonly Row[], c: RecruitmentCaller, now = new Date()): Promise<ScreeningCommentView[]> {
    const mentioned = [...new Set(rows.flatMap((r) => r.mentions))];
    const users = mentioned.length ? await this.prisma.user.findMany({ where: { id: { in: mentioned } }, select: { id: true, email: true } }) : [];
    const names = await userNames(this.prisma, [...rows.map((r) => r.author), ...users]);
    const emailOf = new Map(users.map((u) => [u.id, u.email]));
    const deletes = isSuperAdmin(c.user);
    return rows.map((r): ScreeningCommentView => {
      const about = aboutOf(r);
      const edits = canEditComment(r, c.user.id, now);
      return {
        id: r.id,
        candidateId: r.candidateId,
        about,
        aboutLabel: aboutLabel(about),
        author: r.author ? { email: r.author.email, name: names.get(r.author.id)?.name ?? null } : null,
        authorLabel: r.author ? null : (r.authorLabel ?? 'A former user'),
        authorRole: (r.authorRole as ScreeningAuthorRole | null) ?? null,
        comment: r.text,
        verdict: (r.verdict as ScreeningVerdict | null) ?? null,
        mentions: r.mentions.filter((id) => emailOf.has(id)).map((id) => ({ id, name: names.get(id)?.name ?? emailOf.get(id)!, email: emailOf.get(id)! })),
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        mine: !!r.authorId && r.authorId === c.user.id,
        editableUntil: edits ? editableUntil(r.createdAt).toISOString() : null,
        can: { edit: edits, delete: deletes },
      };
    });
  }

  private async viewOf(id: string, c: RecruitmentCaller): Promise<ScreeningCommentView> {
    const row = await this.prisma.screeningComment.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
    return (await this.views([row], c))[0];
  }

  // ---------- writing ----------

  /** POST /recruitment/comments: a comment on an application, a general CV, or the candidate in general. */
  async add(dto: CommentCreate, user: SessionUser): Promise<ScreeningCommentView> {
    const problems = screeningCommentProblems(dto);
    if (problems.length) throw new BadRequestException(problems);
    const c = await this.caller(user);
    const t = await this.target(c, dto);
    const mentions = await this.checkedMentions(dto.mentions, t.mayRead);
    const made = await this.create(t, { text: dto.comment!.trim(), verdict: dto.verdict ?? null, mentions, role: authorRoleOf(c, t.application) }, user);
    return this.viewOf(made, c);
  }

  /**
   * A first comment by its author on a record (HR's Add a CV: its notes, 24 October 2026), without mentions: on a general
   * CV just made by the caller, who reads it.
   */
  async addFirst(about: { generalCvId: string }, text: string, user: SessionUser): Promise<void> {
    const c = await this.caller(user);
    const t = await this.target(c, about);
    await this.create(t, { text: text.trim().slice(0, 2000), verdict: null, mentions: [], role: authorRoleOf(c, null) }, user);
  }

  private async create(t: Target, w: { text: string; verdict: ScreeningVerdict | null; mentions: string[]; role: ScreeningAuthorRole }, user: SessionUser): Promise<string> {
    const row = await this.prisma.screeningComment.create({
      data: {
        candidateId: t.candidateId,
        applicationId: t.about.kind === 'application' ? t.about.id : null,
        generalCvId: t.about.kind === 'general_cv' ? t.about.id : null,
        authorId: user.id,
        authorRole: w.role,
        text: w.text,
        verdict: w.verdict,
        mentions: w.mentions,
      },
      select: { id: true, candidate: { select: { code: true } } },
    });
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: SCREENING_ENTITY,
      entityId: row.id,
      diff: { candidate: row.candidate.code, about: aboutLabel(t.about), role: w.role, verdict: w.verdict, mentions: w.mentions.length, text: '(text)' },
    });
    await this.tell(w.mentions, t, user);
    return row.id;
  }

  /** Those mentioned told (but the author): in the inbox and on their phone, names only. */
  private async tell(ids: readonly string[], t: Pick<Target, 'candidateId' | 'candidateName' | 'about'>, user: SessionUser): Promise<void> {
    const to = ids.filter((id) => id !== user.id);
    if (!to.length) return;
    const names = await userNames(this.prisma, [{ id: user.id, email: user.email }]);
    const words = mentionNotice(names.get(user.id)?.name ?? user.email, t.candidateName, t.about);
    await this.notifications.notify(to, { kind: 'screening_mention', title: words.title, body: words.body, link: linkOf(t.candidateId, t.about) });
  }

  /** PATCH /recruitment/comments/:id: its author, within 24 hours of writing it; the text, the verdict, the mentions (the new ones told). */
  async edit(id: string, dto: CommentEdit, user: SessionUser, now = new Date()): Promise<ScreeningCommentView> {
    const c = await this.caller(user);
    const row = await this.prisma.screeningComment.findFirst({ where: { AND: [{ id }, commentWhere(c)] }, select: ROW_SELECT });
    if (!row) throw new NotFoundException(NOT_FOUND);
    if (!canEditComment(row, user.id, now)) {
      throw new ForbiddenException(row.authorId === user.id ? 'A comment can be edited for 24 hours after it was written.' : 'Only its author edits a comment.');
    }
    const next = {
      text: dto.comment !== undefined ? dto.comment : row.text,
      verdict: dto.verdict !== undefined ? dto.verdict : (row.verdict as ScreeningVerdict | null),
      mentions: dto.mentions !== undefined ? dto.mentions : row.mentions,
    };
    const problems = screeningCommentProblems({ comment: next.text, verdict: next.verdict, mentions: next.mentions });
    if (problems.length) throw new BadRequestException(problems);
    const t = await this.target(c, row.applicationId ? { applicationId: row.applicationId } : row.generalCvId ? { generalCvId: row.generalCvId } : { candidateId: row.candidateId });
    // those mentioned before stay, whoever may read it now; a new mention must be someone who may
    const added = newlyMentioned(row.mentions, uniqueMentions(next.mentions));
    await this.checkedMentions(added, t.mayRead);
    const mentions = uniqueMentions(next.mentions);
    const text = next.text.trim();
    const changed = [...(text !== row.text ? ['text'] : []), ...(next.verdict !== row.verdict ? ['verdict'] : []), ...(added.length || mentions.length !== row.mentions.length ? ['mentions'] : [])];
    if (!changed.length) return this.viewOf(row.id, c);
    await this.prisma.screeningComment.update({ where: { id }, data: { text, verdict: next.verdict, mentions, editedAt: now } });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: SCREENING_ENTITY,
      entityId: id,
      diff: { about: aboutLabel(aboutOf(row)), changed, ...(changed.includes('verdict') && { verdict: { from: row.verdict, to: next.verdict } }), ...(changed.includes('mentions') && { mentions: mentions.length }) },
    });
    await this.tell(added, t, user);
    return this.viewOf(id, c);
  }

  /** DELETE /recruitment/comments/:id: a Super Admin only. */
  async remove(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const row = await this.prisma.screeningComment.findUnique({ where: { id }, select: { ...ROW_SELECT, candidate: { select: { code: true } } } });
    if (!row) throw new NotFoundException(NOT_FOUND);
    await this.prisma.screeningComment.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: SCREENING_ENTITY,
      entityId: id,
      diff: { candidate: row.candidate.code, about: aboutLabel(aboutOf(row)), author: row.author?.email ?? row.authorLabel, verdict: row.verdict, writtenAt: row.createdAt.toISOString() },
    });
  }

  /** HR's notes of before moved into first comments (the candidates' sweep runs it; the tests call it). */
  moveEarlierNotes(): Promise<{ applications: number; generalCvs: number }> {
    return moveEarlierNotes(this.prisma, this.audit);
  }

  // ---------- the latest verdicts, for the lists ----------

  /** The latest verdict of each application given: from its own comments. */
  async applicationVerdicts(ids: readonly string[]): Promise<Map<string, ScreeningVerdict>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.screeningComment.findMany({ where: { applicationId: { in: [...ids] }, verdict: { not: null } }, select: { id: true, applicationId: true, verdict: true, createdAt: true } });
    return applicationVerdicts(rows);
  }

  /** The latest verdict of each general CV given: from its own comments. */
  async generalCvVerdicts(ids: readonly string[]): Promise<Map<string, ScreeningVerdict>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.screeningComment.findMany({ where: { generalCvId: { in: [...ids] }, verdict: { not: null } }, select: { id: true, generalCvId: true, verdict: true, createdAt: true } });
    return latestVerdictsBy(rows, (r) => r.generalCvId);
  }

  /** The latest verdict of each candidate given, across the comments the caller (HR, the CEO, a Super Admin) may read. */
  async candidateVerdicts(ids: readonly string[] | null, user: SessionUser): Promise<Map<string, ScreeningVerdict>> {
    if (ids && !ids.length) return new Map();
    const rows = await this.prisma.screeningComment.findMany({
      where: { AND: [ids ? { candidateId: { in: [...ids] } } : {}, { verdict: { not: null } }, commentWhere(recruitmentCaller(user, null))] },
      select: { id: true, candidateId: true, verdict: true, createdAt: true },
    });
    return candidateVerdicts(rows);
  }

  /** ?verdict= on the applicants' list: those whose latest is it, or (none) those without one. */
  async applicationVerdictWhere(filter: VerdictFilter | undefined): Promise<Prisma.JobApplicationWhereInput> {
    if (!filter) return {};
    const rows = await this.prisma.screeningComment.findMany({ where: { applicationId: { not: null }, verdict: { not: null } }, select: { id: true, applicationId: true, verdict: true, createdAt: true } });
    return byVerdict(applicationVerdicts(rows), filter);
  }

  /** ?verdict= on the general CVs' list. */
  async generalCvVerdictWhere(filter: VerdictFilter | undefined): Promise<Prisma.GeneralCvWhereInput> {
    if (!filter) return {};
    const rows = await this.prisma.screeningComment.findMany({ where: { generalCvId: { not: null }, verdict: { not: null } }, select: { id: true, generalCvId: true, verdict: true, createdAt: true } });
    return byVerdict(
      latestVerdictsBy(rows, (r) => r.generalCvId),
      filter,
    );
  }

  /** ?verdict= on the Candidates list: by the latest across what the caller may read. */
  async candidateVerdictWhere(filter: VerdictFilter | undefined, user: SessionUser): Promise<Prisma.CandidateWhereInput> {
    if (!filter) return {};
    return byVerdict(await this.candidateVerdicts(null, user), filter);
  }

  // ---------- the profile's timeline ----------

  /** A line for each comment the caller may read: "Screening comment (Good fit): APP-2026-0001 · Video Editor". Names never in it. */
  async timeline(candidateId: string, user: SessionUser): Promise<CandidateTimelineItem[]> {
    const rows = await this.prisma.screeningComment.findMany({ where: { AND: [{ candidateId }, commentWhere(recruitmentCaller(user, null))] }, select: ROW_SELECT });
    return rows.map((r) => {
      const about = aboutOf(r);
      const verdict = r.verdict && r.verdict in SCREENING_VERDICT_LABELS ? ` (${SCREENING_VERDICT_LABELS[r.verdict as ScreeningVerdict]})` : '';
      return {
        at: r.createdAt.toISOString(),
        kind: 'comment',
        text: `Screening comment${verdict}: ${aboutLabel(about)}`,
        href: about.kind === 'application' ? `/recruitment/applicants/${about.id}` : about.kind === 'general_cv' ? `/recruitment/general-cvs/${about.id}` : null,
      };
    });
  }
}

/** The records whose latest verdict passes the filter: those with it, or (none) all but those with one. */
function byVerdict(latest: ReadonlyMap<string, ScreeningVerdict>, filter: VerdictFilter): { id: { in: string[] } | { notIn: string[] } } {
  if (filter === 'none') return { id: { notIn: [...latest.keys()] } };
  return { id: { in: [...latest].filter(([, v]) => v === filter).map(([k]) => k) } };
}
