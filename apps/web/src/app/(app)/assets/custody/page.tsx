import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CUSTODY_PATHS } from '@/lib/asset-paths';
import { asCustodyQuery, custodyChips, custodyPagesOf, readCustodyQuery, recordsText } from '../custody';
import { loadCustodyList } from '../custody-data';
import { CustodyTable } from '../custody-ui';
import { assetsCaller, assetsNotLoaded } from '../data';
import { AssetsFrame } from '../frame';
import { Empty, Loading, NoAccess } from '../ui';

// Custody (Assets step 3; the spec's Custody: "Filters: Active, Overdue, Not signed, Closed, All. 'New handover'"): the
// custody records, those still out first unless another filter is chosen, each chip with how many the search finds; a
// search by the record's code, its purpose, or the name or code of whose it is; New handover for a custodian or a
// manager. Overdue: a shoot past its return date and not closed (spec §6.2). Not signed: no signed copy attached yet.
// C-level people's records only for those who see them, as the API lists them.

export const metadata: Metadata = { title: 'Custody · People System' };

const chip = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap no-underline';
const ACTIVE = 'border-ink bg-ink text-on-accent hover:text-on-accent';
const IDLE = 'border-line bg-card text-ink hover:bg-canvas hover:text-ink';

async function List({ searchParams }: { searchParams: PageProps<'/assets/custody'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  const query = readCustodyQuery(params);
  const loaded = await loadCustodyList(asCustodyQuery(query));
  const counts = loaded.kind === 'ok' ? loaded.value.counts : null;
  const pages = loaded.kind === 'ok' ? custodyPagesOf(loaded.value, query) : null;
  return (
    <div className="space-y-4">
      <form action={CUSTODY_PATHS.list} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="custody-search" className="label">
            Search
          </label>
          <input id="custody-search" name="q" type="search" maxLength={100} defaultValue={query.q} placeholder="A code (CUS-0042), a name or an employee code" className="input" />
        </div>
        {query.filter !== 'active' && <input type="hidden" name="filter" value={query.filter} />}
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {query.q && (
          <Link href={CUSTODY_PATHS.listWith({ filter: query.filter })} className="btn btn-secondary">
            Clear
          </Link>
        )}
        {can.register && (
          <Link href={CUSTODY_PATHS.new} className="btn btn-primary sm:ml-auto">
            New handover
          </Link>
        )}
      </form>

      <nav aria-label="Filters" className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {custodyChips(query, counts).map((c) => (
          <Link key={c.key} href={c.href} aria-current={c.active ? 'page' : undefined} className={`${chip} ${c.active ? ACTIVE : IDLE}`}>
            {c.label}
            {c.count !== undefined && <span className={`tabular-nums ${c.active ? 'opacity-75' : 'text-muted'}`}>{c.count}</span>}
          </Link>
        ))}
      </nav>

      {loaded.kind !== 'ok' ? (
        <Empty>{assetsNotLoaded(loaded, 'custody records')}</Empty>
      ) : loaded.value.items.length === 0 ? (
        <Empty>{query.q || query.filter !== 'active' ? 'No custody record matches. Try another filter or search.' : 'Nothing is out now.'}</Empty>
      ) : (
        <>
          <CustodyTable rows={loaded.value.items} href={CUSTODY_PATHS.record} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted tabular-nums">
              {recordsText(loaded.value.total)}
              {pages && pages.count > 1 ? ` · page ${loaded.value.page} of ${pages.count}` : ''}.
            </p>
            {pages && pages.count > 1 && (
              <nav aria-label="Pages" className="flex gap-2">
                {pages.previous && (
                  <Link href={pages.previous} className="btn btn-secondary">
                    Previous
                  </Link>
                )}
                {pages.next && (
                  <Link href={pages.next} className="btn btn-secondary">
                    Next
                  </Link>
                )}
              </nav>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Custody → Records (owner, 24 October 2026: "7 entries, the rest as tabs"), under Custody's heading (frame.tsx)
export default function CustodyPage({ searchParams }: PageProps<'/assets/custody'>) {
  return (
    <AssetsFrame tab={CUSTODY_PATHS.list}>
      <p className="text-muted">
        Assets handed over to employees: for a shoot, back by its return date, or held long term until clearance. Each record&apos;s form is printed,
        signed on paper, and its signed copy attached.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <List searchParams={searchParams} />
        </Suspense>
      </div>
    </AssetsFrame>
  );
}
