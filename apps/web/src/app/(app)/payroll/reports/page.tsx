import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { confidentialExcludedNote, type PayrollFigures, type ReportPeriod } from '@trendlix/shared';
import { Select } from '@/components/select';
import { formatDateTime, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { monthChoices, periodTitle, quickPeriods, readPeriod, samePeriod } from './salary-raises/salary-raises';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import { monthName, runHref } from '../list';
import { loadJson, notLoadedText } from '../load';
import { PayrollStatusBadge } from '../ui';
import { CostTrendChart } from './cost-chart';
import {
  apiStatisticsPath,
  canSeeReports,
  CONTRACTS_REPORT_HREF,
  costChart,
  excelHref,
  FIGURE_COLUMNS,
  reportsHref,
  SALARY_RAISES_HREF,
  summaryTiles,
  withoutText,
  yearToDateTitle,
  type StatisticsView,
} from './reports';

// Reports (Statistics) under Payroll (owner, 17 October 2026: "make the Payroll in the side tab a main title below it -
// Overview - Unsettled - Additions / Deductions - Reports (Statistics)"): for a period of months, in the address so a view
// can be shared (this calendar year unless asked), what the runs the CEO approved paid and cost: the totals, the company
// cost's trend, month by month (headcount, gross, net, transfer, salary tax, both social insurance shares, the Martyrs'
// Fund, company cost), by department and team, and this year to date; with the Excel workbook, and the Salary Raises
// and Contracts reports linked (the Contracts one since 25 October 2026). One GET /payroll/statistics call. HR, Finance
// and the CEO, as salaries; the API checks it again. The C-level people are left out for anyone but the CEO and the
// Super Admin (owner, 19 October 2026: "make C level Employees details not visible to HR"), the workbook too, and the
// page says so.

export const metadata: Metadata = { title: 'Payroll Reports · People System' };

type Query = Record<string, string | string[] | undefined>;

const quiet = 'px-4 py-10 text-center text-sm text-muted';
const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';
const dash = <span className="text-muted">—</span>;

function PeriodPicker({ period, today }: { period: ReportPeriod; today: string }) {
  const months = monthChoices(today, period);
  return (
    <form key={`${period.from}-${period.to}`} className="flex flex-wrap items-end gap-3">
      {(['from', 'to'] as const).map((end) => (
        <div key={end}>
          <label htmlFor={`statistics-${end}`} className="label">
            {end === 'from' ? 'From' : 'To'}
          </label>
          <Select id={`statistics-${end}`} name={end} defaultValue={period[end]} className="input min-w-44">
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      <ul className="flex flex-wrap gap-2" aria-label="Quick periods">
        {quickPeriods(today).map((q) => {
          const active = samePeriod(q.period, period);
          return (
            <li key={q.key}>
              <Link
                href={reportsHref(q.period, today)}
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

/** The money columns of a row. */
function Figures({ f, strong = false }: { f: PayrollFigures; strong?: boolean }) {
  return FIGURE_COLUMNS.map((c) => (
    <td key={c.key} className={`text-right whitespace-nowrap tabular-nums ${strong ? 'font-semibold' : ''}`}>
      {formatEgp(f[c.key])}
    </td>
  ));
}

const figureHeads = FIGURE_COLUMNS.map((c) => (
  <th key={c.key} scope="col" className="text-right">
    {titleCase(c.label)}
  </th>
));

function ByMonth({ s }: { s: StatisticsView }) {
  return (
    <section aria-labelledby="statistics-by-month" className="space-y-3">
      <SectionTitle id="statistics-by-month" title="By Month" note="From the runs the CEO approved: a draft or a run with the CEO may still change" />
      <div className="card overflow-x-auto">
        {s.months.length === 0 ? (
          <p className={quiet}>No approved payroll in {periodTitle(s.period)}.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="text-right">
                  Headcount
                </th>
                {figureHeads}
                <th scope="col" className="text-right">
                  Average Gross
                </th>
              </tr>
            </thead>
            <tbody>
              {s.months.map((m) => (
                <tr key={m.month}>
                  <td className="whitespace-nowrap">
                    <Link href={runHref(m.runId)} className="font-semibold">
                      {monthName(m.month)}
                    </Link>
                    <div className="mt-0.5">
                      <PayrollStatusBadge status={m.status} />
                    </div>
                  </td>
                  <td className="text-right tabular-nums">
                    {m.employees}
                    {m.held > 0 && <div className="text-xs text-muted">{m.held} on hold</div>}
                  </td>
                  <Figures f={m} />
                  <td className="text-right whitespace-nowrap tabular-nums">{m.averageGross === null ? dash : formatEgp(m.averageGross)}</td>
                </tr>
              ))}
              <tr className="bg-canvas">
                <th scope="row" className="text-left text-sm tracking-normal text-ink normal-case">
                  Total
                </th>
                <td className="text-right font-semibold tabular-nums">{s.totals.employees}</td>
                <Figures f={s.totals} strong />
                <td className="text-right font-semibold whitespace-nowrap tabular-nums">{s.totals.averageGross === null ? dash : formatEgp(s.totals.averageGross)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {s.without.length > 0 && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            Not counted: {s.without.map((w) => `${monthName(w.month)} (${withoutText(w.status).toLowerCase()})`).join(', ')}.
          </p>
        )}
      </div>
    </section>
  );
}

function ByDepartment({ s }: { s: StatisticsView }) {
  if (!s.byDepartment.length) return null;
  return (
    <section aria-labelledby="statistics-by-department" className="space-y-3">
      <SectionTitle id="statistics-by-department" title="By Department and Team" note="As each line was placed when its run was made; a team is counted in its department too" />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col" className="text-right">
                Employees
              </th>
              <th scope="col" className="text-right">
                Person-Months
              </th>
              {figureHeads}
              <th scope="col" className="text-right">
                Average Gross
              </th>
            </tr>
          </thead>
          <tbody>
            {s.byDepartment.map((d) => (
              <Fragment key={d.name}>
                <tr>
                  <th scope="row" className="text-left text-sm font-semibold tracking-normal text-ink normal-case">
                    {d.name}
                  </th>
                  <td className="text-right tabular-nums">{d.employees}</td>
                  <td className="text-right tabular-nums">{d.personMonths}</td>
                  <Figures f={d} strong />
                  <td className="text-right whitespace-nowrap tabular-nums">{d.averageGross === null ? dash : formatEgp(d.averageGross)}</td>
                </tr>
                {d.teams.map((t) => (
                  <tr key={`${d.name}›${t.name}`}>
                    <th scope="row" className="pl-8 text-left text-sm font-normal tracking-normal text-ink normal-case">
                      <span className="text-muted">↳</span> {t.name}
                    </th>
                    <td className="text-right tabular-nums">{t.employees}</td>
                    <td className="text-right tabular-nums">{t.personMonths}</td>
                    <Figures f={t} />
                    <td className="text-right whitespace-nowrap tabular-nums">{t.averageGross === null ? dash : formatEgp(t.averageGross)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function YearToDate({ s }: { s: StatisticsView }) {
  const y = s.yearToDate;
  return (
    <section aria-labelledby="statistics-ytd" className="space-y-3">
      <SectionTitle id="statistics-ytd" title={`${y.year} Year to Date`} note={`${yearToDateTitle(s)}: ${y.months} ${y.months === 1 ? 'month' : 'months'} approved, whatever the period above`} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Company cost', value: formatEgp(y.companyCost) },
          { label: 'Gross', value: formatEgp(y.gross) },
          { label: 'Net', value: formatEgp(y.net) },
          { label: 'Salary tax', value: formatEgp(y.salaryTax) },
          { label: 'Employee insurance', value: formatEgp(y.employeeInsurance) },
          { label: 'Company insurance', value: formatEgp(y.companyInsurance) },
          { label: "Martyrs' Fund", value: formatEgp(y.martyrsFund) },
          { label: 'Employees paid', value: `${y.employees} · ${y.personMonths} person-months` },
        ].map((t) => (
          <div key={t.label} className="card px-4 py-3">
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className="mt-1 font-semibold tabular-nums">{t.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeReports(user)) return <Empty>Only HR, Finance and the CEO can see the payroll reports.</Empty>;
  const today = todayInCairo();
  const period = readPeriod(query, today);
  const loaded = await loadJson<StatisticsView>(apiStatisticsPath(period));

  const header = (
    <section className="card flex flex-wrap items-end justify-between gap-4 p-4">
      <PeriodPicker period={period} today={today} />
      <div className="text-right">
        {/* a plain link, never prefetched: the API makes the workbook on each download */}
        <a href={excelHref(period)} className="btn btn-secondary">
          Download Excel
        </a>
        <p className="hint">By month, by department and the totals.</p>
      </div>
    </section>
  );
  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-4">
        {header}
        <Empty>{notLoadedText(loaded, 'payroll statistics')}</Empty>
      </div>
    );
  }

  const s = loaded.value;
  const chart = costChart(s.months, s.period);
  const excluded = confidentialExcludedNote(s.confidentialExcluded ?? 0);
  return (
    <div className="space-y-8">
      {header}
      <section aria-labelledby="statistics-summary" className="space-y-3">
        <SectionTitle id="statistics-summary" title={titleCase(`Payroll in ${periodTitle(s.period)}`)} note={`As of ${formatDateTime(s.generatedAt)}`} />
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {summaryTiles(s).map((t) => (
            <div key={t.key} className="card px-4 py-3">
              <dt className="text-xs text-muted">{t.label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{t.value}</dd>
              {t.note && <dd className="text-xs text-muted">{t.note}</dd>}
            </div>
          ))}
        </dl>
      </section>
      {chart && (
        <section aria-labelledby="statistics-trend" className="space-y-3">
          <SectionTitle id="statistics-trend" title="Company Cost Trend" />
          <CostTrendChart chart={chart} />
        </section>
      )}
      <ByMonth s={s} />
      <ByDepartment s={s} />
      <YearToDate s={s} />
    </div>
  );
}

export default function PayrollReportsPage({ searchParams }: PageProps<'/payroll/reports'>) {
  return (
    <StaffOnly>
      <div className="max-w-6xl">
        <h1 className="text-2xl font-semibold">Payroll Reports</h1>
        <p className="mt-1 text-muted">
          What the approved payroll paid and cost, by month, department and team, and this year to date. The salary raises and the contracts have reports of
          their own: <Link href={SALARY_RAISES_HREF}>Salary Raises</Link> and <Link href={CONTRACTS_REPORT_HREF}>Contracts</Link>.
        </p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <Report searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </StaffOnly>
  );
}
