import Link from 'next/link';
import { isTrainingType } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile, Employment } from '@/lib/types';
import { confirmProbation } from '../../contract-actions';
import { ActionButton } from './contract-buttons';
import { daysBetween, daysLabel } from './dates';

// While the current employment is on probation (3 months at most, once per employer: Labour Law Art. 90): until when,
// or that its end date has passed without a decision. HR confirms it (the status becomes Active) or ends the
// employment during probation, which goes to the CEO like every ending. Never for a trainee or an intern, whose agreement
// has no probation (19 October 2026), even with a Probation from before then: the API refuses to confirm one.

const small = 'btn min-h-9 px-3';

export function ProbationBanner({
  employee,
  employment: e,
  today,
  endingInProgress,
}: {
  employee: Pick<EmployeeProfile, 'id' | 'fullNameEn' | 'access'>;
  employment: Employment;
  /** YYYY-MM-DD in Cairo. */
  today: string;
  /** An ending is waiting for the CEO or approved: nothing to decide here meanwhile. */
  endingInProgress: boolean;
}) {
  if (e.status !== 'probation' || isTrainingType(e.employmentType)) return null;
  const left = e.probationEnd ? daysBetween(today, e.probationEnd) : null;
  const overdue = left !== null && left < 0;
  const canDecide = employee.access.edit && !endingInProgress;

  let text: string;
  if (left === null || !e.probationEnd) text = 'On probation.';
  else if (left > 0) text = `On probation until ${formatDate(e.probationEnd)} (${daysLabel(left)} left).`;
  else if (left === 0) text = `On probation until today, ${formatDate(e.probationEnd)}.`;
  else {
    // notice during probation must have been given by its end date (the API refuses a later one)
    const next = canDecide ? ' Confirm it, or end the employment during probation if notice was given by then.' : '';
    text = `Probation was due to end on ${formatDate(e.probationEnd)}, ${daysLabel(-left)} ago, and is not confirmed yet.${next}`;
  }

  return (
    <div
      role={overdue ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg px-4 py-3 text-sm ${overdue ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-ink'}`}
    >
      <p className="min-w-0 flex-1">
        {overdue && <span className="font-semibold">Overdue: </span>}
        {text}
      </p>
      {canDecide && (
        <div className="flex flex-wrap items-start gap-2">
          <ActionButton
            action={confirmProbation.bind(null, employee.id, e.id)}
            pendingText="Confirming…"
            variant="primary"
            confirmText={`Confirm that ${employee.fullNameEn} passed probation? Their status becomes Active.`}
          >
            Confirm<span className="sr-only"> that probation passed</span>
          </ActionButton>
          <Link href={`/employees/${employee.id}/ending/new?rule=probation`} className={`${small} btn-secondary`}>
            End during probation
          </Link>
        </div>
      )}
    </div>
  );
}
