import Link from 'next/link';
import type { ReviewGroup } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import { FitPercent, MatchValue } from './cv-fit-ui';
import { boardHref } from './hiring';
import { applicantHref } from './recruitment';
import { reviewBadge } from './shortlist';
import { BatchTick, BatchTickAll, ReviewSelection } from './shortlist-ui';
import { ExperienceCell, LatestRoleCell } from './ui';

// My Hiring's Shortlist to Review (owner, 29 October 2026: "Manager view the shortlisted and accept or reject them";
// asked, "Tick several at once"): each vacancy the person hires for with its shortlisted applicants, those not reviewed
// yet first (the API's order), with their CV match, match, experience (the Ex-agency and Skipper flags under it) and
// latest role, when they were shortlisted and their review so far; ticked, then accepted or rejected together with a
// note for HR (shortlist-ui.tsx ReviewSelection).

/** The shortlists to review; `hires`: the person hires for a vacancy (else the section isn't shown). */
export function ShortlistToReview({ groups, hires }: { groups: readonly ReviewGroup[]; hires: boolean }) {
  if (!hires && !groups.length) return null;
  return (
    <section aria-labelledby="my-shortlist" className="space-y-3">
      <div className="space-y-1">
        <h2 id="my-shortlist" className="text-lg font-semibold">
          Shortlist to Review
        </h2>
        <p className="max-w-3xl text-sm text-muted">
          Tick the applicants HR shortlisted, then accept or reject them together. HR makes a screening call with those you accept, and confirms those you reject.
        </p>
      </div>
      {groups.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">Nothing to review: HR hasn’t shortlisted anyone for your vacancies yet.</div>
      ) : (
        groups.map((g) => <ReviewCard key={g.vacancy.id} group={g} />)
      )}
    </section>
  );
}

function ReviewCard({ group }: { group: ReviewGroup }) {
  const { vacancy, applicants } = group;
  const headingId = `review-${vacancy.id}`;
  return (
    <section aria-labelledby={headingId} className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h3 id={headingId} className="font-semibold">
          <Link href={boardHref(vacancy.id)}>{vacancy.title}</Link>
        </h3>
        <p className="text-xs text-muted">
          {shownCode(vacancy.number) && `${vacancy.number} · `}
          {applicants.length} shortlisted
        </p>
      </div>
      <ReviewSelection vacancyId={vacancy.id} ids={applicants.map((a) => a.id)}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="w-11 px-1">
                  <BatchTickAll label={`Select all shortlisted for ${vacancy.title}`} />
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
                <th scope="col">Shortlisted</th>
                <th scope="col">Your review</th>
              </tr>
            </thead>
            <tbody>
              {applicants.map((a) => {
                const badge = reviewBadge(a.suggestion);
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
                    <td className="text-sm whitespace-nowrap">{a.shortlistedAt ? formatDate(a.shortlistedAt) : '—'}</td>
                    <td className="text-sm">
                      <span className={`badge ${badge.className}`} title={badge.title}>
                        {badge.label}
                      </span>
                      {a.note && (
                        <span className="mt-1 block max-w-64 text-xs text-muted" dir="auto">
                          {a.note}
                        </span>
                      )}
                    </td>
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
