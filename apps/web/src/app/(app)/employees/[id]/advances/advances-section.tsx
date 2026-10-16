import Link from 'next/link';
import { ADVANCE_STATUS_LABELS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import type { EmployeeProfile } from '@/lib/types';
import type { AdvanceRow } from '../../../payroll/adjustments/adjustments';
import { loadJson } from '../../../payroll/load';
import { UNSETTLED_PATH } from '../../../payroll/sections';
import { advanceKindText } from '../../../payroll/unsettled/unsettled';
import { formatEgp } from '../contracts/salary';
import { Loading, ProfileSection } from '../../ui';
import { advanceTotals } from './advances';

// The employee's advances and loans (owner, 17 October 2026: Unsettled lists "advances and loans (still being
// recovered)"), on the Employment tab's Salary sub-tab: each with its amount, what was recovered (the deductions
// applied to a run), what is planned (those pending) and what is outstanding, the open ones first. HR records them, and
// marks them settled, on Payroll → Unsettled; recoveries are planned on Additions / Deductions. HR, Finance and the CEO
// only, as the salary; the API checks this again.

const dash = <span className="text-muted">—</span>;

type Employee = Pick<EmployeeProfile, 'id'>;

const Title = ({ note, children }: { note?: string; children: React.ReactNode }) => (
  <ProfileSection title="Advances and Loans" note={note} restricted>
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

export async function AdvancesSection({ employee }: { employee: Employee }) {
  const loaded = await loadJson<AdvanceRow[]>(`/payroll/advances?employeeId=${employee.id}`);
  // an API from before them, or not the caller's to see: nothing to show
  if (loaded.kind === 'unavailable' || loaded.kind === 'forbidden') return null;
  if (loaded.kind === 'failed') {
    return (
      <Title>
        <p className="text-sm text-muted">The advances and loans could not be loaded. {loaded.messages.join(' ')}</p>
      </Title>
    );
  }
  const rows = loaded.value;
  if (!rows.length) {
    return (
      <Title>
        <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
          No advances or loans. HR records them on <Link href={`${UNSETTLED_PATH}#advances`}>Payroll → Unsettled</Link>.
        </p>
      </Title>
    );
  }
  const t = advanceTotals(rows);
  return (
    <Title note={`${formatEgp(t.outstanding)} outstanding of ${formatEgp(t.amount)} given`}>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Given On</th>
              <th scope="col" className="text-right">
                Amount
              </th>
              <th scope="col" className="text-right">
                Recovered
              </th>
              <th scope="col" className="text-right">
                Planned
              </th>
              <th scope="col" className="text-right">
                Outstanding
              </th>
              <th scope="col">Status</th>
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
                <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(a.recovered)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{a.planned ? formatEgp(a.planned) : dash}</td>
                <td className="text-right font-semibold whitespace-nowrap tabular-nums">{formatEgp(a.outstanding)}</td>
                <td>
                  <span className={`badge ${a.status === 'open' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>{ADVANCE_STATUS_LABELS[a.status] ?? a.status}</span>
                  {a.status === 'settled' && (
                    <div className="mt-0.5 text-xs text-muted">{a.settledNote ?? 'Recovered in full'}{a.settledAt ? `, ${formatDate(a.settledAt)}` : ''}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Title>
  );
}
