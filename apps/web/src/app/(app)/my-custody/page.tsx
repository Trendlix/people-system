import { sessionKindOf } from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { APP_CUSTODY_PATHS } from '@/lib/asset-paths';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../dashboard/cards';
import { Loading, profileHref } from '../employees/ui';

// My custody's address (Assets step 3; owner, 21 October 2026: "Yes, My custody"), the one its notifications open
// ("You received 3 items: CUS-0042"): the person's own profile on its Custody tab; inside the Trendlix People app (its
// web view says so in its user agent), the phone pages' My Custody.

export const metadata: Metadata = { title: 'My Custody · People System' };

async function ToMyCustody() {
  const h = await headers();
  if (sessionKindOf(h.get('user-agent')) === 'app') redirect(APP_CUSTODY_PATHS.mine);
  const user = await getCurrentUser();
  if (user.employeeId) redirect(profileHref(user.employeeId, 'custody'));
  return <NoProfile user={user} />;
}

export default function MyCustodyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ToMyCustody />
    </Suspense>
  );
}
