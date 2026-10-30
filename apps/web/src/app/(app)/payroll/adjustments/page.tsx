import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { ADVANCE_KIND_LABELS } from '@trendlix/shared';
import { Select } from '@/components/select';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import { addMonths, monthName, runHref } from '../list';
import { loadJson, notLoadedText } from '../load';
import { RECURRING_PATH } from '../sections';
import { PayrollStatusBadge } from '../ui';
import { cancelAdjustment, createAdjustment, moveAdjustments, updateAdjustment } from './actions';
import { AddAdjustmentForm, AdjustmentActions, MoveForm } from './adjustment-forms';
import {
  adjustmentsHref,
  approvedMonth,
  byEmployee,
  canSeeAdjustments,
  changeable,
  custodyText,
  daysNotWorkedOut,
  deductionsTaxNote,
  enteredText,
  entersAdjustments,
  isRecurring,
  laterMonths,
  lawWarningsOf,
  monthChoices,
  movable,
  monthTotals,
  netText,
  pendingIds,
  readCustodyPrefill,
  readEmployee,
  readMonth,
  RUN_NOTE,
  signedAmount,
  STATUS_BADGE,
  statusText,
  taxText,
  typeText,
  type AdjustmentChoices,
  type AdjustmentRow,
} from './adjustments';
import { shownCode } from '@/lib/hidden';

// Additions / Deductions (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Unsettled -
// Additions / Deductions"; asked, the owner chose one-off amounts per employee and month, not recurring). For a month,
// in the address so a view can be shared (this month unless asked): its totals, HR's form to add one, and every
// addition and deduction by employee with each person's totals; HR changes or cancels a pending one while the month's
// run is still a draft, and moves one left on a month approved without it to a later month; what no run pays is said at
// the top. HR, Finance and the CEO, as salaries; the API checks it again. The one place to enter them (owner, 17 October
// 2026, on the run's grid: "instead of there, i think earnings and deductions will be enough"): a bonus or penalty in
// days shows its days and, once a run has worked it out, about what it came to; the run's grid opens one person's
// month (?employee=), with the form set to them. A person whose damage or loss deductions in the month pass 5 days'
// wage is warned of under their name (owner, 18 October 2026, after reading the law; Labour Law Art. 151: a warning
// only), and an advance's recovery or a loan's installment past 10% of the wage is refused by the API ("Block above
// 10%"), its reason shown on the form. "Create a deduction" on a custody record (Assets step 3; owner, 21 October 2026:
// "Record it; HR decides a deduction") opens the person's month here, the form filled in (?custodyItem=, ?reason=); a
// deduction made from a custody item says which.

export const metadata: Metadata = { title: 'Additions / Deductions · People System' };

type Query = Record<string, string | string[] | undefined>;

const quiet = 'px-4 py-10 text-center text-sm text-muted';
const dash = <span className="text-muted">—</span>;

function MonthPicker({ month, today, employeeId }: { month: string; today: string; employeeId: string | null }) {
  return (
    <form key={month} className="flex flex-wrap items-end gap-3" aria-label="Choose the month">
      {/* one person's month stays theirs as the month changes */}
      {employeeId && <input type="hidden" name="employee" value={employeeId} />}
      <Link
        href={adjustmentsHref(addMonths(month, -1), today, employeeId)}
        className="btn btn-secondary"
        aria-label={`Previous month, ${monthName(addMonths(month, -1))}`}
      >
        ←
      </Link>
      <div>
        <label htmlFor="adjustments-month" className="label">
          Month
        </label>
        <Select id="adjustments-month" name="month" defaultValue={month} className="input min-w-48">
          {monthChoices(today, month).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      <Link href={adjustmentsHref(addMonths(month, 1), today, employeeId)} className="btn btn-secondary" aria-label={`Next month, ${monthName(addMonths(month, 1))}`}>
        →
      </Link>
    </form>
  );
}

function Totals({ rows }: { rows: AdjustmentRow[] }) {
  const t = monthTotals(rows);
  const tiles = [
    { label: 'Additions', value: formatEgp(t.additions), note: `${formatEgp(t.taxedAdditions)} taxed · ${formatEgp(t.untaxedAdditions)} not taxed` },
    // those before tax (20 October 2026) said apart
    { label: 'Deductions', value: formatEgp(t.deductions), note: deductionsTaxNote(rows) },
    { label: 'Net effect on pay', value: netText(t.net), note: 'Before the tax the taxed additions bring' },
    { label: 'People', value: String(t.people), note: `${t.count} ${t.count === 1 ? 'entry' : 'entries'}, the cancelled left out` },
  ];
  // in days with no run to work them out yet (17 October 2026): not in the sums
  const unknown = daysNotWorkedOut(rows);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((x) => (
        <div key={x.label} className="card px-4 py-3">
          <dt className="text-xs text-muted">{x.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{x.value}</dd>
          <dd className="text-xs text-muted">{x.note}</dd>
        </div>
      ))}
      {unknown > 0 && (
        <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">
          {unknown === 1 ? 'One is' : `${unknown} are`} in days with no run to work {unknown === 1 ? 'it' : 'them'} out yet: not in these sums until the month&apos;s
          run is made.
        </p>
      )}
    </dl>
  );
}

function AdjustmentsTable({ rows, choices, hr, today }: { rows: AdjustmentRow[]; choices: AdjustmentChoices; hr: boolean; today: string }) {
  const months = monthChoices(today, choices.month);
  const later = laterMonths(today, choices.month);
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Tax</th>
            <th scope="col" className="text-right">
              Amount
            </th>
            <th scope="col">Reason</th>
            <th scope="col">Status</th>
            <th scope="col">Entered</th>
            {hr && (
              <th scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {byEmployee(rows).map((g) => (
            <Fragment key={g.employee.id}>
              <tr className="bg-canvas">
                <th scope="rowgroup" colSpan={hr ? 7 : 6} className="text-left normal-case">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm tracking-normal text-ink">
                    <span>
                      <Link href={`/employees/${g.employee.id}`} className="font-semibold">
                        {g.employee.name}
                      </Link>
                      {shownCode(g.employee.employeeCode) && <span className="font-normal text-muted"> · {g.employee.employeeCode}</span>}
                    </span>
                    <span className="font-normal tabular-nums">
                      +{formatEgp(g.sums.additions)} <span className="text-muted">·</span> −{formatEgp(g.sums.deductions)} <span className="text-muted">·</span>{' '}
                      <span className="font-semibold">Net {netText(g.sums.net)}</span>
                    </span>
                  </div>
                  {lawWarningsOf(choices, g.employee.id).map((w) => (
                    <p key={w} className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm font-normal tracking-normal text-warn tabular-nums">
                      {w}
                    </p>
                  ))}
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.id} className={r.status === 'cancelled' ? 'text-muted' : undefined}>
                  <td className="whitespace-nowrap">
                    {typeText(r)}
                    {r.advance && (
                      <div className="text-xs text-muted">
                        {ADVANCE_KIND_LABELS[r.advance.kind]} of {formatEgp(r.advance.amount)}, given {formatDate(r.advance.givenOn)}
                      </div>
                    )}
                    {custodyText(r) && <div className="text-xs text-muted">{custodyText(r)}</div>}
                  </td>
                  <td className="whitespace-nowrap">{taxText(r)}</td>
                  <td className={`text-right whitespace-nowrap tabular-nums ${r.status === 'cancelled' ? 'line-through' : ''}`}>{signedAmount(r)}</td>
                  <td className="min-w-48">{r.reason}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? ''}`}>{statusText(r.status)}</span>
                  </td>
                  <td className="text-xs whitespace-nowrap text-muted">{enteredText(r) || dash}</td>
                  {hr && (
                    <td className="text-right">
                      {isRecurring(r) && r.status === 'pending' ? (
                        // made by the run from its record (18 October 2026): changed or stopped there
                        <Link href={RECURRING_PATH} className="btn btn-secondary min-h-9 px-3">
                          Change on Recurring Deductions
                        </Link>
                      ) : changeable(r, choices.locked) ? (
                        <AdjustmentActions
                          row={r}
                          action={updateAdjustment.bind(null, r.id)}
                          cancel={cancelAdjustment.bind(null, r.id)}
                          months={months}
                          advances={choices.advances}
                        />
                      ) : movable(r, choices.run) ? (
                        <MoveForm action={moveAdjustments.bind(null, [r.id])} months={later} label="Move" what={`the ${r.kind} for ${r.employee.name}`} />
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What no run pays (owner, 17 October 2026): on this month, the pending ones its approved run was made without, all
 * movable at once; on any month, the other months left with some; and this month's for people not on its run.
 */
function LeftBehind({ choices, rows, hr, today }: { choices: AdjustmentChoices; rows: AdjustmentRow[]; hr: boolean; today: string }) {
  const here = approvedMonth(choices.run) ? pendingIds(rows) : [];
  const elsewhere = (choices.leftBehind ?? []).filter((l) => l.month !== choices.month);
  const notOnRun = !approvedMonth(choices.run) ? (choices.notOnRun ?? 0) : 0;
  if (!here.length && !elsewhere.length && !notOnRun) return null;
  return (
    <section aria-labelledby="left-behind" className="space-y-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      <h2 id="left-behind" className="font-semibold">
        Not Paid by a Run
      </h2>
      {here.length > 0 && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p>
            {here.length === 1 ? 'One pending addition or deduction is' : `${here.length} pending additions or deductions are`} left on {monthName(choices.month)}: its
            run was approved without {here.length === 1 ? 'it' : 'them'}. Move {here.length === 1 ? 'it' : 'them'} to a later month to be paid.
          </p>
          {hr && <MoveForm action={moveAdjustments.bind(null, here)} months={laterMonths(today, choices.month)} label={here.length === 1 ? 'Move' : 'Move all'} what="the pending ones" />}
        </div>
      )}
      {notOnRun > 0 && (
        <p>
          {notOnRun === 1 ? 'One is' : `${notOnRun} are`} for people not on the {monthName(choices.month)} run: no line takes {notOnRun === 1 ? 'it' : 'them'}.
          Put the person on the run (a signed contract, then Refresh), or move {notOnRun === 1 ? 'it' : 'them'} to a later month.
        </p>
      )}
      {elsewhere.length > 0 && (
        <p>
          Left on months approved without them:{' '}
          {elsewhere.map((l, i) => (
            <span key={l.month}>
              {i > 0 && ', '}
              <Link href={adjustmentsHref(l.month, today)}>{monthName(l.month)}</Link> ({l.count})
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}

async function MonthView({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeAdjustments(user)) return <Empty>Only HR, Finance and the CEO can see the additions and deductions.</Empty>;
  const today = todayInCairo();
  const month = readMonth(query, today);
  // one person's month, opened from the run's grid (17 October 2026), or from a custody record's damaged item (step 3)
  const employeeId = readEmployee(query);
  const custody = employeeId ? readCustodyPrefill(query) : null;
  const [list, options] = await Promise.all([
    loadJson<AdjustmentRow[]>(`/payroll/adjustments?month=${month}${employeeId ? `&employeeId=${employeeId}` : ''}`),
    loadJson<AdjustmentChoices>(`/payroll/adjustments/choices?month=${month}`),
  ]);
  const hr = entersAdjustments(user);

  const header = (
    <section className="card flex flex-wrap items-end justify-between gap-4 p-4">
      <MonthPicker month={month} today={today} employeeId={employeeId} />
      {options.kind === 'ok' && (
        <p className="text-sm">
          {options.value.run ? (
            <>
              <Link href={runHref(options.value.run.id)}>{monthName(month)} run</Link> <PayrollStatusBadge status={options.value.run.status} />
            </>
          ) : (
            <span className="text-muted">No {monthName(month)} run yet</span>
          )}
        </p>
      )}
    </section>
  );
  if (list.kind !== 'ok' || options.kind !== 'ok') {
    const failed = list.kind !== 'ok' ? list : options.kind !== 'ok' ? options : null;
    return (
      <div className="space-y-4">
        {header}
        {failed && <Empty>{notLoadedText(failed, 'additions and deductions')}</Empty>}
      </div>
    );
  }

  const rows = list.value;
  const choices = options.value;
  const person = employeeId ? (choices.people.find((p) => p.id === employeeId) ?? rows[0]?.employee ?? null) : null;
  return (
    <div className="space-y-6">
      {header}
      {employeeId && (
        <p role="status" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span>
            Showing {person ? <span className="font-semibold">{person.name}</span> : 'one employee'}
            {person && shownCode(person.employeeCode) ? <span className="text-muted"> · {person.employeeCode}</span> : null} only.
          </span>
          <Link href={adjustmentsHref(month, today)}>Show everyone</Link>
        </p>
      )}
      {choices.locked && (
        <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          {choices.locked}
        </p>
      )}
      <LeftBehind choices={choices} rows={rows} hr={hr} today={today} />
      <Totals rows={rows} />
      {hr && !choices.locked && (
        <section aria-labelledby="new-adjustment" className="card space-y-3 p-6">
          <h2 id="new-adjustment" className="font-semibold">
            New Addition or Deduction
          </h2>
          {choices.people.length ? (
            <AddAdjustmentForm action={createAdjustment} choices={choices} employeeId={person && 'department' in person ? person.id : null} custody={custody} />
          ) : (
            <p className="text-sm text-muted">Nobody is employed in {monthName(month)}.</p>
          )}
        </section>
      )}
      <section aria-labelledby="month-adjustments" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="month-adjustments" className="font-semibold">
            {monthName(month)}
          </h2>
          <span className="text-xs text-muted">By employee: additions, deductions and the net effect on their pay</span>
        </div>
        <div className="card">
          {rows.length ? (
            <AdjustmentsTable rows={rows} choices={choices} hr={hr} today={today} />
          ) : (
            <p className={quiet}>
              No additions or deductions for {person ? `${person.name} in ` : ''}
              {monthName(month)}.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export default function AdjustmentsPage({ searchParams }: PageProps<'/payroll/adjustments'>) {
  return (
    <StaffOnly>
      <div className="max-w-6xl">
        <h1 className="page-title">Additions / Deductions</h1>
        <p className="mt-1 text-muted">
          One-off amounts on an employee&apos;s pay for a month: a bonus (in EGP or in days), commission, incentive, correction or reimbursement added;
          a penalty (in EGP or in days), correction, damage or loss, an advance&apos;s recovery or a loan&apos;s installment taken. {RUN_NOTE}
        </p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <MonthView searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </StaffOnly>
  );
}
