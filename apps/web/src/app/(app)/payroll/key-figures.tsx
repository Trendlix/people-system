import Link from 'next/link';
import { formatDate, titleCase } from '@/lib/format';
import { canEditOrganisation } from '@/lib/session';
import type { PayrollRunSummary, PayrollSettingsView, SessionUser } from '@/lib/types';
import { createRun } from './actions';
import { monthName, preparesPayroll, runHref, runMonths } from './list';
import { loadJson } from './load';
import { MakeRunButton } from './make-run-button';
import { currentRunMonth, daysUntil, lastPaidRun, nextPayday, paidFigures } from './overview';
import { UNSETTLED_PATH } from './sections';
import { PayrollStatusBadge } from './ui';
import { summaryTiles, unsettledCount, type UnsettledView } from './unsettled/unsettled';

// The Payroll Overview's key figures (owner, 17 October 2026: "Overview" first under Payroll): the run being paid next
// and where it stands (or, not made yet, a button for HR to make it), the last paid run's totals, the next payday from
// Payroll Setup, and what is unsettled; with Payroll setup for HR and Admin. The runs follow, as before.

function Tile({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-2 p-4">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="flex-1 space-y-1">{children}</div>
      {footer}
    </section>
  );
}

export async function KeyFigures({ user, runs, today }: { user: SessionUser; runs: PayrollRunSummary[]; today: string }) {
  const [settings, unsettled] = await Promise.all([loadJson<PayrollSettingsView>('/payroll/settings'), loadJson<UnsettledView>('/payroll/unsettled')]);
  const payday = settings.kind === 'ok' ? settings.value.payday : null;
  const next = nextPayday(today, payday);
  const month = currentRunMonth(today, payday);
  const current = runs.find((r) => r.month === month) ?? null;
  const paid = lastPaidRun(runs);
  const canMake = preparesPayroll(user) && runMonths(today).includes(month);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Tile title={titleCase(`${monthName(month)} payroll`)}>
          {current ? (
            <>
              <p>
                <PayrollStatusBadge status={current.status} />
              </p>
              <p className="text-sm text-muted">
                {current.totals.employees} {current.totals.employees === 1 ? 'employee' : 'employees'} · <Link href={runHref(current.id)}>Open the run</Link>
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Not made yet</p>
              {canMake && <MakeRunButton action={createRun} month={month} />}
            </>
          )}
        </Tile>
        <Tile title="Last Paid Run">
          {paid ? (
            <>
              <p className="font-semibold">
                <Link href={runHref(paid.id)}>{monthName(paid.month)}</Link>
                {paid.paidOn && <span className="font-normal text-muted"> · paid {formatDate(paid.paidOn)}</span>}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                {paidFigures(paid).map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="text-right tabular-nums">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-sm text-muted">No run marked paid yet.</p>
          )}
        </Tile>
        <Tile title="Next Payday">
          {next ? (
            <>
              <p className="font-semibold tabular-nums">{formatDate(next.date)}</p>
              <p className="text-sm text-muted">
                {daysUntil(today, next.date)}: the {monthName(next.forMonth)} salaries
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">{settings.kind === 'ok' ? 'No payday set in Payroll Setup.' : 'The payday could not be loaded.'}</p>
          )}
        </Tile>
        <Tile title="Unsettled" footer={<Link href={UNSETTLED_PATH} className="text-sm">See what is unsettled</Link>}>
          {unsettled.kind === 'ok' ? (
            <>
              <p className="font-semibold tabular-nums">{unsettledCount(unsettled.value)} open</p>
              <ul className="space-y-0.5 text-sm">
                {summaryTiles(unsettled.value).map((t) => (
                  <li key={t.key} className="flex justify-between gap-3">
                    <Link href={`${UNSETTLED_PATH}${t.href}`} className="text-muted no-underline hover:text-ink">
                      {t.label}
                    </Link>
                    <span className="tabular-nums">{t.count}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">Could not be loaded.</p>
          )}
        </Tile>
      </div>
      {/* what changes the sheet, for those who change it (Payroll Setup, owner's request of 16 October 2026) */}
      {canEditOrganisation(user) && (
        <Link href="/organization/payroll" className="btn btn-secondary no-underline">
          Payroll setup
        </Link>
      )}
    </div>
  );
}
