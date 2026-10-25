import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { confidentialExcludedNote, CONTRACT_FORMS, CONTRACT_FORM_LABELS, type ContractsReportRow } from '@trendlix/shared';
import { Hidden, Shown } from '@/components/hidden';
import { Select } from '@/components/select';
import { departmentOptions } from '@/lib/departments';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { employmentHidden, filtersByJob } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import type { Department } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { BackLink, Empty, Loading, todayInCairo } from '../../../employees/ui';
import { StaffOnly } from '../../../staff-only';
import { loadJson } from '../../load';
import { monthChoices, periodTitle, quickPeriods, samePeriod } from '../salary-raises/salary-raises';
import {
  apiReportPath,
  canSeeContractsReport,
  contractLink,
  contractsLabel,
  employeeHref,
  ENDING_OPTIONS,
  endsSoon,
  excelHref,
  isFiltered,
  noFilters,
  readFilters,
  reportHref,
  rowView,
  SHOW_OPTIONS,
  STATUS_OPTIONS,
  summaryTiles,
  TYPE_OPTIONS,
  type ContractsReportView,
  type ReportFilters,
} from './contracts-report';

// The Contracts report (owner, 25 October 2026: "if i want to export a contracts report, status, start and end dates,
// how?"; asked, "A report under Reports" and "Dates and status"), under Payroll → Reports beside Salary Raises, also
// reached from the Contracts page. For a period of months and the Contracts page's filters, in the address so a view can
// be shared (this calendar year, signed contracts, the latest version per employment unless asked): the totals (by
// status, ending in the next 30, 60 and 90 days, not renewed, renewals signed) and each contract version with its dates
// and status, the person linked to their Employment tab and the number to the contract; no salary or allowances. One
// GET /reports/contracts call; the Excel workbook is the API's, passed on under the web domain (excel/route.ts). HR,
// Finance and the CEO, as the Contracts page; the API checks it again. The C-level people are left out for anyone but
// the CEO and the Super Admin (owner, 19 October 2026: "make C level Employees details not visible to HR"), and the
// page says how many.

export const metadata: Metadata = { title: 'Contracts Report · People System' };

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only HR, Finance and the CEO can see the contracts report.';
const dash = <span className="text-muted">—</span>;
const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';
const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';

const FORM_OPTIONS = [{ value: '', label: 'Any length' }, ...CONTRACT_FORMS.map((f) => ({ value: f, label: CONTRACT_FORM_LABELS[f] }))];

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

function Filters({ filters: f, today, departments }: { filters: ReportFilters; today: string; departments: readonly { id: string; label: string }[] | null }) {
  const months = monthChoices(today, f.period);
  return (
    // keyed by the filters, so following a quick period or Clear shows them, not what was chosen before
    <form key={reportHref(f, today)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect id="contracts-from" name="from" label="From" value={f.period.from} options={months} />
        <FilterSelect id="contracts-to" name="to" label="To" value={f.period.to} options={months} />
        <FilterSelect id="contracts-status" name="status" label="Status" value={f.status} options={STATUS_OPTIONS} />
        <FilterSelect id="contracts-show" name="show" label="Show" value={f.show} options={SHOW_OPTIONS} />
        <FilterSelect id="contracts-type" name="type" label="Employment type" value={f.type} options={TYPE_OPTIONS} />
        <FilterSelect id="contracts-form" name="form" label="Contract length" value={f.form} options={FORM_OPTIONS} />
        {/* a developer's filter by place doesn't apply (22 October 2026: "Hide per-person details"): not offered */}
        {departments && (
          <FilterSelect
            id="contracts-department"
            name="department"
            label="Department or team"
            value={f.department ?? ''}
            options={[{ value: '', label: 'Everyone' }, ...departments.map((d) => ({ value: d.id, label: d.label }))]}
          />
        )}
        <FilterSelect id="contracts-ending" name="endingWithin" label="Ending within" value={f.endingWithin === null ? '' : String(f.endingWithin)} options={ENDING_OPTIONS} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="contracts-search" className="label">
            Search
          </label>
          <input id="contracts-search" name="q" type="search" maxLength={100} defaultValue={f.q} placeholder="Name, employee code or contract number" className="input" />
        </div>
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

function Summary({ report }: { report: ContractsReportView }) {
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

/** A contract's date: DD/MM/YYYY, a dash for none, or Hidden for a developer (who gets no employment dates). */
function Day({ value, hidden }: { value: string | null; hidden: boolean }) {
  if (value) return <>{formatDate(value)}</>;
  return hidden ? <Hidden /> : dash;
}

const STATUS_STYLE: Record<ContractsReportRow['status'], string> = {
  draft: 'bg-warn-soft text-warn',
  active: 'bg-ok-soft text-ok',
  ended: 'bg-line-soft text-muted',
  superseded: 'bg-line-soft text-muted',
};

function ContractRow({ row: r }: { row: ContractsReportRow }) {
  const v = rowView(r);
  // a developer gets the type "••••" and no dates (22 October 2026: "Hide per-person details")
  const hidden = employmentHidden(r);
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap tabular-nums">
        <Shown text={r.employee.employeeCode} />
      </td>
      <td className="min-w-44">
        <Link href={employeeHref(r)} className="font-semibold">
          {r.employee.fullNameEn}
          <span className="sr-only"> (employment)</span>
        </Link>
      </td>
      <td className="min-w-32">
        <Shown text={v.department} empty={dash} />
      </td>
      <td className="min-w-28">
        <Shown text={v.team} empty={dash} />
      </td>
      <td className="min-w-36">
        <Shown text={r.jobTitle} empty={hidden ? <Hidden /> : dash} />
      </td>
      <td className="whitespace-nowrap tabular-nums">
        <Link href={contractLink(r)}>
          <Shown text={r.number} />
          <span className="sr-only"> (contract of {r.employee.fullNameEn})</span>
        </Link>
      </td>
      <td className="text-right tabular-nums">{r.version}</td>
      <td className="whitespace-nowrap">{v.kind}</td>
      <td className="whitespace-nowrap">
        <Shown text={v.type} />
      </td>
      <td className="whitespace-nowrap">{v.length}</td>
      <td className="whitespace-nowrap tabular-nums">
        <Day value={r.startDate} hidden={hidden} />
      </td>
      <td className="whitespace-nowrap tabular-nums">
        {/* none when open-ended (the length says so) or a specific job's end isn't set */}
        <Day value={r.endDate} hidden={hidden} />
      </td>
      <td className={`whitespace-nowrap text-right tabular-nums ${endsSoon(r) ? 'font-semibold text-warn' : ''}`}>{v.daysLeft ?? (hidden ? <Hidden /> : dash)}</td>
      <td>
        <span className={`badge ${STATUS_STYLE[r.status]}`}>{v.status}</span>
      </td>
      <td className="whitespace-nowrap tabular-nums">
        <Day value={r.signedOn} hidden={hidden} />
      </td>
      <td className="whitespace-nowrap tabular-nums">
        <Day value={r.probationEnd} hidden={hidden} />
      </td>
      <td className="whitespace-nowrap">{v.employeeStatus}</td>
    </tr>
  );
}

function Contracts({ report }: { report: ContractsReportView }) {
  const title = periodTitle(report.filters.period);
  return (
    <section aria-labelledby="contracts-list" className="space-y-3">
      <SectionTitle
        id="contracts-list"
        title="Contracts"
        note={report.rows.length > 0 && `${contractsLabel(report.rows.length)}, by employee code; ${report.filters.show === 'every' ? 'every version' : 'the latest version per employment'}`}
      />
      {report.rows.length === 0 ? (
        <Empty>No contract in {title} matches these filters. A contract counts when its term, from its start to its end, touches the period.</Empty>
      ) : (
        // the table scrolls inside its box on a phone, the page doesn't
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee Code</th>
                <th scope="col">Employee Name</th>
                <th scope="col">Department</th>
                <th scope="col">Team</th>
                <th scope="col">Job Title</th>
                <th scope="col">Contract Number</th>
                <th scope="col" className="text-right">
                  Version
                </th>
                <th scope="col">Kind</th>
                <th scope="col">Employment Type</th>
                <th scope="col">Length</th>
                <th scope="col">Start Date</th>
                <th scope="col">End Date</th>
                <th scope="col" className="text-right">
                  Days Left
                </th>
                <th scope="col">Status</th>
                <th scope="col">Signed On</th>
                <th scope="col">Probation End</th>
                <th scope="col">Employee Status</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <ContractRow key={r.contractId} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeContractsReport(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const byJob = filtersByJob(user);
  const today = todayInCairo();
  const f = readFilters(query, today);
  const [loaded, departments] = await Promise.all([
    loadJson<ContractsReportView>(apiReportPath(f)),
    byJob ? getOrNull<Department[]>('/departments') : Promise.resolve(null),
  ]);

  const header = (
    <section className="card space-y-4 p-4">
      <Filters filters={f} today={today} departments={departments && departmentOptions(departments)} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="hint">Each contract’s status, start and end dates, as shown; no salary or allowances.</p>
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
                : `The contracts report could not be loaded. ${loaded.messages.join(' ')}`}
          </p>
        </section>
      </div>
    );
  }

  const report = loaded.value;
  const excluded = confidentialExcludedNote(report.confidentialExcluded ?? 0, 'contracts');
  return (
    <div className="space-y-6">
      {header}
      <section aria-labelledby="contracts-summary" className="space-y-3">
        <SectionTitle id="contracts-summary" title={titleCase(`Contracts in ${periodTitle(report.filters.period)}`)} note={`As of ${formatDateTime(report.generatedAt)}`} />
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        <Summary report={report} />
      </section>
      <Contracts report={report} />
    </div>
  );
}

export default function ContractsReportPage({ searchParams }: PageProps<'/payroll/reports/contracts'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/payroll/reports">Payroll Reports</BackLink>
        <div>
          <h1 className="text-2xl font-semibold">Contracts Report</h1>
          <p className="mt-1 text-muted">
            Every contract of a period with its status, start and end dates, and what ends soon or wasn’t renewed. Each is drafted and signed on the employee’s Employment
            tab; all of them are on <Link href="/contracts">Contracts</Link>.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
