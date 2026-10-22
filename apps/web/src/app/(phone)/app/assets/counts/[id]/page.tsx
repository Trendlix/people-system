import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { CountResults } from '../../../../../(app)/assets/count-pages';
import { PhoneLoading } from '../../../ui';

// A count's results on the phone (Assets step 5; owner, 22 October 2026: "stock counts"): missing first, with Mark lost
// for a custodian or a manager, each asset opening in the phone layout.

export const metadata: Metadata = { title: 'Count · Trendlix People' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Results({ params }: { params: PageProps<'/app/assets/counts/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <CountResults id={id} phone />;
}

export default function PhoneCountPage({ params }: PageProps<'/app/assets/counts/[id]'>) {
  return (
    <div className="space-y-4">
      <Link href={APP_ASSET_PATHS.counts} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">
        <span aria-hidden="true">←</span> Counts
      </Link>
      <Suspense fallback={<PhoneLoading />}>
        <Results params={params} />
      </Suspense>
    </div>
  );
}
