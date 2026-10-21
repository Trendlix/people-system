import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { canChangeAccount } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { UserAccount } from '@/lib/types';
import { accessShort } from '../assets/assets';
import { LINKED_BY_WORK_EMAIL, Loading, RequireAdmin, RoleBadges, StatusBadge } from './ui';

async function UsersList() {
  const [me, users] = await Promise.all([getCurrentUser(), apiGet<UserAccount[]>('/users')]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {users.length} {users.length === 1 ? 'user' : 'users'}
        </p>
        <Link href="/users/new" className="btn btn-primary">
          New user
        </Link>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Employee</th>
              <th>Assets</th>
              <th>Last Sign-In</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-medium break-all">
                  {u.email}
                  {u.id === me.id && <span className="font-normal text-muted"> (you)</span>}
                </td>
                <td>
                  <RoleBadges roles={u.roles} />
                </td>
                <td>
                  <StatusBadge active={u.isActive} />
                </td>
                <td>
                  {u.employee ? (
                    <Link href={`/employees/${u.employee.id}`}>
                      {u.employee.fullNameEn} <span className="whitespace-nowrap text-muted">· {u.employee.employeeCode}</span>
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                {/* the Assets access in effect (owner, 21 October 2026: "3 levels per user") */}
                <td className="whitespace-nowrap">{accessShort(u.assetsAccessInEffect)}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {u.lastSignInAt ? formatDateTime(u.lastSignInAt) : <span className="text-muted">Never</span>}
                </td>
                <td className="text-right">
                  {/* a Super Admin's account is read-only for an Admin */}
                  <Link href={`/users/${u.id}`}>
                    {canChangeAccount(me, u) ? 'Edit' : 'View'}
                    <span className="sr-only"> {u.email}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Employee: {LINKED_BY_WORK_EMAIL}</p>
    </>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RequireAdmin>
        <UsersList />
      </RequireAdmin>
    </Suspense>
  );
}
