import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { employeeBadge, type CandidateListItem } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { CandidatesTabs } from '../candidate-ui';
import { CANDIDATES_PATH, candidateHref, candidatesFiltering, latestText, readCandidatesQuery } from '../candidates';
import { loadCandidates, recruitmentNotLoaded } from '../data';
import { generalCvHref } from '../general';
import { applicantHref, readsRecruitment, WHO_SEES } from '../recruitment';
import { ExperienceCell, MinYearsSelect, VerdictBadge, VerdictSelect } from '../ui';
import { shownCode } from '@/lib/hidden';

// Candidates (owner, 22 October 2026: "how to make like a profile for each candidate to store history and prevent
// duplication? even if the same candidate applied for 2 jobs"): one row per person, whatever they applied for: their
// name and code, how many applications, their latest job and where it stands, when they last applied, where it came
// from, and "Former employee". Search by name, email, mobile (as typed in any form), code or the CVs' text; the possible
// matches HR hasn't decided apart, with their count. HR, the CEO and a Super Admin.
// Their experience too (owner, 24 October 2026: "why isn't the experience pulled off the CV?"; "CV years in list + more
// rules"): of their applications and general CVs, the most years (those typed, else the CV's estimate, "≈ 4 y · CV"),
// with a Min. experience filter by the same rule.
// Their latest screening verdict across what the caller sees of them, with a Verdict filter (owner, 24 October 2026:
// "Yes: Good fit / Maybe / Not a fit").

export const metadata: Metadata = { title: 'Candidates · People System' };

function CandidatesTable({ rows }: { rows: CandidateListItem[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th className="text-right">Applications</th>
            <th className="text-right">Experience</th>
            <th>Latest</th>
            <th>Last applied</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const badge = employeeBadge(c.employee);
            return (
              <tr key={c.id}>
                <td>
                  <Link href={candidateHref(c.id)} className="font-semibold">
                    {c.fullName}
                  </Link>
                  {shownCode(c.code) && <span className="block text-xs text-muted">{c.code}</span>}
                  <span className="mt-1 flex flex-wrap gap-1">
                    <VerdictBadge verdict={c.verdict} />
                    {badge && <span className="badge bg-warn-soft text-warn">{badge}</span>}
                    {c.openMatches > 0 && <span className="badge bg-accent-soft text-accent">{c.openMatches === 1 ? 'Possible match' : `${c.openMatches} possible matches`}</span>}
                  </span>
                </td>
                <td className="text-right tabular-nums">
                  {c.applications}
                  {c.generalCvs > 0 && <span className="block text-xs text-muted">+ {c.generalCvs} general</span>}
                </td>
                <ExperienceCell typed={c.yearsExperience} fromCv={c.fromCv} />
                <td className="text-sm">
                  {c.latest ? (
                    <>
                      <Link href={c.latest.kind === 'application' ? applicantHref(c.latest.id) : generalCvHref(c.latest.id)}>{c.latest.title}</Link>
                      <span className="block text-xs text-muted">{latestText(c.latest)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-sm whitespace-nowrap">{c.lastAppliedAt ? formatDate(c.lastAppliedAt) : '—'}</td>
                <td className="text-sm">{c.latest?.source ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function Candidates({ searchParams }: { searchParams: PageProps<'/recruitment/candidates'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const f = readCandidatesQuery(query);
  const loaded = await loadCandidates(f);
  return (
    <div className="space-y-4">
      <CandidatesTabs on="list" />
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-56 flex-1">
          <label htmlFor="candidate-search" className="label">
            Search
          </label>
          <input id="candidate-search" name="q" defaultValue={f.q} placeholder="Name, email, mobile, code (CAN-0001) or the CV's text" className="input" />
        </div>
        <MinYearsSelect id="candidate-years" value={f.minYears} />
        <VerdictSelect id="candidate-verdict" value={f.verdict} />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {candidatesFiltering(f) && (
          <Link href={CANDIDATES_PATH} className="btn btn-secondary no-underline">
            Clear
          </Link>
        )}
      </form>
      {loaded.kind !== 'ok' ? (
        <Empty>{recruitmentNotLoaded(loaded, 'candidates')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">{candidatesFiltering(f) ? 'Nobody here.' : 'No candidates yet. Everyone who applies or sends a CV gets one.'}</div>
      ) : (
        <CandidatesTable rows={loaded.value} />
      )}
    </div>
  );
}

export default function CandidatesPage({ searchParams }: PageProps<'/recruitment/candidates'>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Candidates</h1>
        <p className="max-w-3xl text-sm text-muted">One profile per person, with every application, CV, interview and offer. The same email or mobile joins a profile by itself; other signs are suggested to HR.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Candidates searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
