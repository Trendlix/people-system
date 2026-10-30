import type { PayrollStatus } from '@trendlix/shared';
import { payrollSteps, STATUS_BADGE, statusLabel } from './list';

// Small building blocks of the Payroll pages.

export function PayrollStatusBadge({ status }: { status: PayrollStatus }) {
  return <span className={`badge ${STATUS_BADGE[status] ?? ''}`}>{statusLabel(status)}</span>;
}

const DOT = {
  done: 'border-ok bg-ok text-on-accent',
  current: 'border-accent bg-accent text-on-accent',
  upcoming: 'border-line bg-card text-muted',
} as const;

/** Where a run stands: Draft → With the CEO → Approved → Paid. */
export function PayrollStepper({ status }: { status: PayrollStatus }) {
  const steps = payrollSteps(status);
  return (
    <ol aria-label="Where the run stands" className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((s, i) => (
        <li key={s.status} aria-current={s.state === 'current' ? 'step' : undefined} className="flex items-center gap-2">
          <span className={`inline-flex size-6 items-center justify-center rounded-full border text-xs font-semibold ${DOT[s.state]}`}>
            {s.state === 'done' ? <span aria-hidden="true">✓</span> : i + 1}
          </span>
          <span className={`text-sm ${s.state === 'upcoming' ? 'text-muted' : 'font-semibold'}`}>
            {s.label}
            {s.state === 'done' && <span className="sr-only"> (done)</span>}
          </span>
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="mx-1 h-px w-8 bg-line">
              {' '}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
