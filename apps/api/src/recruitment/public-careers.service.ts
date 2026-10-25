import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_CLOSED,
  APPLICATION_SOURCE_LABELS,
  APPLICATION_STAGE_LABELS,
  applicationSourceOf,
  applyProblems,
  isVacancySlug,
  keptMobile,
  normalEmail,
  publicQuestionOf,
  RECRUITMENT_LIMITS,
  careersIpToken,
  webLinkOf,
  scoreAnswers,
  sourceOf,
  takesApplications,
  tidyAnswers,
  tidyNotice,
  checkPortfolio,
  linkedinFormKey,
  reapplyChanges,
  reapplyFilter,
  reapplyNote,
  reapplyOutcome,
  type ApplicationStage,
  type ApplyInput,
  type ApplyResult,
  type PublicCareers,
  type PublicVacancyView,
  type ReapplySent,
} from '@trendlix/shared';
import { verifySignedIp } from '../attendance/signed-ip.js';
import { AuditService } from '../audit/audit.service.js';
import { dayInCairo, fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextApplicationNumber } from './application-numbers.js';
import { attachCandidate, findCandidates, foundIds, refreshCandidate } from './candidate-links.js';
import { CvReadingsService } from './cv-readings.service.js';
import { cvFileName, cvProblem, cvTypeOf, type CvType } from './cv-file.js';
import { APPLICATION_ENTITY, answersOf, money, publicSummaryOf, questionsOf } from './recruitment-views.js';
import type { ApplyDto } from './recruitment.dto.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { VacancySuggestionsService } from './vacancy-suggestions.service.js';
import { LinkedInSignInService } from './linkedin-signin.service.js';
import { portfolioFileProblem, portfolioFileRow, portfolioSent } from './portfolio-file.js';
import { vacancyAsk } from './portfolio-settings.service.js';

// The careers page (owner, 22 October 2026: "where will we include the ATS?"; at people.trendlix.com/careers: "i dont
// know how to decide it for now"), without signing in: the open vacancies (approved by the CEO, their closing date not
// passed), a job's page with what its form asks (never the points, the must-have rules or the salary range), and the
// application itself, with the CV. Protected by a field people never see (a form that fills it is a robot's), a limit
// of applications an hour from one address, and one application per email a vacancy. HR is told of new applications
// once a day a vacancy; the applicant gets an email with the reference when email is set up. An invitation's link
// (?src=invite: Suggested From Earlier CVs, 24 October 2026) is kept as the source, and applying closes the person's
// suggestion for the job, invited or not.
// Applying again for the same job (owner, 25 October 2026: "if an employee updated the cv and reapplied, how will he be
// treated in the system?"; asked, "Update their application"; packages/shared reapply.ts): the same person (the email,
// or their candidate by email or mobile) whose application is still open updates it: the new CV current (the earlier
// kept, read again, its fit worked out again), what they sent and the answers scored again, their candidate refreshed,
// a step "Updated by the candidate", HR told ("CV updated", once a day an applicant), the applicant told "We've updated
// your application"; the answer { reference, updated: true }. Closed (rejected, hired): refused in words. The hourly
// limits count each CV an update replaced too, from its address.

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
  jobTitle: { select: { id: true, titleEn: true, minGrade: { select: { confidential: true } } } },
  // its form's portfolio (25 October 2026: "Portfolio per position"): its own mode over its job title's
  portfolioMode: true,
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
export function applicantIp(slug: string, named: string | null, origin: ApplyOrigin, key: string | undefined = process.env.CAREERS_KEY, now: number = Date.now()): string | null {
  const signed = verifySignedIp(origin.headers ?? {}, careersIpToken(slug), key, now);
  if (signed.ip) return signed.ip;
  return signed.problem === 'no_server_key' ? (named ?? origin.ip) : origin.ip;
}

/** What an application is read with when its person applies again for the job. */
const REAPPLY_SELECT = {
  id: true,
  number: true,
  email: true,
  stage: true,
  employeeId: true,
  candidateId: true,
  source: true,
  fullName: true,
  mobile: true,
  linkedin: true,
  portfolioLinks: true,
  yearsExperience: true,
  noticePeriod: true,
  expectedSalary: true,
  answers: true,
  matchPercent: true,
  filteredOut: true,
  knockedOut: true,
  emailConfirmedBy: true,
  whatsappOptInAt: true,
  whatsappStoppedAt: true,
  whatsappLanguage: true,
  offers: { select: { status: true } },
  cv: { select: { sha256: true } },
} satisfies Prisma.JobApplicationSelect;

type ReapplyRow = Prisma.JobApplicationGetPayload<{ select: typeof REAPPLY_SELECT }>;

/** What the transaction made or updated, for what follows it (the audit, the reading, HR, the applicant). */
type Applied =
  | { kind: 'created'; id: string; number: string; candidate: { code: string; possibleDuplicateOf: { code: string } | null } }
  | {
      kind: 'updated';
      id: string;
      number: string;
      newCv: boolean;
      /** Anything changed (a new CV, or a field): HR told, a step kept. */
      changed: boolean;
      diff: Record<string, unknown>;
    };

/** A form field as text: trimmed, empty as null. */
const text = (v: string | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null);
/** A form field as a number: empty as null, anything else that isn't a number as NaN (refused by the rules). */
const numberOf = (v: string | undefined): number | null => {
  const t = text(v);
  return t === null ? null : Number(t.replace(/,/g, ''));
};

/** A vacancy as HR is told of its applicants. */
type TellsHr = { id: string; number: string; title: string; grade: { confidential: boolean } | null; jobTitle: { minGrade: { confidential: boolean } | null } };

@Injectable()
export class PublicCareersService {
  private readonly logger = new Logger('Careers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly readings: CvReadingsService,
    private readonly suggestions: VacancySuggestionsService,
    private readonly whatsapp: WhatsAppService,
    private readonly linkedin: LinkedInSignInService,
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
      // the portfolio its form asks for, and "Fill in with LinkedIn" (25 October 2026)
      portfolio: await vacancyAsk(this.prisma, v),
      linkedinSignIn: await this.linkedin.isOn(),
    };
  }

  /**
   * An application (a multipart form with the CV as `cv`). Refused: the honeypot filled (400), the job not open (404),
   * too many from the address this hour (429), the form's problems in words (400), the CV's (400), the same person (by
   * email or mobile) whose application for it is closed (409, APPLICATION_CLOSED). The same person whose application is
   * still open updates it ({ reference, updated: true }; 25 October 2026). Scored with the vacancy's questions; one
   * failing a must-have is kept, filtered out.
   */
  async apply(slug: string, dto: ApplyDto, file: Express.Multer.File | undefined, origin: ApplyOrigin, portfolioFile?: Express.Multer.File): Promise<ApplyResult> {
    if (text(dto.website)) throw new BadRequestException([NOT_SENT]);
    const v = await this.bySlug(slug);
    const ip = applicantIp(slug, text(dto.ip), origin);
    const userAgent = (text(dto.userAgent) ?? origin.userAgent)?.slice(0, 500) ?? null;
    if (ip) {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      // an update's new CV from the address counts as an application does (25 October 2026: applying again)
      const [recent, replaced] = await Promise.all([
        this.prisma.jobApplication.count({ where: { ip, createdAt: { gte: since } } }),
        this.prisma.jobApplicationEarlierCv.count({ where: { ip, replacedAt: { gte: since } } }),
      ]);
      if (recent + replaced >= RECRUITMENT_LIMITS.applyPerHour) {
        throw new HttpException('You have sent several applications in the last hour. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    // a cap on a flood to one job, whatever addresses it comes from
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [lastHour, replacedLastHour] = await Promise.all([
      this.prisma.jobApplication.count({ where: { vacancyId: v.id, createdAt: { gte: hourAgo } } }),
      this.prisma.jobApplicationEarlierCv.count({ where: { application: { vacancyId: v.id }, replacedAt: { gte: hourAgo } } }),
    ]);
    if (lastHour + replacedLastHour >= RECRUITMENT_LIMITS.applyPerVacancyHour) {
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
      // kept as the system keeps phones (22 October 2026: "country code and no extra zero"): 01012345678 and
      // +20 101 234 5678 are +201012345678; the rule refuses one that isn't a number
      mobile: keptMobile(dto.mobile),
      // https:// put in front when it was typed without (22 October 2026)
      linkedin: webLinkOf(dto.linkedin) || null,
      portfolio: webLinkOf(dto.portfolio) || null,
      yearsExperience: numberOf(dto.yearsExperience),
      // "30 days", "2 months" (22 October 2026: "in Days" … "and a selectoor to make it months")
      noticePeriod: tidyNotice(dto.noticePeriod),
      expectedSalary: numberOf(dto.expectedSalary),
      answers: answersSent,
      consent: dto.consent === 'true' || dto.consent === 'on',
    };
    // the portfolio its form asks for (25 October 2026: "Portfolio per position"); none asked, whatever was sent is left aside
    const portfolio = checkPortfolio({ links: portfolioSent(dto), file: !!portfolioFile?.buffer?.length }, await vacancyAsk(this.prisma, v));
    input.portfolio = portfolio.links[0] ?? null;
    const problems = [...applyProblems(input, questions), ...portfolio.problems];
    const fileSaid = portfolio.file ? portfolioFileProblem(portfolioFile) : null;
    if (fileSaid) problems.push(fileSaid);
    const cvSaid = cvProblem(file);
    if (cvSaid) problems.push(cvSaid);
    if (problems.length) throw new BadRequestException(problems);
    const email = normalEmail(input.email);
    // "Confirmed by LinkedIn": the email LinkedIn verified for this job's form, sent as it gave it (25 October 2026)
    const emailConfirmedBy = this.linkedin.confirmedBy(dto.linkedinTicket, linkedinFormKey({ kind: 'job', slug: v.slug }), email);
    const answers = tidyAnswers(questions, answersSent);
    const match = scoreAnswers(questions, answers);
    const filteredOut = match.knockedOut.length > 0;
    const type = cvTypeOf(file!.buffer)!;
    const source = sourceOf(text(dto.source));
    const now = new Date();
    // "Send me updates about my application on WhatsApp" (24 October 2026), off unless ticked; the page's language
    const whatsapp = dto.whatsapp === 'true' || dto.whatsapp === 'on';
    const whatsappLanguage = dto.whatsappLanguage === 'ar' ? 'ar' : 'en';
    const made: Applied = await this.prisma.$transaction(async (tx) => {
      // their candidate profile (owner, 22 October 2026: "how to make like a profile for each candidate …"; "Email or
      // mobile"): the candidates' lock first; the same person (by email or mobile) applying for this job again updates
      // their application while it is open, and is refused once it is closed (25 October 2026: "Update their application")
      const found = await findCandidates(tx, { email, mobile: input.mobile });
      const ids = foundIds(found);
      const earlier = await tx.jobApplication.findMany({
        where: { vacancyId: v.id, OR: [{ email }, ...(ids.length ? [{ candidateId: { in: ids } }] : [])] },
        select: REAPPLY_SELECT,
        orderBy: { createdAt: 'desc' },
      });
      if (earlier.length) {
        // the one with this email first, else their candidate's newest
        const a = earlier.find((x) => x.email === email) ?? earlier[0];
        if (reapplyOutcome(a) === 'closed') throw new ConflictException(APPLICATION_CLOSED);
        return this.reapply(tx, a, {
          input,
          email,
          emailConfirmedBy,
          portfolio,
          portfolioFile,
          answers,
          match,
          file: file!,
          type,
          source,
          whatsapp,
          whatsappLanguage,
          ip,
          userAgent,
          now,
          found,
          stageLabel: APPLICATION_STAGE_LABELS[a.stage as ApplicationStage] ?? a.stage,
        });
      }
      const candidate = await attachCandidate(tx, { fullName: input.fullName, email, mobile: input.mobile, linkedin: input.linkedin, portfolio: input.portfolio, at: now }, found);
      // the applications' and general CVs' one series (application-numbers.ts)
      const number = await nextApplicationNumber(tx);
      const row = await tx.jobApplication.create({
        data: {
          number,
          vacancyId: v.id,
          candidateId: candidate.id,
          fullName: input.fullName.trim().replace(/\s+/g, ' '),
          email,
          mobile: input.mobile,
          linkedin: input.linkedin ?? null,
          portfolio: input.portfolio ?? null,
          portfolioLinks: portfolio.links,
          emailConfirmedBy,
          ...(portfolio.file && { portfolioFile: { create: portfolioFileRow(portfolioFile!) } }),
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
          ...(whatsapp && { whatsappOptInAt: now, whatsappLanguage }),
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
      // its keys, possible matches and employee worked out with it in
      await refreshCandidate(tx, candidate.id);
      // the tick kept on their candidate too, with its time (a new tick after a STOP is a new consent)
      if (whatsapp) await tx.candidate.update({ where: { id: candidate.id }, data: { whatsappOptInAt: now, whatsappStoppedAt: null } });
      return { kind: 'created', ...row, candidate };
    });
    if (made.kind === 'updated') return this.afterUpdate(v, made, { email, name: input.fullName, whatsapp });
    await this.audit.record({
      userId: null,
      action: 'apply',
      entityType: APPLICATION_ENTITY,
      entityId: made.id,
      diff: {
        number: made.number,
        vacancy: v.number,
        source,
        matchPercent: match.matchPercent,
        filteredOut,
        candidate: made.candidate.code,
        ...(made.candidate.possibleDuplicateOf && { possibleDuplicateOf: made.candidate.possibleDuplicateOf.code }),
      },
    });
    // the CV read in the background (22 October 2026)
    this.readings.kick();
    // their suggestion for this job (invited or not) closed: they applied (24 October 2026)
    await this.suggestions.closeFor(made.id);
    await this.tellHr(v);
    await this.confirm(email, input.fullName, made.number, v.title);
    // on WhatsApp too, when ticked (never throws)
    if (whatsapp) await this.whatsapp.applicationReceived(made.id);
    return { reference: made.number };
  }

  // ---------- applying again (25 October 2026: "Update their application") ----------

  /**
   * The open application of the person applying again, updated in the caller's transaction (the candidates' lock held):
   * a new CV current (a file other than the current one: the current kept among the earlier CVs, its reading, preview
   * and open positions' fits gone, to be worked out again), what they sent, the answers scored again (filtered out as
   * reapplyFilter says), their candidate refreshed, the step "Updated by the candidate". Nothing changed: nothing kept.
   */
  private async reapply(
    tx: Prisma.TransactionClient,
    a: ReapplyRow,
    x: {
      input: ApplyInput;
      email: string;
      emailConfirmedBy: string | null;
      portfolio: { links: string[]; file: boolean };
      portfolioFile: Express.Multer.File | undefined;
      answers: ReturnType<typeof tidyAnswers>;
      match: ReturnType<typeof scoreAnswers>;
      file: Express.Multer.File;
      type: CvType;
      source: string;
      whatsapp: boolean;
      whatsappLanguage: 'en' | 'ar';
      ip: string | null;
      userAgent: string | null;
      now: Date;
      found: Awaited<ReturnType<typeof findCandidates>>;
      stageLabel: string;
    },
  ): Promise<Applied> {
    const { input, now } = x;
    const fullName = input.fullName.trim().replace(/\s+/g, ' ');
    // the same file sent again is no new CV: nothing kept twice, nothing read again
    const sha256 = createHash('sha256').update(x.file.buffer).digest('hex');
    const newCv = !a.cv || a.cv.sha256 !== sha256;
    const before: ReapplySent = {
      fullName: a.fullName,
      mobile: a.mobile,
      linkedin: a.linkedin,
      portfolioLinks: a.portfolioLinks,
      portfolioFile: false,
      yearsExperience: money(a.yearsExperience),
      noticePeriod: a.noticePeriod,
      expectedSalary: money(a.expectedSalary),
      answers: answersOf(a.answers),
      whatsapp: !!a.whatsappOptInAt && !a.whatsappStoppedAt,
      whatsappLanguage: a.whatsappLanguage,
    };
    const after: ReapplySent = {
      fullName,
      mobile: input.mobile,
      linkedin: input.linkedin ?? null,
      portfolioLinks: x.portfolio.links,
      portfolioFile: x.portfolio.file,
      yearsExperience: input.yearsExperience ?? null,
      noticePeriod: input.noticePeriod ?? null,
      expectedSalary: input.expectedSalary ?? null,
      answers: x.answers,
      whatsapp: x.whatsapp,
      whatsappLanguage: x.whatsapp ? x.whatsappLanguage : a.whatsappLanguage,
    };
    const changed = reapplyChanges(before, after);
    const filter = reapplyFilter({ stage: a.stage, filteredOut: a.filteredOut, knockedOut: a.knockedOut }, x.match.knockedOut);
    // where this one came from, when it differs from the application's (?src=: LinkedIn, an invitation…)
    const sourceDiffers = x.source !== a.source;
    const diff = {
      number: a.number,
      newCv,
      changed,
      ...(changed.includes('answers') && { matchPercent: { from: a.matchPercent, to: x.match.matchPercent } }),
      ...(filter.filteredOut !== a.filteredOut && { filteredOut: { from: a.filteredOut, to: filter.filteredOut } }),
      ...(filter.change === 'kept_by_hr' && { mustHavesNotMet: x.match.knockedOut.length }),
      ...(sourceDiffers && { source: x.source }),
    };
    if (!newCv && !changed.length) return { kind: 'updated', id: a.id, number: a.number, newCv, changed: false, diff };

    if (newCv) {
      // the current CV kept among the earlier ones as it was (copied in the database: never read into the API), then replaced
      if (a.cv) {
        await tx.$executeRaw`INSERT INTO job_application_earlier_cvs (id, application_id, file_name, mime_type, size_bytes, data, sent_at, replaced_at, ip)
          SELECT gen_random_uuid(), application_id, file_name, mime_type, size_bytes, data, created_at, ${now.toISOString()}::timestamptz, ${x.ip}
          FROM job_application_cvs WHERE application_id = ${a.id}::uuid`;
      }
      const cv = { fileName: cvFileName(x.file.originalname, x.type), mimeType: x.type, sizeBytes: x.file.buffer.length, data: new Uint8Array(x.file.buffer), createdAt: now };
      await tx.jobApplicationCv.upsert({ where: { applicationId: a.id }, create: { applicationId: a.id, ...cv }, update: cv });
      // read again by the round (its fit, and the other open positions' fits, worked out again once it is read)
      await tx.cvPreview.deleteMany({ where: { applicationId: a.id } });
      await tx.cvReading.deleteMany({ where: { applicationId: a.id } });
      await tx.cvReading.create({ data: { applicationId: a.id } });
      await tx.cvOpenFit.deleteMany({ where: { applicationId: a.id } });
    }
    if (x.portfolio.file && x.portfolioFile) {
      const row = portfolioFileRow(x.portfolioFile);
      await tx.jobApplicationPortfolio.upsert({ where: { applicationId: a.id }, create: { applicationId: a.id, ...row }, update: { ...row, createdAt: now } });
    }
    // their candidate: the new email or mobile joined, the latest name and links kept, worked out again
    const candidate = await attachCandidate(
      tx,
      { fullName, email: x.email, mobile: input.mobile, linkedin: input.linkedin, portfolio: input.portfolio, at: now, candidateId: a.candidateId },
      x.found,
    );
    await tx.jobApplication.update({
      where: { id: a.id },
      data: {
        candidateId: candidate.id,
        fullName,
        mobile: input.mobile,
        linkedin: input.linkedin ?? null,
        portfolio: input.portfolio ?? null,
        portfolioLinks: x.portfolio.links,
        // the email they applied with stays the application's; LinkedIn's confirmation of it kept, or given now
        ...(x.email === a.email && x.emailConfirmedBy && { emailConfirmedBy: x.emailConfirmedBy }),
        yearsExperience: input.yearsExperience ?? null,
        noticePeriod: input.noticePeriod ?? null,
        expectedSalary: input.expectedSalary ?? null,
        answers: x.answers as Prisma.InputJsonValue,
        points: x.match.points,
        maxPoints: x.match.maxPoints,
        matchPercent: x.match.matchPercent,
        knockedOut: x.match.knockedOut,
        filteredOut: filter.filteredOut,
        // their own consent, given again with what they sent (an HR-recorded one of before replaced)
        consentAt: now,
        consentById: null,
        consentNote: null,
        // the WhatsApp tick as sent this time (unticked: no more messages about it)
        ...(x.whatsapp ? { whatsappOptInAt: now, whatsappLanguage: x.whatsappLanguage, whatsappStoppedAt: null } : { whatsappOptInAt: null }),
        ...(newCv && { cvUpdatedAt: now, cvMatchPercent: null, cvFit: Prisma.DbNull }),
      },
    });
    const stage = a.stage as ApplicationStage;
    await tx.jobApplicationStep.createMany({
      data: [
        {
          applicationId: a.id,
          event: 'updated',
          stage,
          note: reapplyNote({
            newCv,
            changed,
            match: { from: a.matchPercent, to: x.match.matchPercent },
            filter: filter.change,
            knockedOut: x.match.knockedOut.length,
            stageLabel: x.stageLabel,
            sourceLabel: sourceDiffers ? APPLICATION_SOURCE_LABELS[applicationSourceOf(x.source)] : null,
          }),
          at: now,
        },
        ...(filter.change === 'now_filtered'
          ? [{ applicationId: a.id, event: 'filtered_out', stage, note: `${x.match.knockedOut.length} must-have ${x.match.knockedOut.length === 1 ? 'question' : 'questions'} not met`, at: now }]
          : []),
      ],
    });
    await refreshCandidate(tx, candidate.id);
    if (x.whatsapp) await tx.candidate.update({ where: { id: candidate.id }, data: { whatsappOptInAt: now, whatsappStoppedAt: null } });
    return { kind: 'updated', id: a.id, number: a.number, newCv, changed: true, diff: { ...diff, candidate: candidate.code } };
  }

  /** After an update: the audit, the reading, HR told, the applicant told "We've updated your application"; the answer. */
  private async afterUpdate(v: TellsHr, made: Extract<Applied, { kind: 'updated' }>, to: { email: string; name: string; whatsapp: boolean }): Promise<ApplyResult> {
    await this.audit.record({ userId: null, action: 'reapply', entityType: APPLICATION_ENTITY, entityId: made.id, diff: { ...made.diff, vacancy: v.number } });
    if (made.newCv) this.readings.kick();
    // the same CV, other years: its fit worked out again at once (a new CV's once it is read)
    else if (made.changed) await this.readings.rescoreApplication(made.id);
    await this.suggestions.closeFor(made.id);
    if (made.changed) await this.tellHrUpdated(v, made);
    await this.confirm(to.email, to.name, made.number, v.title, true);
    if (to.whatsapp) await this.whatsapp.applicationUpdated(made.id);
    return { reference: made.number, updated: true };
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
  private async tellHr(v: TellsHr): Promise<void> {
    try {
      const link = `/recruitment/vacancies/${v.id}`;
      if (await this.toldToday(link)) return;
      await this.notifications.notify(await this.hrOf(v), { kind: 'applications_new', title: 'New applications', body: `${v.title} (${v.number}): open the vacancy to review them.`, link });
    } catch (err) {
      this.logger.warn(`Telling HR of new applications for ${v.number} failed: ${(err as Error).message}`);
    }
  }

  /**
   * HR told an applicant applied again (25 October 2026: "tell HR 'CV updated'"), as of new applications (the kind
   * applications_new; a C-level vacancy's, the CEO and a Super Admin), once a day an applicant. Never fails the update.
   */
  private async tellHrUpdated(v: TellsHr, made: { id: string; number: string; newCv: boolean }): Promise<void> {
    try {
      const link = `/recruitment/applicants/${made.id}`;
      if (await this.toldToday(link)) return;
      const a = await this.prisma.jobApplication.findUnique({ where: { id: made.id }, select: { fullName: true } });
      await this.notifications.notify(await this.hrOf(v), {
        kind: 'applications_new',
        title: made.newCv ? 'CV updated' : 'Application updated',
        body: `${a?.fullName ?? 'An applicant'} applied again for ${v.title} (${v.number})${made.newCv ? ' with a new CV' : ''}: open the applicant to see what changed.`,
        link,
      });
    } catch (err) {
      this.logger.warn(`Telling HR of the updated application ${made.number} failed: ${(err as Error).message}`);
    }
  }

  /** Whether HR was told of this page (applications_new) today, in Cairo. */
  private async toldToday(link: string): Promise<boolean> {
    const last = await this.prisma.notification.findFirst({ where: { kind: 'applications_new', link }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    return !!last && dayInCairo(last.createdAt) === todayInCairo();
  }

  /** Who hears of a vacancy's applicants: HR; a C-level one's, the CEO and a Super Admin. */
  private async hrOf(v: TellsHr): Promise<string[]> {
    const confidential = v.grade?.confidential === true || v.jobTitle.minGrade?.confidential === true;
    const users = await this.prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: { key: { in: confidential ? ['ceo', 'super_admin'] : ['hr'] } } } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /**
   * The applicant's email with their reference, when email is set up (best effort: a failure is only logged); `updated`:
   * they applied again, "We've updated your application" (25 October 2026).
   */
  private async confirm(to: string, name: string, reference: string, title: string, updated = false): Promise<void> {
    if (!(await this.mail.ready())) return;
    try {
      const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } });
      const from = company?.nameEn || 'the company';
      const first = name.trim().split(/\s+/)[0] ?? '';
      const lines = [
        `Dear ${first},`,
        '',
        updated
          ? `We've updated your application for ${title} at ${from} with what you just sent, your CV included; its reference is still ${reference}.`
          : `Thank you for applying for ${title} at ${from}. We received your application; its reference is ${reference}.`,
        'We read every application. If yours fits what we are looking for, we will contact you about the next step.',
        '',
        `${from} HR`,
      ];
      const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await this.mail.send({
        to,
        subject: updated ? `Your updated application for ${title} (${reference})` : `Your application for ${title} (${reference})`,
        text: lines.join('\n'),
        html: lines.map((l) => (l ? `<p>${escape(l)}</p>` : '')).join(''),
      });
    } catch (err) {
      this.logger.warn(`The confirmation of ${reference} could not be sent: ${(err as Error).message}`);
    }
  }
}

