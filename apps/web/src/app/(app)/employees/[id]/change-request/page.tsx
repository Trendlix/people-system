import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';
import type { ChangeRequest } from '@/lib/types';
import { pendingRequest } from '../../confirmation';
import { cancelChangeRequest, requestChange } from '../../confirmation-actions';
import { loadEmployee } from '../../data';
import { EditHeading, Empty, Loading } from '../../ui';
import { CancelRequestForm } from './cancel-form';
import { ChangeForm } from './change-form';
import { ChangeRequestStatusBadge, ChangesTable } from './request-parts';

// The employee asks HR to change their details (owner's decision, 15 October 2026): HR or an Admin approves, which makes
// the change, or rejects it with a note. One request waits at a time; the employee may cancel it until HR decides.
// Below the form, their requests and what HR decided. Only for the employee themself (the API checks this again).

const DONE: Record<string, string> = {
  sent: 'Your request was sent to HR. You will see their decision here.',
  cancelled: 'Your request was cancelled.',
};

function RequestCard({ request: r, employeeId }: { request: ChangeRequest; employeeId: string }) {
  return (
    <li className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Sent <span className="font-medium">{formatDateTime(r.requestedAt)}</span>
        </p>
        <ChangeRequestStatusBadge status={r.status} confidential={r.confidential} />
      </div>
      <ChangesTable changes={r.changes} fromLabel="Was" toLabel="Asked for" caption={`What you asked for on ${formatDate(r.requestedAt)}`} />
      <dl className="grid gap-3 text-sm">
        {r.note && (
          <div>
            <dt className="text-xs text-muted">Your note</dt>
            <dd className="mt-0.5 whitespace-pre-line">{r.note}</dd>
          </div>
        )}
        {r.decidedAt && (
          <div>
            <dt className="text-xs text-muted">{r.status === 'cancelled' ? 'Cancelled' : 'Decided by HR'}</dt>
            <dd className="mt-0.5">
              {r.status !== 'cancelled' && r.decidedBy?.email && <>{r.decidedBy.email} · </>}
              {formatDateTime(r.decidedAt)}
            </dd>
          </div>
        )}
        {r.decisionNote && (
          <div>
            <dt className="text-xs text-muted">HR&apos;s note</dt>
            <dd className="mt-0.5 whitespace-pre-line">{r.decisionNote}</dd>
          </div>
        )}
      </dl>
      {r.status === 'pending' && <CancelRequestForm action={cancelChangeRequest.bind(null, employeeId, r.id)} />}
    </li>
  );
}

async function ChangeRequestView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: PageProps<'/employees/[id]/change-request'>['searchParams'] }) {
  const [p, query] = await Promise.all([loadEmployee(params), searchParams]);
  if (!p.isSelf) redirect(`/employees/${p.id}`);
  const requests = p.changeRequests ?? [];
  const pending = pendingRequest(requests);
  const doneKey = query.sent === '1' ? 'sent' : query.cancelled === '1' ? 'cancelled' : undefined;

  return (
    <>
      <EditHeading profile={p} title="Request a Change" />

      {doneKey && (
        <p role="status" className="max-w-3xl rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {DONE[doneKey]}
        </p>
      )}

      {pending ? (
        <p className="max-w-3xl rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          Your request of {formatDate(pending.requestedAt)} is waiting for HR. You can send another once HR has decided on it, or cancel it below to
          send a different one.
        </p>
      ) : (
        <>
          <p className="max-w-3xl text-sm text-muted">
            Correct the details that are wrong or missing, say what should change and why, and send it to HR. Only what you change is sent, and
            nothing changes on your profile until HR approves it.
          </p>
          <ChangeForm action={requestChange.bind(null, p.id)} employee={p} cancelHref={`/employees/${p.id}/confirm`} />
        </>
      )}

      <section className="max-w-3xl space-y-3 pt-2">
        <h2 className="font-semibold">Your Requests</h2>
        {requests.length === 0 ? (
          <Empty>You haven&apos;t asked for any changes yet.</Empty>
        ) : (
          <ul className="space-y-4">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} employeeId={p.id} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function ChangeRequestPage({ params, searchParams }: PageProps<'/employees/[id]/change-request'>) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Loading />}>
        <ChangeRequestView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
