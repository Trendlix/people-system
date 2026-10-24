import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HomeLocationDetail } from '../../../../../(app)/home-locations/[id]/home-location';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"): their own home location request, with every step, Withdraw while it is being decided and Remove once approved:
// the site's page (home-locations/[id]/home-location.tsx), its back link to the phone pages' My Requests, and what is
// done on it coming back here.

export const metadata: Metadata = { title: 'Check-in Location · Trendlix People' };

export default function PhoneRequestsHomePage({ params, searchParams }: PageProps<'/app/requests/home/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <HomeLocationDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
