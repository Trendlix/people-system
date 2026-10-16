import { ENDING_STATUS_LABELS, PAY_STAGE_LABELS } from '@trendlix/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import { getCurrentUser } from '@/lib/session';
import type { ChangeRequest, EndingSummary } from '@/lib/types';
import { ChangeRequestStatusBadge, ChangesTable } from '../employees/[id]/change-request/request-parts';
import { contractHref, profileHref } from '../employees/ui';
import { INITIATOR_LABELS } from '../organization/contracts/labels';
import { Empty, Loading } from '../organization/ui';
import { raiseRequestsHref, REQUESTER_PHRASES } from '../raise-requests/list';
import { decideChangeRequest, decideEnding, decideRaise } from './actions';
import { decidesChangeRequests, decidesEndings, followsEndings, getOrNull, PENDING_CHANGE_REQUESTS, PENDING_ENDINGS } from './data';
import { DecisionForm } from './decision-form';
import { RaiseDecisionForm } from './raise-decision-form';
import { decidesRaises, followsRaises, PENDING_RAISES, pendingRaiseView, raisesLabel } from './raises';

// What waits for a decision, in three sections:
// - Endings HR has recorded and approved, waiting for the CEO (owner's decision of 15 October 2026: HR approves, then
//   the CEO). The CEO approves or rejects each one; HR sees them here until then.
// - Pay raises HR has sent, and renewals with new pay, which count as raises (owner's decisions of 16 October 2026: HR,
//   then the CEO). The CEO approves each, returns it to HR or declines it, with a reason; HR follows them here. A raise
//   prepared from a raise request says so: the CEO's decision is the request's too.
// - Employees' requests to change their details (owner's decision of 15 October 2026), for HR and Admin to approve,
//   which makes the change, or reject with a note. The CEO doesn't decide these.
// The API checks every decision again.

const DONE: Record<string, string> = {
  approved: 'Ending approved.',
  rejected: 'Ending rejected.',
  'change-approved': 'Change request approved: the profile is updated.',
  'change-rejected': 'Change request rejected. The employee sees your note.',
  'raise-approved': 'Pay raise approved. HR now has it signed; it is paid from its effective date.',
  'raise-returned': 'Pay raise returned to HR with your reason.',
  'raise-declined': 'Pay raise declined. The raise request it came from, if any, is declined too.',
};

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

const none = <span className="text-muted">—</span>;

// ---------- endings of employment ----------

function EndingCard({ ending: e, decides }: { ending: EndingSummary; decides: boolean }) {
  return (
    <li className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            <Link href={profileHref(e.employee.id, 'employment')}>{e.employee.fullNameEn}</Link>
            <span className="font-normal text-muted"> · {e.employee.employeeCode}</span>
          </h3>
          <p className="mt-0.5 text-sm">{e.ruleLabel}</p>
        </div>
        <span className="badge bg-warn-soft text-warn">{ENDING_STATUS_LABELS[e.status] ?? e.status}</span>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {/* no one starts a death or disability ending */}
        <Item label="Started by">{e.initiator ? (INITIATOR_LABELS[e.initiator] ?? e.initiator) : none}</Item>
        <Item label="Notice given on">{e.noticeGivenOn ? formatDate(e.noticeGivenOn) : <span className="text-muted">No notice</span>}</Item>
        <Item label="Last working day">
          <span className="font-medium">{formatDate(e.lastWorkingDay)}</span>
        </Item>
        <Item label="Pay in lieu">{e.payInLieu ? 'Yes: the notice is paid, not worked' : 'No'}</Item>
        {e.reason && (
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="text-xs text-muted">Reason</dt>
            <dd className="mt-0.5 whitespace-pre-line">{e.reason}</dd>
          </div>
        )}
        {e.note && (
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="text-xs text-muted">Note</dt>
            <dd className="mt-0.5 whitespace-pre-line">{e.note}</dd>
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-4">
          <dt className="text-xs text-muted">Recorded and approved by HR</dt>
          <dd className="mt-0.5">
            {e.hrApprovedBy?.email ?? none}
            {e.hrApprovedAt && <span className="text-muted"> · {formatDateTime(e.hrApprovedAt)}</span>}
          </dd>
        </div>
      </dl>
      {decides && (
        <DecisionForm
          action={decideEnding.bind(null, e.id)}
          confirmApprove={`Approve the end of ${e.employee.fullNameEn}'s employment? The last working day is ${formatDate(e.lastWorkingDay)}.`}
        />
      )}
    </li>
  );
}

async function PendingEndings({ decides }: { decides: boolean }) {
  const endings = await apiGet<EndingSummary[]>(PENDING_ENDINGS);
  if (endings.length === 0) return <Empty>No endings are waiting for approval.</Empty>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {endings.length} waiting.{' '}
        {decides ? 'Approve or reject each one; a rejection needs a note saying why.' : 'The CEO approves or rejects each one; you can follow them here until then.'}
      </p>
      <ul className="space-y-4">
        {endings.map((e) => (
          <EndingCard key={e.id} ending={e} decides={decides} />
        ))}
      </ul>
    </div>
  );
}

// ---------- pay raises ----------

/** The raise request a raise was prepared from: who asked, and why. */
function FromRequest({ request: q }: { request: RaiseRequest }) {
  return (
    <>
      Asked for by {REQUESTER_PHRASES[q.requester] ?? q.requester}
      {q.requestedBy?.email && <span className="text-muted"> ({q.requestedBy.email})</span>} on {formatDate(q.createdAt)}
      <span className="mt-0.5 block whitespace-pre-line text-muted">“{q.reason}”</span>
    </>
  );
}

function RaiseCard({ raise: r, request, decides }: { raise: PendingRaise; request: RaiseRequest | null; decides: boolean }) {
  const v = pendingRaiseView(r);
  return (
    <li className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            <Link href={contractHref(r.employee.id)}>{r.employee.fullNameEn}</Link>
            <span className="font-normal text-muted"> · {r.employee.employeeCode}</span>
          </h3>
          <p className="mt-0.5 text-sm">
            {v.kind}
            <span className="text-muted tabular-nums"> · {v.reference}</span>
            {r.jobTitleEn && <span className="text-muted"> · {r.jobTitleEn}</span>}
          </p>
        </div>
        <span className="badge bg-warn-soft text-warn">{PAY_STAGE_LABELS.pending_ceo}</span>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Item label="Effective">
          <span className="font-medium tabular-nums">{v.effective}</span>
        </Item>
        <Item label="Gross a month">
          <span className="tabular-nums">{v.gross}</span>
          {v.change && <span className="block text-xs font-semibold">{v.change}</span>}
          {v.hourly && <span className="block text-xs text-muted">{v.hourly}</span>}
        </Item>
        <Item label="Allowances a month">
          <span className="tabular-nums">{v.allowances}</span>
        </Item>
        <Item label="Total a month">
          <span className="tabular-nums">{v.total}</span>
        </Item>
        <Item label="Reason">{v.reason ?? none}</Item>
        <Item label="Promotion">{v.promotion ?? <span className="text-muted">None</span>}</Item>
        <Item label="Sent by HR">{v.sentAt ?? none}</Item>
        {r.raise?.requestId && (
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="text-xs text-muted">From a raise request</dt>
            <dd className="mt-0.5">
              {request ? <FromRequest request={request} /> : <Link href={raiseRequestsHref('with_ceo')}>See the raise requests with the CEO</Link>}
            </dd>
          </div>
        )}
      </dl>
      {decides && <RaiseDecisionForm action={decideRaise.bind(null, r.id)} confirmApprove={v.confirmApprove} name={r.employee.fullNameEn} />}
    </li>
  );
}

async function PendingRaises({ decides }: { decides: boolean }) {
  // Read quietly, like the change requests: an API from before raises must not take the endings down with it.
  const raises = await getOrNull<PendingRaise[]>(PENDING_RAISES);
  if (raises === null) return <Empty>Pay raises couldn&apos;t load.</Empty>;
  if (raises.length === 0) return <Empty>No pay raises are waiting for approval.</Empty>;
  // the requests they were prepared from, to say who asked and why
  const requests = raises.some((r) => r.raise?.requestId) ? ((await getOrNull<RaiseRequest[]>(raiseRequestsHref('with_ceo'))) ?? []) : [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {raisesLabel(raises.length)} waiting, oldest sent first.{' '}
        {decides
          ? 'Approve, return to HR or decline each one; returning or declining needs a reason.'
          : 'The CEO approves, returns or declines each one; you can follow them here until then.'}
      </p>
      <ul className="space-y-4">
        {raises.map((r) => (
          <RaiseCard key={r.id} raise={r} request={requests.find((q) => q.id === r.raise?.requestId) ?? null} decides={decides} />
        ))}
      </ul>
    </div>
  );
}

// ---------- profile change requests ----------

function ChangeRequestCard({ request: r }: { request: ChangeRequest }) {
  const name = r.employee.fullNameEn;
  return (
    <li className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            <Link href={profileHref(r.employee.id)}>{name}</Link>
            <span className="font-normal text-muted"> · {r.employee.employeeCode}</span>
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            Asked {formatDateTime(r.requestedAt)}
            {r.requestedBy?.email && <> by {r.requestedBy.email}</>}
          </p>
        </div>
        <ChangeRequestStatusBadge status={r.status} />
      </div>
      {r.note && (
        <div className="mt-4 text-sm">
          <p className="text-xs text-muted">What should change and why</p>
          <p className="mt-0.5 whitespace-pre-line">{r.note}</p>
        </div>
      )}
      <div className="mt-4">
        <ChangesTable changes={r.changes} fromLabel="Current" toLabel="Requested" caption={`Changes ${name} asked for`} />
      </div>
      <DecisionForm
        action={decideChangeRequest.bind(null, r.id)}
        confirmApprove={`Approve the change to ${name}'s details? Their profile is updated with what they asked for.`}
        noteMax={1000}
      />
    </li>
  );
}

async function PendingChangeRequests() {
  // Like the sidebar's count: read quietly, so this section can't take the endings down with it.
  const requests = await getOrNull<ChangeRequest[]>(PENDING_CHANGE_REQUESTS);
  if (requests === null) return <Empty>Change requests couldn&apos;t load.</Empty>;
  if (requests.length === 0) return <Empty>No change requests are waiting.</Empty>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {requests.length} waiting. Approving makes the change on the profile; a rejection needs a note saying why, which the employee sees.
      </p>
      <ul className="space-y-4">
        {requests.map((r) => (
          <ChangeRequestCard key={r.id} request={r} />
        ))}
      </ul>
    </div>
  );
}

// ---------- the page ----------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {/* each loads on its own */}
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </section>
  );
}

async function Approvals({ searchParams }: { searchParams: PageProps<'/approvals'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const endings = followsEndings(user);
  const raises = followsRaises(user);
  const changes = decidesChangeRequests(user);
  if (!endings && !raises && !changes) return <Empty>Only HR, the CEO and Admin can see approvals.</Empty>;
  const done = typeof query.done === 'string' ? DONE[query.done] : undefined;

  return (
    <div className="space-y-10">
      {done && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {done}
        </p>
      )}
      {endings && (
        <Section title="Endings of Employment">
          <PendingEndings decides={decidesEndings(user)} />
        </Section>
      )}
      {raises && (
        <Section title="Pay Raises">
          <PendingRaises decides={decidesRaises(user)} />
        </Section>
      )}
      {changes && (
        <Section title="Profile Change Requests">
          <PendingChangeRequests />
        </Section>
      )}
    </div>
  );
}

export default function ApprovalsPage({ searchParams }: PageProps<'/approvals'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Approvals searchParams={searchParams} />
    </Suspense>
  );
}
