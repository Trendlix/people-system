import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { FingerprintDevice, OpenSession, UserAccount } from '@/lib/types';
import { loadJson } from '../../payroll/load';
import { profileHref } from '../../employees/tab-list';
import { todayInCairo } from '../../employees/ui';
import { standingBadge, standingBadgeClass } from '@/lib/access';
import { AccountPanel } from '../account-panel';
import { BackLink, Loading, managesAccessOnProfile, RequireAdmin, StatusBadge, USERS_PAGE_NOTE } from '../ui';
import { shownCode } from '@/lib/hidden';

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
  // the phones as an API from before fingerprint sign-in answers them too (404: said in their place, not the 404 page)
  const [me, user, sessions, devices] = await Promise.all([
    getCurrentUser(),
    apiGet<UserAccount>(`/users/${id}`),
    apiGet<OpenSession[]>(`/users/${id}/sessions`),
    loadJson<FingerprintDevice[]>(`/users/${id}/devices`),
  ]);
  // an employee's account is on their profile's Access tab (owner, 22 October 2026: "On the employee profile"): an old
  // link to it opens there, for someone who opens profiles; an Admin who doesn't (no HR role) keeps this page
  if (user.employee && managesAccessOnProfile(me)) redirect(profileHref(user.employee.id, 'access'));
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
                <>
                  <Link href={profileHref(user.employee.id, 'access')}>
                    {user.employee.fullNameEn} {shownCode(user.employee.employeeCode) && <span className="text-muted">· {user.employee.employeeCode}</span>}
                  </Link>
                  <p className="hint">Their account: HR chooses its sign-in email and sends their set-password link on their profile’s Access tab.</p>
                </>
              ) : (
                <>
                  <span className="text-muted">Not an employee’s account.</span>
                  <p className="hint">{USERS_PAGE_NOTE}</p>
                </>
              )}
            </Row>
            {/* an employee's access standing (owner, 23 October 2026: "Active - Grace - Hold - No Access"): from their
                contract; never held for a Super Admin, the CEO or an account that isn't an employee's */}
            {user.employee && user.standing && (
              <Row label="Access">
                <span className={standingBadgeClass(user.standing.standing)}>{standingBadge(user.standing.standing, user.standing.graceUntil, todayInCairo())}</span>
                <p className="hint">
                  From their contract. HR gives 7 days’ grace on their profile’s <Link href={profileHref(user.employee.id, 'access')}>Access tab</Link>.
                </p>
              </Row>
            )}
            <Row label="Last sign-in">
              {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : <span className="text-muted">Never</span>}
            </Row>
            <Row label="Created">{formatDate(user.createdAt)}</Row>
          </dl>
        </section>

        {/* an employee's password is set with a link from their profile, never a temporary one */}
        <AccountPanel me={me} user={user} sessions={sessions} devices={devices} temporaryPassword={!user.employee} />
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
