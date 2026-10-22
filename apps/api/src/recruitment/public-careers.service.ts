import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  applicationNumber,
  applyProblems,
  isVacancySlug,
  normalEmail,
  publicQuestionOf,
  RECRUITMENT_LIMITS,
  careersIpToken,
  scoreAnswers,
  sourceOf,
  takesApplications,
  tidyAnswers,
  type ApplyInput,
  type ApplyResult,
  type PublicCareers,
  type PublicVacancyView,
} from '@trendlix/shared';
import { verifySignedIp } from '../attendance/signed-ip.js';
import { AuditService } from '../audit/audit.service.js';
import { dayInCairo, fromDateOnly, shownDate, todayInCairo, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cvFileName, cvProblem, cvTypeOf } from './cv-file.js';
import { APPLICATION_ENTITY, publicSummaryOf, questionsOf } from './recruitment-views.js';
import type { ApplyDto } from './recruitment.dto.js';

// The careers page (owner, 22 October 2026: "where will we include the ATS?"; at people.trendlix.com/careers: "i dont
// know how to decide it for now"), without signing in: the open vacancies (approved by the CEO, their closing date not
// passed), a job's page with what its form asks (never the points, the must-have rules or the salary range), and the
// application itself, with the CV. Protected by a field people never see (a form that fills it is a robot's), a limit
// of applications an hour from one address, and one application per email a vacancy. HR is told of new applications
// once a day a vacancy; the applicant gets an email with the reference when email is set up.

const NOT_OPEN = 'This job is no longer open.';
const NOT_FOUND = 'Job not found.';
const NOT_SENT = "Your application couldn't be sent. Please try again.";

/** The vacancies the careers page shows on `today`: open, not past their closing date. */
const openOn = (today: string): Prisma.VacancyWhereInput => ({ status: 'open', OR: [{ closingDate: null }, { closingDate: { gte: toDateOnly(today) } }] });

const PUBLIC_SELECT = {
  id: true,
  number: true,
  slug: true,
  title: true,
  status: true,
  department: { select: { nameEn: true } },
  employmentType: true,
  workArrangement: true,
  closingDate: true,
  publishedAt: true,
  about: true,
  responsibilities: true,
  requirements: true,
  questions: true,
  grade: { select: { confidential: true } },
  jobTitle: { select: { minGrade: { select: { confidential: true } } } },
} satisfies Prisma.VacancySelect;

/** Where the application came from, as the website saw it. */
export interface ApplyOrigin {
  /** The connection's address (the website's, for an application sent through it). */
  ip: string | null;
  userAgent: string | null;
  /** The request's headers: the address the website signed, if any. */
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * The address an application counts against in the hourly limit (22 October 2026). Only one the website signed with
 * WEB_KEY for this job is trusted (attendance/signed-ip.ts): with the key on the server, an address merely named in the
 * form is ignored and the connection's counts, so nobody posting to the API directly gets round the limit by naming
 * another address each time. Without the key on the server yet (deploy/web-key.sh not run), the one named, as before.
 */
export function applicantIp(slug: string, named: string | null, origin: ApplyOrigin, key: string | undefined = process.env.WEB_KEY, now: number = Date.now()): string | null {
  const signed = verifySignedIp(origin.headers ?? {}, careersIpToken(slug), key, now);
  if (signed.ip) return signed.ip;
  return signed.problem === 'no_server_key' ? (named ?? origin.ip) : origin.ip;
}

/** A form field as text: trimmed, empty as null. */
const text = (v: string | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null);
/** A form field as a number: empty as null, anything else that isn't a number as NaN (refused by the rules). */
const numberOf = (v: string | undefined): number | null => {
  const t = text(v);
  return t === null ? null : Number(t.replace(/,/g, ''));
};

@Injectable()
export class PublicCareersService {
  private readonly logger = new Logger('Careers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The company and its open vacancies, newest first. */
  async list(): Promise<PublicCareers> {
    const [company, rows] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true, nameAr: true } }),
      this.prisma.vacancy.findMany({ where: openOn(todayInCairo()), select: PUBLIC_SELECT, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }], take: 200 }),
    ]);
    return { company: { nameEn: company?.nameEn ?? '', nameAr: company?.nameAr ?? null }, vacancies: rows.map(publicSummaryOf) };
  }

  /** A job's page: 404 for an address that isn't one, or one no longer open. */
  async get(slug: string): Promise<PublicVacancyView> {
    const v = await this.bySlug(slug);
    return {
      ...publicSummaryOf(v),
      about: v.about,
      responsibilities: v.responsibilities,
      requirements: v.requirements,
      questions: questionsOf(v.questions).map(publicQuestionOf),
    };
  }

  /**
   * An application (a multipart form with the CV as `cv`). Refused: the honeypot filled (400), the job not open (404),
   * too many from the address this hour (429), the form's problems in words (400), the CV's (400), the email having
   * applied already (409). Scored with the vacancy's questions; one failing a must-have is kept, filtered out.
   */
  async apply(slug: string, dto: ApplyDto, file: Express.Multer.File | undefined, origin: ApplyOrigin): Promise<ApplyResult> {
    if (text(dto.website)) throw new BadRequestException([NOT_SENT]);
    const v = await this.bySlug(slug);
    const ip = applicantIp(slug, text(dto.ip), origin);
    const userAgent = (text(dto.userAgent) ?? origin.userAgent)?.slice(0, 500) ?? null;
    if (ip) {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await this.prisma.jobApplication.count({ where: { ip, createdAt: { gte: since } } });
      if (recent >= RECRUITMENT_LIMITS.applyPerHour) {
        throw new HttpException('You have sent several applications in the last hour. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    // a cap on a flood to one job, whatever addresses it comes from
    const lastHour = await this.prisma.jobApplication.count({ where: { vacancyId: v.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (lastHour >= RECRUITMENT_LIMITS.applyPerVacancyHour) {
      throw new HttpException('This job has had many applications in the last hour. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    let answersSent: Record<string, unknown> = {};
    if (text(dto.answers)) {
      try {
        const parsed: unknown = JSON.parse(dto.answers!);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) answersSent = parsed as Record<string, unknown>;
      } catch {
        throw new BadRequestException([NOT_SENT]);
      }
    }
    const questions = questionsOf(v.questions);
    const input: ApplyInput = {
      fullName: text(dto.fullName) ?? '',
      email: dto.email ?? '',
      mobile: text(dto.mobile) ?? '',
      linkedin: text(dto.linkedin),
      portfolio: text(dto.portfolio),
      yearsExperience: numberOf(dto.yearsExperience),
      noticePeriod: text(dto.noticePeriod),
      expectedSalary: numberOf(dto.expectedSalary),
      answers: answersSent,
      consent: dto.consent === 'true' || dto.consent === 'on',
    };
    const problems = applyProblems(input, questions);
    const cvSaid = cvProblem(file);
    if (cvSaid) problems.push(cvSaid);
    if (problems.length) throw new BadRequestException(problems);
    const email = normalEmail(input.email);
    const before = await this.prisma.jobApplication.findUnique({ where: { vacancyId_email: { vacancyId: v.id, email } }, select: { createdAt: true } });
    if (before) throw new ConflictException(`You applied for this job on ${shownDate(dayInCairo(before.createdAt))} already. HR will be in touch.`);

    const answers = tidyAnswers(questions, answersSent);
    const match = scoreAnswers(questions, answers);
    const filteredOut = match.knockedOut.length > 0;
    const type = cvTypeOf(file!.buffer)!;
    const source = sourceOf(text(dto.source));
    const now = new Date();
    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:application-number'))`;
      const year = todayInCairo().slice(0, 4);
      const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT max(substring(number from 10)::int) AS max FROM job_applications WHERE number ~ ${`^APP-${year}-[0-9]+$`}`;
      const number = applicationNumber(year, (max ?? 0) + 1);
      const row = await tx.jobApplication.create({
        data: {
          number,
          vacancyId: v.id,
          fullName: input.fullName.trim().replace(/\s+/g, ' '),
          email,
          mobile: input.mobile,
          linkedin: input.linkedin ?? null,
          portfolio: input.portfolio ?? null,
          yearsExperience: input.yearsExperience ?? null,
          noticePeriod: input.noticePeriod ?? null,
          expectedSalary: input.expectedSalary ?? null,
          answers: answers as Prisma.InputJsonValue,
          points: match.points,
          maxPoints: match.maxPoints,
          matchPercent: match.matchPercent,
          knockedOut: match.knockedOut,
          filteredOut,
          source,
          consentAt: now,
          ip,
          userAgent,
          cv: { create: { fileName: cvFileName(file!.originalname, type), mimeType: type, sizeBytes: file!.buffer.length, data: new Uint8Array(file!.buffer) } },
          steps: {
            create: [
              { event: 'applied', stage: 'applied', at: now },
              ...(filteredOut ? [{ event: 'filtered_out', stage: 'applied', note: `${match.knockedOut.length} must-have ${match.knockedOut.length === 1 ? 'question' : 'questions'} not met`, at: now }] : []),
            ],
          },
        },
        select: { id: true, number: true },
      });
      return row;
    });
    await this.audit.record({
      userId: null,
      action: 'apply',
      entityType: APPLICATION_ENTITY,
      entityId: made.id,
      diff: { number: made.number, vacancy: v.number, source, matchPercent: match.matchPercent, filteredOut },
    });
    await this.tellHr(v);
    await this.confirm(email, input.fullName, made.number, v.title);
    return { reference: made.number };
  }

  // ---------- helpers ----------

  private async bySlug(slug: string) {
    if (!isVacancySlug(slug)) throw new NotFoundException(NOT_FOUND);
    const v = await this.prisma.vacancy.findUnique({ where: { slug }, select: PUBLIC_SELECT });
    if (!v || v.status === 'draft' || v.status === 'pending') throw new NotFoundException(NOT_FOUND);
    if (!takesApplications({ status: v.status, closingDate: fromDateOnly(v.closingDate) }, todayInCairo())) throw new NotFoundException(NOT_OPEN);
    return v;
  }

  /**
   * HR told of new applications for the vacancy, once a day (the brief: "group them … not one per application"); a
   * C-level one's, the CEO and a Super Admin. Never fails the application.
   */
  private async tellHr(v: { id: string; number: string; title: string; grade: { confidential: boolean } | null; jobTitle: { minGrade: { confidential: boolean } | null } }): Promise<void> {
    try {
      const link = `/recruitment/vacancies/${v.id}`;
      const last = await this.prisma.notification.findFirst({ where: { kind: 'applications_new', link }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (last && dayInCairo(last.createdAt) === todayInCairo()) return;
      const confidential = v.grade?.confidential === true || v.jobTitle.minGrade?.confidential === true;
      const users = await this.prisma.user.findMany({
        where: { isActive: true, roles: { some: { role: { key: { in: confidential ? ['ceo', 'super_admin'] : ['hr'] } } } } },
        select: { id: true },
      });
      await this.notifications.notify(
        users.map((u) => u.id),
        { kind: 'applications_new', title: 'New applications', body: `${v.title} (${v.number}): open the vacancy to review them.`, link },
      );
    } catch (err) {
      this.logger.warn(`Telling HR of new applications for ${v.number} failed: ${(err as Error).message}`);
    }
  }

  /** The applicant's email with their reference, when email is set up (best effort: a failure is only logged). */
  private async confirm(to: string, name: string, reference: string, title: string): Promise<void> {
    if (!this.mail.configured) return;
    try {
      const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } });
      const from = company?.nameEn || 'the company';
      const first = name.trim().split(/\s+/)[0] ?? '';
      const lines = [
        `Dear ${first},`,
        '',
        `Thank you for applying for ${title} at ${from}. We received your application; its reference is ${reference}.`,
        'We read every application. If yours fits what we are looking for, we will contact you about the next step.',
        '',
        `${from} HR`,
      ];
      const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await this.mail.send({
        to,
        subject: `Your application for ${title} (${reference})`,
        text: lines.join('\n'),
        html: lines.map((l) => (l ? `<p>${escape(l)}</p>` : '')).join(''),
      });
    } catch (err) {
      this.logger.warn(`The confirmation of ${reference} could not be sent: ${(err as Error).message}`);
    }
  }
}

