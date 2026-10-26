import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { notLoadedText } from '../payroll/load';
import { loadResignations } from './data';
import { readResignationFilter, RESIGNATION_FILTERS, resignationsHref, seesResignations } from './resignation';
import { ResignationsTable } from './ui';

// Resignations (owner, 26 October 2026: "but the employee has to request resignation and then the HR generates the
// document"): the requests employees sent, under People beside Offboarding. Waiting first (?status= for recorded, returned,
// withdrawn or all). HR, the CEO and a Super Admin see them (a C-level person's only the CEO and a Super Admin); each opens
// its page, where HR records the resignation as the ending or returns the request.

export const metadata: Metadata = { title: 'Resignations · People System' };

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';

async function Requests({ searchParams }: { searchParams: PageProps<'/resignations'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesResignations(user)) return <Empty>Only HR and the CEO see the resignation requests.</Empty>;
  const filter = readResignationFilter(query);
  const loaded = await loadResignations(filter);
  return (
    <div className="space-y-4">
      <nav aria-label="Which requests" className="flex flex-wrap gap-2">
        {RESIGNATION_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={resignationsHref(f.value)}
            aria-current={f.value === filter ? 'page' : undefined}
            className={`${chip} ${f.value === filter ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {loaded.kind !== 'ok' ? (
        <Empty>{notLoadedText(loaded, 'resignation requests')}</Empty>
      ) : loaded.value.length === 0 ? (
        <Empty>{filter === 'sent' ? 'No resignation request is waiting.' : 'No requests here.'}</Empty>
      ) : (
        <ResignationsTable requests={loaded.value} who note="Newest first. Open one to record the resignation or return it." />
      )}
    </div>
  );
}

export default function ResignationsPage({ searchParams }: PageProps<'/resignations'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Resignations</h1>
      <p className="mt-1 text-muted">
        What employees asked for with Resign on My Requests. Record the resignation to open the End employment form with it filled in; the ending, its
        document, the labour office certification and the CEO&apos;s approval carry on as always.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Requests searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
