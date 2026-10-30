import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LABELS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { loadVacancies, recruitmentNotLoaded } from '../data';
import { managesRecruitment, NEW_VACANCY_PATH, readsRecruitment, readVacancyFilter, vacanciesHref, VACANCY_FILTERS, vacancyHref, WHO_SEES } from '../recruitment';
import { suggestionsHref } from '../suggestions';
import { VacancyStatusBadge } from '../ui';

// Vacancies (owner, 22 October 2026: "where will we include the ATS?"; "HR creates a vacancy and the CEO approves it"):
// the active ones first (drafts, those waiting for the CEO, open, on hold), or by status, with their applicants (and those
// still to review) and hires against the headcount. HR drafts a new one from a job title. Since 24 October 2026 (owner:
// "Suggest; HR adds"): "Suggestions: N", the earlier CVs waiting for HR on an open one, to its Suggested From Earlier CVs.

export const metadata: Metadata = { title: 'Vacancies · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-on-accent hover:text-on-accent';
const IDLE = 'border-line bg-card text-ink hover:bg-canvas hover:text-ink';

async function Vacancies({ searchParams }: { searchParams: PageProps<'/recruitment/vacancies'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!readsRecruitment(user)) return <Empty>{WHO_SEES}</Empty>;
  const filter = readVacancyFilter(query);
  const loaded = await loadVacancies(filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <nav aria-label="Which vacancies" className="flex flex-wrap gap-2">
          {VACANCY_FILTERS.map((f) => (
            <Link key={f.value} href={vacanciesHref({ status: f.value, q: filter.q })} aria-current={f.value === filter.status ? 'page' : undefined} className={`${chip} ${f.value === filter.status ? ACTIVE : IDLE}`}>
              {f.label}
            </Link>
          ))}
        </nav>
        {managesRecruitment(user) && (
          <Link href={NEW_VACANCY_PATH} className="btn btn-primary no-underline">
            New vacancy
          </Link>
        )}
      </div>
      <form method="get" className="flex max-w-md gap-2" role="search">
        {filter.status !== 'active' && <input type="hidden" name="status" value={filter.status} />}
        <label htmlFor="vacancy-search" className="sr-only">
          Search vacancies
        </label>
        <input id="vacancy-search" name="q" defaultValue={filter.q} placeholder="Title, number or job title" className="input" />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
      {loaded.kind !== 'ok' ? (
        <Empty>{recruitmentNotLoaded(loaded, 'vacancies')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">No vacancies here.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Vacancy</th>
                <th>Status</th>
                <th>Department</th>
                <th className="text-right">Applicants</th>
                <th className="text-right">Hired</th>
                <th>Closing date</th>
              </tr>
            </thead>
            <tbody>
              {loaded.value.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link href={vacancyHref(v.id)} className="font-semibold">
                      {v.title}
                    </Link>
                    <span className="block text-xs text-muted">
                      {v.number} · {LABELS.employmentType[v.employmentType]}
                      {v.confidential ? ' · C-level' : ''}
                    </span>
                  </td>
                  <td>
                    <VacancyStatusBadge status={v.status} />
                    {(v.suggestions ?? 0) > 0 && (
                      <Link href={suggestionsHref(v.id)} className="mt-1 block text-xs font-semibold whitespace-nowrap">
                        Suggestions: {v.suggestions}
                      </Link>
                    )}
                  </td>
                  <td className="text-sm">{v.department?.nameEn ?? '—'}</td>
                  <td className="text-right tabular-nums">
                    {v.applicants}
                    {v.toReview > 0 && <span className="block text-xs text-accent">{v.toReview} to review</span>}
                  </td>
                  <td className="text-right tabular-nums">
                    {v.hired} of {v.headcount}
                  </td>
                  <td className="text-sm whitespace-nowrap">{v.closingDate ? formatDate(v.closingDate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function VacanciesPage({ searchParams }: PageProps<'/recruitment/vacancies'>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="page-title">Vacancies</h1>
        <p className="max-w-3xl text-sm text-muted">
          HR drafts a vacancy from a job title and sends it to the CEO; once approved, it is on the careers page until it closes or its hires reach the
          headcount.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Vacancies searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
