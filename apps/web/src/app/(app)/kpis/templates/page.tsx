import { kpiMonthName, kpiPillarsText, type KpiFrameworkView, type KpiTemplateRow } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { todayInCairo } from '../../employees/ui';
import { NotLoaded } from '../../organization/payroll/section';
import { Empty, Loading } from '../../organization/ui';
import { draftAllKpiTemplates, publishKpiDrafts, applyKpiVersionsNow } from './actions';
import { loadKpi } from './data';
import { DraftAllForm } from './draft-all';
import { oldPillarsBanner, ownPillarsCountText, pillarRowsOf, pillarsMonthOf } from './framework';
import { TemplatesTable } from './templates-table';
import { buildsKpiTemplates, draftAllConfirmText, groupTemplateRows, jobTitlesLabel, readsKpiTemplates, templateCounts } from './templates';

// KPI Templates, under KPIs in the sidebar (owner, 21 October 2026: "Templates: HR"; "Full framework per role"): every
// job title, by department and team, with its KPI template as it stands: the version in force (the one the scorecards
// opened now use), one published that opens from next month, its draft, how many versions and the people under it who
// get a scorecard; each opening its builder. The KPI settings, the deadlines of each month's steps ("a small KPI
// settings section"), were below until they moved to Organization → KPI Deadlines (owner, 23 October 2026: "Check-in
// Setup, KPI Pillars and deadlines, Recruitment and checklists, Templates"). HR and the Super Admin have it in the
// sidebar; the CEO and an Admin, whom the API answers too, may read it. The API checks every request again.
// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"): for HR and
// the Super Admin, "Draft templates for every job title" above the list, and "Publish selected drafts" on it.
// The KPI pillars (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully flexible"): in KPI
// Settings, the pillars in force and the next ones, HR's and the Super Admin's to change; over the list, how many
// templates use the old pillars, each marked, and that their scorecards keep opening on their old version until then.
// The pillars by department (owner, 22 October 2026: "but i need pillars to each department"): they moved to their own
// page, KPI Pillars; here a short card says the company's and how many departments have their own, with the link. A
// draft published now applies from its own pillars' first month when they are still to come (its department's, or the
// company's).

export const metadata: Metadata = { title: 'KPI Templates · People System' };

/** The job titles and, for those who build templates, drafting them all and publishing the drafts chosen. */
async function JobTitles({ user }: { user: SessionUser }) {
  const [loaded, framework] = await Promise.all([loadKpi<KpiTemplateRow[]>(KPI_API.templates), loadKpi<KpiFrameworkView>(KPI_API.framework)]);
  const builds = buildsKpiTemplates(user);
  // the pillars coming, if any: what a template published now is held back to, and the banner's month
  const next = framework.kind === 'ok' ? framework.value.next : null;
  const heading = (
    <h2 id="kpi-job-titles" className="text-lg font-semibold">
      Job Titles
    </h2>
  );
  if (loaded.kind !== 'ok') {
    return (
      <section aria-labelledby="kpi-job-titles" className="space-y-3">
        {heading}
        <NotLoaded what="the KPI templates" loaded={loaded} />
      </section>
    );
  }
  const rows = loaded.value;
  const counts = templateCounts(rows);
  const banner = oldPillarsBanner(counts.oldPillars);
  return (
    <>
      {banner && (
        <p role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">
          {banner}
        </p>
      )}
      {builds && rows.length > 0 && <DraftAllForm action={draftAllKpiTemplates} confirmText={draftAllConfirmText(counts.none)} withoutTemplate={counts.none} />}
      <section aria-labelledby="kpi-job-titles" className="space-y-3">
        {heading}
        {rows.length === 0 ? (
          <Empty>No job titles yet.</Empty>
        ) : (
          <>
            <p className="text-sm text-muted">
              {jobTitlesLabel(counts.jobTitles)}: {counts.inForce} with a version in force, {counts.upcoming} with one opening next month, {counts.drafts} with a draft
              {counts.none ? `, ${counts.none} without a template yet` : ''}.
            </p>
            <TemplatesTable
              groups={groupTemplateRows(rows)}
              publish={builds ? publishKpiDrafts : null}
              applyNow={builds ? applyKpiVersionsNow : null}
              today={todayInCairo()}
              pillarsFrom={next?.appliesFrom ?? null}
              draftPillarsFrom={framework.kind === 'ok' ? draftPillarsMonths(rows, framework.value) : {}}
            />
          </>
        )}
      </section>
    </>
  );
}

// ---------- the KPI pillars ----------

/** Each draft's (by its id) pillars' first month while they are still to come (its department's, or the company's). */
function draftPillarsMonths(rows: readonly KpiTemplateRow[], view: KpiFrameworkView): Record<string, string | null> {
  return Object.fromEntries(rows.flatMap((r) => (r.draft ? [[r.draft.id, pillarsMonthOf(view, pillarRowsOf(view, r.jobTitle.department))]] : [])));
}

/** The pillars, now on their own page: the company's in words, how many departments have their own, the link. */
async function KpiPillarsCard() {
  const loaded = await loadKpi<KpiFrameworkView>(KPI_API.framework);
  return (
    <section id="kpi-framework" aria-labelledby="kpi-framework-heading" className="card scroll-mt-6 space-y-2 p-6">
      <h2 id="kpi-framework-heading" className="text-lg font-semibold">
        KPI Pillars
      </h2>
      {loaded.kind !== 'ok' ? (
        <NotLoaded what="the KPI pillars" loaded={loaded} />
      ) : (
        <p className="max-w-3xl text-sm text-muted">
          The company’s: {kpiPillarsText(loaded.value.inForce)}.
          {loaded.value.next ? ` New ones apply from ${kpiMonthName(loaded.value.next.appliesFrom)}’s scorecards.` : ''} {ownPillarsCountText(loaded.value)}
        </p>
      )}
      <p className="text-sm">
        <Link href={KPI_PATHS.pillars}>Open KPI Pillars</Link>
      </p>
    </section>
  );
}

// ---------- the page ----------

async function KpiTemplates() {
  const user = await getCurrentUser();
  if (!readsKpiTemplates(user)) return <Empty>Only HR and the Super Admin build KPI templates.</Empty>;
  return (
    <div className="space-y-8">
      <Suspense fallback={<Loading />}>
        <JobTitles user={user} />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <KpiPillarsCard />
      </Suspense>
    </div>
  );
}

export default function KpiTemplatesPage() {
  return (
    <div className="space-y-6">
      <h1 className="page-title">KPI Templates</h1>
      <Suspense fallback={<Loading />}>
        <KpiTemplates />
      </Suspense>
    </div>
  );
}
