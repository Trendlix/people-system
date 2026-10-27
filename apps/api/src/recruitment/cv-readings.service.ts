import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  CV_FACTS_VERSION,
  CV_FIT_VERSION,
  CV_READING_LIMITS,
  cvFacts,
  cvFactsOf,
  cvFitOf,
  cvGuesses,
  experienceText,
  keySkillsFound,
  mostlyArabic,
  textAmount,
  type CvFit,
  type CvGuess,
  type FitJob,
  type CvReadingMethod,
  type CvReadingStatus,
  type CvReadingView,
  type CvTextView,
  type AgencyMarks,
} from '@trendlix/shared';
import { Prisma } from '../generated/prisma/client.js';
import { OcrClient } from '../paperwork/ocr.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CandidatesService } from './candidates.service.js';
import { DOCX, PDF } from './cv-file.js';
import { agencyMarksOf } from './agency-marks.js';
import { agencyOf, canonical, FIT_READING, FIT_VACANCY_SELECT, fitCvOf, fitJobOf, positionOf } from './cv-fit-inputs.js';
import { cvText } from './cv-text.js';

// Every CV read and analysed (owner, 22 October 2026: "make the OCR egine reads the CV and analyse it. is that
// applicable?"; asked, "Built-in rules only"; packages/shared cv-analysis.ts): an application's, a general CV's, and a
// bulk upload's scanned file. In the background, never on the request that brings the CV, so a slow or absent OCR
// service never holds up an applicant:
// - The round (every minute once main.ts starts it, and at once when a CV comes in) first gives every CV without a
//   reading a pending one (a bulk upload's only when its own text couldn't be read), then reads the pending ones due,
//   one at a time, as the OCR service reads one file at a time. Each is claimed by a conditional update (FOR UPDATE
//   SKIP LOCKED), its next try set before it is read, so two rounds never read the same CV and a crash only delays it.
// - A PDF's own text first (its first 5 pages); with next to none (a scan), the OCR service: in English, and again in
//   Arabic when the English reading came out mostly Arabic letters (PaddleOCR's Arabic model reads Arabic better; the
//   Arabic reading is kept then). A Word file's paragraphs. Kept: at most 60,000 characters.
// - The OCR service down or failing: tried again later (after 2, then 10 minutes), the third failure kept as failed.
// - Then what the rules find (cvFacts) is kept; an application's CV match % is worked out from its vacancy's key skills;
//   a bulk upload's row gets the name, email and mobile read from the scan (where HR's row is still empty).
// - The rules grew (owner, 24 October 2026: "CV years in list + more rules": the work history, education details,
//   skills, certifications and city): every CV read before has its facts worked out again from its kept text, never
//   read again (refreshFacts, run by the recruitment round under its lock).
// - The CV match became the CV fit (owner, 25 October 2026: "aren't you supposed to match the candidate to the job based
//   on the CV and ATS?"; "Full CV fit score"; packages/shared cv-fit.ts): an application's fit for its vacancy is kept
//   with its parts (job_applications.cv_fit), its percent the CV match % the lists sort and filter by; worked out when its
//   CV is read, when it is made (moved from a general CV, added from the suggestions, a bulk upload's), when its vacancy
//   changes what it is scored by, and for those of an older version by the recruitment round (refreshFits).

const TICK_MS = 60_000;
/** The minutes before a reading is tried again, after its 1st, 2nd and 3rd try. */
const BACKOFF_MINUTES = [2, 10, 60];
/** At most this many CVs a round. */
const PER_ROUND = 25;

/** A reading to do, as claimed. */
interface Claimed {
  id: string;
  applicationId: string | null;
  generalCvId: string | null;
  uploadId: string | null;
  attempts: number;
}

/** Which CV a reading is for. */
export type CvSubject = { applicationId: string } | { generalCvId: string } | { uploadId: string };

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CvReadingsService implements OnModuleDestroy {
  private readonly logger = new Logger('CvReadings');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  /** Told once a round has read CVs (Suggested From Earlier CVs, 24 October 2026: new CVs matched with the open vacancies). */
  private readonly listeners: (() => Promise<void>)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocr: OcrClient,
    private readonly candidates: CandidatesService,
  ) {}

  /** Starts the round every minute (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A CV came in: read it now rather than at the next minute (only once started: the tests run rounds themselves). */
  kick(): void {
    if (this.timer) void this.tick();
  }

  /** One round, unless one is going (then another right after it). Never throws. */
  async tick(now?: Date): Promise<number | null> {
    if (this.running) {
      this.again = true;
      return null;
    }
    this.running = true;
    try {
      let read = await this.runOnce(now);
      while (this.again) {
        this.again = false;
        read += await this.runOnce(now);
      }
      return read;
    } catch (err) {
      this.logger.error(`The CVs could not be read: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /**
   * Something to do after a round that read an application's or a general CV's CV (VacancySuggestionsService: the new CVs
   * matched with the open vacancies, HR told of new matches). Never fails the round.
   */
  onCvsRead(listener: () => Promise<void>): void {
    this.listeners.push(listener);
  }

  /** One round at `now`: the CVs without a reading given one, then those due read; how many were read or tried. */
  async runOnce(now = new Date()): Promise<number> {
    let readAny = false;
    const done = await this.readDue(now, () => (readAny = true));
    if (readAny) {
      for (const listener of this.listeners) {
        try {
          await listener();
        } catch (err) {
          this.logger.warn(`After the CVs were read: ${(err as Error).message}`);
        }
      }
    }
    return done;
  }

  /** The round itself: `read` told of each application's or general CV's CV read (with text or none). */
  private async readDue(now: Date, read: () => void): Promise<number> {
    await this.enqueueMissing();
    // a reading whose last try was cut short (the API stopped while reading it): failed once that try's time is up
    await this.prisma.cvReading.updateMany({
      where: { status: 'pending', attempts: { gte: CV_READING_LIMITS.attempts }, nextTryAt: { lte: now } },
      data: { status: 'failed', error: 'The CV could not be read.' },
    });
    let done = 0;
    for (; done < PER_ROUND; done++) {
      const row = await this.claim(now);
      if (!row) break;
      try {
        if ((await this.read(row, now)) && !row.uploadId) read();
      } catch (err) {
        // anything unforeseen: the reading stays pending, tried again later (its next try was set when claimed)
        this.logger.warn(`A CV could not be read (try ${row.attempts}): ${(err as Error).message}`);
        await this.prisma.cvReading.updateMany({ where: { id: row.id, status: 'pending' }, data: { error: 'An error while reading it.' } });
        if (row.attempts >= CV_READING_LIMITS.attempts) await this.fail(row.id, 'The CV could not be read.');
      }
    }
    return done;
  }

  /** Every CV without a reading gets a pending one: an application's, a general CV's, a bulk upload's scanned file. */
  async enqueueMissing(db: Db = this.prisma): Promise<void> {
    await db.$executeRaw`INSERT INTO cv_readings (id, application_id, updated_at)
      SELECT gen_random_uuid(), c.application_id, now() FROM job_application_cvs c
      WHERE NOT EXISTS (SELECT 1 FROM cv_readings r WHERE r.application_id = c.application_id)
      ON CONFLICT DO NOTHING`;
    await db.$executeRaw`INSERT INTO cv_readings (id, general_cv_id, updated_at)
      SELECT gen_random_uuid(), f.general_cv_id, now() FROM general_cv_files f
      WHERE NOT EXISTS (SELECT 1 FROM cv_readings r WHERE r.general_cv_id = f.general_cv_id)
      ON CONFLICT DO NOTHING`;
    await db.$executeRaw`INSERT INTO cv_readings (id, upload_id, updated_at)
      SELECT gen_random_uuid(), u.id, now() FROM cv_uploads u
      WHERE NOT u.text_found AND NOT EXISTS (SELECT 1 FROM cv_readings r WHERE r.upload_id = u.id)
      ON CONFLICT DO NOTHING`;
  }

  /** The next reading due, claimed: its try counted and its next try set before it is read. */
  private async claim(now: Date): Promise<Claimed | null> {
    // the round's time as text with its zone: a Date passed as is reaches Postgres without one, read in the server's
    const at = now.toISOString();
    const rows = await this.prisma.$queryRaw<
      { id: string; application_id: string | null; general_cv_id: string | null; upload_id: string | null; attempts: number }[]
    >`UPDATE cv_readings SET attempts = attempts + 1,
        next_try_at = ${at}::timestamptz + make_interval(mins => (ARRAY[${BACKOFF_MINUTES[0]}, ${BACKOFF_MINUTES[1]}, ${BACKOFF_MINUTES[2]}]::int[])[LEAST(attempts + 1, 3)]),
        updated_at = now()
      WHERE id = (
        SELECT id FROM cv_readings
        -- due by the round's time, or by the database's own (a reading made a moment after the round's time was taken)
        WHERE status = 'pending' AND next_try_at <= GREATEST(${at}::timestamptz, now()) AND attempts < ${CV_READING_LIMITS.attempts}
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, application_id, general_cv_id, upload_id, attempts`;
    const r = rows[0];
    return r ? { id: r.id, applicationId: r.application_id, generalCvId: r.general_cv_id, uploadId: r.upload_id, attempts: r.attempts } : null;
  }

  /** The CV's file: its bytes, its type and its name; null when it is gone. */
  private async fileOf(row: Claimed): Promise<{ data: Buffer; mimeType: string; fileName: string } | null> {
    const select = { data: true, mimeType: true, fileName: true } as const;
    const f = row.applicationId
      ? await this.prisma.jobApplicationCv.findUnique({ where: { applicationId: row.applicationId }, select })
      : row.generalCvId
        ? await this.prisma.generalCvFile.findUnique({ where: { generalCvId: row.generalCvId }, select })
        : row.uploadId
          ? await this.prisma.cvUpload.findUnique({ where: { id: row.uploadId }, select })
          : null;
    return f ? { data: Buffer.from(f.data), mimeType: f.mimeType, fileName: f.fileName } : null;
  }

  /** Reads one CV: its text, by its own text or the OCR service; then what the rules find, kept. True once kept (read, or no text). */
  private async read(row: Claimed, now: Date): Promise<boolean> {
    const file = await this.fileOf(row);
    if (!file) {
      await this.fail(row.id, 'The CV is gone.');
      return false;
    }
    let text = '';
    let method: CvReadingMethod | null = null;
    if (file.mimeType === DOCX) {
      text = await cvText(file.data, DOCX, { pages: CV_READING_LIMITS.pdfPages, chars: CV_READING_LIMITS.chars });
      method = 'docx';
    } else if (file.mimeType === PDF) {
      text = await cvText(file.data, PDF, { pages: CV_READING_LIMITS.pdfPages, chars: CV_READING_LIMITS.chars });
      method = 'pdf';
      if (textAmount(text) < CV_READING_LIMITS.minTextChars) {
        // a scan: the OCR service reads it, in English, then in Arabic when that came out mostly Arabic
        const en = await this.ocr.read(file.data, PDF, 'en');
        if (en.status !== 'done') {
          await this.retryLater(row, en.status === 'unavailable' ? 'The OCR service is not set up or not answering.' : 'The OCR service could not read it.');
          return false;
        }
        text = en.text;
        method = 'ocr_en';
        if (mostlyArabic(text)) {
          const ar = await this.ocr.read(file.data, PDF, 'ar');
          if (ar.status === 'done' && textAmount(ar.text) > 0) {
            text = ar.text;
            method = 'ocr_ar';
          }
        }
      }
    } else {
      await this.fail(row.id, 'The CV is neither a PDF nor a Word file.');
      return false;
    }
    const kept = text.slice(0, CV_READING_LIMITS.chars);
    const status: CvReadingStatus = textAmount(kept) > 0 ? 'read' : 'no_text';
    const facts = status === 'read' ? cvFacts(kept, now) : null;
    const { count } = await this.prisma.cvReading.updateMany({
      where: { id: row.id, status: 'pending' },
      data: {
        status,
        method,
        text: status === 'read' ? kept : null,
        facts: facts ? (facts as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        readAt: now,
        error: null,
      },
    });
    if (!count) return false;
    if (row.applicationId) await this.rescoreApplication(row.applicationId);
    if (row.uploadId && status === 'read') await this.fillUpload(row.uploadId, kept);
    // the contacts read from the CV may suggest a match (candidate profiles, 22 October 2026): its candidate worked out again
    if (status === 'read' && row.applicationId) await this.candidates.refreshFor({ applicationId: row.applicationId });
    if (status === 'read' && row.generalCvId) await this.candidates.refreshFor({ generalCvId: row.generalCvId });
    return true;
  }

  /** The OCR service down or failing: tried again at its next try, or failed for good after the last. */
  private async retryLater(row: Claimed, error: string): Promise<void> {
    if (row.attempts >= CV_READING_LIMITS.attempts) return this.fail(row.id, error);
    await this.prisma.cvReading.updateMany({ where: { id: row.id, status: 'pending' }, data: { error } });
  }

  private async fail(id: string, error: string): Promise<void> {
    await this.prisma.cvReading.updateMany({ where: { id, status: 'pending' }, data: { status: 'failed', error } });
  }

  /** A bulk upload's scanned CV read: its row's name, email and mobile, where still empty (or only the file's name). */
  private async fillUpload(uploadId: string, text: string): Promise<void> {
    const u = await this.prisma.cvUpload.findUnique({ where: { id: uploadId }, select: { fileName: true, guess: true } });
    if (!u) return;
    const before = (u.guess && typeof u.guess === 'object' && !Array.isArray(u.guess) ? u.guess : {}) as Partial<CvGuess>;
    const read = cvGuesses(text, u.fileName);
    const fromFile = cvGuesses('', u.fileName).fullName;
    const guess: CvGuess = {
      fullName: before.fullName && before.fullName !== fromFile ? before.fullName : (read.fullName ?? before.fullName ?? null),
      email: before.email ?? read.email,
      mobile: before.mobile ?? read.mobile,
    };
    await this.prisma.cvUpload.update({ where: { id: uploadId }, data: { textFound: true, guess: guess as unknown as Prisma.InputJsonValue } });
  }

  // ---------- the CV fit (25 October 2026) ----------

  /** An application's CV fit for its vacancy, kept on it with its percent as the CV match % (the lists sort and filter by it). */
  async rescoreApplication(applicationId: string, db: Db = this.prisma): Promise<boolean> {
    const a = await db.jobApplication.findUnique({ where: { id: applicationId }, select: { ...APP_FIT_SELECT, vacancy: { select: FIT_VACANCY_SELECT } } });
    return a ? this.keepFit(a, fitJobOf(a.vacancy), await agencyMarksOf(db), db) : false;
  }

  /** Every application of a vacancy scored again (what it is scored by changed: its title, key skills, texts, grade or job title); how many changed. */
  async rescoreVacancy(vacancyId: string): Promise<number> {
    const v = await this.prisma.vacancy.findUnique({ where: { id: vacancyId }, select: FIT_VACANCY_SELECT });
    if (!v) return 0;
    const job = fitJobOf(v);
    const apps = await this.prisma.jobApplication.findMany({ where: { vacancyId }, select: APP_FIT_SELECT });
    const marks = await agencyMarksOf(this.prisma);
    let changed = 0;
    for (const a of apps) if (await this.keepFit(a, job, marks)) changed++;
    return changed;
  }

  /** An application's fit worked out for its vacancy and kept when it changed; whether it did. */
  private async keepFit(a: AppFitRow, job: FitJob, marks: AgencyMarks, db: Db = this.prisma): Promise<boolean> {
    const fit = cvFitOf(job, fitCvOf(a.cvReading, a.yearsExperience, positionOf(a.generalCv), marks));
    const percent = fit?.percent ?? null;
    if (percent === a.cvMatchPercent && canonical(fit) === canonical(a.cvFit)) return false;
    await db.jobApplication.update({ where: { id: a.id }, data: { cvMatchPercent: percent, cvFit: fit ? (fit as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
    return true;
  }

  /**
   * The fits of every application whose CV is read and whose fit is missing or of an older version (CV_FIT_VERSION; the
   * CV match of before, the key skills alone, among them) worked out again, in batches by id, never reading a CV again.
   * Run by the recruitment round (RecruitmentSchedulerService, on the first round after a deploy) under its lock; how many
   * changed. Idempotent: a fit of this version is left as it is.
   */
  async refreshFits(batch = 200): Promise<number> {
    let done = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    // at most 1,000 batches a round (200,000 applications): the next round takes the rest
    for (let round = 0; round < 1000; round++) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`SELECT a.id FROM job_applications a JOIN cv_readings r ON r.application_id = a.id
        WHERE r.status = 'read' AND r.text IS NOT NULL AND a.id > ${after}::uuid
          AND (a.cv_fit IS NULL OR CASE WHEN jsonb_typeof(a.cv_fit->'version') = 'number' THEN (a.cv_fit->>'version')::numeric < ${CV_FIT_VERSION} ELSE true END)
        ORDER BY a.id
        LIMIT ${batch}`;
      for (const r of rows) if (await this.rescoreApplication(r.id)) done++;
      if (rows.length < batch) break;
      after = rows[rows.length - 1].id;
    }
    return done;
  }

  /**
   * A CV's reading carried to where the CV went (a bulk upload's saved as an application or a general CV; a general CV
   * moved to a vacancy), so it isn't read again; in the caller's transaction. Nothing when it wasn't read yet: the round
   * reads it there.
   */
  async carry(tx: Prisma.TransactionClient, from: CvSubject, to: CvSubject): Promise<void> {
    const r = await tx.cvReading.findFirst({ where: from, select: { status: true, method: true, text: true, facts: true, readAt: true } });
    if (!r || (r.status !== 'read' && r.status !== 'no_text')) return;
    await tx.cvReading.upsert({
      where: 'applicationId' in to ? { applicationId: to.applicationId } : 'generalCvId' in to ? { generalCvId: to.generalCvId } : { uploadId: to.uploadId },
      create: { ...to, status: r.status, method: r.method, text: r.text, facts: r.facts ?? Prisma.DbNull, readAt: r.readAt },
      update: {},
    });
  }

  // ---------- what the pages show ----------

  /**
   * A reading as a page shows it; `keySkills`: the vacancy's (an application), or none (a general CV); `fit`: the
   * application's CV fit as kept (25 October 2026), its percent the CV match %.
   */
  view(
    r: { status: string; method: string | null; readAt: Date | null; facts: Prisma.JsonValue | null; text: string | null } | null,
    keySkills: readonly string[] | null,
    fit: CvFit | null = null,
    marks: AgencyMarks = new Map(),
  ): CvReadingView {
    const none = { latestTitle: null, latestCompany: null, workHistory: [], educationDetails: [], cvSkills: [], certifications: [], city: null };
    // a CV come in a moment ago, before the round gave it a reading: being read
    if (!r) return { status: 'pending', method: null, readAt: null, experience: null, education: null, languages: [], skills: keySkills && keySkills.length ? { found: [], missing: [...keySkills] } : null, cvMatchPercent: null, fit: null, ...none };
    const facts = cvFactsOf(r.facts);
    // the key skills as the fit finds them: a dictionary skill under any of its names too (25 October 2026)
    const skills = keySkills && keySkills.length ? (r.status === 'read' && r.text ? keySkillsFound(r.text, keySkills) : { found: [], missing: [...keySkills] }) : null;
    const read = r.status === 'read' && !!r.text;
    return {
      status: r.status as CvReadingStatus,
      method: (r.method as CvReadingMethod | null) ?? null,
      readAt: r.readAt?.toISOString() ?? null,
      experience: experienceText(facts?.experienceMonths ?? null),
      education: facts?.education ?? null,
      languages: facts?.languages ?? [],
      skills,
      // the CV fit's (25 October 2026), as kept on the application
      cvMatchPercent: keySkills && read ? (fit?.percent ?? null) : null,
      fit: keySkills && read ? fit : null,
      // 24 October 2026: more found by the rules (a developer's masked by developer.ts, but for the skills)
      ...(facts
        ? {
            latestTitle: facts.latestTitle,
            latestCompany: facts.latestCompany,
            workHistory: facts.workHistory,
            educationDetails: facts.educationDetails,
            cvSkills: facts.cvSkills,
            certifications: facts.certifications,
            city: facts.city,
          }
        : none),
      // marketing agency background (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or not")
      agency: read ? agencyOf(facts, r.readAt, marks) : null,
    };
  }

  // ---------- the facts worked out again (24 October 2026) ----------

  /**
   * The facts of every CV read before the rules last grew (CV_FACTS_VERSION; 24 October 2026: "CV years in list + more
   * rules") worked out again from its kept text: no reading again, so no OCR. Idempotent: facts of this version are left
   * as they are, and each is worked out as of the month it was read ("present" stays that month, as when it was read).
   * Run by the recruitment round (RecruitmentSchedulerService) under its lock; how many were worked out again.
   */
  async refreshFacts(batch = 200): Promise<number> {
    let done = 0;
    // at most 1,000 batches a round (200,000 CVs): the next round takes the rest
    for (let round = 0; round < 1000; round++) {
      const rows = await this.prisma.$queryRaw<{ id: string; text: string; read_at: Date | null; application_id: string | null }[]>`SELECT id, text, read_at, application_id FROM cv_readings
        WHERE status = 'read' AND text IS NOT NULL
          AND (facts IS NULL OR CASE WHEN jsonb_typeof(facts->'version') = 'number' THEN (facts->>'version')::numeric < ${CV_FACTS_VERSION} ELSE true END)
        ORDER BY id
        LIMIT ${batch}`;
      for (const r of rows) {
        const facts = cvFacts(r.text, r.read_at ?? new Date());
        const { count } = await this.prisma.cvReading.updateMany({ where: { id: r.id, status: 'read' }, data: { facts: facts as unknown as Prisma.InputJsonValue } });
        done += count;
        // its application's fit reads the facts too (25 October 2026)
        if (count && r.application_id) await this.rescoreApplication(r.application_id);
      }
      if (rows.length < batch) break;
    }
    return done;
  }

  /** A CV's text and the contacts found in it (never for a developer: the route is refused to them). */
  async textOf(subject: CvSubject): Promise<CvTextView | null> {
    const r = await this.prisma.cvReading.findFirst({ where: subject, select: { status: true, text: true, facts: true } });
    if (!r) return null;
    const facts = cvFactsOf(r.facts);
    return {
      status: r.status as CvReadingStatus,
      cvText: r.text,
      cvEmails: facts?.emails ?? [],
      cvPhones: facts?.phones ?? [],
      cvLinkedin: facts?.linkedin ?? null,
      cvLinks: facts?.links ?? [],
    };
  }
}

/** What an application is read with for its CV fit (its vacancy's apart). */
const APP_FIT_SELECT = {
  id: true,
  cvMatchPercent: true,
  cvFit: true,
  yearsExperience: true,
  // moved from a general CV: its position counts as a title (25 October 2026)
  generalCv: { select: { positionName: true, positionOther: true } },
  cvReading: FIT_READING,
} satisfies Prisma.JobApplicationSelect;

type AppFitRow = Prisma.JobApplicationGetPayload<{ select: typeof APP_FIT_SELECT }>;
