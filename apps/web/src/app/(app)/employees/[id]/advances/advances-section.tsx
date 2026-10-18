import Link from 'next/link';
import { formatDate } from '@/lib/format';
import type { DeductionPlansView, EmployeeProfile } from '@/lib/types';
import type { AdvanceRow } from '../../../payroll/adjustments/adjustments';
import { monthName } from '../../../payroll/list';
import { loadJson, type Loaded } from '../../../payroll/load';
import { periodText, RECURRING_BADGE, RECURRING_STATUS_LABELS } from '../../../payroll/recurring-deductions/recurring';
import { RECURRING_PATH, UNSETTLED_PATH } from '../../../payroll/sections';
import { settledText } from '../../../payroll/unsettled/installments';
import { advanceKindText } from '../../../payroll/unsettled/unsettled';
import { formatEgp } from '../contracts/salary';
import { Loading, ProfileSection } from '../../ui';
import { hasPlans, plansFromAdvances, plansNote } from './advances';

// The employee's Loans and Deductions (owner, 17 October 2026: Unsettled lists "advances and loans (still being
// recovered)"; 18 October 2026: "in the deductions i might have a loan of a medical subscription or something that
// needs to be deducted as installments on the employee. how will it be managed?"), on the Employment tab's Salary
// sub-tab: each open advance or loan with what is paid so far, what is left and the next installment, and the recurring
// deductions running or to come (e.g. a medical subscription share), from GET /employees/:id/deduction-plans, for the
// employee themself and for HR, Finance and the CEO; those also see the ones settled, and how. HR records advances and
// loans on Payroll → Unsettled and recurring deductions on Payroll → Recurring Deductions. The API checks who may see it.

const dash = <span className="text-muted">—</span>;

type Employee = Pick<EmployeeProfile, 'id'>;

const Title = ({ note, children }: { note?: string; children: React.ReactNode }) => (
  <ProfileSection title="Loans and Deductions" note={note} restricted>
    {children}
  </ProfileSection>
);

export function AdvancesLoading() {
  return (
    <Title>
      <Loading />
    </Title>
  );
}

/** The plans, as the employee's profile reads them: read once for an employee, to offer them the Salary sub-tab. */
export const loadDeductionPlans = (employeeId: string) => loadJson<DeductionPlansView>(`/employees/${encodeURIComponent(employeeId)}/deduction-plans`);

function OpenAdvances({ rows }: { rows: DeductionPlansView['advances'] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Advances and Loans</h3>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col" className="text-right">
                Amount
              </th>
              <th scope="col" className="text-right">
                Paid So Far
              </th>
              <th scope="col" className="text-right">
                Left
              </th>
              <th scope="col">Next Installment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {advanceKindText(a.kind)}
                  <div className="max-w-64 text-xs text-muted">{a.reason}</div>
                </td>
                <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(a.amount)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(a.recovered)}</td>
                <td className="text-right font-semibold whitespace-nowrap tabular-nums">{formatEgp(a.outstanding)}</td>
                <td className="whitespace-nowrap">
                  {a.nextInstallment ? (
                    <>
                      {monthName(a.nextInstallment.month)}
                      <div className="text-xs text-muted tabular-nums">{formatEgp(a.nextInstallment.amount)}</div>
                    </>
                  ) : (
                    dash
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Recurring({ rows }: { rows: DeductionPlansView['recurring'] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Recurring Deductions</h3>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">What For</th>
              <th scope="col" className="text-right">
                A Month
              </th>
              <th scope="col">Months</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="min-w-40">{r.name}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.amount)}</td>
                <td className="min-w-44 text-sm">{periodText({ ...r, stoppedFrom: null })}</td>
                <td>
                  <span className={`badge ${RECURRING_BADGE[r.status] ?? ''}`}>{RECURRING_STATUS_LABELS[r.status] ?? r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The advances and loans settled, and how (HR, Finance and the CEO). */
function Settled({ rows }: { rows: AdvanceRow[] }) {
  return (
    <details className="card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Settled advances and loans ({rows.length})</summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Given On</th>
              <th scope="col" className="text-right">
                Amount
              </th>
              <th scope="col">How Settled</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {advanceKindText(a.kind)}
                  <div className="max-w-64 text-xs text-muted">{[a.reason, a.plan].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="whitespace-nowrap tabular-nums">{formatDate(a.givenOn)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(a.amount)}</td>
                <td className="min-w-48 text-sm">
                  {settledText(a)}
                  {(a.settledBy || a.settledAt) && (
                    <div className="text-xs text-muted">{[a.settledBy?.name, a.settledAt ? formatDate(a.settledAt) : null].filter(Boolean).join(', ')}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * `staff`: HR, Finance or the CEO, who also see the settled ones; `loaded`: the plans already read (for the employee,
 * to offer them the sub-tab).
 */
export async function AdvancesSection({ employee, staff, loaded }: { employee: Employee; staff: boolean; loaded?: Loaded<DeductionPlansView> }) {
  const [read, history] = await Promise.all([
    loaded ?? loadDeductionPlans(employee.id),
    staff ? loadJson<AdvanceRow[]>(`/payroll/advances?employeeId=${encodeURIComponent(employee.id)}`) : null,
  ]);
  const advances = history?.kind === 'ok' ? history.value : null;
  // an API from before the plans: the open advances and loans from HR's list, no recurring deductions
  const plans: DeductionPlansView | null = read.kind === 'ok' ? read.value : advances ? { advances: plansFromAdvances(advances), recurring: [] } : null;
  if (!plans) {
    // not the caller's to see, or nothing to show yet
    if (read.kind !== 'failed') return null;
    return (
      <Title>
        <p className="text-sm text-muted">The loans and deductions could not be loaded. {read.messages.join(' ')}</p>
      </Title>
    );
  }
  const settled = (advances ?? []).filter((a) => a.status === 'settled');
  if (!hasPlans(plans) && !settled.length) {
    // the employee sees the sub-tab only with something here; HR, Finance and the CEO are told where they are recorded
    if (!staff) return null;
    return (
      <Title>
        <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
          No advances, loans or recurring deductions. HR records advances and loans on <Link href={`${UNSETTLED_PATH}#advances`}>Payroll → Unsettled</Link>,
          and recurring deductions on <Link href={RECURRING_PATH}>Payroll → Recurring Deductions</Link>.
        </p>
      </Title>
    );
  }
  return (
    <Title note={plansNote(plans, formatEgp)}>
      <div className="space-y-6">
        {plans.advances.length > 0 && <OpenAdvances rows={plans.advances} />}
        {plans.recurring.length > 0 && <Recurring rows={plans.recurring} />}
        {!hasPlans(plans) && <p className="text-sm text-muted">Nothing is being deducted now.</p>}
        {settled.length > 0 && <Settled rows={settled} />}
      </div>
    </Title>
  );
}
