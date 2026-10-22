import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_CHANNELS,
  APPLICATION_SOURCE_LABELS,
  CV_BATCH_LIMIT,
  cvGuesses,
  GENERAL_CV_LIMITS,
  GENERAL_CV_SOURCE_LABELS,
  generalCvProblems,
  normalEmail,
  type ApplicationChannel,
  type CvGuess,
  type CvSaveResult,
  type CvSaveRow,
  type CvUploadView,
  type GeneralCvSource,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { dayInCairo, shownDate } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextApplicationNumber } from './application-numbers.js';
import { cvFileName, cvProblem, cvTypeOf, type CvType } from './cv-file.js';
import { cvText } from './cv-text.js';
import { GENERAL_CV_ENTITY } from './general-cvs.service.js';
import { createHrApplication } from './hr-applications.js';
import { managesRecruitment, vacancyWhere } from './recruitment-access.js';
import { APPLICATION_ENTITY } from './recruitment-views.js';

// The bulk upload of CVs (owner, 22 October 2026: "is there a way to easy apply from linkedin?", then a bulk upload of
// the CVs LinkedIn's Easy Apply sends: "why not"; packages/shared general-cvs.ts): HR (or a Super Admin) drops many CVs
// on a vacancy, or on the general CVs, one file a request (a batch of at most 50 waiting). Each is checked as an
// application's CV, its text read (cv-text.ts) for the person's name, email and mobile; HR checks each row, picks the
// source (LinkedIn unless changed, for a vacancy), and saves: applications at Applied on the vacancy (one an email: one
// with the email there already is skipped, as is the same email twice in the batch), or general CVs (one in the last 30
// days from the email skipped unless HR keeps it). The consent is HR's ("By HR (LinkedIn Easy Apply)"). A batch is its
// uploader's own; discarded, or saved, its CVs go; any left a day go on the next upload.

const DAY = 24 * 60 * 60 * 1000;
const NOT_FOUND = 'Vacancy not found.';

/** Where a batch goes: a vacancy's applicants, or the general CVs (`vacancyId` null). */
type Target = { vacancyId: string | null };

const UPLOAD_SELECT = { id: true, fileName: true, sizeBytes: true, textFound: true, guess: true, createdAt: true } satisfies Prisma.CvUploadSelect;
type UploadRow = Prisma.CvUploadGetPayload<{ select: typeof UPLOAD_SELECT }>;

/** A kept guess as read back: each field a string or null. */
function guessOf(value: Prisma.JsonValue): CvGuess {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { fullName: s(o.fullName), email: s(o.email), mobile: s(o.mobile) };
}

/** The rules' words to an applicant ("Write your email address") said of the person on HR's row ("their"). */
const theirs = (problem: string) => problem.replace(/\byour\b/g, 'their');

/** "By HR (LinkedIn Easy Apply)": the consent an uploaded CV's row is saved with. */
export const batchConsentNote = (sourceLabel: string, linkedIn: boolean): string => `By HR (${linkedIn ? 'LinkedIn Easy Apply' : sourceLabel})`;

@Injectable()
export class CvUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A CV added to the caller's batch: checked, read, its row guessed. */
  async upload(target: Target, file: Express.Multer.File | undefined, user: SessionUser): Promise<CvUploadView> {
    this.assertManages(user);
    await this.assertTarget(target, user);
    const said = cvProblem(file);
    if (said) throw new BadRequestException([`${file?.originalname ? `${file.originalname}: ` : ''}${said.replace('Your CV', 'A CV').replace('your CV', 'the CV')}`]);
    // what was left a day ago or more, anyone's, goes now
    await this.prisma.cvUpload.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - DAY) } } });
    const waiting = await this.prisma.cvUpload.count({ where: { createdById: user.id } });
    if (waiting >= CV_BATCH_LIMIT) throw new BadRequestException([`A batch takes at most ${CV_BATCH_LIMIT} CVs: save or discard these first.`]);
    const type = cvTypeOf(file!.buffer)! as CvType;
    const fileName = cvFileName(file!.originalname, type);
    const textRead = await cvText(file!.buffer, type);
    const guess = cvGuesses(textRead, file!.originalname ?? fileName);
    const row = await this.prisma.cvUpload.create({
      data: {
        createdById: user.id,
        vacancyId: target.vacancyId,
        fileName,
        mimeType: type,
        sizeBytes: file!.buffer.length,
        data: new Uint8Array(file!.buffer),
        textFound: textRead.trim().length > 0,
        guess: guess as unknown as Prisma.InputJsonValue,
      },
      select: UPLOAD_SELECT,
    });
    return (await this.views(target, [row], user.id))[0];
  }

  /** The caller's batch for the target, oldest first, each with what may make it a duplicate. */
  async list(target: Target, user: SessionUser): Promise<CvUploadView[]> {
    this.assertManages(user);
    await this.assertTarget(target, user);
    const rows = await this.prisma.cvUpload.findMany({ where: { createdById: user.id, vacancyId: target.vacancyId }, select: UPLOAD_SELECT, orderBy: { createdAt: 'asc' } });
    return this.views(target, rows, user.id);
  }

  /** The caller's batch for the target discarded (one CV of it, with `id`). */
  async discard(target: Target, id: string | undefined, user: SessionUser): Promise<{ discarded: number }> {
    this.assertManages(user);
    const { count } = await this.prisma.cvUpload.deleteMany({ where: { createdById: user.id, vacancyId: target.vacancyId, ...(id && { id }) } });
    return { discarded: count };
  }

  /**
   * The rows saved, in the batch's order: each checked (the name, email and mobile; the source; a general CV's area),
   * then an application at Applied on the vacancy, or a general CV; those skipped said with why. Saved rows leave the
   * batch; skipped ones stay to fix or discard.
   */
  async save(target: Target, rows: readonly CvSaveRow[], user: SessionUser): Promise<CvSaveResult> {
    this.assertManages(user);
    const vacancy = await this.assertTarget(target, user);
    const uploads = await this.prisma.cvUpload.findMany({ where: { createdById: user.id, vacancyId: target.vacancyId }, orderBy: { createdAt: 'asc' } });
    const sent = new Map(rows.map((r) => [r.id, r]));
    const result: CvSaveResult = { saved: [], skipped: [] };
    const emails = new Set<string>();
    for (const u of uploads) {
      const r = sent.get(u.id);
      if (!r) continue;
      if (r.skip) {
        result.skipped.push({ id: u.id, fileName: u.fileName, reason: 'Left out.' });
        continue;
      }
      const email = normalEmail(r.email ?? '');
      // a duplicate first: the reason it is left, whatever else the row lacks
      if (email && emails.has(email)) {
        result.skipped.push({ id: u.id, fileName: u.fileName, reason: `${email} is earlier in this batch.` });
        continue;
      }
      if (email && vacancy) {
        const there = await this.prisma.jobApplication.findUnique({ where: { vacancyId_email: { vacancyId: vacancy.id, email } }, select: { number: true } });
        if (there) {
          result.skipped.push({ id: u.id, fileName: u.fileName, reason: `${email} applied for this job already (${there.number}).` });
          continue;
        }
      }
      const problems = vacancy ? this.vacancyRowProblems(r) : this.generalRowProblems(r);
      if (!vacancy && !problems.length) {
        const dept = await this.departmentProblem(r);
        if (dept) problems.push(dept);
      }
      if (problems.length) {
        result.skipped.push({ id: u.id, fileName: u.fileName, reason: problems.join(' ') });
        continue;
      }
      const cv = { fileName: u.fileName, mimeType: u.mimeType, sizeBytes: u.sizeBytes, data: u.data };
      try {
        if (vacancy) {
          const source = r.source as ApplicationChannel;
          const label = APPLICATION_SOURCE_LABELS[source];
          const made = await this.prisma.$transaction(async (tx) => {
            const app = await createHrApplication(tx, {
              vacancyId: vacancy.id,
              stage: 'applied',
              fullName: r.fullName,
              email,
              mobile: r.mobile,
              source,
              consentAt: new Date(),
              consentById: user.id,
              consentNote: batchConsentNote(label, source === 'linkedin'),
              cv,
              note: `Added by HR from a CV (${source === 'linkedin' ? 'LinkedIn Easy Apply' : label}), in a bulk upload`,
              byId: user.id,
            });
            await tx.cvUpload.delete({ where: { id: u.id } });
            return app;
          });
          await this.audit.record({ userId: user.id, action: 'create', entityType: APPLICATION_ENTITY, entityId: made.id, diff: { number: made.number, vacancy: vacancy.number, source, via: 'bulk upload' } });
          result.saved.push({ id: u.id, reference: made.number, fullName: r.fullName.trim() });
        } else {
          const recent = await this.prisma.generalCv.findFirst({
            where: { email, createdAt: { gte: new Date(Date.now() - GENERAL_CV_LIMITS.perEmailDays * DAY) } },
            orderBy: { createdAt: 'desc' },
            select: { number: true, createdAt: true },
          });
          if (recent && !r.keep) {
            result.skipped.push({ id: u.id, fileName: u.fileName, reason: `${email} sent a CV on ${shownDate(dayInCairo(recent.createdAt))} (${recent.number}): tick Keep to save it anyway.` });
            continue;
          }
          const source = r.source as GeneralCvSource;
          const label = GENERAL_CV_SOURCE_LABELS[source];
          const made = await this.prisma.$transaction(async (tx) => {
            const number = await nextApplicationNumber(tx);
            const row = await tx.generalCv.create({
              data: {
                number,
                fullName: r.fullName.trim().replace(/\s+/g, ' '),
                email,
                mobile: r.mobile.trim(),
                departmentId: r.departmentId || null,
                areaOther: r.departmentId ? null : r.areaOther?.trim() || null,
                source,
                referrer: source === 'referral' ? r.referrer?.trim() || null : null,
                consentAt: new Date(),
                consentById: user.id,
                consentNote: batchConsentNote(label, source === 'linkedin'),
                createdById: user.id,
                file: { create: cv },
                events: { create: { event: 'received', note: `Added by HR (${label}), in a bulk upload`, byId: user.id } },
              },
              select: { id: true, number: true },
            });
            await tx.cvUpload.delete({ where: { id: u.id } });
            return row;
          });
          await this.audit.record({ userId: user.id, action: 'create', entityType: GENERAL_CV_ENTITY, entityId: made.id, diff: { number: made.number, source, via: 'bulk upload' } });
          result.saved.push({ id: u.id, reference: made.number, fullName: r.fullName.trim() });
        }
        emails.add(email);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'It could not be saved.';
        result.skipped.push({ id: u.id, fileName: u.fileName, reason: message });
      }
    }
    return result;
  }

  // ---------- helpers ----------

  private assertManages(user: SessionUser): void {
    if (!managesRecruitment(user)) throw new ForbiddenException('Only HR and a Super Admin upload CVs.');
  }

  /** The vacancy the batch is for (one the caller sees, open or on hold); null for the general CVs. */
  private async assertTarget(target: Target, user: SessionUser): Promise<{ id: string; number: string } | null> {
    if (!target.vacancyId) return null;
    const v = await this.prisma.vacancy.findFirst({ where: { AND: [{ id: target.vacancyId }, vacancyWhere(user)] }, select: { id: true, number: true, status: true } });
    if (!v) throw new NotFoundException(NOT_FOUND);
    if (v.status !== 'open' && v.status !== 'on_hold') throw new BadRequestException(['CVs are added to an open vacancy (or one on hold).']);
    return { id: v.id, number: v.number };
  }

  /** A vacancy's row: the person's details (as an application's) and a channel. */
  private vacancyRowProblems(r: CvSaveRow): string[] {
    const problems = generalCvProblems({ fullName: r.fullName, email: r.email, mobile: r.mobile, consent: true, areaOther: 'x' }, { byHr: false }).map(theirs);
    if (!(APPLICATION_CHANNELS as readonly string[]).includes(r.source)) problems.push('Choose where the CV came from.');
    return problems;
  }

  /** A general CV's row: the person's details, how it came, and the area. */
  private generalRowProblems(r: CvSaveRow): string[] {
    return generalCvProblems(
      { fullName: r.fullName, email: r.email, mobile: r.mobile, consent: true, departmentId: r.departmentId ?? null, areaOther: r.areaOther ?? null, source: r.source, referrer: r.referrer ?? null },
      { byHr: true },
    ).map(theirs);
  }

  private async departmentProblem(r: CvSaveRow): Promise<string> {
    if (!r.departmentId) return '';
    const ok = /^[0-9a-f-]{36}$/i.test(r.departmentId) && (await this.prisma.department.count({ where: { id: r.departmentId, parentId: null } })) > 0;
    return ok ? '' : 'Choose one of the areas, or Other and write it.';
  }

  /** The rows as the page shows them: what each guessed, and what may make it a duplicate (there already, or earlier in the batch). */
  private async views(target: Target, rows: readonly UploadRow[], userId: string): Promise<CvUploadView[]> {
    const guesses = rows.map((r) => guessOf(r.guess));
    const emails = [...new Set(guesses.map((g) => g.email).filter((e): e is string => !!e))];
    const there = new Map<string, { reference: string; date: string }>();
    if (emails.length) {
      if (target.vacancyId) {
        const apps = await this.prisma.jobApplication.findMany({ where: { vacancyId: target.vacancyId, email: { in: emails } }, select: { email: true, number: true, createdAt: true } });
        for (const a of apps) there.set(a.email, { reference: a.number, date: dayInCairo(a.createdAt) });
      } else {
        const cvs = await this.prisma.generalCv.findMany({
          where: { email: { in: emails }, createdAt: { gte: new Date(Date.now() - GENERAL_CV_LIMITS.perEmailDays * DAY) } },
          select: { email: true, number: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        });
        for (const c of cvs) if (!there.has(c.email)) there.set(c.email, { reference: c.number, date: dayInCairo(c.createdAt) });
      }
    }
    // earlier in the whole batch (not only these rows): the batch's emails in order
    const batch = await this.prisma.cvUpload.findMany({ where: { createdById: userId, vacancyId: target.vacancyId, id: { notIn: rows.map((r) => r.id) } }, select: { guess: true, createdAt: true } });
    return rows.map((r, i) => {
      const g = guesses[i];
      const found = g.email ? there.get(g.email) : undefined;
      const earlier =
        !!g.email &&
        (guesses.slice(0, i).some((x) => x.email === g.email) || batch.some((b) => b.createdAt < r.createdAt && guessOf(b.guess).email === g.email));
      return {
        id: r.id,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
        textFound: r.textFound,
        guess: g,
        duplicate: found ? { reference: found.reference, inBatch: false, date: found.date } : earlier ? { reference: null, inBatch: true, date: null } : null,
        uploadedAt: r.createdAt.toISOString(),
      };
    });
  }
}
