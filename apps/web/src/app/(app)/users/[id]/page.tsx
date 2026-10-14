import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { UserAccount } from '@/lib/types';
import { setActive, setPassword, updateRoles } from '../actions';
import { BackLink, LINKED_BY_WORK_EMAIL, Loading, RequireAdmin, StatusBadge } from '../ui';
import { PasswordForm, RolesForm, StatusForm } from '../user-forms';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line-soft py-3 last:border-0 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

async function EditUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, user] = await Promise.all([getCurrentUser(), apiGet<UserAccount>(`/users/${id}`)]);
  const self = me.id === user.id;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold break-all">{user.email}</h2>
        <StatusBadge active={user.isActive} />
        {self && <span className="badge bg-line-soft text-muted">You</span>}
      </div>

      <div className="mt-4 space-y-6">
        <section className="card max-w-xl px-6 py-3">
          <dl>
            <Row label="Employee">
              {user.employee ? (
                <Link href={`/employees/${user.employee.id}`}>
                  {user.employee.fullNameEn} <span className="text-muted">· {user.employee.employeeCode}</span>
                </Link>
              ) : (
                <span className="text-muted">No employee has this work email.</span>
              )}
              <p className="hint">{LINKED_BY_WORK_EMAIL}</p>
            </Row>
            <Row label="Last sign-in">
              {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : <span className="text-muted">Never</span>}
            </Row>
            <Row label="Created">{formatDate(user.createdAt)}</Row>
          </dl>
        </section>

        <RolesForm action={updateRoles.bind(null, id)} roles={user.roles} self={self} />

        <section className="card max-w-xl space-y-3 p-6">
          <h3 className="font-semibold">{user.isActive ? 'Deactivate' : 'Reactivate'}</h3>
          {self ? (
            <p className="text-sm text-muted">You cannot deactivate your own account. Another admin can do it.</p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {user.isActive
                  ? 'Deactivating signs them out at once and stops them signing in. Nothing else is deleted, and you can reactivate the account later.'
                  : 'This account is deactivated: they cannot sign in.'}
              </p>
              <StatusForm action={setActive.bind(null, id)} active={user.isActive} email={user.email} />
            </>
          )}
        </section>

        {self ? (
          <section className="card max-w-xl p-6">
            <h3 className="font-semibold">Password</h3>
            <p className="mt-1 text-sm text-muted">
              To change your own password, use <Link href="/account/password">Change password</Link>.
            </p>
          </section>
        ) : (
          <PasswordForm action={setPassword.bind(null, id)} email={user.email} />
        )}
      </div>
    </>
  );
}

export default function UserPage({ params }: PageProps<'/users/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/users">Users</BackLink>
      <Suspense fallback={<Loading />}>
        <RequireAdmin>
          <EditUser params={params} />
        </RequireAdmin>
      </Suspense>
    </div>
  );
}
