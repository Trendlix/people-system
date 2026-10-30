import type { Metadata } from 'next';
import { Suspense } from 'react';
import { kpiMonthName, kpiScorecardMonthOn, type KpiHeatmap } from '@trendlix/shared';
import { Select } from '@/components/select';
import { titleCase } from '@/lib/format';
import { KPI_PATHS } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { kpiNotLoaded, loadHeatmap, loadScorecards, loadWaitingScorecards } from '../data';
import { scoredText } from '../heatmap';
import { readMonth, scorecardsLabel, teamWaiting } from '../scorecard';
import { Heatmap, LevelDistribution, ScorecardsTable } from '../ui';

// Team KPIs (owner's brief, 21 October 2026: "Team KPIs (managers): their people's scorecards to score, and a team
// overview heatmap (people × months, final % coloured by level) with the level distribution"): the scorecards waiting
// for the caller to score or to sign as the manager; a month's scorecards of the people they score (the person in
// charge: direct manager, else team lead, else head of department; the CEO's are the C-level people's, owner, 21
// October 2026: "For C-level people the CEO scores"); and the team's heatmap over six months with the last month's
// levels. The API answers for the caller alone.

export const metadata: Metadata = { title: 'Team KPIs · People System' };

const MONTHS = 6;

/** The month shown: one of the heatmap's months, newest first, and the one asked for. */
function MonthPicker({ month, months }: { month: string; months: string[] }) {
  const choices = [...new Set([month, ...months])].sort().reverse();
  return (
    <form key={month} action={KPI_PATHS.team} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="team-kpi-month" className="label">
          Month
        </label>
        <Select id="team-kpi-month" name="month" defaultValue={month} className="input min-w-48">
          {choices.map((m) => (
            <option key={m} value={m}>
              {kpiMonthName(m)}
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

function Overview({ heatmap }: { heatmap: KpiHeatmap }) {
  const d = heatmap.distribution;
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="team-heatmap" className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-5">
          <h2 id="team-heatmap" className="font-semibold">
            Team Overview
          </h2>
          <span className="text-sm text-muted">Final % by month, coloured by level</span>
        </div>
        <div className="mt-3">
          <Heatmap heatmap={heatmap} label="Your people’s final % by month" />
        </div>
      </section>
      <section aria-labelledby="team-levels" className="card p-5">
        <h2 id="team-levels" className="font-semibold">
          {titleCase(`levels · ${kpiMonthName(d.month)}`)}
        </h2>
        <div className="mt-3">
          <LevelDistribution counts={d.counts} caption={scoredText(d.scored, d.total)} />
        </div>
      </section>
    </div>
  );
}

async function Team({ searchParams }: { searchParams: PageProps<'/kpis/team'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  const asked = readMonth(query);
  const [waiting, heatmap] = await Promise.all([loadWaitingScorecards(), loadHeatmap({ scope: 'team', to: asked, months: MONTHS })]);
  const map = heatmap.kind === 'ok' ? heatmap.value : null;
  const month = asked ?? map?.months.at(-1) ?? kpiScorecardMonthOn(todayInCairo());
  const scorecards = await loadScorecards({ scope: 'team', month });
  const mine = waiting.kind === 'ok' ? teamWaiting(waiting.value, user.employeeId) : [];

  if (heatmap.kind === 'unavailable' && scorecards.kind === 'unavailable') return <Empty>{kpiNotLoaded(heatmap, 'scorecards')}</Empty>;

  return (
    <div className="space-y-6">
      {mine.length > 0 && (
        <section aria-labelledby="team-waiting" className="card border-accent/40">
          <h2 id="team-waiting" className="px-5 pt-5 font-semibold">
            Waiting for You <span className="font-normal text-muted tabular-nums">· {mine.length}</span>
          </h2>
          <p className="px-5 text-sm text-muted">Score the month, or sign that you have read it as the manager.</p>
          <div className="mt-3">
            <ScorecardsTable scorecards={mine} showMonth />
          </div>
        </section>
      )}
      {waiting.kind === 'failed' && <Empty>{kpiNotLoaded(waiting, 'scorecards waiting for you')}</Empty>}

      <section aria-labelledby="team-month" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="team-month" className="text-lg font-semibold">
            {titleCase(`scorecards of ${kpiMonthName(month)}`)}
          </h2>
          <MonthPicker month={month} months={map?.months ?? []} />
        </div>
        {scorecards.kind !== 'ok' ? (
          <Empty>{kpiNotLoaded(scorecards, 'scorecards')}</Empty>
        ) : scorecards.value.length === 0 ? (
          <Empty>No scorecards of your people for {kpiMonthName(month)}. They open on the 1st of the next month for everyone whose job title has a published template.</Empty>
        ) : (
          <div className="card">
            <ScorecardsTable scorecards={scorecards.value} />
            <p className="border-t border-line px-5 py-3 text-sm text-muted">{scorecardsLabel(scorecards.value.length)}.</p>
          </div>
        )}
      </section>

      {map ? map.rows.length > 0 && <Overview heatmap={map} /> : heatmap.kind !== 'ok' && <Empty>{kpiNotLoaded(heatmap, 'team overview')}</Empty>}
    </div>
  );
}

export default function TeamKpisPage({ searchParams }: PageProps<'/kpis/team'>) {
  return (
    <div className="max-w-7xl">
      <h1 className="page-title">Team KPIs</h1>
      <p className="mt-1 text-muted">
        The monthly KPI scorecards of the people you are in charge of. Each person rates themself first; you score the month, seeing their
        self-rating; HR calibrates it; then you both sign that you have read it. A missed self-rating doesn&apos;t hold up your scoring.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Team searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
