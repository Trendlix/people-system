import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { NewPermission, NewPermissionHeading } from './new-permission';

// A new permission request (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum
// 2 hours per day"): new-permission.tsx, shared with the phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'New Permission · People System' };

export default function NewPermissionPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <Suspense
        fallback={
          <>
            <NewPermissionHeading back={null} />
            <Loading />
          </>
        }
      >
        <NewPermission />
      </Suspense>
    </div>
  );
}
