import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { confidentialExcludedNote, leaveReportGroups, type LeaveReportPerson, type LeaveReportTotals } from '@trendlix/shared';
import { GroupHeading } from '@/components/group-heading';
import { Shown } from '@/components/hidden';
import { Select } from '@/components/select';
import { actionablePeople } from '@/lib/confidential';
import { departmentOptions } from '@/lib/departments';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { filtersByJob, withCode } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import type { Department, EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { BackLink, Empty, Loading, todayInCairo } from '../../../employees/ui';
import { StaffOnly } from '../../../staff-only';
import { loadJson } from '../../load';
import { monthChoices, periodTitle } from '../salary-raises/salary-raises';
import {
  apiReportPath,
  balanceText,
  canSeeLeaveReport,
  crossesPeriod,
  excelHref,
  figureText,
  isFiltered,
  leaveHref,
  leavesLabel,
  noFilters,
  profileHref,
  quickPeriods,
  readFilters,
  reportHref,
  samePeriod,
  sourceText,
  typeTotal,
  type LeaveReportFilters,
  type LeaveReportView,
} from './leave-report';

// The Leave report (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"; asked, "Both" (a
// summary and a list), to count the permission hours, the work from home days and the annual balance left, and "A month,
// or a range"), under Payroll → Reports beside Salary Raises and Contracts, also reached from Leave Requests. For a month or
// From and To months, in the address so a view can be shared (this month unless asked), a department or team and an
// employee: the summary, one row per employee with a column per leave type that has days in the period, then the leave
// days, permission hours, work from home days and the annual balance left, grouped by department and team as Leave Requests
// groups, with subtotals and a grand total; and the list of each leave. Approved leave only, and a leave crossing the period
// counts only its days inside it. One GET /reports/leave call; the Excel workbook is the API's, passed on under the web
// domain (excel/route.ts). HR and the CEO, who see everyone's leave; the API checks it again. The C-level people are left
// out for anyone but the CEO and the Super Admin (owner, 19 October 2026: "make C level Employees details not visible to
// HR"), and the page says how many.

export const metadata: Metadata = { title: 'Leave Report · People System' };

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only HR and the CEO can see the leave report.';
const dash = <span className="text-muted">—</span>;
const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';
const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';

function FilterSelect({ id, name, label, value, options }: { id: string; name: string; label: string; value: string; options: readonly { value: string; label: string }[] }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <Select id={id} name={name} defaultValue={value} className="input w-full sm:min-w-44">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Filters({
  filters: f,
  today,
  departments,
  people,
}: {
  filters: LeaveReportFilters;
  today: string;
  departments: readonly { id: string; label: string }[] | null;
  people: readonly { id: string; label: string }[] | null;
}) {
  const months = monthChoices(today, f.period);
  return (
    // keyed by the filters, so following a quick period or Clear shows them, not what was chosen before
    <form key={reportHref(f, today)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect id="leave-report-from" name="from" label="From" value={f.period.from} options={months} />
        <FilterSelect id="leave-report-to" name="to" label="To" value={f.period.to} options={months} />
        {/* a developer's filter by place doesn't apply (22 October 2026: "Hide per-person details"): not offered */}
        {departments && (
          <FilterSelect
            id="leave-report-department"
            name="department"
            label="Department or team"
            value={f.department ?? ''}
            options={[{ value: '', label: 'Everyone' }, ...departments.map((d) => ({ value: d.id, label: d.label }))]}
          />
        )}
        {people && (
          <FilterSelect
            id="leave-report-employee"
            name="employee"
            label="Employee"
            value={f.employee ?? ''}
            options={[{ value: '', label: 'All employees' }, ...people.map((p) => ({ value: p.id, label: p.label }))]}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-secondary">
          Show
        </button>
        {isFiltered(f) && (
          <Link href={reportHref(noFilters(f.period), today)} className="btn btn-secondary">
            Clear
          </Link>
        )}
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Quick periods">
        {quickPeriods(today).map((q) => {
          const active = samePeriod(q.period, f.period);
          return (
            <li key={q.key}>
              <Link
                href={reportHref({ ...f, period: q.period }, today)}
                aria-current={active ? 'page' : undefined}
                className={`${chip} ${active ? 'border-ink bg-ink text-on-accent hover:text-on-accent' : 'border-line bg-card text-ink hover:bg-canvas hover:text-ink'}`}
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

const num = 'whitespace-nowrap text-right tabular-nums';

/** A group's subtotal, or the grand total, across the figure columns. */
function TotalRow({ label, totals, types, grand = false }: { label: string; totals: LeaveReportTotals; types: LeaveReportView['types']; grand?: boolean }) {
  return (
    <tr className={`font-semibold ${grand ? 'border-t-2 border-line bg-line-soft' : 'bg-canvas'}`}>
      <td colSpan={2}>{label}</td>
      {types.map((t) => (
        <td key={t.id} className={num}>
          {figureText(typeTotal(totals, t.id))}
        </td>
      ))}
      <td className={num}>{figureText(totals.leaveDays)}</td>
      <td className={num}>{figureText(totals.permissionHours)}</td>
      <td className={num}>{figureText(totals.wfhDays)}</td>
      <td />
    </tr>
  );
}

function PersonRow({ person: p, types }: { person: LeaveReportPerson; types: LeaveReportView['types'] }) {
  return (
    <tr className="align-top">
      <td className="min-w-44">
        <Link href={profileHref(p)} className="font-semibold">
          {p.employee.fullNameEn}
        </Link>
      </td>
      <td className="whitespace-nowrap tabular-nums">
        <Shown text={p.employee.employeeCode} />
      </td>
      {types.map((t) => (
        <td key={t.id} className={num}>
          {figureText(p.days[t.id] ?? 0)}
        </td>
      ))}
      <td className={`${num} font-semibold`}>{figureText(p.leaveDays)}</td>
      <td className={num}>{figureText(p.permissionHours)}</td>
      <td className={num}>{figureText(p.wfhDays)}</td>
      <td className={num}>{balanceText(p.annualLeft)}</td>
    </tr>
  );
}

function SummaryTable({ report }: { report: LeaveReportView }) {
  const { types } = report;
  const groups = leaveReportGroups(report.people);
  const span = 2 + types.length + 4;
  return (
    // the table scrolls inside its card on a phone, the page doesn't
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Code</th>
            {types.map((t) => (
              <th key={t.id} scope="col" className="text-right">
                {titleCase(t.nameEn)}
              </th>
            ))}
            <th scope="col" className="text-right">
              Leave Days
            </th>
            <th scope="col" className="text-right">
              Permission Hours
            </th>
            <th scope="col" className="text-right">
              Work From Home Days
            </th>
            <th scope="col" className="text-right">
              Annual Balance Left
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.department ?? 'none'}>
              {(g.department !== null || groups.length > 1) && <GroupHeading level="department" name={g.department} span={span} count={g.totals.people} />}
              {g.teams.map((t) => (
                <Fragment key={t.team ?? 'own'}>
                  {t.team !== null && <GroupHeading level="team" name={t.team} span={span} count={t.totals.people} />}
                  {t.people.map((p) => (
                    <PersonRow key={p.employee.id} person={p} types={types} />
                  ))}
                  {t.team !== null && <TotalRow label={`Total · ${titleCase(t.team)}`} totals={t.totals} types={types} />}
                </Fragment>
              ))}
              <TotalRow label={`Total · ${g.department === null ? 'No Department' : titleCase(g.department)}`} totals={g.totals} types={types} />
            </Fragment>
          ))}
          <TotalRow label="Total · Everyone" totals={report.totals} types={types} grand />
        </tbody>
      </table>
    </div>
  );
}

function LeaveList({ report }: { report: LeaveReportView }) {
  return (
    <section aria-labelledby="leave-report-list" className="space-y-3">
      <SectionTitle id="leave-report-list" title="Leaves" note={`${leavesLabel(report.leaves.length)}, by first day`} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Type</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col" className="text-right">
                Days In The Period
              </th>
              <th scope="col" className="text-right">
                Total Days
              </th>
              <th scope="col">Recorded As</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {report.leaves.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="min-w-44">
                  <Link href={profileHref(l)} className="font-semibold">
                    {l.employee.fullNameEn}
                  </Link>
                  <div className="text-xs tabular-nums text-muted">
                    <Shown text={l.employee.employeeCode} />
                  </div>
                </td>
                <td className="whitespace-nowrap">
                  <Link href={leaveHref(l)}>{titleCase(l.typeName)}</Link>
                  {l.halfDay && <span className="text-xs text-muted"> (half day)</span>}
                </td>
                <td className="whitespace-nowrap tabular-nums">{formatDate(l.startDate)}</td>
                <td className="whitespace-nowrap tabular-nums">{formatDate(l.endDate)}</td>
                <td className={`${num} ${crossesPeriod(l) ? 'font-semibold' : ''}`}>{l.daysInPeriod}</td>
                <td className={num}>{l.days}</td>
                <td className="whitespace-nowrap">{sourceText(l)}</td>
                <td className="min-w-48 max-w-96">
                  <Shown text={l.reason} empty={dash} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeLeaveReport(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const byJob = filtersByJob(user);
  const today = todayInCairo();
  const f = readFilters(query, today);
  const [loaded, departments, directory] = await Promise.all([
    loadJson<LeaveReportView>(apiReportPath(f)),
    byJob ? getOrNull<Department[]>('/departments') : Promise.resolve(null),
    getOrNull<EmployeeSummary[]>('/employees'),
  ]);
  // the people to choose from are those the user sees (the directory without the C-level cards they can't open)
  const people = directory
    ? actionablePeople(directory)
        .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'))
        .map((p) => ({ id: p.id, label: withCode(p.fullNameEn, p.employeeCode) }))
    : null;

  const header = (
    <section className="card space-y-4 p-4">
      <Filters filters={f} today={today} departments={departments && departmentOptions(departments)} people={people} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="hint">Approved leave only. A leave crossing the period counts only its days inside it, counted as the leave counts its days.</p>
        {/* a plain link, never prefetched: the API makes the workbook on each download */}
        <a href={excelHref(f)} className="btn btn-secondary">
          Download Excel
        </a>
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
                : `The leave report could not be loaded. ${loaded.messages.join(' ')}`}
          </p>
        </section>
      </div>
    );
  }

  const report = loaded.value;
  const excluded = confidentialExcludedNote(report.confidentialExcluded ?? 0, 'leave');
  return (
    <div className="space-y-6">
      {header}
      <section aria-labelledby="leave-report-summary" className="space-y-3">
        <SectionTitle
          id="leave-report-summary"
          title={titleCase(`Leave in ${periodTitle(report.filters.period)}`)}
          note={`As of ${formatDateTime(report.generatedAt)}; the annual balance is of ${formatDate(report.balanceAsOf)}`}
        />
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        {report.people.length === 0 ? <Empty>No approved leave in this period.</Empty> : <SummaryTable report={report} />}
      </section>
      {report.people.length > 0 && <LeaveList report={report} />}
    </div>
  );
}

export default function LeaveReportPage({ searchParams }: PageProps<'/payroll/reports/leave'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/payroll/reports">Payroll Reports</BackLink>
        <div>
          <h1 className="page-title">Leave Report</h1>
          <p className="mt-1 text-muted">
            The approved leave of a month or of a range of months, by employee and leave type, with the permission hours, the work from home days and the annual
            balance left. Leave is recorded and decided on <Link href="/leave">Leave Requests</Link>.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
