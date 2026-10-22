import { ConflictException } from '@nestjs/common';
import { normalEmail, type ApplicationSource } from '@trendlix/shared';
import { Prisma } from '../generated/prisma/client.js';
import { nextApplicationNumber } from './application-numbers.js';
import { attachCandidate, findCandidates, foundIds, refreshCandidate, type AttachedCandidate } from './candidate-links.js';

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
  /** The candidate it belongs to already (a general CV moved to a vacancy keeps its own; 22 October 2026). */
  candidateId?: string | null;
  /** When the person sent it (a general CV's own time), for their candidate's latest name; now when left out. */
  sentAt?: Date;
}

/**
 * The application made, in the transaction, with its candidate (candidate profiles, 22 October 2026: "Email or mobile"):
 * 409 when that email has applied for the vacancy already, or the same person by their mobile (their candidate), each
 * naming the application there.
 */
export async function createHrApplication(tx: Prisma.TransactionClient, a: HrApplicationInput): Promise<{ id: string; number: string; candidate: AttachedCandidate }> {
  const email = normalEmail(a.email);
  const before = await tx.jobApplication.findUnique({ where: { vacancyId_email: { vacancyId: a.vacancyId, email } }, select: { number: true } });
  if (before) throw new ConflictException(`${email} applied for this job already (${before.number}).`);
  // the candidates' lock first, before the series' (candidate-links.ts)
  const found = await findCandidates(tx, { email, mobile: a.mobile });
  const ids = [...new Set([...foundIds(found), ...(a.candidateId ? [a.candidateId] : [])])];
  const again = ids.length
    ? await tx.jobApplication.findFirst({ where: { vacancyId: a.vacancyId, candidateId: { in: ids } }, select: { number: true, candidate: { select: { code: true } } } })
    : null;
  if (again) throw new ConflictException(`The same person applied for this job already (${again.number}${again.candidate ? `, ${again.candidate.code}` : ''}).`);
  const candidate = await attachCandidate(
    tx,
    { fullName: a.fullName, email, mobile: a.mobile, linkedin: a.linkedin ?? null, portfolio: a.portfolio ?? null, at: a.sentAt, candidateId: a.candidateId ?? null },
    found,
  );
  const number = a.number ?? (await nextApplicationNumber(tx));
  const now = new Date();
  try {
    const made = await tx.jobApplication.create({
      data: {
        number,
        vacancyId: a.vacancyId,
        candidateId: candidate.id,
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
    await refreshCandidate(tx, candidate.id);
    return { ...made, candidate };
  } catch (err) {
    // the same email saved meanwhile (the vacancy and email are one application's)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(`${email} applied for this job already.`);
    throw err;
  }
}
