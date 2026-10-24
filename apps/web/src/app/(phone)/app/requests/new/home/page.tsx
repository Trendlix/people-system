import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { AskHome, AskHomeHeading } from '../../../../../(app)/home-locations/new/ask-home';
import { PhoneLoading } from '../../../ui';

// Ask for a home location on the phone pages (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"): the site's page and form (home-locations/new/ask-home.tsx), "Use my current
// location" reading the app's own location inside the app, coming back to the phone pages once sent. Since 24 October
// 2026 any check-in location ("Home Location - Remote Site - Client Location"), and from a refused check-in
// (?from=refusal) with the point it was refused at.

export const metadata: Metadata = { title: 'Request a Check-in Location · Trendlix People' };

export default function PhoneAskHomePage({ searchParams }: PageProps<'/app/requests/new/home'>) {
  return (
    <div className="space-y-5">
      <AskHomeHeading back={appBack('requests')} />
      <Suspense fallback={<PhoneLoading />}>
        <AskHome surface="requests" searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
