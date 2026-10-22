import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { APPLICATION_SOURCE_LABELS, APPLICATION_SOURCES, APPLICATION_STAGE_LABELS, GOOD_MATCH_PERCENT } from '@trendlix/shared';
import { Select } from '@/components/select';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { loadApplicants, recruitmentNotLoaded } from '../data';
import { APPLICANTS_PATH, applicantsHref, readApplicantsQuery, readsRecruitment, STAGE_FILTERS, WHO_SEES } from '../recruitment';
import { ApplicantsTable } from '../ui';

// All applicants (owner, 22 October 2026: "where will we include the ATS?"): across the vacancies, best match first, by
// stage, source, a good match (70% and over), experience, or a search on names, email, mobile and reference; those
// filtered out by a must-have apart.

export const metadata: Metadata = { title: 'Applicants · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';

async function Applicants({ searchParams }: { searchParams: PageProps<'/recruitment/applicants'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const q = readApplicantsQuery(query);
  const loaded = await loadApplicants(q);
  return (
    <div className="space-y-4">
      <nav aria-label="Applicants by stage" className="flex flex-wrap gap-2">
        <Link href={applicantsHref(APPLICANTS_PATH, { ...q, stage: '', filtered: 'hide' })} className={`${chip} ${!q.stage && q.filtered === 'hide' ? ACTIVE : IDLE}`}>
          All
        </Link>
        {STAGE_FILTERS.map((s) => (
          <Link key={s} href={applicantsHref(APPLICANTS_PATH, { ...q, stage: s, filtered: 'hide' })} className={`${chip} ${q.stage === s && q.filtered === 'hide' ? ACTIVE : IDLE}`}>
            {APPLICATION_STAGE_LABELS[s]}
          </Link>
        ))}
        <Link href={applicantsHref(APPLICANTS_PATH, { ...q, stage: '', filtered: 'only' })} className={`${chip} ${q.filtered === 'only' ? ACTIVE : IDLE}`}>
          Filtered out
        </Link>
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        {q.stage && <input type="hidden" name="stage" value={q.stage} />}
        {q.filtered !== 'hide' && <input type="hidden" name="filtered" value={q.filtered} />}
        <div className="min-w-56 flex-1">
          <label htmlFor="applicant-search" className="label">
            Search
          </label>
          <input id="applicant-search" name="q" defaultValue={q.q} placeholder="Name, email, mobile or reference" className="input" />
        </div>
        <div>
          <label htmlFor="applicant-source" className="label">
            Source
          </label>
          <Select id="applicant-source" name="source" defaultValue={q.source} className="input min-w-40">
            <option value="">Any</option>
            {APPLICATION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {APPLICATION_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="applicant-match" className="label">
            Match
          </label>
          <Select id="applicant-match" name="minMatch" defaultValue={q.minMatch === null ? '' : String(q.minMatch)} className="input min-w-36">
            <option value="">Any</option>
            <option value={String(GOOD_MATCH_PERCENT)}>{GOOD_MATCH_PERCENT}% and over</option>
            <option value="50">50% and over</option>
          </Select>
        </div>
        <div>
          <label htmlFor="applicant-years" className="label">
            Experience, years at least
          </label>
          <input id="applicant-years" name="minYears" inputMode="decimal" defaultValue={q.minYears === null ? '' : String(q.minYears)} className="input w-28" />
        </div>
        <button type="submit" className="btn btn-secondary">
          Apply filters
        </button>
      </form>
      {loaded.kind !== 'ok' ? (
        <Empty>{recruitmentNotLoaded(loaded, 'applicants')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">Nobody here.</div>
      ) : (
        <ApplicantsTable rows={loaded.value} withVacancy />
      )}
    </div>
  );
}

export default function ApplicantsPage({ searchParams }: PageProps<'/recruitment/applicants'>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Applicants</h1>
        <p className="max-w-3xl text-sm text-muted">Everyone who applied on the careers page, best match first. Open a vacancy to see its own.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Applicants searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
