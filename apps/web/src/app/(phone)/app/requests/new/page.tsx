import type { Metadata } from 'next';
import { Suspense } from 'react';
import { seesRaiseRequests } from '@trendlix/shared';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { appBack } from '@/lib/surface';
import { loadWfhAllowance } from '../../../../(app)/attendance/wfh/data';
import { loadOdForm } from '../../../../(app)/attendance/official-duty/data';
import { NoProfile } from '../../../../(app)/dashboard/cards';
import { todayInCairo } from '../../../../(app)/employees/ui';
import { loadMyPermissionMonth } from '../../../../(app)/leave/data';
import { loadOwnProfile } from '../../../../(app)/own-profile';
import { loadEmployeeRaiseRequests } from '../../../../(app)/raise-requests/data';
import { PageTitle, PhoneLoading, RowLink, RowList } from '../../ui';
import { askOptions, offersOd, offersRaise, offersWfh } from './options';

// New Request on the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): each kind they
// may ask for now (options.ts), opening its form, the site's own form in the phone pages' layout. A raise only for
// someone who sees raise requests (owner, 20 October 2026: "raises not to be visible to employee level for now", then
// "Hide from managers too"; seesRaiseRequests). Working from home (owner, 21 October 2026: "think about how should we
// handle the working from home in out erp") for someone whose month says their arrangement needs it (offersWfh).
// Official duty (owner, 23 October 2026: "Official duty (OD) requests") when its form says nothing refuses them (offersOd).

export const metadata: Metadata = { title: 'New Request · Trendlix People' };

async function Options() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const seesRaises = seesRaiseRequests(user);
  const [month, raises, wfh, od] = await Promise.all([
    profile.employment ? loadMyPermissionMonth(todayInCairo().slice(0, 7)) : null,
    seesRaises ? loadEmployeeRaiseRequests(profile.id) : null,
    profile.employment ? loadWfhAllowance() : null,
    profile.employment ? loadOdForm() : null,
  ]);
  const asksRaise = offersRaise({ seesRaises, canRequest: raises?.kind === 'ok' && raises.value.canRequest, manager: hasRole(user, 'manager') });
  const asksWfh = offersWfh(wfh?.kind === 'ok' ? wfh.value : null);
  const asksOd = offersOd(od?.kind === 'ok' ? od.value : null);
  const options = askOptions({ employment: profile.employment, permissionMonth: month?.kind === 'ok' ? month.value : null, asksRaise, asksWfh, asksOd });
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
        What would you like to ask for? Your direct manager decides it first (without one, your team lead or the head of your department), then HR; a
        check-in location goes to HR, then the CEO.
      </PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Options />
      </Suspense>
    </div>
  );
}
