import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { MY_HOMES_HREF } from '../home-locations';
import { AskHome, AskHomeHeading } from './ask-home';

// Ask for a home location (owner, 20 October 2026: "allow other users to request to add their home locations when working
// from home"): ask-home.tsx, shared with the phone pages.

export const metadata: Metadata = { title: 'Ask for a Home Location · People System' };

export default function AskHomePage() {
  return (
    <div className="max-w-4xl space-y-6">
      <AskHomeHeading back={{ href: MY_HOMES_HREF, label: 'My Requests' }} />
      <Suspense fallback={<Loading />}>
        <AskHome />
      </Suspense>
    </div>
  );
}
