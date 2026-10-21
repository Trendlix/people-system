import type { Metadata } from 'next';
import { Suspense } from 'react';
import { APP_PATHS } from '@/lib/surface';
import { assetsNotLoaded } from '../../../(app)/assets/data';
import { loadMyCustody } from '../../../(app)/assets/custody-data';
import { MyCustody } from '../../../(app)/assets/custody/my-custody';
import { PageTitle, PhoneCard, PhoneLoading, Quiet } from '../ui';

// My Custody on the phone pages (owner, 21 October 2026: "Yes, My custody"; the brief: "in the app (a card or tab on the
// phone pages), read only"): what the person holds of the company's assets, since when, the return dates and what is
// overdue, and their custody records with their signed forms. The same as on their profile's Custody tab; the
// notifications of their handovers and returns open it.

export const metadata: Metadata = { title: 'My Custody · Trendlix People' };

async function Mine() {
  const loaded = await loadMyCustody();
  if (loaded.kind !== 'ok') {
    return (
      <PhoneCard>
        <Quiet>{assetsNotLoaded(loaded, 'custody')}</Quiet>
      </PhoneCard>
    );
  }
  if (!loaded.value.employeeId) {
    return (
      <PhoneCard>
        <Quiet>No employee record uses your sign-in email as its work email yet, so there is no custody of yours to show.</Quiet>
      </PhoneCard>
    );
  }
  return <MyCustody view={loaded.value} />;
}

export default function PhoneMyCustodyPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="My Custody" back={{ href: APP_PATHS.home, label: 'Home' }}>
        The company&apos;s assets handed over to you, and your signed forms.
      </PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Mine />
      </Suspense>
    </div>
  );
}
