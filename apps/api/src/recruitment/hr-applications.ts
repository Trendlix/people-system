import { ConflictException } from '@nestjs/common';
import { normalEmail, type ApplicationSource } from '@trendlix/shared';
import { Prisma } from '../generated/prisma/client.js';
import { nextApplicationNumber } from './application-numbers.js';

// An application HR makes rather than the applicant (owner, 22 October 2026; packages/shared general-cvs.ts): a general
// CV moved to a vacancy, or a CV of a bulk upload (LinkedIn's Easy Apply). The vacancy's screening questions weren't
// asked, so it has no answers and no match ("—") and is never filtered out; its consent is HR's, with who and why; its
// history starts with "Applied" (and "Shortlisted" when HR chose that), noting where it came from.

export interface HrApplicationInput {
  /** A general CV's own reference, kept for the application made from it; none: the series' next. */
  number?: string;
  vacancyId: string;
  stage: 'applied' | 'shortlisted';
  fullName: string;
  email: string;
  mobile: string;
  linkedin?: string | null;
  portfolio?: string | null;
  yearsExperience?: number | Prisma.Decimal | null;
  noticePeriod?: string | null;
  expectedSalary?: number | Prisma.Decimal | null;
  source: ApplicationSource;
  consentAt: Date;
  /** Who recorded the consent (HR); null when it was the person's own (a general CV sent on the careers page). */
  consentById: string | null;
  consentNote: string;
  cv: { fileName: string; mimeType: string; sizeBytes: number; data: Uint8Array };
  /** The history's first step's note: where it came from. */
  note: string;
  byId: string;
}

/** The application made, in the transaction; 409 when that email has applied for the vacancy already. */
export async function createHrApplication(tx: Prisma.TransactionClient, a: HrApplicationInput): Promise<{ id: string; number: string }> {
  const email = normalEmail(a.email);
  const before = await tx.jobApplication.findUnique({ where: { vacancyId_email: { vacancyId: a.vacancyId, email } }, select: { number: true } });
  if (before) throw new ConflictException(`${email} applied for this job already (${before.number}).`);
  const number = a.number ?? (await nextApplicationNumber(tx));
  const now = new Date();
  try {
    return await tx.jobApplication.create({
      data: {
        number,
        vacancyId: a.vacancyId,
        stage: a.stage,
        fullName: a.fullName.trim().replace(/\s+/g, ' '),
        email,
        mobile: a.mobile.trim(),
        linkedin: a.linkedin ?? null,
        portfolio: a.portfolio ?? null,
        yearsExperience: a.yearsExperience ?? null,
        noticePeriod: a.noticePeriod ?? null,
        expectedSalary: a.expectedSalary ?? null,
        answers: {},
        points: 0,
        maxPoints: 0,
        matchPercent: null,
        knockedOut: [],
        filteredOut: false,
        source: a.source,
        consentAt: a.consentAt,
        consentById: a.consentById,
        consentNote: a.consentNote,
        cv: { create: { ...a.cv, data: new Uint8Array(a.cv.data) } },
        steps: {
          create: [
            { event: 'applied', stage: 'applied', note: a.note, byId: a.byId, at: now },
            ...(a.stage === 'shortlisted' ? [{ event: 'shortlisted', stage: 'shortlisted', byId: a.byId, at: new Date(now.getTime() + 1) }] : []),
          ],
        },
      },
      select: { id: true, number: true },
    });
  } catch (err) {
    // the same email saved meanwhile (the vacancy and email are one application's)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(`${email} applied for this job already.`);
    throw err;
  }
}
