import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { loadOwnProfile } from '../../own-profile';
import { sendResignation } from '../../resignations/actions';
import { loadMyResignation } from '../../resignations/data';
import { ResignForm } from '../../resignations/forms';
import { MY_RESIGNATION_HREF } from '../../resignations/resignation';

// Resign (owner, 26 October 2026: "but the employee has to request resignation and then the HR generates the document"):
// the employee's request from My Requests, for anyone with a current employment under the labour law. A freelancer or an
// intern, someone with a request already waiting or an ending already recorded: said so, no form.

export const metadata: Metadata = { title: 'Resign · People System' };

async function Resign() {
  const user = await getCurrentUser();
  const [profile, mine] = await Promise.all([loadOwnProfile(user), user.employeeId ? loadMyResignation() : null]);
  let body: React.ReactNode;
  if (!user.employeeId || !profile) {
    body = <Empty>Only someone with an employee profile can send a resignation request.</Empty>;
  } else if (!mine || mine.kind !== 'ok') {
    body = <Empty>{mine ? notLoadedText(mine, 'resignation form') : 'Not available.'}</Empty>;
  } else if (!mine.value.form.offered) {
    body = <Empty>{mine.value.form.refusal}</Empty>;
  } else {
    const f = mine.value.form;
    body = <ResignForm action={sendResignation} today={f.today} notice={f.notice} lastDayIfToday={f.lastDayIfToday} toCeo={profile.confidential === true} cancelHref={MY_RESIGNATION_HREF} />;
  }
  return body;
}

export default function ResignPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <div className="space-y-2">
        <BackLink href={MY_RESIGNATION_HREF}>My Requests</BackLink>
        <h1 className="page-title">Resign</h1>
        <p className="text-muted">
          Tell HR you wish to resign. The day you send this is the day the notice is received. HR records it, the labour office certifies it, and the CEO
          approves it. You can withdraw the request until HR records it.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Resign />
      </Suspense>
    </div>
  );
}
