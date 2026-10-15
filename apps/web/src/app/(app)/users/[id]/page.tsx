import { ROLES } from '@trendlix/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { assignableRoles, canChangeAccount, isSuperAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { UserAccount } from '@/lib/types';
import { setActive, setPassword, updateRoles } from '../actions';
import { BackLink, LINKED_BY_WORK_EMAIL, Loading, ONLY_SUPER_ADMIN_CHANGES, RequireAdmin, RoleBadges, StatusBadge } from '../ui';
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
  // A Super Admin's roles, active flag and password are a Super Admin's to change: an Admin sees them read-only (the
  // API refuses with 403). Only a Super Admin is offered the Super Admin role.
  const mayChange = canChangeAccount(me, user);
  const rolesHint = !self
    ? 'Changes apply straight away, even if they are signed in.'
    : isSuperAdmin(user)
      ? 'This is your own account: you cannot remove your own admin rights, and the last active Super Admin keeps that role.'
      : 'This is your own account: you cannot remove your own Admin role.';

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

        {mayChange ? (
          <RolesForm action={updateRoles.bind(null, id)} roles={user.roles} choices={assignableRoles(me, ROLES)} hint={rolesHint} />
        ) : (
          <section className="card max-w-xl space-y-3 p-6">
            <h3 className="font-semibold">Roles</h3>
            <RoleBadges roles={user.roles} />
            <p className="text-sm text-muted">{ONLY_SUPER_ADMIN_CHANGES}</p>
          </section>
        )}

        {mayChange && (
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
        )}

        {mayChange &&
          (self ? (
            <section className="card max-w-xl p-6">
              <h3 className="font-semibold">Password</h3>
              <p className="mt-1 text-sm text-muted">
                To change your own password, use <Link href="/account/password">Change password</Link>.
              </p>
            </section>
          ) : (
            <PasswordForm action={setPassword.bind(null, id)} email={user.email} />
          ))}
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
