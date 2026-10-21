// The KPIs module's addresses (owner, 21 October 2026: "lets start with the KPI's First"): the API's (the web server
// calls them with lib/api.ts) and the site's pages. The rules and the API's answers are packages/shared kpis.ts. Pure
// code, no "@/" imports: the tests read it.

const q = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

/** The API's KPI endpoints (all under /api, as lib/api.ts adds it). */
export const KPI_API = {
  /** GET: KpiCounts, what waits for the caller (the sidebar's, Approvals' and the phone's counts). */
  counts: '/kpis/counts',
  /** GET (everyone) and PATCH (HR, Super Admin): KpiSettingsView. */
  settings: '/kpis/settings',
  /** GET: KpiTemplateRow[] (HR, the CEO, Admin, Super Admin). */
  templates: '/kpis/templates',
  /** GET: KpiSampleView[] (HR, Super Admin). */
  samples: '/kpis/templates/samples',
  /** GET: KpiJobTitleTemplates. */
  jobTitleTemplates: (jobTitleId: string) => `/kpis/templates/job-titles/${encodeURIComponent(jobTitleId)}`,
  /** POST KpiDraftSource → KpiTemplateView (the new draft). */
  newDraft: (jobTitleId: string) => `/kpis/templates/job-titles/${encodeURIComponent(jobTitleId)}/draft`,
  /** GET KpiTemplateView; PUT KpiTemplateContent (a draft) → KpiTemplateView; DELETE a draft (Super Admin) → 204. */
  template: (id: string) => `/kpis/templates/${encodeURIComponent(id)}`,
  /** POST → KpiTemplateView (published). */
  publish: (id: string) => `/kpis/templates/${encodeURIComponent(id)}/publish`,
  /** GET: KpiScorecardSummary[], the caller's own, newest first. */
  mine: '/kpis/scorecards/mine',
  /** GET: KpiScorecardSummary[] waiting for the caller (their own too), the nearest deadline first. */
  waiting: '/kpis/scorecards/waiting',
  /** GET: KpiScorecardSummary[]: scope team (those the caller scores) or all (HR, the CEO, Super Admin). */
  scorecards: (params: { scope: 'team' | 'all'; month?: string | null; status?: string | null; departmentId?: string | null }) => `/kpis/scorecards${q(params)}`,
  /** GET: KpiScorecardView. */
  scorecard: (id: string) => `/kpis/scorecards/${encodeURIComponent(id)}`,
  /** POST KpiPicksInput → KpiScorecardView. */
  self: (id: string) => `/kpis/scorecards/${encodeURIComponent(id)}/self`,
  /** POST KpiPicksInput → KpiScorecardView. */
  score: (id: string) => `/kpis/scorecards/${encodeURIComponent(id)}/score`,
  /** POST KpiCalibrateInput → KpiScorecardView. */
  calibrate: (id: string) => `/kpis/scorecards/${encodeURIComponent(id)}/calibrate`,
  /** POST KpiSignInput → KpiScorecardView. */
  sign: (id: string) => `/kpis/scorecards/${encodeURIComponent(id)}/sign`,
  /** GET: KpiHeatmap, the `months` months up to `to` (YYYY-MM; default: the latest month with scorecards). */
  heatmap: (params: { scope: 'team' | 'all'; to?: string | null; months?: number | null }) => `/kpis/heatmap${q(params)}`,
  /** GET: KpiOverview of a month (default: the latest with scorecards). */
  overview: (month?: string | null) => `/kpis/overview${q({ month })}`,
  /** GET: the month's scorecards as an Excel workbook (HR, the CEO, Super Admin). */
  export: (month: string) => `/kpis/export${q({ month })}`,
  /** POST → KpiOpenResult: opens last month's scorecards now (HR). */
  open: '/kpis/open',
} as const;

/** The site's KPI pages. */
export const KPI_PATHS = {
  /** My KPIs: this month's scorecard to rate, and the history. */
  mine: '/kpis',
  /** Team KPIs: the scorecards to score, and the team's heatmap. */
  team: '/kpis/team',
  /** All KPIs: HR's, the CEO's and the Super Admin's month. */
  all: '/kpis/all',
  /** KPI Templates: the job titles and their templates, and the KPI settings. */
  templates: '/kpis/templates',
  /** A job title's template builder. */
  template: (jobTitleId: string) => `/kpis/templates/${encodeURIComponent(jobTitleId)}`,
  /** A scorecard. */
  scorecard: (id: string) => `/kpis/scorecards/${encodeURIComponent(id)}`,
} as const;
