import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../../organization/ui';
import { CandidatesTabs, MatchItem } from '../../candidate-ui';
import { loadPossibleMatches, recruitmentNotLoaded } from '../../data';
import { managesRecruitment, readsRecruitment, WHO_SEES } from '../../recruitment';

// Possible matches (owner, 22 October 2026: "the same email or mobile joins automatically"; "and their is a possible
// match from other fields, HR decides from suggested match"): the possible duplicates (one candidate's email with
// another's mobile, never merged by itself) and the suggestions from the other signs (the same LinkedIn, portfolio, CV
// file, name, a nearly identical email, the mobile with another country code, a contact found in a CV), strongest first,
// a name alone last. HR merges a pair (the older candidate kept) or dismisses it ("Not the same person": never
// suggested again).

export const metadata: Metadata = { title: 'Possible Matches · People System' };

async function Matches() {
  const user = await getCurrentUser();
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const loaded = await loadPossibleMatches();
  const manages = managesRecruitment(user);
  return (
    <div className="space-y-4">
      <CandidatesTabs on="matches" />
      {loaded.kind !== 'ok' ? (
        <Empty>{recruitmentNotLoaded(loaded, 'possible matches')}</Empty>
      ) : loaded.value.duplicates.length + loaded.value.suggested.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">Nothing to decide: no possible duplicates or suggested matches.</div>
      ) : (
        <>
          {loaded.value.duplicates.length > 0 && (
            <section aria-labelledby="matches-duplicates" className="card space-y-3 p-6">
              <h2 id="matches-duplicates" className="text-lg font-semibold">
                Possible Duplicates
              </h2>
              <p className="text-sm text-muted">The same email or mobile on two candidates: an application with one candidate’s email and another’s mobile, or a profile split.</p>
              <ul className="space-y-3">
                {loaded.value.duplicates.map((m) => (
                  <MatchItem key={m.id} m={m} selfId={null} manages={manages} />
                ))}
              </ul>
            </section>
          )}
          {loaded.value.suggested.length > 0 && (
            <section aria-labelledby="matches-suggested" className="card space-y-3 p-6">
              <h2 id="matches-suggested" className="text-lg font-semibold">
                Suggested Matches
              </h2>
              <p className="text-sm text-muted">Signs that two candidates may be one person. They are never joined by themselves: merge them, or say they are not the same person.</p>
              <ul className="space-y-3">
                {loaded.value.suggested.map((m) => (
                  <MatchItem key={m.id} m={m} selfId={null} manages={manages} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default function PossibleMatchesPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Possible Matches</h1>
        <p className="max-w-3xl text-sm text-muted">Candidates who may be one person, for HR to decide.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Matches />
      </Suspense>
    </div>
  );
}
