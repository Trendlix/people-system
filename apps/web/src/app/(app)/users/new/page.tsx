import { Suspense } from 'react';
import { createUser } from '../actions';
import { BackLink, Loading, RequireAdmin } from '../ui';
import { NewUserForm } from '../user-forms';

export default function NewUserPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/users">Users</BackLink>
      <h2 className="text-lg font-semibold">New User</h2>
      <Suspense fallback={<Loading />}>
        <RequireAdmin>
          <NewUserForm action={createUser} />
        </RequireAdmin>
      </Suspense>
    </div>
  );
}
