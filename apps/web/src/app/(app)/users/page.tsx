import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { canChangeAccount } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { UserAccount } from '@/lib/types';
import { accessShort } from '../assets/assets';
import { profileHref } from '../employees/tab-list';
import { Loading, managesAccessOnProfile, RequireAdmin, RoleBadges, StatusBadge, USERS_PAGE_NOTE } from './ui';
import { shownCode } from '@/lib/hidden';

// The accounts that aren't an employee's (owner, 22 October 2026: "any active employee with active contract should have
// access", managed "On the employee profile"): a developer, an outside accountant. ?show=all lists the employees'
// accounts too, for an Admin who doesn't open profiles (no HR role): theirs open here, everyone else's on the profile.

async function UsersList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const all = query.show === 'all';
  const [me, users] = await Promise.all([getCurrentUser(), apiGet<UserAccount[]>(all ? '/users' : '/users?only=other')]);
  const onProfile = managesAccessOnProfile(me);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {users.length} {all ? (users.length === 1 ? 'account' : 'accounts') : users.length === 1 ? 'other account' : 'other accounts'}
          {' · '}
          <Link href={all ? '/users' : '/users?show=all'}>{all ? 'Only the other accounts' : 'Show employees’ accounts too'}</Link>
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
              {all && <th>Employee</th>}
              <th>Assets</th>
              <th>Last Sign-In</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={all ? 7 : 6} className="py-8 text-center text-sm text-muted">
                  No other accounts yet.
                </td>
              </tr>
            )}
            {users.map((u) => {
              // an employee's account opens on their profile's Access tab, for those who open profiles
              const href = u.employee && onProfile ? profileHref(u.employee.id, 'access') : `/users/${u.id}`;
              return (
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
                  {all && (
                    <td>
                      {u.employee ? (
                        <span>
                          {u.employee.fullNameEn} {shownCode(u.employee.employeeCode) && <span className="whitespace-nowrap text-muted">· {u.employee.employeeCode}</span>}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                  {/* the Assets access in effect (owner, 21 October 2026: "3 levels per user") */}
                  <td className="whitespace-nowrap">{accessShort(u.assetsAccessInEffect)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {u.lastSignInAt ? formatDateTime(u.lastSignInAt) : <span className="text-muted">Never</span>}
                  </td>
                  <td className="text-right">
                    {/* a Super Admin's account is read-only for an Admin */}
                    <Link href={href}>
                      {canChangeAccount(me, u) ? 'Edit' : 'View'}
                      <span className="sr-only"> {u.email}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">{USERS_PAGE_NOTE}</p>
    </>
  );
}

export default function UsersPage({ searchParams }: PageProps<'/users'>) {
  return (
    <Suspense fallback={<Loading />}>
      <RequireAdmin>
        <UsersList searchParams={searchParams} />
      </RequireAdmin>
    </Suspense>
  );
}
