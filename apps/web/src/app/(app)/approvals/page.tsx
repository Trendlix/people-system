import { ENDING_STATUS_LABELS } from '@trendlix/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { decidesChangeOfDetails } from '@/lib/confidential';
import { formatDate, formatDateTime } from '@/lib/format';
import { loadLawRates } from '@/lib/law-rates';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import { getCurrentUser } from '@/lib/session';
import type { ChangeRequest, EndingSummary, SessionUser } from '@/lib/types';
import { ChangeRequestCard } from '../employees/[id]/change-request/request-parts';
import { art154Text } from '../employees/employment-law';
import { profileHref } from '../employees/ui';
import { INITIATOR_LABELS } from '../organization/contracts/labels';
import { Empty, Loading } from '../organization/ui';
import { countsRaiseRequests, handlesRaiseRequests, raiseRequestsHref, waitingForYouCount, WITH_HR_REQUESTS } from '../raise-requests/list';
import { changeDeciders, readsChangeRequests } from '../requests/details-changes/list';
import { decideChangeRequest, decideEnding } from './actions';
import { decidesEndings, followsEndings, getOrNull, PENDING_CHANGE_REQUESTS, PENDING_ENDINGS } from './data';
import { DecisionForm } from './decision-form';
import { PayRaiseCard } from './pay-raise-card';
import { decidesRaises, followsRaises, PENDING_RAISES, raisesLabel } from './raises';

// What waits for a decision, in three sections:
// - Endings HR has recorded and approved, waiting for the CEO (owner's decision of 15 October 2026: HR approves, then
//   the CEO). The CEO approves or rejects each one; HR sees them here until then.
// - Pay raises HR has sent, and renewals with new pay, which count as raises (owner's decisions of 16 October 2026: HR,
//   then the CEO; 17 October 2026: "Approve - Approve with another raise amount or percentge - Reject, and add a
//   comment"). The CEO approves each as it reached them or with another raise, or rejects it, always with a comment, or
//   returns it to HR; HR follows them here. A raise prepared from a raise request says so, with the request's reason,
//   comment, suggestion and log: the CEO's decision is the request's too. Since 19 October 2026 every raise has its
//   request (one HR prepared directly says so), each card links to it on Raise Requests, where the CEO may decide it
//   too, and approving the CEO may change the reason ("i might want to ammend the raise reason, not only the money").
// - Employees' requests to change their details (owner's decision of 15 October 2026), for HR and Admin to approve,
//   which makes the change, or reject with a note. A C-level person's (owner, 19 October 2026: "make C level Employees
//   details not visible to HR") the CEO decides, or a Super Admin, not HR: the CEO gets those (the API sends the CEO
//   only C-level people's), and the decide buttons show only to who decides each.
// The CEO also takes HR's step on a C-level person's raise request, on Raise Requests: the Pay Raises section says how
// many wait there. The API checks every decision again.

const DONE: Record<string, string> = {
  approved: 'Ending approved.',
  rejected: 'Ending rejected.',
  'change-approved': 'Change request approved: the profile is updated.',
  'change-rejected': 'Change request rejected. The employee sees your note.',
  'raise-approved': 'Pay raise approved. HR now has it signed; it is paid from its effective date.',
  'raise-approved-other': 'Pay raise approved with your raise: its pay is changed to it. HR now has it signed; it is paid from its effective date.',
  'raise-returned': 'Pay raise returned to HR with your comment.',
  'raise-declined': 'Pay raise rejected. Its raise request shows as rejected, with your comment.',
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
        {/* a fixed term the company doesn't renew (18 October 2026): Art. 154, information only */}
        {e.art154Note && (
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="text-xs text-muted">Labour Law Art. 154</dt>
            <dd className="mt-0.5">
              {e.art154Note}. {e.art154Estimate && art154Text(e.art154Estimate)}
            </dd>
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

/**
 * For the CEO, who takes HR's step on a C-level person's raise request (19 October 2026) on Raise Requests: how many
 * wait there, linked; nothing when none does, or they can't be read.
 */
async function HrStepRequests({ user }: { user: SessionUser }) {
  if (handlesRaiseRequests(user) || !countsRaiseRequests(user)) return null;
  const requests = await getOrNull<RaiseRequest[]>(WITH_HR_REQUESTS);
  const n = requests ? waitingForYouCount(user, requests) : 0;
  if (!n) return null;
  return (
    <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      Also waiting for you: {n === 1 ? '1 raise request' : `${n} raise requests`} of C-level people at HR&apos;s step, which you take.{' '}
      <Link href={raiseRequestsHref('with_hr')} className="font-semibold">
        Decide on Raise Requests
      </Link>
    </p>
  );
}

async function PendingRaises({ decides }: { decides: boolean }) {
  // Read quietly, like the change requests: an API from before raises must not take the endings down with it.
  const raises = await getOrNull<PendingRaise[]>(PENDING_RAISES);
  if (raises === null) return <Empty>Pay raises couldn&apos;t load.</Empty>;
  if (raises.length === 0) return <Empty>No pay raises are waiting for approval.</Empty>;
  // the requests they were prepared from, to say who asked and why
  const requests = raises.some((r) => r.raise?.requestId) ? ((await getOrNull<RaiseRequest[]>(raiseRequestsHref('with_ceo'))) ?? []) : [];
  // the years' rates set by law, for the net in the figures of another raise
  const rates = decides ? await loadLawRates() : [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {raisesLabel(raises.length)} waiting, oldest sent first.{' '}
        {decides
          ? 'Approve each one as it is or with another raise, or reject it, with a comment; or return it to HR.'
          : 'The CEO approves, rejects or returns each one; you can follow them here until then.'}
      </p>
      <ul className="space-y-4">
        {raises.map((r) => (
          <PayRaiseCard key={r.id} raise={r} request={requests.find((q) => q.id === r.raise?.requestId) ?? null} decides={decides} rates={rates} />
        ))}
      </ul>
    </div>
  );
}

// ---------- profile change requests ----------

/** A change request waiting, with the decide buttons for who decides it (a C-level person's: the CEO or a Super Admin). */
function PendingChangeRequestCard({ request: r, decides }: { request: ChangeRequest; decides: boolean }) {
  return (
    <ChangeRequestCard request={r}>
      {decides ? (
        <DecisionForm
          action={decideChangeRequest.bind(null, r.id)}
          confirmApprove={`Approve the change to ${r.employee.fullNameEn}'s details? Their profile is updated with what they asked for.`}
          noteMax={1000}
        />
      ) : (
        <p className="mt-4 border-t border-line-soft pt-4 text-sm text-muted">Waiting for {changeDeciders(r.confidential)} to decide it.</p>
      )}
    </ChangeRequestCard>
  );
}

async function PendingChangeRequests({ user }: { user: SessionUser }) {
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
          <PendingChangeRequestCard key={r.id} request={r} decides={decidesChangeOfDetails(user, r.confidential)} />
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
  // HR and Admin, and the CEO for C-level people's (19 October 2026)
  const changes = readsChangeRequests(user);
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
          <HrStepRequests user={user} />
          <PendingRaises decides={decidesRaises(user)} />
        </Section>
      )}
      {changes && (
        <Section title="Profile Change Requests">
          <PendingChangeRequests user={user} />
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
