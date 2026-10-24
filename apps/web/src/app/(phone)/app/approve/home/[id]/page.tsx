import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HomeLocationDetail } from '../../../../../(app)/home-locations/[id]/home-location';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; "then approved by the HR and CEO"): a home location waiting for the caller, HR's step (with the radius) or the
// CEO's, its point on a small map and every step: the site's page (home-locations/[id]/home-location.tsx), its back link
// to the phone pages' To Approve, and what is done on it coming back here.

export const metadata: Metadata = { title: 'Check-in Location · Trendlix People' };

export default function PhoneApproveHomePage({ params, searchParams }: PageProps<'/app/approve/home/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <HomeLocationDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
