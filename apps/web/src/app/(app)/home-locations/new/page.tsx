import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { MY_HOMES_HREF } from '../home-locations';
import { AskHome, AskHomeHeading } from './ask-home';

// Ask for a home location (owner, 20 October 2026: "allow other users to request to add their home locations when working
// from home"): ask-home.tsx, shared with the phone pages.

export const metadata: Metadata = { title: 'Request a Check-in Location · People System' };

// ?from=refusal: opened from a check-in refused for its location (owner, 24 October 2026: "allow the employee to request
// adding this location"), the point it was refused at filled in
export default function AskHomePage({ searchParams }: PageProps<'/home-locations/new'>) {
  return (
    <div className="max-w-4xl space-y-6">
      <AskHomeHeading back={{ href: MY_HOMES_HREF, label: 'My Requests' }} />
      <Suspense fallback={<Loading />}>
        <AskHome searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
