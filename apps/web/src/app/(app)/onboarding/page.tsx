import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ONBOARDING_STATUS_LABELS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { progressText } from '../offboarding/offboarding';
import { loadOnboardingList, onboardingNotLoaded } from './data';
import { managesOnboarding, ONBOARDING_CHECKLIST_PATH, ONBOARDING_FILTERS, onboardingHref, onboardingListHref, readOnboardingFilter, STATUS_STYLE } from './onboarding';

// Onboarding (owner, 22 October 2026, the ATS's Phase 2): the checklists in progress (or completed, or all), newest
// first, each with how far it is. One opens when an applicant is hired through an accepted job offer, or from a new
// employee's profile. HR, the CEO and a Super Admin; a C-level person's only the CEO and a Super Admin.

export const metadata: Metadata = { title: 'Onboarding · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';
const ACTIVE = 'border-ink bg-ink text-white hover:text-white';
const IDLE = 'border-line bg-white text-ink hover:bg-canvas hover:text-ink';

async function List({ searchParams }: { searchParams: PageProps<'/onboarding'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!managesOnboarding(user)) return <Empty>Only HR, the CEO and a Super Admin handle onboarding.</Empty>;
  const filter = readOnboardingFilter(query);
  const loaded = await loadOnboardingList(filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <nav aria-label="Which checklists" className="flex flex-wrap gap-2">
          {ONBOARDING_FILTERS.map((f) => (
            <Link key={f.value} href={onboardingListHref(f.value)} aria-current={f.value === filter ? 'page' : undefined} className={`${chip} ${f.value === filter ? ACTIVE : IDLE}`}>
              {f.label}
            </Link>
          ))}
        </nav>
        <Link href={ONBOARDING_CHECKLIST_PATH} className="btn btn-secondary no-underline">
          Default items
        </Link>
      </div>
      {loaded.kind !== 'ok' ? (
        <Empty>{onboardingNotLoaded(loaded, 'onboarding')}</Empty>
      ) : loaded.value.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">No onboarding here.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Joins</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loaded.value.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={onboardingHref(c.id)} className="font-semibold">
                      {c.employee.fullNameEn}
                    </Link>
                    <span className="block text-xs text-muted">{[c.employee.employeeCode, c.jobTitle, c.department].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="text-sm whitespace-nowrap">{formatDate(c.joinDate)}</td>
                  <td className="text-sm">{progressText(c.progress)}</td>
                  <td>
                    <span className={`badge ${STATUS_STYLE[c.status]}`}>{ONBOARDING_STATUS_LABELS[c.status]}</span>
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

export default function OnboardingPage({ searchParams }: PageProps<'/onboarding'>) {
  return (
    <div className="max-w-5xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Onboarding</h1>
        <p className="max-w-3xl text-sm text-muted">
          A checklist for each new employee: opened when an applicant is hired through an accepted job offer, or from a new employee’s profile. The contract,
          the KPI template and their equipment are ticked by the system.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
