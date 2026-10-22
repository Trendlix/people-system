import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { NewCount } from '../../../../../(app)/assets/count-pages';
import { readCountScope } from '../../../../../(app)/assets/counts';
import { PhoneLoading } from '../../../ui';

// A new count on the phone (Assets step 5; owner, 22 October 2026: "stock counts"): the site's count sheet in the phone
// layout, its labels scanned with the camera where the phone's browser can read QR codes.

export const metadata: Metadata = { title: 'New Count · Trendlix People' };

async function Sheet({ searchParams }: { searchParams: PageProps<'/app/assets/counts/new'>['searchParams'] }) {
  return <NewCount scope={readCountScope(await searchParams)} phone />;
}

export default function PhoneNewCountPage({ searchParams }: PageProps<'/app/assets/counts/new'>) {
  return (
    <div className="space-y-4">
      <Link href={APP_ASSET_PATHS.counts} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">
        <span aria-hidden="true">←</span> Counts
      </Link>
      <Suspense fallback={<PhoneLoading />}>
        <Sheet searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
