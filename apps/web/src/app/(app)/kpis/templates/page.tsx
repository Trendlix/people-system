import { KPI_PILLARS, KPI_SETTING_LABELS, type KpiSettingsView, type KpiTemplateRow } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Fragment, Suspense } from 'react';
import { KPI_API } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { todayInCairo } from '../../employees/ui';
import { NotLoaded, SettingRow } from '../../organization/payroll/section';
import { dayOfMonth } from '../../organization/payroll/settings';
import { Empty, Loading } from '../../organization/ui';
import { draftAllKpiTemplates, publishKpiDrafts, updateKpiSettings } from './actions';
import { loadKpi } from './data';
import { DraftAllForm } from './draft-all';
import { KpiSettingsForm } from './settings-form';
import { TemplatesTable } from './templates-table';
import {
  buildsKpiTemplates,
  draftAllConfirmText,
  groupTemplateRows,
  jobTitlesLabel,
  readsKpiTemplates,
  SETTING_KEYS,
  settingsChangedText,
  templateCounts,
} from './templates';

// KPI Templates, under KPIs in the sidebar (owner, 21 October 2026: "Templates: HR"; "Full framework per role"): every
// job title, by department and team, with its KPI template as it stands: the version in force (the one the scorecards
// opened now use), one published that opens from next month, its draft, how many versions and the people under it who
// get a scorecard; each opening its builder. Below, the KPI settings: the deadlines of each month's steps ("a small KPI
// settings section"), HR's and the Super Admin's to change. HR and the Super Admin have it in the sidebar; the CEO and
// an Admin, whom the API answers too, may read it. The API checks every request again.
// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"): for HR and
// the Super Admin, "Draft templates for every job title" above the list, and "Publish selected drafts" on it.

export const metadata: Metadata = { title: 'KPI Templates · People System' };

/** The job titles and, for those who build templates, drafting them all and publishing the drafts chosen. */
async function JobTitles({ user }: { user: SessionUser }) {
  const loaded = await loadKpi<KpiTemplateRow[]>(KPI_API.templates);
  const builds = buildsKpiTemplates(user);
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
  return (
    <>
      {builds && rows.length > 0 && <DraftAllForm action={draftAllKpiTemplates} confirmText={draftAllConfirmText(counts.none)} withoutTemplate={counts.none} />}
      <section aria-labelledby="kpi-job-titles" className="space-y-3">
        {heading}
        {rows.length === 0 ? (
          <Empty>No job titles yet: add them on Organization → Departments &amp; Job Titles.</Empty>
        ) : (
          <>
            <p className="text-sm text-muted">
              {jobTitlesLabel(counts.jobTitles)}: {counts.inForce} with a version in force, {counts.upcoming} with one opening next month, {counts.drafts} with a draft
              {counts.none ? `, ${counts.none} without a template yet` : ''}.
            </p>
            <TemplatesTable groups={groupTemplateRows(rows)} publish={builds ? publishKpiDrafts : null} today={todayInCairo()} />
          </>
        )}
      </section>
    </>
  );
}

// ---------- the KPI settings ----------

const SETTINGS_INTRO =
  'Each month’s scorecard opens on the 1st of the next month (October’s on the 1st of November), and each step is due by a day of that month. A self-rating not sent by its day doesn’t hold up the manager, and a scorecard not signed by the sign-off day is final anyway; each is noted on it. One reminder goes the day before each deadline.';

async function KpiSettingsSection({ user }: { user: SessionUser }) {
  const loaded = await loadKpi<KpiSettingsView>(KPI_API.settings);
  const changed = loaded.kind === 'ok' ? settingsChangedText(loaded.value) : null;
  return (
    <section id="kpi-settings" aria-labelledby="kpi-settings-heading" className="card scroll-mt-6 p-6">
      <h2 id="kpi-settings-heading" className="text-lg font-semibold">
        KPI Settings
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">{SETTINGS_INTRO}</p>
      <div className="mt-5">
        {loaded.kind !== 'ok' ? (
          <NotLoaded what="the KPI settings" loaded={loaded} />
        ) : buildsKpiTemplates(user) ? (
          <KpiSettingsForm action={updateKpiSettings} settings={loaded.value} />
        ) : (
          <dl>
            {SETTING_KEYS.map((k) => (
              <SettingRow key={k} label={KPI_SETTING_LABELS[k]}>
                {dayOfMonth(loaded.value[k])} of the next month
              </SettingRow>
            ))}
          </dl>
        )}
        {changed && <p className="mt-4 text-xs text-muted">{changed}</p>}
      </div>
    </section>
  );
}

// ---------- the page ----------

async function KpiTemplates() {
  const user = await getCurrentUser();
  if (!readsKpiTemplates(user)) return <Empty>Only HR and the Super Admin build KPI templates.</Empty>;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="max-w-3xl text-sm text-muted">
          Every job title gets its own KPI template, built from its job description: metrics in four pillars with fixed weights, each with a points scale, one
          criterion picked a month. A version published applies to the scorecards opened from the next month on; a scorecard keeps the version it opened
          with.
          {buildsKpiTemplates(user)
            ? ' Draft every job title at once from the KPI role library, or open a job title to build its template, from a library role, a sample or another job title’s.'
            : ''}
        </p>
        <p className="text-sm">
          {KPI_PILLARS.map((p, i) => (
            <Fragment key={p.id}>
              {i > 0 && <span className="text-muted"> · </span>}
              <span className="font-medium">{p.name}</span> <span className="text-muted tabular-nums">{p.weight}%</span>
            </Fragment>
          ))}
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <JobTitles user={user} />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <KpiSettingsSection user={user} />
      </Suspense>
    </div>
  );
}

export default function KpiTemplatesPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold">KPI Templates</h1>
      <Suspense fallback={<Loading />}>
        <KpiTemplates />
      </Suspense>
    </div>
  );
}
