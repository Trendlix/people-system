import type { Metadata } from 'next';
import { Suspense } from 'react';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { appBack } from '@/lib/surface';
import { NoProfile } from '../../../../(app)/dashboard/cards';
import { todayInCairo } from '../../../../(app)/employees/ui';
import { loadMyPermissionMonth } from '../../../../(app)/leave/data';
import { loadOwnProfile } from '../../../../(app)/own-profile';
import { loadEmployeeRaiseRequests } from '../../../../(app)/raise-requests/data';
import { PageTitle, PhoneLoading, RowLink, RowList } from '../../ui';
import { askOptions } from './options';

// New Request on the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): each kind they
// may ask for now (options.ts), opening its form, the site's own form in the phone pages' layout.

export const metadata: Metadata = { title: 'New Request · TrendLIX People' };

async function Options() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const [month, raises] = await Promise.all([
    profile.employment ? loadMyPermissionMonth(todayInCairo().slice(0, 7)) : null,
    loadEmployeeRaiseRequests(profile.id),
  ]);
  // a manager asks for a direct report too (the form's picker offers whom they may)
  const asksRaise = (raises.kind === 'ok' && raises.value.canRequest) || hasRole(user, 'manager');
  const options = askOptions({ employment: profile.employment, permissionMonth: month?.kind === 'ok' ? month.value : null, asksRaise });
  return (
    <div className="card">
      <RowList label="Kinds of request">
        {options.map((o) => (
          <RowLink key={o.key} href={o.href} title={o.label} line={o.text} />
        ))}
      </RowList>
    </div>
  );
}

export default function PhoneNewRequestPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="New Request" back={appBack('requests')}>
        What would you like to ask for? Your direct manager decides it first (without one, your team lead or the head of your department), then HR.
      </PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Options />
      </Suspense>
    </div>
  );
}
