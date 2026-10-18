import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { GroupHeading } from '@/components/group-heading';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import { getCurrentUser } from '@/lib/session';
import type { RecurringDeductionView } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { advancesHref } from '../../employees/tab-list';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import type { AdjustmentChoices } from '../adjustments/adjustments';
import { monthName, monthOf } from '../list';
import { loadJson, notLoadedText } from '../load';
import { changeRecurring, createRecurring, editRecurring, stopRecurring } from './actions';
import {
  canSeeRecurring,
  changesRecurring,
  deductedText,
  editEndChoices,
  endChoices,
  fromChoices,
  monthlyTotal,
  peopleOf,
  periodText,
  placeOfRecurring,
  RECURRING_BADGE,
  RECURRING_STATUS_LABELS,
  splitByStatus,
  startChoices,
} from './recurring';
import { AddRecurringForm, RecurringActions } from './recurring-forms';

// Recurring Deductions, under Payroll (owner, 18 October 2026: "in the deductions i might have a loan of a medical
// subscription or something that needs to be deducted as installments on the employee. how will it be managed?"; asked,
// the owner chose a medical subscription as an ongoing monthly share): every fixed monthly deduction, those running or
// to come grouped by department, then team, as the other lists of people are, and those ended folded below. HR adds one,
// changes its amount from a month, stops it from a month, or edits its name and last month. Each month's payroll run
// takes those due that month as deductions after tax, named on the payslip as they are here. HR, Finance and the CEO,
// as salaries; the API checks it again.

export const metadata: Metadata = { title: 'Recurring Deductions · People System' };

const quiet = 'px-4 py-10 text-center text-sm text-muted';

function RecurringTable({ rows, hr, today }: { rows: RecurringDeductionView[]; hr: boolean; today: string }) {
  const groups = groupByPlace(rows, placeOfRecurring);
  const span = hr ? 7 : 6;
  const heading = (list: RecurringDeductionView[]) => ({ count: peopleOf(list), note: `${list.length} ${list.length === 1 ? 'deduction' : 'deductions'}` });
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">What For</th>
            <th scope="col" className="text-right">
              A Month
            </th>
            <th scope="col">Months</th>
            <th scope="col">Deducted</th>
            <th scope="col">Status</th>
            {hr && (
              <th scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.department ?? ''}>
              {showsDepartment(groups, g) && <GroupHeading level="department" name={g.department} span={span} {...heading(g.teams.flatMap((t) => t.rows))} />}
              {g.teams.map((t) => (
                <Fragment key={t.team ?? ''}>
                  {t.team !== null && <GroupHeading level="team" name={t.team} span={span} {...heading(t.rows)} />}
                  {t.rows.map((r) => {
                    const deducted = deductedText(r);
                    return (
                      <tr key={r.id} className={`align-top ${r.status === 'ended' ? 'text-muted' : ''}`}>
                        <td className="min-w-40">
                          <Link href={advancesHref(r.employee.id)} className="font-semibold">
                            {r.employee.fullNameEn}
                          </Link>
                        </td>
                        <td className="min-w-48">
                          {r.name}
                          {r.stopNote && <div className="text-xs text-muted">Stopped: {r.stopNote}</div>}
                        </td>
                        <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.amount)}</td>
                        <td className="min-w-44 text-sm">{periodText(r)}</td>
                        <td className="text-sm whitespace-nowrap">
                          <span className="tabular-nums">{deducted.applied}</span>
                          {deducted.pending && <div className="text-xs text-muted">{deducted.pending}</div>}
                        </td>
                        <td>
                          <span className={`badge ${RECURRING_BADGE[r.status] ?? ''}`}>{RECURRING_STATUS_LABELS[r.status] ?? r.status}</span>
                        </td>
                        {hr && (
                          <td className="text-right">
                            {r.status !== 'ended' && (
                              <RecurringActions
                                change={changeRecurring.bind(null, r.id)}
                                stop={stopRecurring.bind(null, r.id)}
                                edit={editRecurring.bind(null, r.id)}
                                saved={{ name: r.name, amount: r.amount, endMonth: r.endMonth }}
                                froms={fromChoices(r, today)}
                                ends={editEndChoices(r, today)}
                                name={`the ${r.name} of ${r.employee.fullNameEn}`}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function RecurringDeductions() {
  const user = await getCurrentUser();
  if (!canSeeRecurring(user)) return <Empty>Only HR, Finance and the CEO can see the recurring deductions.</Empty>;
  const hr = changesRecurring(user);
  const today = todayInCairo();
  const thisMonth = monthOf(today);
  const [loaded, choices] = await Promise.all([
    loadJson<RecurringDeductionView[]>('/payroll/recurring-deductions'),
    // the people one can be added for: those employed this month
    hr ? loadJson<AdjustmentChoices>(`/payroll/adjustments/choices?month=${thisMonth}`) : null,
  ]);
  if (loaded.kind !== 'ok') return <Empty>{notLoadedText(loaded, 'recurring deductions')}</Empty>;
  const { current, ended } = splitByStatus(loaded.value);
  const people = choices?.kind === 'ok' ? choices.value.people : [];
  const running = current.filter((r) => r.status === 'running');

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <dt className="text-xs text-muted">Running</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{running.length}</dd>
          <dd className="text-xs text-muted">{formatEgp(monthlyTotal(running))} a month</dd>
        </div>
        <div className="card px-4 py-3">
          <dt className="text-xs text-muted">Still to start</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{current.length - running.length}</dd>
          <dd className="text-xs text-muted">From a later month</dd>
        </div>
        <div className="card px-4 py-3">
          <dt className="text-xs text-muted">People</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{peopleOf(current)}</dd>
          <dd className="text-xs text-muted">With one running or to start</dd>
        </div>
      </dl>

      <section aria-labelledby="recurring-current" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="recurring-current" className="font-semibold">
            Running and Upcoming
          </h2>
          <span className="text-xs text-muted">By department, then team</span>
        </div>
        <div className="card">
          {hr && (
            <details className="border-b border-line" open={current.length === 0 && ended.length === 0}>
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Add a recurring deduction</summary>
              <div className="px-4 pb-4">
                {people.length ? (
                  <AddRecurringForm action={createRecurring} people={people} starts={startChoices(today)} ends={endChoices(today)} thisMonth={thisMonth} />
                ) : (
                  <p className="text-sm text-muted">Nobody is employed in {monthName(thisMonth)}.</p>
                )}
              </div>
            </details>
          )}
          {current.length ? <RecurringTable rows={current} hr={hr} today={today} /> : <p className={quiet}>No recurring deductions running or to start.</p>}
        </div>
      </section>

      {ended.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Ended ({ended.length})</summary>
          <div className="border-t border-line">
            {/* nothing to change on one ended */}
            <RecurringTable rows={ended} hr={false} today={today} />
          </div>
        </details>
      )}
    </div>
  );
}

export default function RecurringDeductionsPage() {
  return (
    <StaffOnly>
      <div className="max-w-6xl">
        <h1 className="text-2xl font-semibold">Recurring Deductions</h1>
        <p className="mt-1 text-muted">
          A fixed amount taken from an employee&apos;s pay every month, such as their share of a medical subscription: from its first month to its last, or
          until it is stopped. Each month&apos;s payroll run takes it after tax, named on the payslip as it is here. Advances and loans are recovered by
          their installments, on Unsettled.
        </p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <RecurringDeductions />
          </Suspense>
        </div>
      </div>
    </StaffOnly>
  );
}
