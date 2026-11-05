import Link from 'next/link';
import { APPLICATION_STAGE_LABELS, REVIEW_STAGES, type ReviewApplicant, type ReviewGroup, type ReviewStage } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import { FitPercent, MatchValue } from './cv-fit-ui';
import { applicantHref } from './recruitment';
import { BatchTick, BatchTickAll, ReviewSelection } from './shortlist-ui';
import { ExperienceCell, LatestRoleCell } from './ui';

// My Hiring's reviews waiting (the recruitment tree, owner, 3 November 2026: "HR1 (Recruter) - HR2 (Her MAnager if there
// is) - then Manager"; "Tick several at once"; 5 November 2026: Review 2 the Final Review, the hiring manager's review
// gone): the Final Review of the vacancies whose recruiter the person manages; a card per vacancy and review, the longest
// waiting first (the API's order), with their CV match, match, experience (the Ex-agency and Skipper flags under it),
// latest role and since when they wait; ticked, then passed or rejected together with optional feedback (shortlist-ui.tsx
// ReviewSelection). The recruiter reviews Applicants on the vacancy's page.

/** A vacancy's applicants split by the review they wait for, in the tree's order. */
export function reviewCards(groups: readonly ReviewGroup[]): { vacancy: ReviewGroup['vacancy']; stage: ReviewStage; applicants: ReviewApplicant[] }[] {
  return groups.flatMap((g) =>
    REVIEW_STAGES
      .map((stage) => ({ vacancy: g.vacancy, stage, applicants: g.applicants.filter((a) => a.stage === stage) }))
      .filter((c) => c.applicants.length > 0),
  );
}

/** The reviews waiting; `reviews`: the person takes a review (else the section isn't shown when nothing waits). */
export function ShortlistToReview({ groups, reviews }: { groups: readonly ReviewGroup[]; reviews: boolean }) {
  if (!reviews && !groups.length) return null;
  const cards = reviewCards(groups);
  return (
    <section aria-labelledby="my-reviews" className="space-y-3">
      <h2 id="my-reviews" className="text-lg font-semibold">
        Waiting for Your Review
      </h2>
      {cards.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">Nothing to review.</div>
      ) : (
        cards.map((c) => <ReviewCard key={`${c.vacancy.id}-${c.stage}`} card={c} />)
      )}
    </section>
  );
}

function ReviewCard({ card }: { card: ReturnType<typeof reviewCards>[number] }) {
  const { vacancy, stage, applicants } = card;
  const headingId = `review-${vacancy.id}-${stage}`;
  return (
    <section aria-labelledby={headingId} className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h3 id={headingId} className="font-semibold">
          {vacancy.title} · {APPLICATION_STAGE_LABELS[stage]}
        </h3>
        <p className="text-xs text-muted">
          {shownCode(vacancy.number) && `${vacancy.number} · `}
          {applicants.length} waiting
        </p>
      </div>
      <ReviewSelection vacancyId={vacancy.id} stage={stage} ids={applicants.map((a) => a.id)}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="w-11 px-1">
                  <BatchTickAll label={`Select all waiting for ${APPLICATION_STAGE_LABELS[stage]} of ${vacancy.title}`} />
                </th>
                <th scope="col">Applicant</th>
                <th scope="col" className="text-right">
                  CV match
                </th>
                <th scope="col" className="text-right">
                  Match
                </th>
                <th scope="col" className="text-right">
                  Experience
                </th>
                <th scope="col">Latest role</th>
                <th scope="col">Waiting since</th>
              </tr>
            </thead>
            <tbody>
              {applicants.map((a) => {
                return (
                  <tr key={a.id}>
                    <td className="w-11 px-1">
                      <BatchTick id={a.id} label={a.fullName} />
                    </td>
                    <td>
                      <Link href={applicantHref(a.id)} className="font-semibold">
                        {a.fullName}
                      </Link>
                      {shownCode(a.number) && <span className="block text-xs text-muted">{a.number}</span>}
                    </td>
                    <td className="text-right">
                      <FitPercent percent={a.cvMatchPercent} />
                    </td>
                    <td className="text-right tabular-nums">
                      <MatchValue a={a} />
                    </td>
                    {/* the years typed, else the CV's; the Ex-agency and Skipper flags under them */}
                    <ExperienceCell typed={a.yearsTyped} fromCv={a.fromCv} />
                    <LatestRoleCell fromCv={a.fromCv} />
                    <td className="text-sm whitespace-nowrap">{a.since ? formatDate(a.since) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ReviewSelection>
    </section>
  );
}
