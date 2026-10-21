import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { KPI_PILLARS, KPI_STATUSES, kpiMonthName, kpiScorecardMonthOn, type KpiOverview, type KpiStatus } from '@trendlix/shared';
import { Select } from '@/components/select';
import { titleCase } from '@/lib/format';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { hasRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { openScorecards } from '../actions';
import { kpiNotLoaded, loadHeatmap, loadOverview, loadScorecards } from '../data';
import {
  allKpisHref,
  averageChangeText,
  KPI_STEP_NAMES,
  kpiExcelHref,
  percentText,
  readDepartment,
  readMonth,
  readStatus,
  scorecardsLabel,
  seesAllKpis,
} from '../scorecard';
import { Heatmap, LevelDistribution, ScorecardsTable } from '../ui';
import { OpenScorecardsForm } from './open-form';

// All KPIs (owner's brief, 21 October 2026: "All KPIs (HR, the CEO, Super Admin): every scorecard by month with its
// step, calibration, pillar averages by department, and an Excel export"): a month's figures (how many, at which step,
// calibrated by HR, self-ratings missed, final without every signature, the average against the month before), its
// levels, each department's average by pillar, everyone's heatmap over six months, and the month's scorecards filtered
// by step and department, with the month's workbook. HR opens last month's scorecards now rather than on the 1st. The
// C-level people are left out for HR (owner, 19 October 2026: "make C level Employees details not visible to HR"): the
// page says so. The API checks the roles again.

export const metadata: Metadata = { title: 'All KPIs · People System' };

/** The month, the step and the department shown, in the address (a GET form: a link keeps them). */
function Filters({ overview, status, department }: { overview: KpiOverview; status: KpiStatus | null; department: string | null }) {
  const months = [...new Set([overview.month, ...overview.months])].sort().reverse();
  const departments = overview.departments.filter((d): d is typeof d & { id: string } => !!d.id);
  return (
    <form key={`${overview.month}-${status}-${department}`} action={KPI_PATHS.all} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="all-kpi-month" className="label">
          Month
        </label>
        <Select id="all-kpi-month" name="month" defaultValue={overview.month} className="input min-w-44">
          {months.map((m) => (
            <option key={m} value={m}>
              {kpiMonthName(m)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="all-kpi-status" className="label">
          Step
        </label>
        <Select id="all-kpi-status" name="status" defaultValue={status ?? ''} className="input min-w-44">
          <option value="">Every step</option>
          {KPI_STATUSES.map((s) => (
            <option key={s} value={s}>
              {KPI_STEP_NAMES[s]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="all-kpi-department" className="label">
          Department
        </label>
        <Select id="all-kpi-department" name="department" defaultValue={department ?? ''} className="input min-w-52">
          <option value="">Every department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
    </form>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="mt-1 text-xs text-muted">{note}</dd>}
    </div>
  );
}

/** The month in figures: how many and at which step, HR's calibrations, what was missed, and the average. */
function Figures({ overview: o }: { overview: KpiOverview }) {
  const final = o.byStatus.final ?? 0;
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <Stat label="Scorecards" value={o.total} note={`${final} final · ${o.total - final} still open`} />
      <Stat label="Average final %" value={percentText(o.average)} note={averageChangeText(o.average, o.previousAverage, o.month) ?? 'None scored yet'} />
      <Stat label="Calibrated by HR" value={o.calibrated} note="Scorecards with a pick HR changed, with its reason" />
      <Stat label="Self-ratings missed" value={o.selfMissed} note="Not sent by the self-rating day; the scoring went on" />
      <Stat label="Final unsigned" value={o.unsigned} note="Final on the sign-off day without every signature" />
    </dl>
  );
}

/** How many are at each step. */
function ByStep({ overview: o }: { overview: KpiOverview }) {
  return (
    <ul className="space-y-2 text-sm">
      {KPI_STATUSES.map((s) => (
        <li key={s} className="flex items-center justify-between gap-3">
          <Link href={allKpisHref({ month: o.month, status: s })} className="font-medium">
            {KPI_STEP_NAMES[s]}
          </Link>
          <span className="font-semibold tabular-nums">{o.byStatus[s] ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

/** Each department's average final % and pillar %, of its scored scorecards (its teams' with it). */
function Departments({ overview: o }: { overview: KpiOverview }) {
  if (!o.departments.length) return <p className="px-5 pb-5 text-sm text-muted">None scored yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Department</th>
            <th scope="col" className="text-right">
              Scored
            </th>
            <th scope="col" className="text-right">
              Average
            </th>
            {KPI_PILLARS.map((p) => (
              <th key={p.id} scope="col" className="text-right" title={p.name}>
                {p.short} <span className="font-normal normal-case">{p.weight}%</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {o.departments.map((d) => (
            <tr key={d.id ?? d.name}>
              <td className="font-medium">{d.name}</td>
              <td className="text-right tabular-nums">{d.scored}</td>
              <td className="text-right font-semibold tabular-nums">{percentText(d.average)}</td>
              {KPI_PILLARS.map((p) => (
                <td key={p.id} className="text-right tabular-nums">
                  {percentText(d.pillars[p.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function All({ searchParams }: { searchParams: PageProps<'/kpis/all'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!seesAllKpis(user)) return <Empty>Only HR, the CEO and a Super Admin see every scorecard. Yours are on My KPIs.</Empty>;
  const status = readStatus(query);
  const department = readDepartment(query);
  const loaded = await loadOverview(readMonth(query));
  // HR opens last month's scorecards now, rather than on the 1st (owner's brief, 21 October 2026)
  const openMonth = kpiScorecardMonthOn(todayInCairo());
  const opener = hasRole(user, 'hr') && <OpenScorecardsForm action={openScorecards} monthName={kpiMonthName(openMonth)} />;
  if (loaded.kind !== 'ok') {
    return (
      <div className="space-y-4">
        {opener}
        <Empty>{kpiNotLoaded(loaded, 'KPI figures')}</Empty>
      </div>
    );
  }
  const o = loaded.value;
  const [scorecards, heatmap] = await Promise.all([
    loadScorecards({ scope: 'all', month: o.month, status, departmentId: department }),
    loadHeatmap({ scope: 'all', to: o.month, months: 6 }),
  ]);
  const monthName = kpiMonthName(o.month);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Filters overview={o} status={status} department={department} />
        <div className="flex flex-wrap items-start gap-3">
          {o.total > 0 && (
            <a href={kpiExcelHref(o.month)} className="btn btn-secondary no-underline">
              Download Excel
            </a>
          )}
          {opener}
        </div>
      </div>
      {o.hidden > 0 && (
        <p className="rounded-lg bg-white px-4 py-3 text-sm text-muted">
          C-level people are left out: {o.hidden === 1 ? 'one scorecard' : `${o.hidden} scorecards`}, which the CEO scores.
        </p>
      )}

      {o.total === 0 ? (
        <Empty>No scorecards for {monthName}. A month&apos;s scorecards open on the 1st of the next month for everyone whose job title has a published template.</Empty>
      ) : (
        <>
          <Figures overview={o} />
          <div className="grid items-start gap-4 lg:grid-cols-3">
            <section aria-labelledby="all-steps" className="card p-5">
              <h2 id="all-steps" className="font-semibold">
                {titleCase(`by step · ${monthName}`)}
              </h2>
              <div className="mt-3">
                <ByStep overview={o} />
              </div>
            </section>
            <section aria-labelledby="all-levels" className="card p-5 lg:col-span-2">
              <h2 id="all-levels" className="font-semibold">
                {titleCase(`levels · ${monthName}`)}
              </h2>
              <div className="mt-3">
                <LevelDistribution counts={o.distribution} />
              </div>
            </section>
          </div>
          <section aria-labelledby="all-departments" className="card">
            <h2 id="all-departments" className="px-5 pt-5 font-semibold">
              {titleCase(`pillar averages by department · ${monthName}`)}
            </h2>
            <div className="mt-3">
              <Departments overview={o} />
            </div>
          </section>
        </>
      )}

      {o.total > 0 && (
        <section aria-labelledby="all-scorecards" className="card">
          <h2 id="all-scorecards" className="px-5 pt-5 font-semibold">
            {titleCase(`scorecards of ${monthName}`)}
            {(status || department) && <span className="font-normal text-muted"> · filtered</span>}
          </h2>
          <div className="mt-3">
            {scorecards.kind !== 'ok' ? (
              <p className="px-5 pb-5 text-sm text-muted">{kpiNotLoaded(scorecards, 'scorecards')}</p>
            ) : scorecards.value.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">
                No scorecards match these filters. <Link href={allKpisHref({ month: o.month })}>Show all</Link>
              </p>
            ) : (
              <>
                <ScorecardsTable scorecards={scorecards.value} />
                <p className="border-t border-line px-5 py-3 text-sm text-muted">{scorecardsLabel(scorecards.value.length)}.</p>
              </>
            )}
          </div>
        </section>
      )}

      {heatmap.kind === 'ok' && heatmap.value.rows.length > 0 && (
        <section aria-labelledby="all-heatmap" className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-5">
            <h2 id="all-heatmap" className="font-semibold">
              Everyone by Month
            </h2>
            <span className="text-sm text-muted">Final % by month, coloured by level</span>
          </div>
          <div className="mt-3">
            <Heatmap heatmap={heatmap.value} label="Everyone’s final % by month" />
          </div>
        </section>
      )}
    </div>
  );
}

export default function AllKpisPage({ searchParams }: PageProps<'/kpis/all'>) {
  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">All KPIs</h1>
      <p className="mt-1 text-muted">
        Every KPI scorecard of a month: where each stands, HR&apos;s calibrations, the levels and each department&apos;s pillar averages. A
        month&apos;s scorecards open on the 1st of the next month and count in that month&apos;s payroll.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <All searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
