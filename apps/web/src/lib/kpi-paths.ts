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
  /**
   * GET (everyone): KpiFrameworkView, the company's pillars in force and the next ones, and each department's; PUT
   * KpiFrameworkInput, the company's or a department's (HR, Super Admin).
   */
  framework: '/kpis/framework',
  /** GET: KpiTemplateRow[] (HR, the CEO, Admin, Super Admin). */
  templates: '/kpis/templates',
  /** GET: KpiSampleView[] (HR, Super Admin). */
  samples: '/kpis/templates/samples',
  /** GET: KpiLibraryRole[], the KPI role library's roles (HR, Super Admin). */
  library: '/kpis/templates/library',
  /** POST → KpiDraftAllResult: a draft from the library for every job title without a template (HR, Super Admin). */
  draftAll: '/kpis/templates/draft-all',
  /** POST { templateIds } → KpiPublishDraftsResult: publishes the drafts chosen that pass (HR, Super Admin). */
  publishDrafts: '/kpis/templates/publish-drafts',
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
  /**
   * Practice scorecards (owner, 22 October 2026: "Practice scorecards"; packages/shared kpi-practice.ts): GET
   * KpiPracticeRow[] (HR, Super Admin); POST KpiPracticeStartInput → KpiScorecardView (the new one).
   */
  practice: '/kpis/practice',
  /** DELETE → KpiPracticeDeleted: every practice scorecard, or only the caller's (`mine`); a Super Admin only. */
  practiceAll: (mine: boolean) => `/kpis/practice${q({ mine: mine ? 'true' : null })}`,
  /** GET: KpiPracticeChoices, whom a practice scorecard may be started for, with their months and versions. */
  practiceChoices: '/kpis/practice/choices',
  /** DELETE → 204: one practice scorecard (a Super Admin only; never a real one). */
  practiceCard: (id: string) => `/kpis/practice/${encodeURIComponent(id)}`,
  /** The steps stood in for on a practice scorecard (its starter, a Super Admin): POST KpiPicksInput → KpiScorecardView. */
  practiceSelf: (id: string) => `/kpis/practice/${encodeURIComponent(id)}/self`,
  practiceScore: (id: string) => `/kpis/practice/${encodeURIComponent(id)}/score`,
  /** POST KpiCalibrateInput → KpiScorecardView. */
  practiceCalibrate: (id: string) => `/kpis/practice/${encodeURIComponent(id)}/calibrate`,
  /** POST KpiPracticeSignInput → KpiScorecardView. */
  practiceSign: (id: string) => `/kpis/practice/${encodeURIComponent(id)}/sign`,
} as const;

/** The site's KPI pages. */
export const KPI_PATHS = {
  /** My KPIs: this month's scorecard to rate, and the history. */
  mine: '/kpis',
  /** Team KPIs: the scorecards to score, and the team's heatmap. */
  team: '/kpis/team',
  /** All KPIs: HR's, the CEO's and the Super Admin's month. */
  all: '/kpis/all',
  /** KPI Templates: the job titles and their templates. */
  templates: '/kpis/templates',
  /** A job title's template builder. */
  template: (jobTitleId: string) => `/kpis/templates/${encodeURIComponent(jobTitleId)}`,
  /**
   * KPI Pillars (owner, 22 October 2026: "but i need pillars to each department"): the company's pillars and each
   * department's. Under Organization, in the setup menu's Performance, since 23 October 2026 (owner: "Check-in Setup, KPI
   * Pillars and deadlines, Recruitment and checklists, Templates"); /kpis/pillars redirects there (lib/moved-pages.ts).
   */
  pillars: '/organization/kpi-pillars',
  /** A department's own pillars, or its going back to the company's. */
  departmentPillars: (departmentId: string) => `/organization/kpi-pillars/${encodeURIComponent(departmentId)}`,
  /** KPI Deadlines: the day of the month each step is due by, a section of KPI Templates until 23 October 2026. */
  deadlines: '/organization/kpi-deadlines',
  /** A scorecard. */
  scorecard: (id: string) => `/kpis/scorecards/${encodeURIComponent(id)}`,
  /**
   * Practice scorecards (owner, 22 October 2026: "Practice scorecards"): a tab of All KPIs for HR and the Super Admin,
   * so the sidebar keeps All KPIs lit.
   */
  practice: '/kpis/all/practice',
} as const;
