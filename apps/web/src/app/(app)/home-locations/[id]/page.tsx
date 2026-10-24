import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { HomeLocationDetail } from './home-location';

// A home location request (owner, 20 October 2026: "allow other users to request to add their home locations when
// working from home"): home-location.tsx, shared with the phone pages. Since 24 October 2026 a remote site's or a client
// location's too ("Home Location - Remote Site - Client Location").

export const metadata: Metadata = { title: 'Check-in Location · People System' };

export default function HomeLocationPage({ params, searchParams }: PageProps<'/home-locations/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <HomeLocationDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
