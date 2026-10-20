import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewPermission, NewPermissionHeading } from '../../../../../(app)/leave/permissions/new/new-permission';
import { PhoneLoading } from '../../../ui';

// New permission on the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): the site's
// page and form (leave/permissions/new/new-permission.tsx), coming back to the phone pages once sent.

export const metadata: Metadata = { title: 'New Permission · Trendlix People' };

export default function PhoneNewPermissionPage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <>
            <NewPermissionHeading back={appBack('requests')} />
            <PhoneLoading />
          </>
        }
      >
        <NewPermission surface="requests" />
      </Suspense>
    </div>
  );
}
