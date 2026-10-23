import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { confidentialExcludedNote, type DueForReviewRow, type ReportPeriod, type SalaryRaiseRow } from '@trendlix/shared';
import { Select } from '@/components/select';
import { departmentName } from '@/lib/departments';
import { formatDateTime, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { StaffOnly } from '../../../staff-only';
import { formatEgp } from '../../../employees/[id]/contracts/salary';
import { BackLink, Empty, Loading, todayInCairo } from '../../../employees/ui';
import { loadSalaryRaises } from './data';
import {
  canSeeSalaryRaises,
  costText,
  departmentLabel,
  excelHref,
  monthChoices,
  openText,
  percentText,
  periodTitle,
  peopleLabel,
  preparesRaises,
  quickPeriods,
  raisesHref,
  raisesLabel,
  raiseView,
  readPeriod,
  reviewActions,
  reviewRuleText,
  salaryHistoryHref,
  samePeriod,
  sinceText,
  summaryTiles,
  type SalaryRaisesView,
} from './salary-raises';
import { shownCode } from '@/lib/hidden';

// The Salary Raises report (owner's decision, 16 October 2026: the salary raises tracked on each profile's Salary
// History and in a company-wide report), under Payroll → Reports since 17 October 2026 (owner: "Reports (Statistics)"
// under Payroll), also reached from the Employees page; its old address, /employees/raises, is redirected here
// (next.config.ts). For a period of months, in the address so a view can be shared (this calendar year unless asked):
// the totals (the raises, the people, the average raise, what they cost a month and a year more), the raises by
// department, every signed raise that took effect in it with its person linked to their Salary History, and who is due
// for a salary review now, after the months set in Payroll Setup → Your Rules, with a way for HR to prepare or ask for
// their raise. One GET /reports/salary-raises call, from the same pay events as each Salary History, so the figures
// agree. HR, Finance and the CEO, as salaries; the API checks it again. The Excel workbook is the API's, passed on
// under the web domain (excel/route.ts). The C-level people are left out for anyone but the CEO and the Super Admin
// (owner, 19 October 2026: "make C level Employees details not visible to HR"), and the page says so.

export const metadata: Metadata = { title: 'Salary Raises · People System' };

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only HR, Finance and the CEO can see the salary raises.';
const dash = <span className="text-muted">—</span>;
const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';
const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';
const small = 'btn btn-secondary min-h-9 px-3';

function PeriodPicker({ period, today }: { period: ReportPeriod; today: string }) {
  const months = monthChoices(today, period);
  return (
    // keyed by the period, so following a quick link shows it, not what was chosen before
    <form key={`${period.from}-${period.to}`} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="raises-from" className="label">
          From
        </label>
        <Select id="raises-from" name="from" defaultValue={period.from} className="input min-w-44">
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="raises-to" className="label">
          To
        </label>
        <Select id="raises-to" name="to" defaultValue={period.to} className="input min-w-44">
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      <ul className="flex flex-wrap gap-2" aria-label="Quick periods">
        {quickPeriods(today).map((q) => {
          const active = samePeriod(q.period, period);
          return (
            <li key={q.key}>
              <Link
                href={raisesHref(q.period, today)}
                aria-current={active ? 'page' : undefined}
                className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
              >
                {q.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </form>
  );
}

function Summary({ report }: { report: SalaryRaisesView }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {summaryTiles(report.totals).map((t) => (
        <div key={t.key} className="card px-4 py-3">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{t.value}</dd>
          {t.note && <dd className="text-xs text-muted">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function SectionTitle({ id, title, note }: { id: string; title: string; note?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}

function ByDepartment({ report }: { report: SalaryRaisesView }) {
  const t = report.totals;
  return (
    <section aria-labelledby="raises-by-department" className="space-y-3">
      <SectionTitle id="raises-by-department" title="By Department" note="A team’s raises are its department’s" />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col" className="text-right">
                Raises
              </th>
              <th scope="col" className="text-right">
                People
              </th>
              <th scope="col" className="text-right">
                Average Raise
              </th>
              <th scope="col" className="text-right">
                Monthly Cost Increase
              </th>
              <th scope="col" className="text-right">
                Yearly Cost Increase
              </th>
            </tr>
          </thead>
          <tbody>
            {report.byDepartment.map((d) => (
              <tr key={d.department?.id ?? 'none'}>
                <td className={d.department ? undefined : 'text-muted'}>{departmentLabel(d.department)}</td>
                <td className="text-right tabular-nums">{d.count}</td>
                <td className="text-right tabular-nums">{d.people}</td>
                <td className="text-right tabular-nums">{percentText(d.averagePercent)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{costText(d.monthlyCostIncrease)}</td>
                <td className="text-right whitespace-nowrap tabular-nums">{costText(d.yearlyCostIncrease)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="text-left">
                All departments
              </th>
              <td className="text-right tabular-nums">{t.count}</td>
              <td className="text-right tabular-nums">{t.people}</td>
              <td className="text-right tabular-nums">{percentText(t.averagePercent)}</td>
              <td className="text-right whitespace-nowrap tabular-nums">{costText(t.monthlyCostIncrease)}</td>
              <td className="text-right whitespace-nowrap tabular-nums">{costText(t.yearlyCostIncrease)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function RaiseRow({ row }: { row: SalaryRaiseRow }) {
  const v = raiseView(row);
  return (
    <tr className="align-top">
      <td className="min-w-48 align-top">
        <Link href={salaryHistoryHref(row.employee.id)} className="font-semibold">
          {row.employee.fullNameEn}
          <span className="sr-only"> (salary history)</span>
        </Link>
        {shownCode(row.employee.employeeCode) && <div className="text-xs text-muted tabular-nums">{row.employee.employeeCode}</div>}
        {v.place && <div className="text-xs text-muted">{v.place}</div>}
      </td>
      <td className="min-w-44 align-top">
        {v.jobTitle ?? dash}
        {v.promotion && <div className="text-xs font-semibold text-ok">{v.promotion}</div>}
      </td>
      <td className="align-top whitespace-nowrap tabular-nums">
        {v.effective}
        {v.upcoming && <div className="text-xs text-muted">Signed, to come</div>}
      </td>
      <td className="align-top">
        {v.kind}
        {v.reason && <div className="text-xs text-muted">{v.reason}</div>}
      </td>
      <td className="min-w-56 align-top tabular-nums">
        {v.gross}
        <div className={`text-xs ${v.change.startsWith('+') ? 'font-semibold text-ok' : 'text-muted'}`}>{v.change}</div>
      </td>
      <td className="min-w-44 align-top tabular-nums">{v.allowances}</td>
      <td className="text-right align-top whitespace-nowrap tabular-nums">{v.cost}</td>
      <td className="min-w-44 align-top">{v.approved ?? dash}</td>
    </tr>
  );
}

function Raises({ report }: { report: SalaryRaisesView }) {
  const title = periodTitle(report.period);
  return (
    <section aria-labelledby="raises-list" className="space-y-3">
      <SectionTitle id="raises-list" title="Raises" note={report.raises.length > 0 && `${raisesLabel(report.raises.length)} for ${peopleLabel(report.totals.people)}, oldest first`} />
      {report.raises.length === 0 ? (
        <Empty>
          No raise took effect in {title}. A raise counts once it is signed; a first contract or a renewal with the same pay is not a raise.
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Job Title</th>
                <th scope="col">Effective</th>
                <th scope="col">Kind</th>
                <th scope="col">Gross a Month</th>
                <th scope="col">Allowances a Month</th>
                <th scope="col" className="text-right">
                  Monthly Cost
                </th>
                <th scope="col">Approved By</th>
              </tr>
            </thead>
            <tbody>
              {report.raises.map((r) => (
                <RaiseRow key={r.contractId} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReviewRow({ row, user }: { row: DueForReviewRow; user: SessionUser }) {
  const open = openText(row);
  const actions = reviewActions(user, row);
  return (
    <tr className="align-top">
      <td className="min-w-48 align-top">
        <Link href={salaryHistoryHref(row.employee.id)} className="font-semibold">
          {row.employee.fullNameEn}
          <span className="sr-only"> (salary history)</span>
        </Link>
        {shownCode(row.employee.employeeCode) && <div className="text-xs text-muted tabular-nums">{row.employee.employeeCode}</div>}
        {row.department && <div className="text-xs text-muted">{departmentName(row.department)}</div>}
      </td>
      <td className="min-w-40 align-top">{row.jobTitle ?? dash}</td>
      <td className="min-w-56 align-top">{sinceText(row)}</td>
      <td className="text-right align-top whitespace-nowrap tabular-nums">{formatEgp(row.currentGross)}</td>
      <td className="min-w-48 align-top">{open ?? <span className="text-muted">Nothing open</span>}</td>
      {preparesRaises(user) && (
        <td className="align-top">
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              // no prefetch: the raise form loads the contracts and their pay
              <Link key={a.key} href={a.href} prefetch={false} className={small}>
                {a.label}
                <span className="sr-only"> for {row.employee.fullNameEn}</span>
              </Link>
            ))}
          </div>
        </td>
      )}
    </tr>
  );
}

function DueForReview({ report, user }: { report: SalaryRaisesView; user: SessionUser }) {
  const rows = report.dueForReview;
  const rule = (
    <>
      {reviewRuleText(report.reviewMonths)}, or since joining without one, as of today ·{' '}
      <Link href="/organization/payroll#your-rules">Payroll Setup → Your Rules</Link>
    </>
  );
  return (
    <section aria-labelledby="raises-due" className="space-y-3">
      <SectionTitle id="raises-due" title="Due for Review" note={rule} />
      {rows.length === 0 ? (
        <Empty>No one is due for a salary review: every current employee has had a raise, or joined, within the last {report.reviewMonths === 1 ? 'month' : `${report.reviewMonths} months`}.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Job Title</th>
                <th scope="col">Since</th>
                <th scope="col" className="text-right">
                  Current Gross
                </th>
                <th scope="col">Open Now</th>
                {preparesRaises(user) && (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ReviewRow key={r.employmentId} row={r} user={user} />
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-sm text-muted">
            {peopleLabel(rows.length)}, longest without a raise first
          </p>
        </div>
      )}
    </section>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeSalaryRaises(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const today = todayInCairo();
  const period = readPeriod(query, today);
  const loaded = await loadSalaryRaises(period);

  const header = (
    <section className="card flex flex-wrap items-end justify-between gap-4 p-4">
      <PeriodPicker period={period} today={today} />
      <div className="text-right">
        {/* a plain link, never prefetched: the API makes the workbook on each download */}
        <a href={excelHref(period)} className="btn btn-secondary">
          Download Excel
        </a>
        <p className="hint">The raises, by department and due for review.</p>
      </div>
    </section>
  );

  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-4">
        {header}
        <section className="card">
          <p className={quiet}>
            {loaded.kind === 'unavailable'
              ? 'Not available yet: the server does not have this report yet.'
              : loaded.kind === 'forbidden'
                ? NOT_ALLOWED
                : `The salary raises could not be loaded. ${loaded.messages.join(' ')}`}
          </p>
        </section>
      </div>
    );
  }

  const report = loaded.report;
  const excluded = confidentialExcludedNote(report.confidentialExcluded ?? 0);
  return (
    <div className="space-y-6">
      {header}
      <section aria-labelledby="raises-summary" className="space-y-3">
        <SectionTitle id="raises-summary" title={titleCase(`Raises in ${periodTitle(report.period)}`)} note={`As of ${formatDateTime(report.generatedAt)}`} />
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        <Summary report={report} />
      </section>
      {report.byDepartment.length > 0 && <ByDepartment report={report} />}
      <Raises report={report} />
      <DueForReview report={report} user={user} />
    </div>
  );
}

export default function SalaryRaisesPage({ searchParams }: PageProps<'/payroll/reports/salary-raises'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/payroll/reports">Payroll Reports</BackLink>
        <div>
          <h1 className="text-2xl font-semibold">Salary Raises</h1>
          <p className="mt-1 text-muted">Every signed raise of a period and what it costs, by department, and who is due for a salary review.</p>
        </div>
        <Suspense fallback={<Loading />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
