import type { ReviewApplicant, ReviewGroup, ReviewStage } from '@trendlix/shared';
import type { PrismaService } from '../prisma/prisma.service.js';
import { agencyMarksOf } from './agency-marks.js';
import { reviewOrder } from './hiring-batches.js';
import { cvListFactsOf, money } from './recruitment-views.js';

// My Hiring's reviews waiting (the recruitment tree, owner, 3 November 2026: "HR1 (Recruter) - HR2 (Her MAnager if there
// is) - then Manager"; "Tick several at once"; packages/shared recruitment-tree.ts): the applicants at the Review 2 of
// the open (or on hold) vacancies whose recruiter the person manages now, and at the Final Review of those they hire for,
// never one filtered out; each with their match, the CV's facts (the Ex-agency and Skipper flags with HR's agency marks,
// as the lists read them), the years they typed, and when they reached that review; the longest waiting first. A
// vacancy with nobody waiting is left out. One read of the applicants, one of the agency marks.

const LIVE = { in: ['open', 'on_hold'] };

/** The applicants waiting for the review of `selfId` (an employee's id), a vacancy each, the vacancies by number. */
export async function reviewsWaiting(prisma: PrismaService, selfId: string): Promise<ReviewGroup[]> {
  const [rows, marks] = await Promise.all([
    prisma.jobApplication.findMany({
      where: {
        filteredOut: false,
        OR: [
          { stage: 'review_2', vacancy: { status: LIVE, recruiter: { employments: { some: { endDate: null, managerId: selfId } } } } },
          { stage: 'final_review', vacancy: { status: LIVE, hiringManagerId: selfId } },
        ],
      },
      select: {
        id: true,
        number: true,
        fullName: true,
        stage: true,
        vacancy: { select: { id: true, number: true, title: true } },
        matchPercent: true,
        cvMatchPercent: true,
        yearsExperience: true,
        cv: { select: { sizeBytes: true } },
        cvReading: { select: { status: true, facts: true, readAt: true } },
        // when they reached it: the latest step to their stage
        steps: { orderBy: { at: 'desc' }, take: 5, select: { stage: true, at: true } },
      },
      take: 500,
    }),
    agencyMarksOf(prisma),
  ]);
  const groups = new Map<string, ReviewGroup>();
  for (const r of rows) {
    const g = groups.get(r.vacancy.id) ?? { vacancy: r.vacancy, applicants: [] as ReviewApplicant[] };
    g.applicants.push({
      id: r.id,
      number: r.number,
      fullName: r.fullName,
      stage: r.stage as ReviewStage,
      matchPercent: r.matchPercent,
      cvMatchPercent: r.cvMatchPercent,
      fromCv: cvListFactsOf(!!r.cv, r.cvReading, marks),
      yearsTyped: money(r.yearsExperience),
      since: r.steps.find((s) => s.stage === r.stage)?.at.toISOString() ?? null,
    });
    groups.set(r.vacancy.id, g);
  }
  return [...groups.values()].sort((a, b) => a.vacancy.number.localeCompare(b.vacancy.number)).map((g) => ({ ...g, applicants: reviewOrder(g.applicants) }));
}
