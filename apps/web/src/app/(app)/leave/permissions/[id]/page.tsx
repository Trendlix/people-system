import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { permissionClock, permissionHoursText } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { approverLabel } from '@/lib/department-leads';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading, UUID } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { loadPermission } from '../../data';
import { CancelLeaveForm, HrCancelLeaveForm, LeaveDecisionForm } from '../../leave-forms';
import { decidingAsTitle, hrStageName, placeOfEmployee } from '../../list';
import { cancelMyPermission, cancelPermissionByHr, decidePermission } from '../../permission-actions';
import {
  MY_PERMISSION_HREF,
  permissionBack,
  permissionDayText,
  permissionDoneText,
  permissionStepText,
  permissionTimesText,
  recordsPermission,
} from '../../permissions';
import { LeaveProgress, LeaveStatusBadge, LeaveTimeline } from '../../ui';

// A permission request (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2
// hours per day", asked "In the system, like leave"), for the employee, the one who decides it first (their direct
// manager, else their team lead, else their department's head), HR and the CEO; anyone else gets the 404 page, as the
// API says it isn't there. Its day, its hours and times, the reason, what is left of its month's hours with it counted,
// where it stands and who decides it, and its log of every step. While it waits for the user, their decision (Approve,
// or Reject with a comment); the employee's Cancel while it is being decided or before its day; HR's Cancel of an
// approved one, with a comment, its hours given back. What was just done on it shows at the top (?done=). A C-level
// person's has HR's stage decided by the CEO (or HR with Super Admin): it says so ("With the CEO"). No documents and no
// balance, as a leave request has: permission is hours of a working day, out of the month's allowance.

export const metadata: Metadata = { title: 'Permission · People System' };

function Fact({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

async function PermissionRequest({
  params,
  searchParams,
}: {
  params: PageProps<'/leave/permissions/[id]'>['params'];
  searchParams: PageProps<'/leave/permissions/[id]'>['searchParams'];
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [user, loaded] = await Promise.all([getCurrentUser(), loadPermission(id)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind === 'forbidden') return <Empty>This permission request isn&apos;t yours to see.</Empty>;
  if (loaded.kind === 'failed') return <Empty>{notLoadedText(loaded, 'permission request')}</Empty>;
  const r = loaded.value;
  const back = permissionBack(user, r);
  const done = permissionDoneText(query, r.status, r.manager, r.confidential);
  const place = placeOfEmployee(r.employee);
  const times = permissionTimesText(r);
  const what = `permission on ${permissionDayText(r)} (${permissionHoursText(r.hours)})`;
  const own = user.employeeId === r.employee.id;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Permission</h1>
          <LeaveStatusBadge status={r.status} confidential={r.confidential} />
          {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage, and HR doesn’t see the request." />}
        </div>
        <p className="text-muted">
          {r.employee.fullNameEn}
          {place && ` · ${place}`} · {r.recordedByHr ? 'recorded by HR' : 'sent'} {formatDateTime(r.createdAt)}
        </p>
      </div>
      {done && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${done.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {done.text}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="The Permission">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Day">
                <span className="tabular-nums">{permissionDayText(r)}</span>
              </Fact>
              <Fact label="Hours">
                <span className="text-base font-semibold tabular-nums">{permissionHoursText(r.hours)}</span>
                <span className="block text-xs text-muted">Counted as worked once approved</span>
              </Fact>
              <Fact label="Times">{times ? <span className="tabular-nums">{times}</span> : <span className="text-muted">Not given</span>}</Fact>
              {r.monthLeft !== null && (
                <Fact label="Left of its month">
                  <span className="text-base font-semibold tabular-nums">{permissionClock(r.monthLeft)}</span>
                  <span className="block text-xs text-muted">Of the month&apos;s permission hours, with those approved and waiting taken</span>
                </Fact>
              )}
              {r.reason && (
                <Fact label="Reason" wide>
                  <span className="whitespace-pre-line">{r.reason}</span>
                </Fact>
              )}
              <Fact label="Where it stands">
                <LeaveProgress request={r} />
              </Fact>
              <Fact label={r.manager ? approverLabel(r.manager) : 'Direct manager'}>
                {r.recordedByHr ? (
                  <span className="text-muted">Recorded by HR: no decision needed</span>
                ) : r.manager ? (
                  r.manager.fullNameEn
                ) : (
                  <span className="text-muted">None: sent straight to {hrStageName(r.confidential)}</span>
                )}
              </Fact>
            </dl>
            {own && (
              <p className="mt-4 text-sm text-muted">
                Your other permission requests are on <Link href={MY_PERMISSION_HREF}>My Requests</Link>.
              </p>
            )}
          </Section>

          {r.waitingForYou && r.stage && (
            <Section title={`Your Decision as ${decidingAsTitle(user, r.stage, r.manager, r.confidential)}`}>
              <LeaveDecisionForm
                action={decidePermission.bind(null, r.id, r.stage)}
                stage={r.stage}
                name={r.employee.fullNameEn}
                confidential={r.confidential}
                kind="permission"
              />
            </Section>
          )}

          {r.canCancel && (
            <Section title="Cancel the Permission">
              <p className="mb-3 text-sm text-muted">
                {r.status === 'approved'
                  ? 'Approved and its day still to come: you can still cancel it, and its hours go back to the month’s allowance.'
                  : 'While it is being decided you can cancel it, e.g. to ask again for another day or other hours.'}
              </p>
              <CancelLeaveForm action={cancelMyPermission.bind(null, r.id)} what={what} kind="permission" />
            </Section>
          )}
          {!r.canCancel && (r.hrCanCancel ?? (recordsPermission(user) && r.status === 'approved' && !own)) && (
            <Section title="Cancel the Permission">
              <p className="mb-3 text-sm text-muted">Approved permission HR cancels gives its hours back to the month; the employee sees why.</p>
              <HrCancelLeaveForm action={cancelPermissionByHr.bind(null, r.id)} what={what} kind="permission" />
            </Section>
          )}
        </div>

        <Section title="Every Step">
          <LeaveTimeline request={r} stepText={permissionStepText} />
        </Section>
      </div>
    </div>
  );
}

export default function PermissionRequestPage({ params, searchParams }: PageProps<'/leave/permissions/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <PermissionRequest params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
