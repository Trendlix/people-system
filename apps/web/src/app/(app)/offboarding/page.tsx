import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { END_REASON_LABELS, EXIT_INTERVIEW_STATUS_LABELS, OFFBOARDING_STATUS_LABELS, REHIRE_LABELS, type EndReason } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { loadCases, offboardingNotLoaded } from './data';
import {
  CASE_FILTERS,
  caseHref,
  casesHref,
  FORMER_EMPLOYEES_PATH,
  managesOffboarding,
  OFFBOARDING_CHECKLIST_PATH,
  progressText,
  readCasesFilter,
  REHIRE_STYLE,
  STATUS_STYLE,
  TURNOVER_PATH,
} from './offboarding';
import { joinShown, shownCode } from '@/lib/hidden';

// Offboarding (owner, 21 October 2026: "when an employee resigns or contract ends with no renewal, where will the data be
// stored? will it be another tab?"; 22 October 2026, the full module): the cases, those in clearance first (?status=
// for completed, cancelled or all). HR, the CEO and a Super Admin see every case (a C-level person's only the CEO and a
// Super Admin), with the exit interview and rehire eligibility; those who clear items (a direct manager, an Admin,
// Finance, the Assets custodians) see the cases with items of theirs, and how many wait for them. A case opens when
// the CEO approves an ending, or when an employment is ended by hand.

export const metadata: Metadata = { title: 'Offboarding · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-on-accent hover:text-on-accent';
const IDLE = 'border-line bg-card text-ink hover:bg-canvas hover:text-ink';

async function Cases({ searchParams }: { searchParams: PageProps<'/offboarding'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const filter = readCasesFilter(query);
  const manages = managesOffboarding(user);
  const loaded = await loadCases(filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <nav aria-label="Which cases" className="flex flex-wrap gap-2">
          {CASE_FILTERS.map((f) => (
            <Link key={f.value} href={casesHref(f.value)} aria-current={f.value === filter ? 'page' : undefined} className={`${chip} ${f.value === filter ? ACTIVE : IDLE}`}>
              {f.label}
            </Link>
          ))}
        </nav>
        {manages && (
          <div className="flex flex-wrap gap-2">
            <Link href={FORMER_EMPLOYEES_PATH} className="btn btn-secondary no-underline">
              Former employees
            </Link>
            <Link href={TURNOVER_PATH} className="btn btn-secondary no-underline">
              Turnover
            </Link>
            <Link href={OFFBOARDING_CHECKLIST_PATH} className="btn btn-secondary no-underline">
              Clearance checklist
            </Link>
          </div>
        )}
      </div>
      {loaded.kind !== 'ok' ? (
        <Empty>{offboardingNotLoaded(loaded, 'offboarding cases')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">
          {filter === 'open'
            ? manages
              ? 'Nobody is in clearance. A case opens when the CEO approves an ending, or when an employment is ended.'
              : 'No clearance items wait for you.'
            : 'No cases here.'}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Last Working Day</th>
                <th>Clearance</th>
                {manages ? (
                  <>
                    <th>Exit Interview</th>
                    <th>Rehire</th>
                  </>
                ) : (
                  <th>For You</th>
                )}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loaded.value.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={caseHref(c.id)} className="font-semibold">
                      {c.employee.fullNameEn}
                    </Link>
                    <div className="text-xs text-muted">{joinShown([c.jobTitle, c.department]) || shownCode(c.employee.employeeCode)}</div>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {c.lastWorkingDay ? formatDate(c.lastWorkingDay) : <span className="text-muted">—</span>}
                    {c.lastDayAgreed && <div className="text-xs text-muted">Agreed</div>}
                    {c.endReason && <div className="text-xs text-muted">{END_REASON_LABELS[c.endReason as EndReason] ?? c.endReason}</div>}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{progressText(c.progress)}</td>
                  {manages ? (
                    <>
                      <td>{c.exitInterview ? EXIT_INTERVIEW_STATUS_LABELS[c.exitInterview] : '—'}</td>
                      <td>{c.rehire ? <span className={`badge ${REHIRE_STYLE[c.rehire]}`}>{REHIRE_LABELS[c.rehire]}</span> : <span className="text-muted">Not set</span>}</td>
                    </>
                  ) : (
                    <td className="tabular-nums">{c.mine ? `${c.mine} ${c.mine === 1 ? 'item' : 'items'}` : <span className="text-muted">None</span>}</td>
                  )}
                  <td>
                    <span className={`badge ${STATUS_STYLE[c.status]}`}>{OFFBOARDING_STATUS_LABELS[c.status]}</span>
                    {c.completedAt && <div className="text-xs text-muted">{formatDate(c.completedAt)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function OffboardingPage({ searchParams }: PageProps<'/offboarding'>) {
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="page-title">Offboarding</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Everyone leaving, from the CEO&apos;s approval of their ending (or the day their employment is ended) until their clearance is done: what they hold
          is received back, each item is cleared by the person in charge of it, the final settlement is paid, and the exit interview and rehire eligibility
          are recorded.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Cases searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
