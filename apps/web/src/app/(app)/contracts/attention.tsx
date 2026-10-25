import { PAY_BASIS_LABELS } from '@trendlix/shared';
import { shownCode } from '@/lib/hidden';
import type { ContractListItem, EndingSummary, ExpiringContract, ProbationEnding, SessionUser } from '@/lib/types';
import { followsEndings, getOrNull, PENDING_ENDINGS } from '../approvals/data';
import { todayInCairo } from '../employees/ui';
import { loadContractList } from './data';
import { ContractPerson as Person, Due, ExpiringRow } from './ending-soon';
import {
  APPROVED_ENDINGS,
  byDate,
  CONTRACTS_WITHIN,
  endingsInProgress,
  endingStage,
  listPaths,
  NO_FILTERS,
  PROBATION_WITHIN,
} from './list';

// What needs doing about contracts, in compact panels: contracts ending soon (with the day the non-renewal notice is
// due, or for an intern's agreement what follows it: 19 October 2026), drafts waiting to be signed, probations ending, and endings in progress. HR and the CEO see them all; Finance,
// which doesn't get the alert and ending lists, only the drafts. Each row opens the employee's Employment tab. Like the
// home page's cards (their dates, people and contracts ending soon shared in ending-soon.tsx), each panel shows a quiet
// line when it can't load.

/** A panel's rows, or why there are none to show: it failed, or the API doesn't have the list yet. */
type Rows<T> = T[] | 'failed' | 'unavailable';

const rowsOf = <T,>(rows: T[] | null): Rows<T> => rows ?? 'failed';

function Panel<T>({
  title,
  note,
  rows,
  empty,
  children,
}: {
  title: string;
  /** Beside the title, e.g. "Next 90 days". */
  note?: string;
  rows: Rows<T>;
  empty: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-semibold">{title}</h3>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      {rows === 'failed' ? (
        <p className="mt-3 text-sm text-muted">Couldn&apos;t load.</p>
      ) : rows === 'unavailable' ? (
        <p className="mt-3 text-sm text-muted">Not available yet.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">{children(rows)}</ul>
      )}
    </section>
  );
}

const line = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1';
const subline = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted';

function EndingSoon({ rows, today }: { rows: Rows<ExpiringContract>; today: string }) {
  return (
    <Panel title="Ending Soon" note={`Next ${CONTRACTS_WITHIN} days`} rows={rows} empty={`No contracts end in the next ${CONTRACTS_WITHIN} days.`}>
      {(rows) => rows.map((c) => <ExpiringRow key={c.id} contract={c} today={today} />)}
    </Panel>
  );
}

function DraftsToSign({ rows, today }: { rows: Rows<ContractListItem>; today: string }) {
  return (
    <Panel title="Drafts to Sign" rows={rows} empty="No drafts are waiting to be signed.">
      {(rows) =>
        rows.map((c) => (
          <li key={c.id} className="space-y-1 py-2.5 text-sm">
            <div className={line}>
              <Person employee={c.employee} />
              <span>
                Starts <Due date={c.startDate} today={today} />
              </span>
            </div>
            <div className={subline}>
              <span>
                {/* its number, hidden from a developer (23 October 2026), left out */}
                {shownCode(c.number) && <span className="tabular-nums">{c.number} · </span>}
                Version {c.version} · {PAY_BASIS_LABELS[c.payBasis] ?? PAY_BASIS_LABELS.monthly}
              </span>
            </div>
          </li>
        ))
      }
    </Panel>
  );
}

function ProbationEndingPanel({ rows, today }: { rows: Rows<ProbationEnding>; today: string }) {
  return (
    <Panel title="Probation Ending" note={`Next ${PROBATION_WITHIN} days`} rows={rows} empty={`No probation ends in the next ${PROBATION_WITHIN} days.`}>
      {(rows) =>
        rows.map((p) => (
          <li key={p.employmentId} className={`${line} py-2.5 text-sm`}>
            <Person employee={p.employee} />
            <span>
              Ends <Due date={p.probationEnd} today={today} />
            </span>
          </li>
        ))
      }
    </Panel>
  );
}

function EndingsInProgress({ rows, today }: { rows: Rows<EndingSummary>; today: string }) {
  return (
    <Panel title="Endings in Progress" rows={rows} empty="No endings are waiting for the CEO or in their notice period.">
      {(rows) =>
        rows.map((e) => (
          <li key={e.id} className="space-y-1 py-2.5 text-sm">
            <div className={line}>
              <Person employee={e.employee} />
              <span>
                Last working day <Due date={e.lastWorkingDay} today={today} />
              </span>
            </div>
            <div className={subline}>
              <span>{e.ruleLabel}</span>
              <span className={`badge ${e.status === 'pending_ceo' ? 'bg-warn-soft text-warn' : 'bg-line-soft text-muted'}`}>{endingStage(e.status)}</span>
            </div>
          </li>
        ))
      }
    </Panel>
  );
}

export async function NeedsAttention({ user }: { user: SessionUser }) {
  const alerts = followsEndings(user);
  const [drafts, expiring, probations, pending, approved] = await Promise.all([
    loadContractList(listPaths({ ...NO_FILTERS, status: 'draft' })),
    alerts ? getOrNull<ExpiringContract[]>(`/contracts/expiring?within=${CONTRACTS_WITHIN}`) : null,
    alerts ? getOrNull<ProbationEnding[]>(`/employments/probation-ending?within=${PROBATION_WITHIN}`) : null,
    alerts ? getOrNull<EndingSummary[]>(PENDING_ENDINGS) : null,
    alerts ? getOrNull<EndingSummary[]>(APPROVED_ENDINGS) : null,
  ]);
  const today = todayInCairo(); // after the data: it reads the clock
  // the API lists drafts newest first; here the soonest to start comes first
  const draftRows: Rows<ContractListItem> = drafts.kind === 'ok' ? byDate(drafts.rows, (c) => c.startDate) : drafts.kind;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {alerts && <EndingSoon rows={rowsOf(byDate(expiring, (c) => c.endDate))} today={today} />}
      <DraftsToSign rows={draftRows} today={today} />
      {alerts && <ProbationEndingPanel rows={rowsOf(byDate(probations, (p) => p.probationEnd))} today={today} />}
      {alerts && <EndingsInProgress rows={rowsOf(endingsInProgress(pending, approved))} today={today} />}
    </div>
  );
}
