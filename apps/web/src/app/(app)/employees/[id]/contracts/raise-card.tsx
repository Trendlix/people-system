import Link from 'next/link';
import { PAY_STAGE_LABELS, RAISE_REASON_LABELS, type PayStage } from '@trendlix/shared';
import { formatDate, titleCase } from '@/lib/format';
import type { Contract } from '@/lib/types';
import { deleteContract, signContract } from '../../contract-actions';
import { ceoDecidesRaise, sendRaise } from '../../raise-actions';
import { RaiseDecisionForm } from '../../../approvals/raise-decision-form';
import { ActionButton, SignContract } from './contract-buttons';
import { termLabel } from './dates';
import { changeOf, decisionText, editHref, fromToText, insuredWageText, pendingKindLabel, promotionText, stageOf, stageTone, versionBefore } from './raise';
import { hourlyNetTerms, payLabel } from './salary';
import { shownCode, withCodeInBrackets } from '@/lib/hidden';

// A change of pay waiting to be signed, in the Contract section (owner's decisions, 16 October 2026: "HR, then the
// CEO"): a raise (a salary amendment, or a new contract within the term) or a renewal with new pay. It says what it is,
// from when, the pay before and after (to those who see salaries), why, the promotion with it, where it stands (Draft,
// Returned, With the CEO, Approved) and the CEO's comment when returned. HR changes it and sends it to the CEO, and signs
// it once approved; the CEO approves it as it is or with another raise, or rejects it, with a comment, or returns it
// (17 October 2026); a Super Admin may delete it. Its documents are generated once the CEO approves it.

const small = 'btn min-h-9 px-3';

/** Where a version stands, as the Salary History and the raise card show it. */
export function StageBadge({ stage }: { stage: PayStage }) {
  return <span className={`badge ${stageTone(stage)}`}>{PAY_STAGE_LABELS[stage]}</span>;
}

/** Where it stands with the CEO ("With the CEO since 16/10/2026"); null for a draft or a returned one (the badge says it). */
function stageNote(d: Contract, stage: PayStage, isCeo: boolean): string | null {
  if (stage === 'pending_ceo') return `${decisionText(d.raise)}${isCeo ? ': waiting for your decision' : ''}.`;
  if (stage === 'approved') return `${decisionText(d.raise)}.`;
  return null;
}

export function RaiseCard({
  draft: d,
  contracts,
  employeeId,
  canEdit,
  canDelete,
  isCeo,
  today,
}: {
  /** A draft with `raise`. */
  draft: Contract;
  /** Every version, to compare with the one before. */
  contracts: Contract[];
  employeeId: string;
  canEdit: boolean;
  canDelete: boolean;
  isCeo: boolean;
  today: string;
}) {
  const raise = d.raise;
  if (!raise) return null;
  const change = changeOf(d, contracts);
  const before = versionBefore(d, contracts);
  const stage = stageOf(d);
  const kind = pendingKindLabel(change);
  const name = `the ${kind.toLowerCase()} of ${withCodeInBrackets(`version ${d.version}`, d.number)}`;
  const term =
    change === 'amendment'
      ? `From ${formatDate(d.startDate)}, on the contract${d.endDate ? ` to ${formatDate(d.endDate)}` : ''}`
      : `${termLabel(d)}, without probation`;
  const what = [term, payLabel(d), hourlyNetTerms(d)].filter(Boolean).join(' · ');
  const allowances = (d.allowances ?? []).length > 0 || (before?.allowances ?? []).length > 0;
  const gross = d.salaryHidden ? null : fromToText(before?.grossSalary ?? null, d.grossSalary);
  const total = d.salaryHidden || !allowances ? null : fromToText(before?.totalSalary ?? null, d.totalSalary);
  const promotion = promotionText(raise);

  const send = canEdit && (stage === 'draft' || stage === 'returned');
  const edit = canEdit && stage !== 'pending_ceo';
  const sign = canEdit && stage === 'approved';
  const decide = isCeo && stage === 'pending_ceo';

  return (
    <div className="card space-y-3 border-dashed p-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          {titleCase(kind)}: Version {d.version}
        </h3>
        <StageBadge stage={stage} />
        {shownCode(d.number) && <span className="text-xs text-muted">{d.number}</span>}
      </div>
      <p className="text-sm">{what}</p>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {gross && (
          <>
            <dt className="text-muted">Gross</dt>
            <dd className="tabular-nums">{gross}</dd>
          </>
        )}
        {total && (
          <>
            <dt className="text-muted">Gross and allowances</dt>
            <dd className="tabular-nums">{total}</dd>
          </>
        )}
        <dt className="text-muted">Reason</dt>
        <dd>{RAISE_REASON_LABELS[raise.reason]}</dd>
        {promotion && (
          <>
            <dt className="text-muted">Promotion</dt>
            <dd>{promotion}</dd>
          </>
        )}
      </dl>
      {d.note && <p className="text-sm text-muted">{d.note}</p>}
      {stage === 'returned' && raise.returnedReason && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Returned by the CEO: {raise.returnedReason}
        </p>
      )}
      <p className="text-xs text-muted">{[stageNote(d, stage, isCeo), insuredWageText(d.startDate, raise.form2From)].filter(Boolean).join(' ')}</p>
      {(send || edit || sign || decide || canDelete) && (
        <div className="flex flex-wrap items-start gap-3">
          {sign && (
            <SignContract action={signContract.bind(null, d.id)} today={today} name={name} />
          )}
          {send && (
            <ActionButton
              action={sendRaise.bind(null, d.id)}
              pendingText="Sending…"
              variant="primary"
              confirmText={`Send ${name} to the CEO?`}
            >
              Send to the CEO<span className="sr-only">: {name}</span>
            </ActionButton>
          )}
          {edit && (
            <Link href={editHref(employeeId, d.id, change)} className={`${small} btn-secondary`}>
              Edit<span className="sr-only"> {name}</span>
            </Link>
          )}
          {decide && (
            <div className="w-full">
              <RaiseDecisionForm
                action={ceoDecidesRaise.bind(null, d.id)}
                confirmApprove={`Approve ${name}?`}
                name={name}
                previousGross={before?.grossSalary ?? null}
                // the CEO may change the reason when approving (19 October 2026)
                reason={d.raise?.reason ?? null}
              />
            </div>
          )}
          {canDelete && (
            <ActionButton
              action={deleteContract.bind(null, d.id)}
              pendingText="Deleting…"
              variant="danger"
              confirmText={`Delete ${name}?`}
            >
              Delete<span className="sr-only"> {name}</span>
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}
