import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../../organization/ui';
import { NewCount } from '../../count-pages';
import { readCountScope } from '../../counts';
import { Loading } from '../../ui';

// A new count (Assets step 5; owner, 22 October 2026: "stock counts"): the sheet of the group, room or kit in the address
// (?kind=group&group=, ?kind=room&roomId=, ?kind=kit&kitId=), ticked by tapping, typing or scanning, then saved.

export const metadata: Metadata = { title: 'New Count · People System' };

async function Sheet({ searchParams }: { searchParams: PageProps<'/assets/counts/new'>['searchParams'] }) {
  return <NewCount scope={readCountScope(await searchParams)} />;
}

export default function NewCountPage({ searchParams }: PageProps<'/assets/counts/new'>) {
  return (
    <div className="max-w-3xl space-y-4">
      <BackLink href={ASSET_PATHS.counts}>Counts</BackLink>
      <Suspense fallback={<Loading />}>
        <Sheet searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
