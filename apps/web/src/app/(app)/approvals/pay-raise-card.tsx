import { PAY_STAGE_LABELS, PREPARED_DIRECTLY_COMMENT, type LawRates } from '@trendlix/shared';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import type { PendingRaise, RaiseRequest } from '@/lib/raise-types';
import { contractHref } from '../employees/ui';
import { isDirect, raiseRequestOnListHref, raiseRequestsHref, REQUESTER_PHRASES } from '../raise-requests/list';
import { FoldedRequestLog, RequestReason, Suggestion } from '../raise-requests/ui';
import { decideRaise } from './actions';
import { CeoRaiseDecision } from './ceo-raise-decision';
import { pendingRaiseView } from './raises';
import { shownCode } from '@/lib/hidden';
import { Hidden } from '@/components/hidden';

// A pay raise waiting for the CEO (owner's decisions, 16 October 2026: "HR, then the CEO"), on Approvals and, since 20
// October 2026, on the phone pages' To Approve (the employee app): what changes, why, the raise request it came from,
// and the CEO's decision.

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

const none = <span className="text-muted">—</span>;

/** The raise request a raise was prepared from: who asked, why (the reason and the comment), the raise suggested, and its log. */
function FromRequest({ request: q }: { request: RaiseRequest }) {
  return (
    <>
      Asked for by {REQUESTER_PHRASES[q.requester] ?? q.requester}
      {q.requestedBy?.email && <span className="text-muted"> ({q.requestedBy.email})</span>} on {formatDate(q.createdAt)}
      <span className="mt-1 block">
        <RequestReason request={q} />
      </span>
      {(q.suggestion || q.suggestedGross !== null) && (
        <span className="mt-1 block text-muted">
          Suggested: <Suggestion request={q} />
        </span>
      )}
      <FoldedRequestLog request={q} />
    </>
  );
}

/** A raise HR prepared directly (19 October 2026): by whom and when, HR's note, and its log. */
function DirectRequest({ request: q }: { request: RaiseRequest }) {
  return (
    <>
      By {q.requestedBy?.email ?? 'HR'} on {formatDate(q.createdAt)}
      {q.comment && q.comment !== PREPARED_DIRECTLY_COMMENT && <span className="mt-1 block whitespace-pre-line text-muted">{q.comment}</span>}
      <FoldedRequestLog request={q} />
    </>
  );
}

export function PayRaiseCard({
  raise: r,
  request,
  decides,
  rates,
  onSite = true,
}: {
  raise: PendingRaise;
  request: RaiseRequest | null;
  decides: boolean;
  rates: readonly LawRates[];
  /** The site's card, with the links to the contract and to Raise Requests; the phone pages' has neither. */
  onSite?: boolean;
}) {
  const v = pendingRaiseView(r);
  const direct = request ? isDirect(request) : r.raise?.requestOrigin === 'direct';
  return (
    <li className={`card ${onSite ? 'p-6' : 'p-4'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            {onSite ? <Link href={contractHref(r.employee.id)}>{r.employee.fullNameEn}</Link> : r.employee.fullNameEn}
            {shownCode(r.employee.employeeCode) && <span className="font-normal text-muted"> · {r.employee.employeeCode}</span>}
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
          {v.effective ? <span className="font-medium tabular-nums">{v.effective}</span> : <Hidden />}
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
            <dt className="text-xs text-muted">{direct ? 'Prepared directly by HR' : 'From a raise request'}</dt>
            <dd className="mt-0.5">
              {request && (direct ? <DirectRequest request={request} /> : <FromRequest request={request} />)}
              {/* its request on Raise Requests, the one place for every raise (19 October 2026) */}
              {onSite && (
                <Link href={request ? raiseRequestOnListHref(request) : raiseRequestsHref('with_ceo')} className={`${request ? 'mt-2' : ''} inline-block font-semibold`}>
                  Open the request in Raise Requests<span className="sr-only"> for {r.employee.fullNameEn}</span>
                </Link>
              )}
            </dd>
          </div>
        )}
      </dl>
      {decides && <CeoRaiseDecision raise={r} request={request} rates={rates} action={decideRaise.bind(null, r.id)} />}
    </li>
  );
}
