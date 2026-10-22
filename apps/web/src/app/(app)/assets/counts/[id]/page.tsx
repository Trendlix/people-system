import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../../organization/ui';
import { CountResults } from '../../count-pages';
import { Loading } from '../../ui';

// A count's results (Assets step 5; owner, 22 October 2026: "stock counts"; spec §5: "history with missing items and
// 'Mark lost'"): each asset found, missing or out, missing first, with Mark lost for a custodian or a manager.

export const metadata: Metadata = { title: 'Count · People System' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Results({ params }: { params: PageProps<'/assets/counts/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <CountResults id={id} />;
}

export default function CountPage({ params }: PageProps<'/assets/counts/[id]'>) {
  return (
    <div className="max-w-3xl space-y-4">
      <BackLink href={ASSET_PATHS.counts}>Counts</BackLink>
      <Suspense fallback={<Loading />}>
        <Results params={params} />
      </Suspense>
    </div>
  );
}
