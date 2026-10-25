import Link from 'next/link';
import type { ReimbursementStatus } from '@trendlix/shared';
import { asLeadNote } from '@/lib/department-leads';
import { formatDate, formatDateTime } from '@/lib/format';
import type { ReimbursementClaimView } from '@/lib/types';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { standingInText } from '../leave/list';
import { claimHref, lowerApproved, payMonthOf, progressText, STATUS_BADGE, statusLabel, stepsLabel, stepText, stepTone } from './list';

// Parts of a reimbursement claim (owner, 18 October 2026) shown on its page, on Requests → Reimbursements, on My
// Requests, on My Team and on the dashboard, worded as the raise requests are: its status, the amount claimed and the
// one approved when lower, where it stands with the comment of a rejection, its log of every step as a timeline, and the
// tables of the employee's own claims and of those waiting for a direct manager.

const dash = <span className="text-muted">—</span>;

/**
 * With the manager, With HR, With Finance, Approved, Rejected or Cancelled; With the CEO for a C-level person's with HR
 * or Finance (`confidential`, 19 October 2026).
 */
export function ClaimStatusBadge({ status, confidential }: { status: ReimbursementStatus; confidential?: boolean }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? 'bg-line-soft text-muted'}`}>{statusLabel(status, confidential)}</span>;
}

/** The amount claimed, and under it the lower amount approved, when one was. */
export function ClaimAmount({ claim }: { claim: Pick<ReimbursementClaimView, 'amount' | 'approvedAmount'> }) {
  const lower = lowerApproved(claim);
  if (lower === null) return <span className="tabular-nums">{formatEgp(claim.amount)}</span>;
  return (
    <>
      <span className="text-muted tabular-nums line-through">{formatEgp(claim.amount)}</span>
      <span className="block font-medium tabular-nums">{formatEgp(lower)} approved</span>
    </>
  );
}

/** Where it stands, with the comment of a rejection. */
export function ClaimProgress({ claim }: { claim: ReimbursementClaimView }) {
  const p = progressText(claim);
  return (
    <>
      {p.text}
      {p.reason && <span className="mt-0.5 block whitespace-pre-line text-muted">“{p.reason}”</span>}
    </>
  );
}

const DOT: Record<'ok' | 'danger' | 'warn' | 'none', string> = { ok: 'bg-ok', danger: 'bg-danger', warn: 'bg-warn', none: 'bg-line' };

/**
 * The claim's log: every step in order, what happened and the amount with it, the comment, who and when (a C-level
 * person's HR and Finance stages by the stage, which the CEO decides), and for a stand-in's decision whom they stood in
 * for (owner, 25 October 2026: "To a stand-in").
 */
export function ClaimTimeline({ claim }: { claim: Pick<ReimbursementClaimView, 'steps' | 'manager' | 'confidential'> }) {
  const steps = claim.steps ?? [];
  if (!steps.length) return <p className="text-sm text-muted">No steps logged yet.</p>;
  return (
    <ol className="space-y-3 border-l-2 border-line-soft pl-4" aria-label={`Every step of the claim, ${stepsLabel(steps.length)}`}>
      {steps.map((s) => {
        const t = stepText(s, claim.manager, claim.confidential);
        return (
          <li key={s.id} className="relative">
            <span aria-hidden="true" className={`absolute top-1.5 -left-[23px] size-3 rounded-full border-2 border-card ${DOT[stepTone(s) ?? 'none']}`} />
            <p className="text-sm font-medium">{t.title}</p>
            {t.detail && <p className="text-xs text-muted tabular-nums">{t.detail}</p>}
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
        );
      })}
    </ol>
  );
}

/** The type, linked to the claim's page. */
function TypeLink({ claim, decide = false }: { claim: ReimbursementClaimView; decide?: boolean }) {
  return (
    <Link href={claimHref(claim.id)} className="font-semibold">
      {claim.type.nameEn}
      <span className="sr-only">
        {' '}
        claim of {formatDate(claim.expenseDate)}
        {decide ? ` by ${claim.employee.fullNameEn}` : ''}
      </span>
    </Link>
  );
}

/**
 * The employee's own claims (My Requests): the type, the expense's date, the amount claimed and the one approved, where
 * it stands and the payroll month it is paid with, each opening its page (receipts, timeline, Cancel while open).
 */
export function MyClaimsTable({ claims }: { claims: ReimbursementClaimView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Expense Date</th>
            <th scope="col" className="text-right">
              Amount
            </th>
            <th scope="col" className="text-right">
              Approved
            </th>
            <th scope="col">Status</th>
            <th scope="col">Pay Month</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => {
            const month = payMonthOf(c);
            return (
              <tr key={c.id} className={`align-top ${c.status === 'cancelled' ? 'text-muted' : ''}`}>
                <td className="min-w-40">
                  <TypeLink claim={c} />
                  <div className="text-xs text-muted">Sent {formatDateTime(c.createdAt)}</div>
                </td>
                <td className="whitespace-nowrap tabular-nums">{formatDate(c.expenseDate)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(c.amount)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{c.approvedAmount !== null && c.status !== 'rejected' ? formatEgp(c.approvedAmount) : dash}</td>
                <td className="min-w-48">
                  <ClaimStatusBadge status={c.status} confidential={c.confidential} />
                  <p className="mt-1 text-xs text-muted">
                    <ClaimProgress claim={c} />
                  </p>
                </td>
                <td className="whitespace-nowrap">{month ?? dash}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The claims waiting for a direct manager (My Team, Reimbursements to Approve): who, the type, the expense's date and the
 * amount, each with Decide, which opens the claim's page and its decision form. One waiting for them as a team lead or
 * head of department (19 October 2026: the claimant has no direct manager) says so.
 */
export function WaitingClaimsTable({ claims }: { claims: ReimbursementClaimView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Type</th>
            <th scope="col">Expense Date</th>
            <th scope="col" className="text-right">
              Amount
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id} className="align-top">
              <td className="min-w-40">
                <span className="font-semibold">{c.employee.fullNameEn}</span>
                <div className="text-xs text-muted">Sent {formatDateTime(c.createdAt)}</div>
                {asLeadNote(c.manager) && <div className="text-xs text-muted">{asLeadNote(c.manager)}</div>}
              </td>
              <td className="min-w-48">
                <TypeLink claim={c} decide />
                <p className="text-xs break-words text-muted">{c.description}</p>
              </td>
              <td className="whitespace-nowrap tabular-nums">{formatDate(c.expenseDate)}</td>
              <td className="text-right whitespace-nowrap">
                <ClaimAmount claim={c} />
              </td>
              <td className="text-right">
                <Link href={claimHref(c.id)} className="btn btn-primary min-h-9 px-3">
                  Decide<span className="sr-only"> on the {c.type.nameEn} claim by {c.employee.fullNameEn}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
