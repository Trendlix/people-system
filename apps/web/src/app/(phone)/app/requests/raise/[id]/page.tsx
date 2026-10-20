import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../../../../../(app)/dashboard/cards';
import { isOpenRaise } from '../../../../../(app)/my-requests/requests';
import { RaiseCard } from '../../../../../(app)/my-requests/raise-card';
import { UUID } from '../../../../../(app)/organization/ui';
import { loadOwnProfile } from '../../../../../(app)/own-profile';
import { loadEmployeeRaiseRequests } from '../../../../../(app)/raise-requests/data';
import { PageTitle, PhoneLoading } from '../../../ui';

// A raise request of the employee's on the phone pages (owner, 20 October 2026: the employee app, "raise requests"):
// the card My Requests shows (my-requests/raise-card.tsx): the reason and comment, the month it is asked from, the raise
// suggested and prepared, where it stands and every step, as the API shapes it for them.

export const metadata: Metadata = { title: 'Raise Request · TrendLIX People' };

async function Request({ params }: { params: PageProps<'/app/requests/raise/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const loaded = await loadEmployeeRaiseRequests(profile.id);
  const r = loaded.kind === 'ok' ? loaded.value.requests.find((q) => q.id === id) : undefined;
  if (!r) notFound();
  return (
    <ul>
      <RaiseCard item={{ kind: 'raise', id: r.id, at: r.createdAt, open: isOpenRaise(r), request: r }} link={null} />
    </ul>
  );
}

export default function PhoneRaiseRequestPage({ params }: PageProps<'/app/requests/raise/[id]'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="Raise Request" back={appBack('requests')} />
      <Suspense fallback={<PhoneLoading />}>
        <Request params={params} />
      </Suspense>
    </div>
  );
}
