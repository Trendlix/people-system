import { ROLES } from '@trendlix/shared';
import { Suspense } from 'react';
import { assignableRoles } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { createUser } from '../actions';
import { BackLink, Loading, RequireAdmin } from '../ui';
import { NewUserForm } from '../user-forms';

/** Super Admin is offered only to a Super Admin. */
async function NewUser() {
  const me = await getCurrentUser();
  return <NewUserForm action={createUser} choices={assignableRoles(me, ROLES)} />;
}

export default function NewUserPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/users">Users</BackLink>
      <h2 className="text-lg font-semibold">New User</h2>
      <Suspense fallback={<Loading />}>
        <RequireAdmin>
          <NewUser />
        </RequireAdmin>
      </Suspense>
    </div>
  );
}
