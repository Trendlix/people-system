import Link from 'next/link';
import type { RaiseRequestStatus, Role } from '@trendlix/shared';
import type { RaiseRequest } from '@/lib/raise-types';
import { contractHref } from '../employees/ui';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { declineRaiseRequest } from './actions';
import { preparedRaiseText, prepareRaiseHref, progressText, requestActions, requesterText, STATUS_BADGE, statusLabel } from './list';
import { DeclineRequestForm } from './request-forms';

// Parts of a raise request shown on the profile's Employment tab and on the Raise Requests page (owner's decisions, 16
// October 2026), worded as the profile change requests and the payroll approvals are: who asked and why, the suggested
// gross and the raise prepared from it (only what the API sends the caller), where it stands with the reasons given,
// and HR's actions while it is with HR.

const dash = <span className="text-muted">—</span>;

/** With HR, With the CEO, Approved, Declined or Done. */
export function RaiseRequestStatusBadge({ status }: { status: RaiseRequestStatus }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'bg-line-soft text-muted'}`}>{statusLabel(status)}</span>;
}

/** "The direct manager", and their email under it. */
export function Requester({ request }: { request: RaiseRequest }) {
  const r = requesterText(request);
  return (
    <>
      {r.who}
      {r.email && <span className="block text-xs break-all text-muted">{r.email}</span>}
    </>
  );
}

/** The raise HR prepared, as far as the caller may see it; a dash without one. */
export function PreparedRaise({ request }: { request: RaiseRequest }) {
  const p = preparedRaiseText(request.raise);
  if (!p) return dash;
  return (
    <>
      <span className="tabular-nums">{p.title}</span>
      {p.detail && <span className="block text-xs text-muted tabular-nums">{p.detail}</span>}
    </>
  );
}

/** The suggested gross; a dash when none was suggested or it isn't the caller's to see. */
export function SuggestedGross({ request }: { request: RaiseRequest }) {
  return request.suggestedGross === null ? dash : <span className="tabular-nums">{formatEgp(request.suggestedGross)}</span>;
}

/** Where it stands, with the reason given (a decline's, or the CEO's return). */
export function Progress({ request }: { request: RaiseRequest }) {
  const p = progressText(request);
  return (
    <>
      {p.text}
      {p.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{p.reason}”</span>}
    </>
  );
}

/**
 * HR's actions on a request with HR: Prepare the raise (the raise form, from the request) or, once prepared, where to
 * carry on with it (the Contract section, where HR changes it and sends it to the CEO); and Decline, with a reason.
 * Nothing for anyone else, or once it has left HR.
 */
export function HrRequestActions({ request: r, user }: { request: RaiseRequest; user: { roles: readonly Role[] } }) {
  const can = requestActions(user, r);
  if (!can.prepare && !can.continueRaise && !can.decline) return null;
  const name = r.employee.fullNameEn;
  return (
    <div className="flex flex-wrap items-start gap-3">
      {can.prepare && (
        <Link href={prepareRaiseHref(r.employee.id, r.id)} prefetch={false} className="btn btn-primary min-h-9 px-3">
          Prepare the raise<span className="sr-only"> for {name}</span>
        </Link>
      )}
      {can.continueRaise && (
        <Link href={contractHref(r.employee.id)} className="btn btn-secondary min-h-9 px-3">
          Open the raise<span className="sr-only"> prepared for {name}</span>
        </Link>
      )}
      {can.decline && <DeclineRequestForm action={declineRaiseRequest.bind(null, r.id)} name={name} />}
    </div>
  );
}
