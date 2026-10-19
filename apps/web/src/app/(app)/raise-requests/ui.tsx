import Link from 'next/link';
import type { LawRates, RaiseRequestStatus, Role } from '@trendlix/shared';
import { formatDateTime } from '@/lib/format';
import type { RaiseRequest } from '@/lib/raise-types';
import { contractHref, todayInCairo } from '../employees/ui';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { declineRaiseRequest, decideRaiseRequest } from './actions';
import {
  commentText,
  decisionEffectiveDate,
  effectiveFromText,
  preparedRaiseText,
  prepareRaiseHref,
  progressText,
  reasonText,
  requestActions,
  requesterText,
  STATUS_BADGE,
  statusLabel,
  stepsLabel,
  stepText,
  stepTone,
  suggestionText,
} from './list';
import { DeclineRequestForm, HrDecisionForm } from './request-forms';

// Parts of a raise request shown on the profile's Employment tab, the Raise Requests page and Approvals (owner's
// decisions, 16 October 2026; reworked 17 October 2026), worded as the profile change requests and the payroll
// approvals are: who asked, the reason from the list and the comment, the raise suggested and the raise prepared from
// it (only what the API sends the caller), where it stands with the comment given, its log of every step as a
// timeline, and HR's decision while it is with HR. Since 17 October 2026 also the month it is asked from ("Effective
// from"), and the line saying a request was just sent, on the page the requester lands on. Since 19 October 2026 a raise
// HR prepared directly says so where the requester is shown ("Prepared directly by HR"), and is carried on with only. A
// C-level person's request (owner, 19 October 2026: "make C level Employees details not visible to HR") says "With the
// CEO" while it waits for HR's step, which the CEO takes: the CEO gets HR's decision on it, without the whole raise form
// (the Contract section is HR's).

const dash = <span className="text-muted">—</span>;

/** The line on the page a requester lands on once a request is sent (?sent=1). */
export function RequestSent() {
  return (
    <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
      Raise request sent. HR approves or rejects it, then the CEO decides; each step shows on the request.
    </p>
  );
}

/** The month a request is asked from, "November 2026"; "Not given" (muted) on one from before 17 October 2026. */
export function EffectiveFrom({ request }: { request: Pick<RaiseRequest, 'effectiveFrom'> }) {
  return <span className={request.effectiveFrom ? 'tabular-nums' : 'text-muted'}>{effectiveFromText(request)}</span>;
}

/** With HR, With the CEO, Approved, Rejected or Done; With the CEO for a C-level person's with HR (`confidential`). */
export function RaiseRequestStatusBadge({ status, confidential }: { status: RaiseRequestStatus; confidential?: boolean }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'bg-line-soft text-muted'}`}>{statusLabel(status, confidential)}</span>;
}

/** "The direct manager", and their email under it; "Prepared directly by HR" and who did (19 October 2026). */
export function Requester({ request }: { request: RaiseRequest }) {
  const r = requesterText(request);
  return (
    <>
      {r.who}
      {r.email && <span className="block text-xs break-all text-muted">{r.email}</span>}
    </>
  );
}

/** The reason from the list, and the requester's comment under it (a request from before 17 October 2026: the comment only). */
export function RequestReason({ request }: { request: RaiseRequest }) {
  const reason = reasonText(request);
  return (
    <>
      {reason && <span className="block font-medium">{reason}</span>}
      <span className={`block whitespace-pre-line ${reason ? 'text-muted' : ''}`}>{commentText(request)}</span>
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

/** The raise suggested, as far as the caller may see it (an amount, a percent, the gross it comes to); a dash without. */
export function Suggestion({ request }: { request: RaiseRequest }) {
  const text = request.suggestion !== undefined ? suggestionText(request.suggestion) : request.suggestedGross !== null ? `Gross ${formatEgp(request.suggestedGross)}` : null;
  return text ? <span className="tabular-nums">{text}</span> : dash;
}

/** Where it stands, with the comment given (a rejection's, or the CEO's return). */
export function Progress({ request }: { request: RaiseRequest }) {
  const p = progressText(request);
  return (
    <>
      {p.text}
      {p.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{p.reason}”</span>}
    </>
  );
}

const DOT: Record<'ok' | 'danger' | 'warn' | 'none', string> = { ok: 'bg-ok', danger: 'bg-danger', warn: 'bg-warn', none: 'bg-line' };

/**
 * The request's log (owner, 17 October 2026: "all the request steps to be logged in the request"): every step in order,
 * what happened and what goes with it, the comment, who and when. Nothing from an API from before the log.
 */
export function RequestLog({ request: r }: { request: RaiseRequest }) {
  const steps = r.steps ?? [];
  if (!steps.length) return null;
  return (
    <ol className="space-y-3 border-l-2 border-line-soft pl-4" aria-label={`Every step of the raise request, ${stepsLabel(steps.length)}`}>
      {steps.map((s) => {
        const t = stepText(s, r.requester, r);
        return (
          <li key={s.id} className="relative">
            <span aria-hidden="true" className={`absolute top-1.5 -left-[23px] size-3 rounded-full border-2 border-card ${DOT[stepTone(s) ?? 'none']}`} />
            <p className="text-sm font-medium">{t.title}</p>
            {t.detail && <p className="text-xs text-muted tabular-nums">{t.detail}</p>}
            {s.comment && <p className="mt-0.5 text-sm whitespace-pre-line">“{s.comment}”</p>}
            <p className="text-xs text-muted">
              {s.by?.email && <span className="break-all">{s.by.email} · </span>}
              {formatDateTime(s.at)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** The log folded away, for a table row: "Log · 4 steps". */
export function FoldedRequestLog({ request }: { request: RaiseRequest }) {
  const n = request.steps?.length ?? 0;
  if (!n) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-semibold text-accent">
        Log · {stepsLabel(n)}
        <span className="sr-only"> of the raise request for {request.employee.fullNameEn}</span>
      </summary>
      <div className="mt-3 min-w-64">
        <RequestLog request={request} />
      </div>
    </details>
  );
}

/**
 * HR's actions on a request with HR: Decide (approve it as suggested or with another raise, which prepares the raise and
 * sends it to the CEO, or reject it), with the whole raise form a link away; or, once a raise is prepared from it, where
 * to carry on with it (the Contract section, where HR changes it and sends it to the CEO) and Reject. Nothing for anyone
 * else, or once it has left HR. The decision starts from the month the request is asked from, and another raise shows
 * what it comes to (the pay in force with `rates`, 17 October 2026). The CEO takes HR's step on a C-level person's
 * (19 October 2026): Decide and Reject, without the whole raise form, which is HR's.
 */
export function HrRequestActions({ request: r, user, rates = [] }: { request: RaiseRequest; user: { roles: readonly Role[] }; rates?: readonly LawRates[] }) {
  const can = requestActions(user, r);
  if (!can.decide && !can.continueRaise && !can.decline) return null;
  const name = r.employee.fullNameEn;
  const today = todayInCairo();
  const inForce = r.inForce ?? null;
  return (
    <div className="flex flex-wrap items-start gap-3">
      {can.decide && (
        <HrDecisionForm
          action={decideRaiseRequest.bind(null, r.id, !!r.suggestion)}
          name={name}
          requester={r.requester}
          suggestion={suggestionText(r.suggestion ?? null) ?? (r.suggestedGross !== null ? `Gross ${formatEgp(r.suggestedGross)}` : null)}
          gross={inForce?.grossSalary ?? null}
          inForce={inForce}
          defaultEffective={decisionEffectiveDate(r, today)}
          fullFormHref={can.prepare ? prepareRaiseHref(r.employee.id, r.id) : null}
          pay={inForce}
          rates={rates}
        />
      )}
      {can.continueRaise && (
        <Link href={contractHref(r.employee.id)} className="btn btn-secondary min-h-9 px-3">
          Open the raise<span className="sr-only"> prepared for {name}</span>
        </Link>
      )}
      {can.decline && <DeclineRequestForm action={declineRaiseRequest.bind(null, r.id)} name={name} requester={r.requester} />}
    </div>
  );
}
