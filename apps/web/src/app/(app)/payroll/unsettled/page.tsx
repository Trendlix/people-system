import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { advancesHref } from '../../employees/tab-list';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import type { AdjustmentChoices } from '../adjustments/adjustments';
import { monthName, runHref } from '../list';
import { loadJson, notLoadedText } from '../load';
import { ADJUSTMENTS_PATH } from '../sections';
import { PayrollStatusBadge } from '../ui';
import { createAdvance, recordPaidOut, reopenFinal, settleAdvance, settleFinal, updateAdvance } from './actions';
import {
  advanceKindText,
  canSeeUnsettled,
  counted,
  daysText,
  documentHref,
  reasonText,
  settlesPayroll,
  summaryTiles,
  type UnsettledView,
} from './unsettled';
import { EditAdvanceForm, NewAdvanceForm, PaidOutForm, ReopenFinalForm, SettleAdvanceForm, SettleFinalForm } from './unsettled-forms';

// Unsettled (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Unsettled - Additions /
// Deductions"; asked, the owner chose what it lists): the runs not yet paid (a draft, with the CEO, approved but not
// marked paid), the lines on hold (held on an approved or paid run and not paid out since: HR records the payout), the
// final settlements of people who left (open from the employment's end date until HR marks them settled), and the
// advances and loans still being recovered. One GET /payroll/unsettled call. HR, Finance and the CEO, as salaries; HR
// settles. The API checks it again.

export const metadata: Metadata = { title: 'Unsettled · People System' };

const quiet = 'px-4 py-10 text-center text-sm text-muted';
const dash = <span className="text-muted">—</span>;

function Section({ id, title, count, total, note, children }: { id: string; title: string; count: string; total?: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`${id}-title`} className="font-semibold">
          {title}
        </h2>
        <span className="text-sm text-muted tabular-nums">
          {count}
          {total && <> · {total}</>}
        </span>
        {note && <span className="w-full text-xs text-muted">{note}</span>}
      </div>
      <div className="card">{children}</div>
    </section>
  );
}

function Person({ person, href }: { person: { id: string; employeeCode: string; name: string }; href?: string }) {
  return (
    <>
      <Link href={href ?? `/employees/${person.id}`} className="font-semibold">
        {person.name}
      </Link>
      <div className="text-xs text-muted">{person.employeeCode}</div>
    </>
  );
}

function RunsNotPaid({ u }: { u: UnsettledView }) {
  return (
    <Section id="runs" title="Runs Not Yet Paid" count={counted(u.runs.count, 'run', 'runs')} total={`${formatEgp(u.runs.transfer)} to transfer`}>
      {u.runs.rows.length === 0 ? (
        <p className={quiet}>Every payroll run is marked paid.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">
                  Employees
                </th>
                <th scope="col" className="text-right">
                  On Hold
                </th>
                <th scope="col" className="text-right">
                  Transfer
                </th>
              </tr>
            </thead>
            <tbody>
              {u.runs.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={runHref(r.id)} className="font-semibold">
                      {monthName(r.month)}
                    </Link>
                  </td>
                  <td>
                    <PayrollStatusBadge status={r.status} />
                  </td>
                  <td className="text-right tabular-nums">{r.employees}</td>
                  <td className="text-right tabular-nums">{r.held || dash}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.transfer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function LinesOnHold({ u, hr, today }: { u: UnsettledView; hr: boolean; today: string }) {
  return (
    <Section
      id="held"
      title="Lines on Hold"
      count={counted(u.held.count, 'line', 'lines')}
      total={`${formatEgp(u.held.amount)} held`}
      note="Held on an approved or paid run, so the bank files left them out. Each stays here until HR records it paid out."
    >
      {u.held.rows.length === 0 ? (
        <p className={quiet}>No held pay waiting to be paid out.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Run</th>
                <th scope="col" className="text-right">
                  Amount Held
                </th>
                <th scope="col">Comments</th>
                {hr && (
                  <th scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {u.held.rows.map((h) => (
                <tr key={h.lineId}>
                  <td>
                    <Person person={h.employee} />
                  </td>
                  <td className="whitespace-nowrap">
                    <Link href={runHref(h.runId)}>{monthName(h.month)}</Link> <PayrollStatusBadge status={h.runStatus} />
                  </td>
                  <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(h.amount)}</td>
                  <td className="min-w-40 text-sm">{h.comments ?? dash}</td>
                  {hr && (
                    <td className="text-right">
                      <PaidOutForm action={recordPaidOut.bind(null, h.lineId)} name={`for ${h.employee.name}, ${monthName(h.month)}`} today={today} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function FinalSettlements({ u, hr, today }: { u: UnsettledView; hr: boolean; today: string }) {
  const recent = u.settlements.recentlySettled;
  return (
    <Section
      id="settlements"
      title="Final Settlements"
      count={counted(u.settlements.count, 'open', 'open')}
      note="Each employment that has ended, from its end date until HR marks its final dues settled."
    >
      {u.settlements.rows.length === 0 ? (
        <p className={quiet}>No final settlements open.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Left On</th>
                <th scope="col">Reason</th>
                <th scope="col" className="text-right">
                  Open For
                </th>
                <th scope="col">Clearance</th>
                {hr && (
                  <th scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {u.settlements.rows.map((s) => (
                <tr key={s.employmentId}>
                  <td>
                    <Person person={s.employee} />
                    {s.reopened && <span className="badge mt-1 bg-warn-soft text-warn">Reopened</span>}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(s.endDate)}</td>
                  <td>{reasonText(s)}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">{daysText(s.daysOpen)}</td>
                  <td className="text-sm">
                    {s.clearances[0] ? (
                      <a href={documentHref(s.employee.id, s.clearances[0].id)} className="whitespace-nowrap">
                        Clearance and dues
                      </a>
                    ) : (
                      <span className="text-muted">Not generated</span>
                    )}
                  </td>
                  {hr && (
                    <td className="text-right">
                      <SettleFinalForm action={settleFinal.bind(null, s.employmentId)} name={`for ${s.employee.name}`} today={today} clearances={s.clearances} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recent.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Settled in the last 90 days ({recent.length})</summary>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Left On</th>
                  <th scope="col">Settled On</th>
                  <th scope="col" className="text-right">
                    Amount Paid
                  </th>
                  <th scope="col">Note</th>
                  {hr && (
                    <th scope="col" className="text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.employmentId}>
                    <td>
                      <Person person={s.employee} />
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{formatDate(s.endDate)}</td>
                    <td className="whitespace-nowrap">
                      <span className="tabular-nums">{formatDate(s.settledOn)}</span>
                      {s.settledBy && <div className="text-xs text-muted">by {s.settledBy.name}</div>}
                    </td>
                    <td className="text-right whitespace-nowrap tabular-nums">{s.amountPaid === null ? dash : formatEgp(s.amountPaid)}</td>
                    <td className="text-sm">
                      {s.note ?? dash}
                      {s.document && (
                        <div>
                          <a href={documentHref(s.employee.id, s.document.id)}>Clearance and dues</a>
                        </div>
                      )}
                    </td>
                    {hr && (
                      <td className="text-right">
                        <ReopenFinalForm action={reopenFinal.bind(null, s.employmentId)} name={`the final settlement of ${s.employee.name}`} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Section>
  );
}

function AdvancesAndLoans({ u, hr, today, people }: { u: UnsettledView; hr: boolean; today: string; people: AdjustmentChoices['people'] }) {
  return (
    <Section
      id="advances"
      title="Advances and Loans"
      count={counted(u.advances.count, 'open', 'open')}
      total={`${formatEgp(u.advances.outstanding)} outstanding of ${formatEgp(u.advances.amount)}`}
      note="Recovered by deductions linked to each on Additions / Deductions: those applied to a run count as recovered, those pending as planned."
    >
      {hr && (
        <details className="border-b border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Record an advance or loan</summary>
          <div className="px-4 pb-4">
            <NewAdvanceForm action={createAdvance} people={people} today={today} />
          </div>
        </details>
      )}
      {u.advances.rows.length === 0 ? (
        <p className={quiet}>No advances or loans being recovered.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Kind</th>
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
                <th scope="col">Given On</th>
                {hr && (
                  <th scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {u.advances.rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Person person={a.employee} href={advancesHref(a.employee.id)} />
                  </td>
                  <td>
                    {advanceKindText(a.kind)}
                    <div className="max-w-56 text-xs text-muted">{[a.reason, a.plan].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(a.amount)}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(a.recovered)}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(a.planned)}</td>
                  <td className="text-right font-semibold whitespace-nowrap tabular-nums">{formatEgp(a.outstanding)}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(a.givenOn)}</td>
                  {hr && (
                    <td className="space-y-2 text-right">
                      <Link href={ADJUSTMENTS_PATH} className="btn btn-secondary min-h-9 px-3">
                        Plan a recovery
                      </Link>
                      <EditAdvanceForm action={updateAdvance.bind(null, a.id)} advance={a} today={today} />
                      <SettleAdvanceForm action={settleAdvance.bind(null, a.id)} name={`the ${a.kind} of ${a.employee.name}`} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

async function Unsettled() {
  const user = await getCurrentUser();
  if (!canSeeUnsettled(user)) return <Empty>Only HR, Finance and the CEO can see what is unsettled.</Empty>;
  const hr = settlesPayroll(user);
  const today = todayInCairo();
  const [loaded, choices] = await Promise.all([
    loadJson<UnsettledView>('/payroll/unsettled'),
    // the people an advance or loan can be recorded for: those employed this month
    hr ? loadJson<AdjustmentChoices>(`/payroll/adjustments/choices?month=${today.slice(0, 7)}`) : null,
  ]);
  if (loaded.kind !== 'ok') return <Empty>{notLoadedText(loaded, 'unsettled payroll')}</Empty>;
  const u = loaded.value;
  const people = choices?.kind === 'ok' ? choices.value.people : [];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summaryTiles(u).map((t) => (
            <div key={t.key} className="card px-4 py-3">
              <dt className="text-xs text-muted">
                <a href={t.href} className="text-muted no-underline hover:text-ink">
                  {t.label}
                </a>
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{t.count}</dd>
              <dd className="text-xs text-muted">{t.note}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">As of {formatDateTime(u.generatedAt)}</p>
      </div>
      <RunsNotPaid u={u} />
      <LinesOnHold u={u} hr={hr} today={today} />
      <FinalSettlements u={u} hr={hr} today={today} />
      <AdvancesAndLoans u={u} hr={hr} today={today} people={people} />
    </div>
  );
}

export default function UnsettledPage() {
  return (
    <StaffOnly>
      <div className="max-w-6xl">
        <h1 className="text-2xl font-semibold">Unsettled</h1>
        <p className="mt-1 text-muted">
          What the payroll still owes or is owed: runs not yet paid, pay held on a run and not paid out since, the final dues of people who left, and advances
          and loans still being recovered.
        </p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <Unsettled />
          </Suspense>
        </div>
      </div>
    </StaffOnly>
  );
}
