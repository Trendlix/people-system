import 'server-only';
import { cache } from 'react';
import type { KpiHeatmap, KpiOverview, KpiScorecardSummary, KpiScorecardView } from '@trendlix/shared';
import { KPI_API } from '@/lib/kpi-paths';
import { loadJson, type Loaded } from '../payroll/load';

// Reading the KPI scorecards (owner, 21 October 2026: "lets start with the KPI's First"): the caller's own (My KPIs),
// what waits for them (My KPIs, Team KPIs, the phone's Home, My Requests and To Approve), their people's and everyone's
// (Team KPIs, All KPIs), one scorecard for its page, the heatmap and HR's overview. An API from before the KPIs answers
// 404, which here means "not available yet" rather than the 404 page, so the rest of the page keeps working.

export type { Loaded };

/** GET /kpis/scorecards/mine: the caller's own, newest first (none without an employee profile). Read once a request. */
export const loadMyScorecards = cache(() => loadJson<KpiScorecardSummary[]>(KPI_API.mine));

/** GET /kpis/scorecards/waiting: what waits for the caller, their own too, the nearest deadline first. Read once a request. */
export const loadWaitingScorecards = cache(() => loadJson<KpiScorecardSummary[]>(KPI_API.waiting));

/** GET /kpis/scorecards?scope=…: those the caller scores (team), or everyone's for HR, the CEO and a Super Admin (all). */
export function loadScorecards(params: Parameters<typeof KPI_API.scorecards>[0]): Promise<Loaded<KpiScorecardSummary[]>> {
  return loadJson<KpiScorecardSummary[]>(KPI_API.scorecards(params));
}

/** GET /kpis/scorecards/:id: for its employee, its scorer, HR (not a C-level person's), the CEO and a Super Admin; else 404. */
export function loadScorecard(id: string): Promise<Loaded<KpiScorecardView>> {
  return loadJson<KpiScorecardView>(KPI_API.scorecard(id));
}

/** GET /kpis/heatmap: people × months, and the last month's level distribution. */
export function loadHeatmap(params: Parameters<typeof KPI_API.heatmap>[0]): Promise<Loaded<KpiHeatmap>> {
  return loadJson<KpiHeatmap>(KPI_API.heatmap(params));
}

/** GET /kpis/overview: a month's figures for HR, the CEO and a Super Admin (default: the latest with scorecards). */
export function loadOverview(month: string | null): Promise<Loaded<KpiOverview>> {
  return loadJson<KpiOverview>(KPI_API.overview(month));
}

/** What a KPI page says in place of what it couldn't load. */
export function kpiNotLoaded(loaded: Exclude<Loaded<unknown>, { kind: 'ok' }>, what: string): string {
  if (loaded.kind === 'unavailable') return 'Not available yet: the server does not have KPIs yet. Please try again after its next update.';
  if (loaded.kind === 'forbidden') return `You can't see the ${what}.`;
  return `The ${what} could not be loaded. ${loaded.messages.join(' ')}`;
}
