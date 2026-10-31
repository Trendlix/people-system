import { sessionKindOf } from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { PageHead } from '@/components/design';
import { APP_CUSTODY_PATHS } from '@/lib/asset-paths';
import { getCurrentUser } from '@/lib/session';
import { assetsNotLoaded } from '../assets/data';
import { loadMyCustody } from '../assets/custody-data';
import { MyCustody } from '../assets/custody/my-custody';
import { NoProfile } from '../dashboard/cards';
import { Loading } from '../employees/ui';
import { Empty } from '../organization/ui';

// My Assets (owner, 31 October 2026: "show the employee assets, the ones he received from the company"; "every employee
// sees his assets"): what the person holds of the company's assets, since when and until when, and their custody records
// with their signed forms, read only and never a value (GET /me/custody). Its own page in every employee's sidebar (and
// the user menu of HR, Finance, the CEO and Admins with a profile), so the sidebar highlights it; the same as their
// profile's Custody tab, now shown to every employee too. Its notifications ("You received 3 items: CUS-0042") open it.
// Inside the old Trendlix People app (its web view says so in its user agent), the phone pages' My Custody.

export const metadata: Metadata = { title: 'My Assets · People System' };

async function Mine() {
  const h = await headers();
  if (sessionKindOf(h.get('user-agent')) === 'app') redirect(APP_CUSTODY_PATHS.mine);
  const user = await getCurrentUser();
  if (!user.employeeId) return <NoProfile user={user} />;
  const loaded = await loadMyCustody();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'custody')}</Empty>;
  return <MyCustody view={loaded.value} />;
}

export default function MyAssetsPage() {
  return (
    <div>
      <PageHead
        eyebrow="People System · Assets"
        title="My Assets"
        intro="The company’s assets handed over to you, since when and until when, and your custody records with their signed forms. The asset team records each handover and return."
      />
      <div className="mt-7">
        <Suspense fallback={<Loading />}>
          <Mine />
        </Suspense>
      </div>
    </div>
  );
}
