import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STAGES,
  GENERAL_CV_IP_TOKEN,
  GENERAL_CV_LIMITS,
  GENERAL_CV_SOURCE_LABELS,
  generalAreas,
  generalCvProblems,
  isGeneralCvSource,
  isGeneralCvStatus,
  keptMobile,
  mobileSearchForms,
  moveProblem,
  normalEmail,
  RECRUITMENT_LIMITS,
  tidyNotice,
  webLinkOf,
  withinDays,
  type ApplicantsSummary,
  type ApplicationStage,
  type GeneralArea,
  type GeneralCvInput,
  type GeneralCvListItem,
  type GeneralCvSource,
  type GeneralCvStatus,
  type GeneralCvView,
  type MoveStage,
  type PublicGeneralForm,
  type VacancyApplicantsGroup,
  type VacancyStatus,
} from '@trendlix/shared';
import { verifySignedIp } from '../attendance/signed-ip.js';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { dayInCairo, shownDate, todayInCairo } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextApplicationNumber } from './application-numbers.js';
import { attachCandidate, findCandidates, foundIds, lockCandidates, refreshCandidate } from './candidate-links.js';
import { cvFileName, cvProblem, cvTypeOf } from './cv-file.js';
import { CvReadingsService } from './cv-readings.service.js';
import { createHrApplication } from './hr-applications.js';
import type { ApplyOrigin } from './public-careers.service.js';
import { managesRecruitment, READS, vacancyWhere } from './recruitment-access.js';
import { APPLICATION_ENTITY, cvListFactsOf, minYearsWhere, money, skillWhere, userRef } from './recruitment-views.js';
import type { AddGeneralCvDto, GeneralCvFormDto, ListGeneralCvsDto, MoveGeneralCvDto } from './recruitment.dto.js';

// General CVs (owner, 22 October 2026: "i want a proper viweing, what came out of the posted jobs and what cam on
// randomly"; "Both"; packages/shared general-cvs.ts): "Send us your CV" on the careers page, with the same protections as
// an application (the field robots fill, a limit an hour from an address trusted only when the website signed it, a cap
// an hour in all) and one CV an email every 30 days; HR's Add a CV (from email, WhatsApp, LinkedIn, in person, a referral
// or other), the person's agreement ticked by HR and kept with who and when. HR, the CEO and a Super Admin read them; HR
// and a Super Admin mark them reviewed, archive and restore them, note on them and move one to a vacancy (an application
// made from it, keeping its reference). Each step in its history and the audit log. HR is told of the careers page's new
// CVs once a day. Also the Applicants page's summary: the two tabs' counts and each vacancy's applicants by stage and
// source (the posted links apart from the careers page reached directly).

export const GENERAL_CV_ENTITY = 'general_cv';

const NOT_FOUND = 'CV not found.';
const NOT_SENT = "Your CV couldn't be sent. Please try again.";
const LIST_CAP = 1000;
const HOUR = 60 * 60 * 1000;

const LIST_SELECT = {
  id: true,
  number: true,
  fullName: true,
  email: true,
  mobile: true,
  yearsExperience: true,
  departmentId: true,
  department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  areaOther: true,
  source: true,
  referrer: true,
  status: true,
  createdAt: true,
  createdBy: { select: { id: true, email: true } },
  application: { select: { id: true, number: true, vacancy: { select: { id: true, title: true } } } },
  // the CV's reading, for the Experience and Latest role columns (24 October 2026)
  file: { select: { sizeBytes: true } },
  cvReading: { select: { status: true, facts: true } },
} satisfies Prisma.GeneralCvSelect;

type ListRow = Prisma.GeneralCvGetPayload<{ select: typeof LIST_SELECT }>;

const DETAIL_INCLUDE = {
  department: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  createdBy: { select: { id: true, email: true } },
  consentBy: { select: { id: true, email: true } },
  application: { select: { id: true, number: true, vacancy: { select: { id: true, title: true } } } },
  file: { select: { fileName: true, mimeType: true, sizeBytes: true } },
  // the CV read and analysed (22 October 2026)
  cvReading: { select: { status: true, method: true, readAt: true, facts: true, text: true } },
  events: { orderBy: { at: 'asc' }, include: { by: { select: { id: true, email: true } } } },
} satisfies Prisma.GeneralCvInclude;

/** A form field as text: trimmed, single-spaced, empty as null. */
const text = (v: string | undefined | null): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null);
/** A form field as a number: empty as null, anything else that isn't a number as NaN (refused by the rules). */
const numberOf = (v: string | number | undefined | null): number | null => {
  if (typeof v === 'number') return v;
  const t = text(v);
  return t === null ? null : Number(t.replace(/,/g, ''));
};

/** The address a general CV counts against in the hourly limit: one the website signed for the general form (as an application's). */
function senderIp(named: string | null, origin: ApplyOrigin, key: string | undefined = process.env.WEB_KEY): string | null {
  const signed = verifySignedIp(origin.headers ?? {}, GENERAL_CV_IP_TOKEN, key, Date.now());
  if (signed.ip) return signed.ip;
  return signed.problem === 'no_server_key' ? (named ?? origin.ip) : origin.ip;
}

/** A team as an area: "Video · Production"; a department as itself. */
const areaName = (d: { nameEn: string; parent?: { nameEn: string } | null }) => (d.parent ? `${d.nameEn} · ${d.parent.nameEn}` : d.nameEn);

const areaOf = (r: { department: { nameEn: string; parent?: { nameEn: string } | null } | null; areaOther: string | null }) =>
  r.department ? areaName(r.department) : (r.areaOther ?? 'Other');

/** C-level (owner, 22 October 2026: "C Level isn't an option for any user or even HR"): every job title for a confidential grade, as G9 Executive. */
const cLevel = (titles: readonly { minGrade: { confidential: boolean } | null }[]) => titles.length > 0 && titles.every((t) => t.minGrade?.confidential === true);

/**
 * The areas a CV may be for, in the organisation's order (generalAreas in packages/shared general-cvs.ts; owner, 22
 * October 2026: "remove the department from the dropdown menu, area you would like to work in"): each team by its own
 * name, a department only when it has no teams, never a C-level one (cLevel: a department whose job titles, its teams'
 * too, are all for a confidential grade is left out with its teams, and so is such a team). The careers page's list,
 * and the only ones taken from it, from HR's Add a CV and from the bulk upload.
 */
export async function areasOf(prisma: PrismaService): Promise<GeneralArea[]> {
  const titles = { select: { minGrade: { select: { confidential: true } } } } as const;
  const order = [{ sortOrder: 'asc' as const }, { nameEn: 'asc' as const }];
  const rows = await prisma.department.findMany({
    where: { parentId: null },
    orderBy: order,
    select: { id: true, nameEn: true, jobTitles: titles, children: { orderBy: order, select: { id: true, nameEn: true, jobTitles: titles } } },
  });
  return generalAreas(
    rows.map((d) => ({
      id: d.id,
      name: d.nameEn,
      cLevel: cLevel([...d.jobTitles, ...d.children.flatMap((t) => t.jobTitles)]),
      teams: d.children.map((t) => ({ id: t.id, name: t.nameEn, cLevel: cLevel(t.jobTitles) })),
    })),
  );
}

/** Whether an id is one of the areas a CV may be for (areasOf). */
export async function isArea(prisma: PrismaService, departmentId: string): Promise<boolean> {
  return /^[0-9a-f-]{36}$/i.test(departmentId) && (await areasOf(prisma)).some((a) => a.id === departmentId);
}

@Injectable()
export class GeneralCvsService {
  private readonly logger = new Logger('GeneralCvs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly readings: CvReadingsService,
  ) {}

  // ---------- the careers page ----------

  /** The general form: the company, and the areas to choose from (areasOf). */
  async publicForm(): Promise<PublicGeneralForm> {
    const [company, areas] = await Promise.all([this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true, nameAr: true } }), areasOf(this.prisma)]);
    return { company: { nameEn: company?.nameEn ?? '', nameAr: company?.nameAr ?? null }, areas };
  }

  /**
   * "Send us your CV" (a multipart form with the CV as `cv`). Refused: the field robots fill (400), too many from the
   * address this hour, or in all (429), the form's problems in words (400), the CV's (400), a CV from the email in the
   * last 30 days (409). Answers its reference.
   */
  async send(dto: GeneralCvFormDto, file: Express.Multer.File | undefined, origin: ApplyOrigin): Promise<{ reference: string }> {
    if (text(dto.website)) throw new BadRequestException([NOT_SENT]);
    const ip = senderIp(text(dto.ip), origin);
    const since = new Date(Date.now() - HOUR);
    if (ip && (await this.prisma.generalCv.count({ where: { ip, createdAt: { gte: since } } })) >= RECRUITMENT_LIMITS.applyPerHour) {
      throw new HttpException('You have sent several CVs in the last hour. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((await this.prisma.generalCv.count({ where: { source: 'careers', createdAt: { gte: since } } })) >= GENERAL_CV_LIMITS.perHour) {
      throw new HttpException('We have had many CVs in the last hour. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const input = this.inputOf(dto);
    const problems = generalCvProblems(input, { byHr: false });
    const cvSaid = cvProblem(file);
    if (cvSaid) problems.push(cvSaid);
    problems.push(...(await this.areaProblems(input.departmentId)));
    if (problems.length) throw new BadRequestException(problems);
    const email = normalEmail(input.email);
    const userAgent = (text(dto.userAgent) ?? origin.userAgent)?.slice(0, 500) ?? null;
    // one CV every 30 days by the same person: their email, or their candidate (candidate profiles, 22 October 2026)
    const made = await this.create(input, file!, { source: 'careers', consentById: null, consentNote: null, createdById: null, ip, userAgent, note: null }, (recent) =>
      new ConflictException(`You sent us your CV on ${shownDate(dayInCairo(recent.createdAt))} already. HR will be in touch.`),
    );
    await this.audit.record({ userId: null, action: 'apply', entityType: GENERAL_CV_ENTITY, entityId: made.id, diff: { number: made.number, source: 'careers', area: made.area, candidate: made.candidate } });
    await this.tellHr();
    await this.confirm(email, input.fullName, made.number);
    return { reference: made.number };
  }

  // ---------- HR ----------

  /** Add a CV (HR, a Super Admin): one that came by email, WhatsApp, LinkedIn, in person, a referral or other, the person's agreement ticked. */
  async add(dto: AddGeneralCvDto, file: Express.Multer.File | undefined, user: SessionUser): Promise<GeneralCvView> {
    this.assertManages(user);
    const input = this.inputOf(dto);
    const problems = generalCvProblems(input, { byHr: true });
    const cvSaid = cvProblem(file);
    if (cvSaid) problems.push(cvSaid.replace('your CV', 'the CV').replace('Your CV', 'The CV'));
    problems.push(...(await this.areaProblems(input.departmentId)));
    if (problems.length) throw new BadRequestException(problems);
    const email = normalEmail(input.email);
    const source = input.source as GeneralCvSource;
    const made = await this.create(
      input,
      file!,
      {
        source,
        consentById: user.id,
        consentNote: 'Agreed to be considered (recorded by HR)',
        createdById: user.id,
        ip: null,
        userAgent: null,
        note: `Added by HR (${GENERAL_CV_SOURCE_LABELS[source]})`,
      },
      (recent) =>
        new ConflictException(
          recent.email === email
            ? `${email} sent a CV on ${shownDate(dayInCairo(recent.createdAt))} already (${recent.number}): open it instead.`
            : `The same person (by their mobile) sent a CV on ${shownDate(dayInCairo(recent.createdAt))} already (${recent.number}): open it instead.`,
        ),
    );
    await this.audit.record({ userId: user.id, action: 'create', entityType: GENERAL_CV_ENTITY, entityId: made.id, diff: { number: made.number, source, area: made.area, candidate: made.candidate } });
    return this.get(made.id, user);
  }

  /**
   * The general CVs: ?status= (a status, or all; none: all but archived), ?source=, ?departmentId=, ?q= (name, email,
   * mobile, reference, the CV's text), ?minYears= (the years typed, else the CV's) and ?skill= (24 October 2026).
   */
  async list(query: ListGeneralCvsDto, user: SessionUser): Promise<GeneralCvListItem[]> {
    this.assertReads(user);
    const q = query.q ? { contains: query.q, mode: 'insensitive' as const } : null;
    const rows = await this.prisma.generalCv.findMany({
      where: {
        AND: [
          query.status === 'all' ? {} : query.status ? { status: query.status } : { status: { not: 'archived' } },
          query.source ? { source: query.source } : {},
          query.departmentId ? { departmentId: query.departmentId } : {},
          // the years typed, else the CV's, and a skill of the dictionary the CV names (owner, 24 October 2026: "why isn't
          // the experience pulled off the CV?")
          query.minYears !== undefined ? minYearsWhere(query.minYears) : {},
          query.skill ? skillWhere(query.skill) : {},
          // the search also looks in the CVs' text (22 October 2026), and a mobile as typed in any form (+20…, 010…)
          q
            ? { OR: [{ fullName: q }, { email: q }, { mobile: q }, ...mobileSearchForms(query.q!).map((f) => ({ mobile: { contains: f } })), { number: q }, { cvReading: { is: { text: q } } }] }
            : {},
        ],
      },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: LIST_CAP,
    });
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    return rows.map((r) => this.listItem(r, names));
  }

  async get(id: string, user: SessionUser): Promise<GeneralCvView> {
    this.assertReads(user);
    const r = await this.prisma.generalCv.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!r) throw new NotFoundException(NOT_FOUND);
    const names = await userNames(this.prisma, [r.createdBy, r.consentBy, ...r.events.map((e) => e.by)]);
    const status = r.status as GeneralCvStatus;
    const manages = managesRecruitment(user);
    return {
      ...this.listItem(r, names),
      linkedin: r.linkedin,
      portfolio: r.portfolio,
      noticePeriod: r.noticePeriod,
      expectedSalary: money(r.expectedSalary),
      areaOther: r.areaOther,
      notes: r.notes,
      consentAt: r.consentAt.toISOString(),
      consentBy: userRef(r.consentBy, names),
      consentNote: r.consentNote,
      cv: r.file,
      cvReading: r.file ? this.readings.view(r.cvReading, null) : null,
      history: r.events.map((e) => ({ event: e.event, note: e.note, by: userRef(e.by, names), at: e.at.toISOString() })),
      can: {
        review: manages && status === 'new',
        archive: manages && (status === 'new' || status === 'reviewed'),
        restore: manages && status === 'archived',
        move: manages && moveProblem(status) === null,
        editNotes: manages,
      },
    };
  }

  /** The CV as sent. */
  async file(id: string, user: SessionUser): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
    this.assertReads(user);
    const f = await this.prisma.generalCvFile.findUnique({ where: { generalCvId: id }, select: { fileName: true, mimeType: true, data: true } });
    if (!f) throw new NotFoundException(NOT_FOUND);
    return { fileName: f.fileName, mimeType: f.mimeType, data: Buffer.from(f.data) };
  }

  /** Reviewed (from new), archived (new or reviewed), restored (archived: reviewed again). */
  async setStatus(id: string, action: 'review' | 'archive' | 'restore', user: SessionUser): Promise<GeneralCvView> {
    this.assertManages(user);
    const from: Record<typeof action, GeneralCvStatus[]> = { review: ['new'], archive: ['new', 'reviewed'], restore: ['archived'] };
    const to: Record<typeof action, GeneralCvStatus> = { review: 'reviewed', archive: 'archived', restore: 'reviewed' };
    const event = { review: 'reviewed', archive: 'archived', restore: 'restored' }[action];
    const r = await this.prisma.generalCv.findUnique({ where: { id }, select: { number: true, status: true } });
    if (!r) throw new NotFoundException(NOT_FOUND);
    const { count } = await this.prisma.generalCv.updateMany({ where: { id, status: { in: from[action] } }, data: { status: to[action] } });
    if (!count) {
      const said = r.status === 'moved' ? 'It was moved to a vacancy.' : r.status === 'archived' ? 'It is archived: restore it first.' : `It is ${r.status} already.`;
      throw new ConflictException(said);
    }
    await this.prisma.generalCvEvent.create({ data: { generalCvId: id, event, byId: user.id } });
    await this.audit.record({ userId: user.id, action, entityType: GENERAL_CV_ENTITY, entityId: id, diff: { number: r.number, status: { from: r.status, to: to[action] } } });
    return this.get(id, user);
  }

  async notes(id: string, notes: string | null | undefined, user: SessionUser): Promise<GeneralCvView> {
    this.assertManages(user);
    const r = await this.prisma.generalCv.findUnique({ where: { id }, select: { number: true, notes: true } });
    if (!r) throw new NotFoundException(NOT_FOUND);
    const next = text(notes ?? null);
    if (next !== r.notes) {
      await this.prisma.generalCv.update({ where: { id }, data: { notes: next } });
      await this.audit.record({ userId: user.id, action: 'notes', entityType: GENERAL_CV_ENTITY, entityId: id, diff: { number: r.number, notes: { from: r.notes, to: next } } });
    }
    return this.get(id, user);
  }

  /**
   * Add to a vacancy: an application on it made from the general CV (open or on hold, one the caller sees), at Applied or
   * Shortlisted, keeping its reference, its CV copied, source "General CV (<where it came from>)"; the general CV marked
   * moved and linked to it. 409 when that email applied for the vacancy already, or it was moved or archived meanwhile.
   */
  async move(id: string, dto: MoveGeneralCvDto, user: SessionUser): Promise<GeneralCvView> {
    this.assertManages(user);
    const v = await this.prisma.vacancy.findFirst({ where: { AND: [{ id: dto.vacancyId }, vacancyWhere(user)] }, select: { id: true, number: true, title: true, status: true } });
    if (!v) throw new NotFoundException('Vacancy not found.');
    if (v.status !== 'open' && v.status !== 'on_hold') throw new BadRequestException(['Choose an open vacancy (or one on hold).']);
    const stage: MoveStage = dto.stage ?? 'applied';
    const done = await this.prisma.$transaction(async (tx) => {
      // the candidates' lock before any row's (candidate-links.ts: never a deadlock with a merge)
      await lockCandidates(tx);
      await tx.$queryRaw`SELECT id FROM general_cvs WHERE id = ${id}::uuid FOR UPDATE`;
      const r = await tx.generalCv.findUnique({ where: { id }, include: { file: true } });
      if (!r) throw new NotFoundException(NOT_FOUND);
      const problem = moveProblem(r.status as GeneralCvStatus);
      if (problem) throw new ConflictException(problem);
      if (!r.file) throw new ConflictException('Its CV is missing, so it can’t be moved.');
      const source = (isGeneralCvSource(r.source) ? r.source : 'other') as GeneralCvSource;
      const app = await createHrApplication(tx, {
        number: r.number,
        vacancyId: v.id,
        stage,
        fullName: r.fullName,
        email: r.email,
        mobile: r.mobile,
        linkedin: r.linkedin,
        portfolio: r.portfolio,
        yearsExperience: r.yearsExperience,
        noticePeriod: r.noticePeriod,
        expectedSalary: r.expectedSalary,
        source: 'general',
        consentAt: r.consentAt,
        consentById: r.consentById,
        consentNote: `From general CV ${r.number}`,
        cv: { fileName: r.file.fileName, mimeType: r.file.mimeType, sizeBytes: r.file.sizeBytes, data: r.file.data },
        note: `Moved from a general CV (${GENERAL_CV_SOURCE_LABELS[source]})`,
        byId: user.id,
        // the general CV's candidate: a general CV then an application, one candidate (22 October 2026)
        candidateId: r.candidateId,
        sentAt: r.createdAt,
      });
      // its CV's reading goes with it, so it isn't read again (22 October 2026)
      await this.readings.carry(tx, { generalCvId: id }, { applicationId: app.id });
      await tx.generalCv.update({ where: { id }, data: { status: 'moved', applicationId: app.id, movedAt: new Date() } });
      await tx.generalCvEvent.create({ data: { generalCvId: id, event: 'moved', note: `${v.title} (${v.number}), at ${stage === 'applied' ? 'Applied' : 'Shortlisted'}`, byId: user.id } });
      return { app, number: r.number };
    });
    await this.readings.rescoreApplication(done.app.id);
    this.readings.kick();
    await this.audit.record({ userId: user.id, action: 'move_to_vacancy', entityType: GENERAL_CV_ENTITY, entityId: id, diff: { number: done.number, vacancy: v.number, stage } });
    await this.audit.record({ userId: user.id, action: 'create', entityType: APPLICATION_ENTITY, entityId: done.app.id, diff: { number: done.app.number, vacancy: v.number, source: 'general', stage, from: 'general CV' } });
    return this.get(id, user);
  }

  /** The CV's text and the contacts found in it (HR, the CEO, a Super Admin; never a developer: the route refuses them). */
  async cvText(id: string, user: SessionUser) {
    this.assertReads(user);
    if (!(await this.prisma.generalCv.count({ where: { id } }))) throw new NotFoundException(NOT_FOUND);
    const t = await this.readings.textOf({ generalCvId: id });
    if (!t) throw new NotFoundException('This CV hasn’t been read yet.');
    return t;
  }

  /** The Applicants page's summary: the two tabs' counts, and each vacancy's applicants by stage and source. */
  async summary(user: SessionUser): Promise<ApplicantsSummary> {
    this.assertReads(user);
    const visible: Prisma.JobApplicationWhereInput = { vacancy: vacancyWhere(user) };
    const [posted, general, generalNew, groups, vacancies] = await Promise.all([
      this.prisma.jobApplication.count({ where: { AND: [visible, { filteredOut: false }] } }),
      this.prisma.generalCv.count({ where: { status: { not: 'archived' } } }),
      this.prisma.generalCv.count({ where: { status: 'new' } }),
      this.prisma.jobApplication.groupBy({ by: ['vacancyId', 'stage', 'source', 'filteredOut'], where: visible, _count: { _all: true } }),
      this.prisma.vacancy.findMany({ where: { AND: [vacancyWhere(user), { applications: { some: {} } }] }, select: { id: true, number: true, title: true, status: true, publishedAt: true } }),
    ]);
    const byId = new Map<string, VacancyApplicantsGroup>();
    for (const v of vacancies) {
      byId.set(v.id, {
        vacancy: { id: v.id, number: v.number, title: v.title, status: v.status as VacancyStatus },
        total: 0,
        byStage: Object.fromEntries(APPLICATION_STAGES.map((s) => [s, 0])) as Record<ApplicationStage, number>,
        filteredOut: 0,
        bySource: {},
      });
    }
    for (const g of groups) {
      const group = byId.get(g.vacancyId);
      if (!group) continue;
      const n = g._count._all;
      group.total += n;
      if (g.filteredOut) group.filteredOut += n;
      else group.byStage[g.stage as ApplicationStage] += n;
      group.bySource[g.source] = (group.bySource[g.source] ?? 0) + n;
    }
    const order = ['open', 'on_hold', 'closed', 'filled', 'pending', 'draft'];
    const published = new Map(vacancies.map((v) => [v.id, v.publishedAt?.getTime() ?? 0]));
    const sorted = [...byId.values()].sort(
      (a, b) => order.indexOf(a.vacancy.status) - order.indexOf(b.vacancy.status) || (published.get(b.vacancy.id) ?? 0) - (published.get(a.vacancy.id) ?? 0),
    );
    return { posted, general, generalNew, vacancies: sorted };
  }

  // ---------- helpers ----------

  private assertReads(user: SessionUser): void {
    if (!user.roles.some((r) => READS.includes(r))) throw new ForbiddenException('Only HR, the CEO and a Super Admin see the CVs.');
  }

  private assertManages(user: SessionUser): void {
    if (!managesRecruitment(user)) throw new ForbiddenException('Only HR and a Super Admin add or change the CVs.');
  }

  private inputOf(dto: GeneralCvFormDto | AddGeneralCvDto): GeneralCvInput {
    const hr = dto as AddGeneralCvDto;
    return {
      fullName: text(dto.fullName) ?? '',
      email: dto.email ?? '',
      // kept as the system keeps phones, +201012345678 (22 October 2026); the rule refuses one that isn't a number
      mobile: keptMobile(dto.mobile),
      linkedin: webLinkOf(dto.linkedin) || null,
      portfolio: webLinkOf(dto.portfolio) || null,
      yearsExperience: numberOf(dto.yearsExperience),
      // "30 days", "2 months" (22 October 2026)
      noticePeriod: tidyNotice(dto.noticePeriod),
      expectedSalary: numberOf(dto.expectedSalary),
      departmentId: text(dto.departmentId),
      areaOther: text(dto.departmentId) ? null : text(dto.areaOther),
      consent: dto.consent === 'true' || dto.consent === 'on',
      source: text(hr.source),
      referrer: text(hr.referrer),
      notes: text(hr.notes),
    };
  }

  /** The area chosen, when one is: one of areasOf (a team, or a department without teams; never a C-level one). */
  private async areaProblems(departmentId: string | null | undefined): Promise<string[]> {
    if (!departmentId) return [];
    return (await isArea(this.prisma, departmentId)) ? [] : ['Choose one of the areas, or Other and write it.'];
  }

  /** A general CV in the last 30 days from the email, or from the same person (their candidate, by email or mobile; 22 October 2026). */
  private async recent(db: Prisma.TransactionClient, email: string, candidateIds: readonly string[]) {
    const since = new Date(Date.now() - GENERAL_CV_LIMITS.perEmailDays * 24 * HOUR);
    const r = await db.generalCv.findFirst({
      where: { createdAt: { gte: since }, OR: [{ email }, ...(candidateIds.length ? [{ candidateId: { in: [...candidateIds] } }] : [])] },
      orderBy: { createdAt: 'desc' },
      select: { number: true, createdAt: true, email: true },
    });
    return r && withinDays(r.createdAt, GENERAL_CV_LIMITS.perEmailDays) ? r : null;
  }

  /**
   * The general CV made, with its candidate (candidate profiles, 22 October 2026: the email's, else the mobile's, else a
   * new one): the candidates' lock first; one from the same person in the last 30 days refused with `refuseRecent`'s
   * error.
   */
  private async create(
    input: GeneralCvInput,
    file: Express.Multer.File,
    how: { source: GeneralCvSource; consentById: string | null; consentNote: string | null; createdById: string | null; ip: string | null; userAgent: string | null; note: string | null },
    refuseRecent: (recent: { number: string; createdAt: Date; email: string }) => Error,
  ): Promise<{ id: string; number: string; area: string; candidate: string }> {
    const type = cvTypeOf(file.buffer)!;
    return this.prisma.$transaction(async (tx) => {
      const email = normalEmail(input.email);
      const found = await findCandidates(tx, { email, mobile: input.mobile });
      const recent = await this.recent(tx, email, foundIds(found));
      if (recent) throw refuseRecent(recent);
      const candidate = await attachCandidate(tx, { fullName: input.fullName, email, mobile: input.mobile, linkedin: input.linkedin ?? null, portfolio: input.portfolio ?? null }, found);
      const number = await nextApplicationNumber(tx);
      const row = await tx.generalCv.create({
        data: {
          number,
          candidateId: candidate.id,
          fullName: input.fullName.trim().replace(/\s+/g, ' '),
          email: normalEmail(input.email),
          mobile: input.mobile,
          linkedin: input.linkedin ?? null,
          portfolio: input.portfolio ?? null,
          yearsExperience: input.yearsExperience ?? null,
          noticePeriod: input.noticePeriod ?? null,
          expectedSalary: input.expectedSalary ?? null,
          departmentId: input.departmentId ?? null,
          areaOther: input.departmentId ? null : (input.areaOther ?? null),
          source: how.source,
          referrer: how.source === 'referral' ? (input.referrer ?? null) : null,
          notes: input.notes ?? null,
          consentAt: new Date(),
          consentById: how.consentById,
          consentNote: how.consentNote,
          ip: how.ip,
          userAgent: how.userAgent,
          createdById: how.createdById,
          file: { create: { fileName: cvFileName(file.originalname, type), mimeType: type, sizeBytes: file.buffer.length, data: new Uint8Array(file.buffer) } },
          events: { create: { event: 'received', note: how.note, byId: how.createdById } },
        },
        select: { id: true, number: true, department: { select: { nameEn: true } }, areaOther: true },
      });
      await refreshCandidate(tx, candidate.id);
      return { id: row.id, number: row.number, area: areaOf(row), candidate: candidate.code };
    }).finally(() => this.readings.kick());
  }

  private listItem(r: ListRow, names: ReadonlyMap<string, { name: string }>): GeneralCvListItem {
    return {
      id: r.id,
      number: r.number,
      fullName: r.fullName,
      email: r.email,
      mobile: r.mobile,
      yearsExperience: money(r.yearsExperience),
      area: areaOf(r),
      departmentId: r.departmentId,
      source: (isGeneralCvSource(r.source) ? r.source : 'other') as GeneralCvSource,
      referrer: r.referrer,
      status: (isGeneralCvStatus(r.status) ? r.status : 'new') as GeneralCvStatus,
      receivedAt: r.createdAt.toISOString(),
      addedBy: userRef(r.createdBy, names),
      movedTo: r.application ? { applicationId: r.application.id, reference: r.application.number, vacancyId: r.application.vacancy.id, vacancyTitle: r.application.vacancy.title } : null,
      fromCv: cvListFactsOf(!!r.file, r.cvReading),
    };
  }

  /** HR told of the careers page's new CVs, once a day. Never fails the CV. */
  private async tellHr(): Promise<void> {
    try {
      const link = '/recruitment/applicants?tab=general';
      const last = await this.prisma.notification.findFirst({ where: { kind: 'applications_new', link }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (last && dayInCairo(last.createdAt) === todayInCairo()) return;
      const users = await this.prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { key: 'hr' } } } }, select: { id: true } });
      await this.notifications.notify(
        users.map((u) => u.id),
        { kind: 'applications_new', title: 'New CVs', body: 'CVs sent on the careers page without a job: open General CVs to review them.', link },
      );
    } catch (err) {
      this.logger.warn(`Telling HR of new CVs failed: ${(err as Error).message}`);
    }
  }

  /** The person's email with their reference, when email is set up (best effort). */
  private async confirm(to: string, name: string, reference: string): Promise<void> {
    if (!(await this.mail.ready())) return;
    try {
      const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } });
      const from = company?.nameEn || 'the company';
      const first = name.trim().split(/\s+/)[0] ?? '';
      const lines = [
        `Dear ${first},`,
        '',
        `Thank you for sending us your CV. We received it; its reference is ${reference}.`,
        'When a job opens that fits what you do, we will contact you.',
        '',
        `${from} HR`,
      ];
      const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await this.mail.send({ to, subject: `Your CV (${reference})`, text: lines.join('\n'), html: lines.map((l) => (l ? `<p>${escape(l)}</p>` : '')).join('') });
    } catch (err) {
      this.logger.warn(`The confirmation of ${reference} could not be sent: ${(err as Error).message}`);
    }
  }
}
