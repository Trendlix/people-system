import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CUSTODY_PATHS } from '@/lib/asset-paths';
import { itemsText, valueText } from '../custody';
import { loadHolders } from '../custody-data';
import { assetsCaller, assetsNotLoaded } from '../data';
import { AssetsFrame } from '../frame';
import { Empty, Loading, NoAccess } from '../ui';
import { shownCode } from '@/lib/hidden';

// Holdings (Assets step 3; the spec's Employees (holdings): "Type a name or ID to see what they hold"; cards with
// holdings count and value): for anyone with Assets access, a search by a name or an employee code (current employees,
// and anyone with a custody record), else everyone holding something now; each card with how many assets they hold, how
// many are overdue, their damaged and missing items, and for the CEO, Finance and a Super Admin what they hold is worth
// (its value when it was handed over: the API sends it to them only). C-level people only for those who see them.

export const metadata: Metadata = { title: 'Holdings · People System' };

async function Cards({ searchParams }: { searchParams: PageProps<'/assets/holders'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : '';
  const loaded = await loadHolders(q || null);
  return (
    <div className="space-y-4">
      <form action={CUSTODY_PATHS.holders} role="search" className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="holders-search" className="label">
            Type a name or code to see what they hold
          </label>
          <input id="holders-search" name="q" type="search" maxLength={100} defaultValue={q} placeholder="E.g. Mona or EMP-0007" className="input" />
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {q && (
          <Link href={CUSTODY_PATHS.holders} className="btn btn-secondary">
            Clear
          </Link>
        )}
      </form>
      {loaded.kind !== 'ok' ? (
        <Empty>{assetsNotLoaded(loaded, 'holdings')}</Empty>
      ) : loaded.value.length === 0 ? (
        <Empty>{q ? `Nobody matches "${q}".` : 'Nobody holds anything now.'}</Empty>
      ) : (
        <>
          {!q && <p className="text-sm text-muted">Everyone holding something now:</p>}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {loaded.value.map((c) => (
              <li key={c.employee.id}>
                <Link href={CUSTODY_PATHS.person(c.employee.id)} className="card block h-full p-4 text-ink no-underline hover:border-accent">
                  <span className="block font-semibold">{c.employee.fullNameEn}</span>
                  {shownCode(c.employee.employeeCode) && <span className="block text-xs text-muted">{c.employee.employeeCode}</span>}
                  <span className="mt-3 flex flex-wrap gap-1.5 text-sm">
                    <span className="badge bg-accent-soft text-accent">{c.holding ? `Holds ${itemsText(c.holding)}` : 'Holds nothing now'}</span>
                    {c.overdue > 0 && <span className="badge bg-danger-soft text-danger">{c.overdue} overdue</span>}
                    {c.damagedOrMissing > 0 && <span className="badge bg-warn-soft text-warn">{c.damagedOrMissing} damaged or missing</span>}
                  </span>
                  {'value' in c && <span className="mt-2 block text-sm tabular-nums">Value held: {valueText(c.value)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Custody → Holdings (owner, 24 October 2026: "7 entries, the rest as tabs"): its tab names it, under Custody's heading
// (frame.tsx)
export default function HoldersPage({ searchParams }: PageProps<'/assets/holders'>) {
  return (
    <AssetsFrame tab={CUSTODY_PATHS.holders}>
      <div className="max-w-6xl">
        <p className="text-muted">What each employee holds of the company&apos;s assets, since when, and what came back damaged or missing.</p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <Cards searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </AssetsFrame>
  );
}
