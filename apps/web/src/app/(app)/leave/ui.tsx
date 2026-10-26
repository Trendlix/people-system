import Link from 'next/link';
import type { LeaveStatus, LeaveStepKind } from '@trendlix/shared';
import { asLeadNote } from '@/lib/department-leads';
import { formatDateTime } from '@/lib/format';
import type { LeaveBalances, LeaveRequestStep, LeaveRequestView, LeaveTypeView, PermissionRequestView, RequestApprover } from '@/lib/types';
import type { WfhRequestView } from '@/lib/wfh-types';
import { wfhDayText, wfhProgressText } from '../attendance/wfh/wfh';
import { annualFigures, availableText, typeLeftText } from './balance';
import { daysText, leaveProgressText, leaveStatusLabel, leaveStepText, leaveStepTone, periodText, standingInText, STATUS_BADGE } from './list';
import { isPermission, permissionDayText, permissionHoursLine, permissionWhenText, requestHref, type RequestRow } from './permissions';
import { isWfh, WFH_WHEN_NOTE, type LeaveListRow } from './wfh-rows';

// Parts of a leave request (owner, 18 October 2026: "can you apply the leaves according to the law?") shown on its page,
// on Requests → Leave Requests, on My Requests, on My Team, on the dashboard and on a profile, worded as the
// reimbursement claims are: its status, when and how many days, where it stands with the comment of a rejection, its log
// of every step as a timeline, the tables of the employee's own requests and of those waiting for a direct manager, and
// the balance card: the annual balance and what is left of the other types. A permission request (owner, 19 October
// 2026: "In the system, like leave") is shown with the same parts where they fit: its status, where it stands, its log,
// and a row of the tables of those waiting for a direct manager, its day and hours in place of the days; the employee's
// own permissions have a table of their own. A work from home request (owner, 26 October 2026: "Show it with leave") is a
// row of Leave Requests too: its day, a working day, and where it stands.

/** With the manager, With HR, Approved, Rejected or Cancelled; With the CEO for a C-level person's with HR (`confidential`). */
export function LeaveStatusBadge({ status, confidential }: { status: LeaveStatus; confidential?: boolean }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'bg-line-soft text-muted'}`}>{leaveStatusLabel(status, confidential)}</span>;
}

/** Where it stands, with the comment of a rejection or a cancellation: of a leave or a permission request (WfhProgress: a work from home one's). */
export function LeaveProgress({
  request,
}: {
  request: Pick<LeaveRequestView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'recordedByHr' | 'confidential' | 'steps'>;
}) {
  const p = leaveProgressText(request);
  return (
    <>
      {p.text}
      {p.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{p.reason}”</span>}
    </>
  );
}

/** Where a work from home request stands, as a leave request's, a day imported from Zoho People said so (26 October 2026). */
export function WfhProgress({ request }: { request: WfhRequestView }) {
  const p = wfhProgressText(request);
  return (
    <>
      {p.text}
      {p.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{p.reason}”</span>}
    </>
  );
}

const DOT: Record<'ok' | 'danger' | 'none', string> = { ok: 'bg-ok', danger: 'bg-danger', none: 'bg-line' };

/**
 * The request's log: every step in order, what happened, the comment, who and when (the manager stage by who decides it;
 * a C-level person's HR stage by the stage, which the CEO decides), and for a stand-in's decision whom they stood in for
 * (owner, 25 October 2026: "To a stand-in"). `stepText`: how a step is said, a permission request's its own
 * (permissionStepText: its hours given back).
 */
export function LeaveTimeline({
  request,
  stepText = leaveStepText,
}: {
  request: Pick<LeaveRequestView, 'steps' | 'manager' | 'confidential'>;
  /**
   * The steps the requests share (LeaveStepKind) are what each wording takes; a leave's own (its cover changed) only
   * leaveStepText words, the default.
   */
  stepText?: (s: Pick<LeaveRequestStep, 'decision' | 'comment'> & { kind: LeaveStepKind }, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null) => string;
}) {
  const steps = request.steps ?? [];
  if (!steps.length) return <p className="text-sm text-muted">No steps logged yet.</p>;
  return (
    <ol className="space-y-3 border-l-2 border-line-soft pl-4" aria-label={`Every step of the request, ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}>
      {steps.map((s) => (
        <li key={s.id} className="relative">
          <span aria-hidden="true" className={`absolute top-1.5 -left-[23px] size-3 rounded-full border-2 border-card ${DOT[leaveStepTone(s) ?? 'none']}`} />
          <p className="text-sm font-medium">{stepText(s as Pick<LeaveRequestStep, 'decision' | 'comment'> & { kind: LeaveStepKind }, request.manager, request.confidential)}</p>
          {s.comment && <p className="mt-0.5 text-sm whitespace-pre-line">“{s.comment}”</p>}
          <p className="text-xs text-muted">
            {s.actor && (
              <span className="break-words">
                {s.actor}
                {standingInText(s.onBehalfOf) && `, ${standingInText(s.onBehalfOf)}`} ·{' '}
              </span>
            )}
            {formatDateTime(s.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** A request over its team's staffing limit (owner, 25 October 2026: "Warn and need HR"): HR approves it too. */
export function OverLimitBadge() {
  return (
    <span className="badge bg-warn-soft text-warn" title="It broke its team’s staffing limit when sent: HR approves it too.">
      Over the staffing limit
    </span>
  );
}

/** The type (Permission for a permission request), linked to the request's page. */
function TypeLink({ request: r, who = false }: { request: RequestRow; who?: boolean }) {
  return (
    <Link href={requestHref(r)} className="font-semibold">
      {r.type.nameEn}
      <span className="sr-only">
        , {isPermission(r) ? permissionWhenText(r) : periodText(r)}
        {who ? ` for ${r.employee.fullNameEn}` : ''}
      </span>
    </Link>
  );
}

/**
 * When, and how long: a leave's days ("05/10/2026 – 08/10/2026", "4 days"); a permission's day and its hours with the
 * times ("Tuesday 03/11/2026", "2 hours (5:00 PM – 7:00 PM)"); a work from home day, a working day (26 October 2026).
 */
export function RequestWhen({ request: r }: { request: LeaveListRow }) {
  if (isWfh(r)) {
    return (
      <>
        <span className="whitespace-nowrap tabular-nums">{wfhDayText(r)}</span>
        <span className="block text-xs text-muted">{WFH_WHEN_NOTE}</span>
      </>
    );
  }
  return (
    <>
      <span className="whitespace-nowrap tabular-nums">{isPermission(r) ? permissionDayText(r) : periodText(r)}</span>
      <span className="block text-xs text-muted tabular-nums">{isPermission(r) ? permissionHoursLine(r) : daysText(r.days)}</span>
    </>
  );
}

/**
 * The employee's own requests (My Requests, a profile): the type, when and how many days, where it stands, each opening
 * its page (documents, timeline, Cancel while it may be).
 */
export function MyLeaveTable({ requests }: { requests: LeaveRequestView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">When</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className={`align-top ${r.status === 'cancelled' || r.status === 'rejected' ? 'text-muted' : ''}`}>
              <td className="min-w-40">
                <TypeLink request={r} />
                <div className="text-xs text-muted">{r.recordedByHr ? 'Recorded by HR' : 'Sent'} {formatDateTime(r.createdAt)}</div>
              </td>
              <td className="min-w-40">
                <RequestWhen request={r} />
              </td>
              <td className="min-w-48">
                <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                <p className="mt-1 text-xs text-muted">
                  <LeaveProgress request={r} />
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The requests waiting for a direct manager (My Team, Leave to Approve): who, the type, when, each with Decide; the
 * leave and the permission requests together (19 October 2026), a permission's day with its hours. One waiting for them
 * as a team lead or head of department (19 October 2026: the employee has no direct manager) says so.
 */
export function WaitingLeaveTable({ requests }: { requests: RequestRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Type</th>
            <th scope="col">When</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="min-w-40">
                <span className="font-semibold">{r.employee.fullNameEn}</span>
                <div className="text-xs text-muted">Sent {formatDateTime(r.createdAt)}</div>
                {asLeadNote(r.manager) && <div className="text-xs text-muted">{asLeadNote(r.manager)}</div>}
              </td>
              <td className="min-w-40">
                <TypeLink request={r} who />
                {/* over its team's staffing limit (25 October 2026): HR approves it too */}
                {!isPermission(r) && r.overStaffingLimit && (
                  <div className="mt-1">
                    <OverLimitBadge />
                  </div>
                )}
                {r.reason && <p className="text-xs break-words text-muted">{r.reason}</p>}
              </td>
              <td className="min-w-40">
                <RequestWhen request={r} />
              </td>
              <td className="text-right">
                <Link href={requestHref(r)} className="btn btn-primary min-h-9 px-3">
                  Decide<span className="sr-only"> on the {r.type.nameEn} request by {r.employee.fullNameEn}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The employee's own permission requests (My Requests): the day, the hours with the times, where it stands, each opening
 * its page (its timeline, Cancel while it may be).
 */
export function MyPermissionTable({ requests }: { requests: PermissionRequestView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Hours</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className={`align-top ${r.status === 'cancelled' || r.status === 'rejected' ? 'text-muted' : ''}`}>
              <td className="min-w-40">
                <Link href={requestHref(r)} className="font-semibold whitespace-nowrap tabular-nums">
                  {permissionDayText(r)}
                  <span className="sr-only">, permission of {permissionHoursLine(r)}</span>
                </Link>
                <div className="text-xs text-muted">
                  {r.recordedByHr ? 'Recorded by HR' : 'Sent'} {formatDateTime(r.createdAt)}
                </div>
              </td>
              <td className="min-w-40 tabular-nums">
                {permissionHoursLine(r)}
                {r.reason && <p className="line-clamp-2 text-xs break-words text-muted">{r.reason}</p>}
              </td>
              <td className="min-w-48">
                <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                <p className="mt-1 text-xs text-muted">
                  <LeaveProgress request={r} />
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The balance card's body: the annual balance's figures, the days available large, and what is left of each other type
 * (`types`, for their limits in words; their own names otherwise). `compact`: the dashboard's, the available days and a
 * few figures only.
 */
export function LeaveBalanceFigures({ balances, types, compact = false }: { balances: LeaveBalances; types?: LeaveTypeView[] | null; compact?: boolean }) {
  const a = balances.annual;
  const figures = annualFigures(a, balances.year).filter((f) => f.key !== 'available' && (!compact || ['entitlement', 'taken', 'booked', 'pending'].includes(f.key)));
  const others = balances.types.filter((t) => {
    const type = types?.find((x) => x.id === t.typeId);
    // the annual leave itself is the card's figure; a type off for new requests is shown only once used
    return type?.balance !== 'annual' && (type?.active !== false || t.used > 0);
  });
  return (
    <div className="space-y-4">
      <div>
        <p className="text-2xl font-semibold tabular-nums">{availableText(a)}</p>
        <p className="text-xs text-muted">Annual leave, {balances.year}: what you can still ask for, once what is waiting is decided.</p>
      </div>
      <dl className={`grid gap-3 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
        {figures.map((f) => (
          <div key={f.key} className="rounded-lg bg-canvas px-3 py-2">
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="text-base font-semibold tabular-nums">{f.value}</dd>
            {f.note && <dd className="text-[11px] text-muted">{f.note}</dd>}
          </div>
        ))}
      </dl>
      {!compact && others.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Other Leave</h3>
          <ul className="mt-1 divide-y divide-line-soft">
            {others.map((t) => (
              <li key={t.typeId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
                <span>
                  {t.nameEn}{' '}
                  <span lang="ar" dir="rtl" className="inline-block text-xs text-muted">
                    {t.nameAr}
                  </span>
                </span>
                <span className="text-muted tabular-nums">{typeLeftText(t, types?.find((x) => x.id === t.typeId))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

