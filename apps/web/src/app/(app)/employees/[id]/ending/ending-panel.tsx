import { ENDING_STATUS_LABELS, type EndingStatus } from '@trendlix/shared';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Ending } from '@/lib/types';
import { completeEnding, decideEnding, setEndingLastDay, withdrawEnding } from '../../contract-actions';
import { art154Text } from '../../employment-law';
import { FieldGrid, ProfileSection, type GridField } from '../../ui';
import { ActionButton } from '../contracts/contract-buttons';
import { ChangeLastDay, EndingDecision, WithdrawEnding } from './ending-buttons';
import { lastDayText } from './rules';

// An ending on the Employment tab: how and when the employment ends, where its approval stands, and what is left to do.
// HR recorded it (which counts as HR's approval); the CEO approves or rejects it here; HR may withdraw it until it is
// completed, and completes it on or after the last working day, which ends the employment. Once completed: the
// deadlines for the final dues and for filing the ending with the labour office. A fixed term the company doesn't renew
// carries Art. 154's note and estimate (owner, 18 October 2026), information only: no money is moved.

const STATUS_STYLE: Record<EndingStatus, string> = {
  pending_ceo: 'bg-warn-soft text-warn',
  approved: '', // the badge's own accent colours
  rejected: 'bg-danger-soft text-danger',
  withdrawn: 'bg-line-soft text-muted',
  completed: 'bg-line-soft text-muted',
};

export function EndingStatusBadge({ status }: { status: EndingStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{ENDING_STATUS_LABELS[status]}</span>;
}

/** Who approved and when: "hr@trendlix.com" with "14/10/2026, 5:42 PM" under it. */
const by = (who: { email: string } | null, at: string | null) => ({ value: who?.email ?? (at ? 'Recorded' : null), note: at && formatDateTime(at) });

function endingFields(x: Ending): GridField[] {
  const ceoLabel = x.status === 'rejected' ? 'Rejected by the CEO' : 'Approved by the CEO';
  const fields: (GridField | false)[] = [
    { key: 'ending-rule', label: 'How it ends', value: x.ruleLabel },
    { key: 'ending-status', label: 'Status', value: <EndingStatusBadge status={x.status} /> },
    (x.initiator === 'employee' || x.initiator === 'company') && {
      key: 'ending-initiator',
      label: 'Started by',
      value: x.initiator === 'employee' ? 'The employee' : 'The company',
    },
    { key: 'ending-notice', label: 'Notice given on', value: formatDate(x.noticeGivenOn), note: x.payInLieu && 'Paid instead of worked' },
    {
      key: 'ending-last-day',
      label: x.lastDayAgreed ? 'Last working day (agreed)' : 'Last working day',
      value: lastDayText(x, formatDate),
    },
    !!x.decisionDueOn && {
      key: 'ending-decision-due',
      label: 'Decision due',
      value: formatDate(x.decisionDueOn),
      note: 'Or the resignation counts as accepted (Decree 187/2025)',
    },
    !!(x.certifiedOffice || x.certifiedSerial || x.certifiedOn) && {
      key: 'ending-certified',
      label: 'Certified at the labour office',
      value: [x.certifiedOffice, x.certifiedSerial && `No. ${x.certifiedSerial}`].filter(Boolean).join(' · '),
      note: x.certifiedOn && `On ${formatDate(x.certifiedOn)}`,
    },
    { key: 'ending-hr', label: 'Approved by HR', ...by(x.hrApprovedBy, x.hrApprovedAt) },
    x.status === 'pending_ceo'
      ? { key: 'ending-ceo', label: 'The CEO', value: <span className="text-muted">Not decided yet</span> }
      : !!(x.ceoDecidedBy || x.ceoDecidedAt) && { key: 'ending-ceo', label: ceoLabel, ...by(x.ceoDecidedBy, x.ceoDecidedAt) },
    !!x.ceoNote && { key: 'ending-ceo-note', label: "The CEO's note", value: x.ceoNote },
    !!x.reason && { key: 'ending-reason', label: 'Reason', value: x.reason },
    !!x.note && { key: 'ending-note', label: 'Note', value: x.note },
    !!x.completedAt && { key: 'ending-completed', label: 'Completed', value: formatDateTime(x.completedAt) },
  ];
  return fields.filter((f): f is GridField => f !== false);
}

export function EndingPanel({
  ending: x,
  employeeName,
  canEdit,
  canSetLastDay = false,
  isCeo,
  today,
}: {
  ending: Ending;
  employeeName: string;
  /** HR: withdraws and completes. */
  canEdit: boolean;
  /** HR or an Admin (never a developer): agrees, changes or clears the last working day until the ending is completed. */
  canSetLastDay?: boolean;
  /** The CEO: approves or rejects. */
  isCeo: boolean;
  /** YYYY-MM-DD in Cairo. */
  today: string;
}) {
  const name = `the ending of ${employeeName}'s employment`;
  const open = x.status === 'pending_ceo' || x.status === 'approved';
  const canComplete = today >= x.lastWorkingDay;
  const decides = x.status === 'pending_ceo' && isCeo;
  const completes = x.status === 'approved' && canEdit;
  const withdraws = open && canEdit;
  const setsLastDay = open && canSetLastDay;

  return (
    <ProfileSection
      title="Ending"
      note={
        x.status === 'completed'
          ? `Ended ${formatDate(x.lastWorkingDay)}`
          : `Last working day ${formatDate(x.lastWorkingDay)}${x.lastDayAgreed ? ' (agreed)' : ''}`
      }
    >
      <div className="space-y-3">
        <FieldGrid fields={endingFields(x)} />

        {x.status === 'pending_ceo' && !isCeo && <p className="text-sm text-muted">Waiting for the CEO&apos;s approval.</p>}
        {x.status === 'approved' && !canEdit && (
          <p className="text-sm text-muted">Approved. HR completes it on or after the last working day, {formatDate(x.lastWorkingDay)}.</p>
        )}

        {(decides || completes || withdraws || setsLastDay) && (
          <div className="flex flex-wrap items-start gap-3">
            {decides && <EndingDecision approve={decideEnding.bind(null, x.id, 'approve')} reject={decideEnding.bind(null, x.id, 'reject')} name={name} />}
            {completes && (
              <ActionButton
                action={completeEnding.bind(null, x.id)}
                pendingText="Completing…"
                variant="primary"
                disabled={!canComplete}
                disabledNote={canComplete ? undefined : `Can be completed from ${formatDate(x.lastWorkingDay)}, the last working day.`}
                confirmText={`Complete ${name}? The employment ends on ${formatDate(x.lastWorkingDay)}, and ${employeeName} is then a former employee. This cannot be undone.`}
              >
                Complete<span className="sr-only"> {name}</span>
              </ActionButton>
            )}
            {setsLastDay && (
              <ChangeLastDay
                action={setEndingLastDay.bind(null, x.id)}
                name={name}
                agreed={Boolean(x.lastDayAgreed)}
                lastWorkingDay={x.lastWorkingDay}
                approved={x.status === 'approved'}
              />
            )}
            {withdraws && <WithdrawEnding action={withdrawEnding.bind(null, x.id)} name={name} />}
          </div>
        )}

        {x.art154Note && (
          <p className="rounded-lg bg-canvas px-4 py-3 text-sm">
            <span className="font-semibold">{x.art154Note}.</span>
            {x.art154Estimate && ` ${art154Text(x.art154Estimate)}`}
          </p>
        )}

        {x.status === 'completed' && x.deadlines && (
          <ul className="space-y-1 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            <li>Pay final dues by {formatDate(x.deadlines.finalDuesBy)} (Labour Law Art. 108).</li>
            <li>File the ending with the labour office by {formatDate(x.deadlines.labourOfficeFilingBy)} (Decree 214/2025).</li>
          </ul>
        )}
      </div>
    </ProfileSection>
  );
}
