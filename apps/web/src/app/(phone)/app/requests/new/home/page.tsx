import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { AskHome, AskHomeHeading } from '../../../../../(app)/home-locations/new/ask-home';
import { PhoneLoading } from '../../../ui';

// Ask for a home location on the phone pages (owner, 20 October 2026: "allow other users to request to add their home
// locations when working from home"): the site's page and form (home-locations/new/ask-home.tsx), "Use my current
// location" reading the app's own location inside the app, coming back to the phone pages once sent.

export const metadata: Metadata = { title: 'Ask for a Home Location · Trendlix People' };

export default function PhoneAskHomePage() {
  return (
    <div className="space-y-5">
      <AskHomeHeading back={appBack('requests')} />
      <Suspense fallback={<PhoneLoading />}>
        <AskHome surface="requests" />
      </Suspense>
    </div>
  );
}
