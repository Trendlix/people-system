import type { HiringSuggestion, ReviewApplicant, ReviewGroup } from '@trendlix/shared';
import type { PrismaService } from '../prisma/prisma.service.js';
import { agencyMarksOf } from './agency-marks.js';
import { reviewOrder } from './hiring-batches.js';
import { hiringManagerApplications } from './recruitment-scope.js';
import { cvListFactsOf, money } from './recruitment-views.js';

// My Hiring's shortlist to review (owner, 29 October 2026: "Manager view the shortlisted and accept or reject them";
// "Tick several at once"; packages/shared hiring-steps.ts): for each open (or on hold) vacancy the person hires for, its
// shortlisted applicants (never one filtered out), those not reviewed yet first, then those accepted, then those
// rejected; each with their match, the CV's facts (the Ex-agency and Skipper flags with HR's agency marks, as the lists
// read them), the years they typed, their review and its note, and when they were shortlisted. A vacancy with nobody
// shortlisted is left out. One read of the applicants, one of the agency marks.

/** The shortlists waiting for the hiring manager `selfId` on these vacancies (theirs), in the vacancies' order. */
export async function shortlistsToReview(prisma: PrismaService, vacancies: readonly { id: string; number: string; title: string }[], selfId: string): Promise<ReviewGroup[]> {
  if (!vacancies.length) return [];
  const [rows, marks] = await Promise.all([
    prisma.jobApplication.findMany({
      where: { AND: [{ vacancyId: { in: vacancies.map((v) => v.id) } }, hiringManagerApplications(selfId), { stage: 'shortlisted', filteredOut: false }] },
      select: {
        id: true,
        number: true,
        fullName: true,
        vacancyId: true,
        matchPercent: true,
        cvMatchPercent: true,
        yearsExperience: true,
        suggestion: true,
        suggestionNote: true,
        cv: { select: { sizeBytes: true } },
        cvReading: { select: { status: true, facts: true, readAt: true } },
        // the latest time they were shortlisted (shortlisted again after a step back, the latest)
        steps: { where: { event: 'shortlisted' }, orderBy: { at: 'desc' }, take: 1, select: { at: true } },
      },
    }),
    agencyMarksOf(prisma),
  ]);
  const byVacancy = new Map<string, ReviewApplicant[]>();
  for (const r of rows) {
    const list = byVacancy.get(r.vacancyId) ?? [];
    list.push({
      id: r.id,
      number: r.number,
      fullName: r.fullName,
      matchPercent: r.matchPercent,
      cvMatchPercent: r.cvMatchPercent,
      fromCv: cvListFactsOf(!!r.cv, r.cvReading, marks),
      yearsTyped: money(r.yearsExperience),
      suggestion: (r.suggestion as HiringSuggestion | null) ?? null,
      note: r.suggestion ? r.suggestionNote : null,
      shortlistedAt: r.steps[0]?.at.toISOString() ?? null,
    });
    byVacancy.set(r.vacancyId, list);
  }
  return vacancies
    .map((v) => ({
      vacancy: { id: v.id, number: v.number, title: v.title },
      applicants: reviewOrder(byVacancy.get(v.id) ?? []),
    }))
    .filter((g) => g.applicants.length > 0);
}
