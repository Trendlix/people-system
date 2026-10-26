import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import {
  confidentialExcludedNote,
  VS_INSURANCE_DIFFERENCE_SIGN,
  vsInsuranceCountsText,
  vsInsuranceGroups,
  vsInsuranceRulesText,
  type ReportPeriod,
  type VsInsuranceFigures,
  type VsInsuranceRow,
  type VsInsuranceRun,
  type VsInsuranceTotals,
} from '@trendlix/shared';
import { GroupHeading } from '@/components/group-heading';
import { Shown } from '@/components/hidden';
import { Select } from '@/components/select';
import { formatDateTime, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading, todayInCairo } from '../../../employees/ui';
import { StaffOnly } from '../../../staff-only';
import { monthName, runHref } from '../../list';
import { loadJson } from '../../load';
import { PayrollStatusBadge } from '../../ui';
import { monthChoices, periodTitle } from '../salary-raises/salary-raises';
import {
  apiReportPath,
  canSeeVsInsurance,
  COLUMN_COUNT,
  defaultedText,
  DIFFERENCE_COLUMNS,
  differenceText,
  excelHref,
  FIGURE_COLUMNS,
  mayChangeNote,
  moneyText,
  profileHref,
  quickPeriods,
  readPeriod,
  reportHref,
  rowsLabel,
  samePeriod,
  standingNote,
  standingText,
  statusText,
  type VsInsuranceView,
} from './vs-insurance';

// The Payroll vs Social Insurance report (owner, 26 October 2026: "i want a comparison report between the actual payroll
// run and the social insurance data, and the differences in the social insurance and taxes between the 2 runs"; asked which
// two figures: "actual gross and the whole cycle vs the social insurance gross with the whole cycle"), under Payroll →
// Reports beside Salary Raises, Contracts and Leave. For a month or From and To months, in the address so a view can be
// shared (the latest run's month unless asked): every run of the period whatever its status, each marked with it (a draft
// "may change"), and per employee and month three blocks: the actual run's whole cycle as the run stored it, the same month
// worked out by the same engine on the registered insured wage (no allowances, no amount-based additions), and the
// differences (the SI cycle less the actual run); grouped by department and team as the Leave report groups, with subtotals
// and a grand total; the counts of those not registered and outside the labour law; the period and each run's rules in
// words. One GET /payroll/vs-insurance call; the Excel workbook of three sheets is the API's, passed on under the web domain
// (excel/route.ts). HR, Finance and the CEO, as payroll figures; the API checks it again. The C-level people are left out
// for anyone but the CEO and the Super Admin (owner, 19 October 2026: "make C level Employees details not visible to HR"),
// and the page says how many. A developer sees the figures masked by the API, as on every payroll page.

export const metadata: Metadata = { title: 'Payroll vs Social Insurance · People System' };

type Query = Record<string, string | string[] | undefined>;

const NOT_ALLOWED = 'Only HR, Finance and the CEO can see the payroll vs social insurance report.';
const dash = <span className="text-muted">—</span>;
const quiet = 'border-t border-line px-4 py-10 text-center text-sm text-muted';
const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';
const num = 'whitespace-nowrap text-right tabular-nums';

function PeriodPicker({ period, shown, today }: { period: ReportPeriod | null; shown: ReportPeriod; today: string }) {
  const months = monthChoices(today, shown);
  return (
    // keyed by the period, so following a quick period shows it, not what was chosen before
    <form key={reportHref(period)} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {(['from', 'to'] as const).map((end) => (
          <div key={end}>
            <label htmlFor={`vs-insurance-${end}`} className="label">
              {end === 'from' ? 'From' : 'To'}
            </label>
            <Select id={`vs-insurance-${end}`} name={end} defaultValue={shown[end]} className="input min-w-44">
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
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Quick periods">
        {quickPeriods(today).map((q) => {
          const active = samePeriod(q.period, period);
          return (
            <li key={q.key}>
              <Link
                href={reportHref(q.period)}
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

/** The runs of the period, each with its status and the rules its month is worked out with. */
function Runs({ runs }: { runs: VsInsuranceRun[] }) {
  return (
    <section aria-labelledby="vs-insurance-runs" className="space-y-3">
      <SectionTitle id="vs-insurance-runs" title="Runs and Rules" note="Every run of the period, whatever its status; the SI cycle is worked out with the run's own copied rules and rates" />
      <div className="card">
        {runs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No payroll run in this period.</p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-40">
                  <Link href={runHref(r.id)} className="font-semibold">
                    {monthName(r.month)}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <PayrollStatusBadge status={r.status} />
                    {mayChangeNote(r) && <span className="text-xs text-muted">{mayChangeNote(r)}</span>}
                  </div>
                </div>
                <p className="flex-1 text-sm text-muted">{vsInsuranceRulesText(r)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The A or B block of a row or a total: the whole cycle's figures. */
function Cycle({ figures, strong = false }: { figures: VsInsuranceFigures; strong?: boolean }) {
  return FIGURE_COLUMNS.map((c) => (
    <td key={c.key} className={`${num} ${strong ? 'font-semibold' : ''}`}>
      {moneyText(figures[c.key])}
    </td>
  ));
}

/** The differences block: B − A, signed. */
function Differences({ difference, strong = false }: { difference: NonNullable<VsInsuranceRow['difference']>; strong?: boolean }) {
  return DIFFERENCE_COLUMNS.map((c) => (
    <td key={c.key} className={`${num} ${strong ? 'font-semibold' : ''}`}>
      {differenceText(difference[c.key])}
    </td>
  ));
}

/** A group's subtotal, or the grand total, across the three blocks. */
function TotalRow({ label, totals, grand = false }: { label: string; totals: VsInsuranceTotals; grand?: boolean }) {
  return (
    <tr className={`font-semibold ${grand ? 'border-t-2 border-line bg-line-soft' : 'bg-canvas'}`}>
      <td colSpan={2}>
        {label}
        {totals.registered < totals.rows && <div className="text-xs font-normal text-muted">SI cycle and differences over the {totals.registered} registered</div>}
      </td>
      <Cycle figures={totals.actual} strong />
      <Cycle figures={totals.insurance} strong />
      <Differences difference={totals.difference} strong />
    </tr>
  );
}

function Row({ row: r }: { row: VsInsuranceRow }) {
  const note = standingNote(r);
  return (
    <tr className="align-top">
      <td className="min-w-48">
        <Link href={profileHref(r)} className="font-semibold">
          {r.employee.fullNameEn}
        </Link>
        <div className="text-xs tabular-nums text-muted">
          <Shown text={r.employee.employeeCode} />
        </div>
        <div className={`text-xs ${r.standing === 'registered' ? 'text-muted' : 'text-warn'}`}>{standingText(r)}</div>
        {r.onHold && <div className="text-xs text-muted">On hold</div>}
      </td>
      <td className="whitespace-nowrap">
        <Link href={runHref(r.runId)}>{monthName(r.month)}</Link>
        <div className="text-xs text-muted">{statusText(r)}</div>
      </td>
      <Cycle figures={r.actual} />
      {r.insurance && r.difference ? (
        <>
          <Cycle figures={r.insurance} />
          <Differences difference={r.difference} />
        </>
      ) : (
        <>
          <td colSpan={FIGURE_COLUMNS.length} className="max-w-96 text-sm text-muted">
            {note}
          </td>
          <td colSpan={DIFFERENCE_COLUMNS.length} className="text-center">
            {dash}
          </td>
        </>
      )}
    </tr>
  );
}

function ComparisonTable({ report }: { report: VsInsuranceView }) {
  const groups = vsInsuranceGroups(report.rows);
  return (
    // the table scrolls inside its card on a narrow screen, the page doesn't
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>
              Employee
            </th>
            <th scope="col" rowSpan={2}>
              Month
            </th>
            <th scope="colgroup" colSpan={FIGURE_COLUMNS.length} className="border-l border-line text-center">
              Actual Run
            </th>
            <th scope="colgroup" colSpan={FIGURE_COLUMNS.length} className="border-l border-line text-center">
              SI Cycle
            </th>
            <th scope="colgroup" colSpan={DIFFERENCE_COLUMNS.length} className="border-l border-line text-center">
              Difference ({titleCase(VS_INSURANCE_DIFFERENCE_SIGN)})
            </th>
          </tr>
          <tr>
            {FIGURE_COLUMNS.map((c, i) => (
              <th key={`a-${c.key}`} scope="col" className={`text-right ${i === 0 ? 'border-l border-line' : ''}`}>
                {titleCase(c.label)}
              </th>
            ))}
            {FIGURE_COLUMNS.map((c, i) => (
              <th key={`b-${c.key}`} scope="col" className={`text-right ${i === 0 ? 'border-l border-line' : ''}`}>
                {titleCase(c.label)}
              </th>
            ))}
            {DIFFERENCE_COLUMNS.map((c, i) => (
              <th key={`d-${c.key}`} scope="col" className={`text-right ${i === 0 ? 'border-l border-line' : ''}`}>
                {titleCase(c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.department ?? 'none'}>
              {(g.department !== null || groups.length > 1) && <GroupHeading level="department" name={g.department} span={COLUMN_COUNT} count={g.totals.people} />}
              {g.teams.map((t) => (
                <Fragment key={t.team ?? 'own'}>
                  {t.team !== null && <GroupHeading level="team" name={t.team} span={COLUMN_COUNT} count={t.totals.people} />}
                  {t.rows.map((r) => (
                    <Row key={r.lineId} row={r} />
                  ))}
                  {t.team !== null && <TotalRow label={`Total · ${titleCase(t.team)}`} totals={t.totals} />}
                </Fragment>
              ))}
              <TotalRow label={`Total · ${g.department === null ? 'No Department' : titleCase(g.department)}`} totals={g.totals} />
            </Fragment>
          ))}
          <TotalRow label="Total · Everyone" totals={report.totals} grand />
        </tbody>
      </table>
    </div>
  );
}

async function Report({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeVsInsurance(user)) return <Empty>{NOT_ALLOWED}</Empty>;
  const today = todayInCairo();
  const period = readPeriod(query);
  const loaded = await loadJson<VsInsuranceView>(apiReportPath(period));
  // the picker shows the period the report is of: the latest run's month when none was asked
  const shown: ReportPeriod = loaded.kind === 'ok' ? loaded.value.period : (period ?? { from: today.slice(0, 7), to: today.slice(0, 7) });

  const header = (
    <section className="card space-y-4 p-4">
      <PeriodPicker period={period} shown={shown} today={today} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="hint">
          Column A is the run as paid. Column B is the same month worked out by the same engine on the registered insured wage: no allowances, no amount-based
          additions. The differences are B − A.
        </p>
        {/* a plain link, never prefetched: the API makes the workbook on each download */}
        <a href={excelHref(period)} className="btn btn-secondary">
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
                : `The payroll vs social insurance report could not be loaded. ${loaded.messages.join(' ')}`}
          </p>
        </section>
      </div>
    );
  }

  const report = loaded.value;
  const excluded = confidentialExcludedNote(report.confidentialExcluded ?? 0);
  const defaulted = defaultedText(report);
  return (
    <div className="space-y-6">
      {header}
      <Runs runs={report.runs} />
      <section aria-labelledby="vs-insurance-comparison" className="space-y-3">
        <SectionTitle
          id="vs-insurance-comparison"
          title={titleCase(`Payroll vs social insurance in ${periodTitle(report.period)}`)}
          note={`${defaulted ? `${defaulted}. ` : ''}${rowsLabel(report.rows.length)}, as of ${formatDateTime(report.generatedAt)}`}
        />
        <p className="text-sm text-muted">{vsInsuranceCountsText(report.totals)}</p>
        {excluded && <p className="text-sm text-muted">{excluded}</p>}
        {report.rows.length === 0 ? <Empty>No payroll lines in this period.</Empty> : <ComparisonTable report={report} />}
      </section>
    </div>
  );
}

export default function VsInsurancePage({ searchParams }: PageProps<'/payroll/reports/vs-insurance'>) {
  return (
    <StaffOnly>
      <div className="space-y-4">
        <BackLink href="/payroll/reports">Payroll Reports</BackLink>
        <div>
          <h1 className="text-2xl font-semibold">Payroll vs Social Insurance</h1>
          <p className="mt-1 text-muted">
            Per employee and month, the actual payroll run&rsquo;s whole cycle beside the same month on the registered social insurance wage, and the differences in
            the insurance shares, the tax, the Martyrs&rsquo; Fund, the net and the company cost. The registered wage is on each profile&rsquo;s Social Insurance tab;
            the runs are on <Link href="/payroll">Payroll</Link>.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
