import { KPI_PILLARS, KPI_SETTING_LABELS, type KpiSettingsView, type KpiTemplateRow } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { titleCase } from '@/lib/format';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import type { SessionUser } from '@/lib/types';
import { NotLoaded, SettingRow } from '../../organization/payroll/section';
import { dayOfMonth } from '../../organization/payroll/settings';
import { Empty, Loading } from '../../organization/ui';
import { updateKpiSettings } from './actions';
import { loadKpi } from './data';
import { KpiSettingsForm } from './settings-form';
import {
  buildsKpiTemplates,
  groupTemplateRows,
  jobTitlesLabel,
  peopleLabel,
  readsKpiTemplates,
  SETTING_KEYS,
  settingsChangedText,
  templateCounts,
  templateRowText,
} from './templates';

// KPI Templates, under KPIs in the sidebar (owner, 21 October 2026: "Templates: HR"; "Full framework per role"): every
// job title, by department and team, with its KPI template as it stands: the version in force (the one the scorecards
// opened now use), one published that opens from next month, its draft, how many versions and the people under it who
// get a scorecard; each opening its builder. Below, the KPI settings: the deadlines of each month's steps ("a small KPI
// settings section"), HR's and the Super Admin's to change. HR and the Super Admin have it in the sidebar; the CEO and
// an Admin, whom the API answers too, may read it. The API checks every request again.

export const metadata: Metadata = { title: 'KPI Templates · People System' };

const none = <span className="text-muted">—</span>;
const SPAN = 6;

function TemplateRow({ row }: { row: KpiTemplateRow }) {
  const text = templateRowText(row);
  const nothing = !text.inForce && !text.upcoming && !text.draft;
  return (
    <tr>
      <td className="min-w-56">
        <Link href={KPI_PATHS.template(row.jobTitle.id)} className="font-semibold">
          {row.jobTitle.titleEn}
        </Link>
        {nothing && <span className="block text-xs text-muted">No KPI template yet</span>}
      </td>
      <td className="min-w-48 text-sm">
        {text.inForce ? (
          <>
            <span className="badge bg-ok-soft text-ok">In force</span>
            <span className="mt-1 block">{text.inForce}</span>
          </>
        ) : (
          none
        )}
      </td>
      <td className="min-w-44 text-sm">
        {text.upcoming ? (
          <>
            <span className="badge">Upcoming</span>
            <span className="mt-1 block">{text.upcoming}</span>
          </>
        ) : (
          none
        )}
      </td>
      <td className="min-w-40 text-sm">
        {text.draft ? (
          <>
            <span className="badge bg-warn-soft text-warn">Draft</span>
            <span className="mt-1 block">{text.draft}</span>
          </>
        ) : (
          none
        )}
      </td>
      <td className="text-right tabular-nums">{row.versions}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{peopleLabel(row.people)}</td>
    </tr>
  );
}

async function TemplatesList() {
  const loaded = await loadKpi<KpiTemplateRow[]>(KPI_API.templates);
  if (loaded.kind !== 'ok') return <NotLoaded what="the KPI templates" loaded={loaded} />;
  const rows = loaded.value;
  if (rows.length === 0) return <Empty>No job titles yet: add them on Organization → Departments &amp; Job Titles.</Empty>;
  const counts = templateCounts(rows);
  const groups = groupTemplateRows(rows);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {jobTitlesLabel(counts.jobTitles)}: {counts.inForce} with a version in force, {counts.upcoming} with one opening next month, {counts.drafts} with a draft
        {counts.none ? `, ${counts.none} without a template yet` : ''}.
      </p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Job title</th>
              <th scope="col">In force</th>
              <th scope="col">Upcoming</th>
              <th scope="col">Draft</th>
              <th scope="col" className="text-right">
                Versions
              </th>
              <th scope="col" className="text-right">
                People
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.department}>
              <tr>
                <th colSpan={SPAN} scope="colgroup" className="bg-canvas py-2.5 text-left text-sm tracking-normal text-ink normal-case">
                  <span className="sticky left-4 inline-flex flex-wrap items-baseline gap-x-2">
                    {titleCase(g.department)}
                    <span className="text-xs font-normal text-muted">{jobTitlesLabel(g.count)}</span>
                  </span>
                </th>
              </tr>
              {g.teams.map((t) => (
                <Fragment key={t.team ?? ''}>
                  {t.team !== null && (
                    <tr>
                      <th colSpan={SPAN} scope="colgroup" className="bg-card py-2 text-left text-sm font-medium tracking-normal text-muted normal-case">
                        <span className="sticky left-4 inline-flex pl-4">{titleCase(t.team)}</span>
                      </th>
                    </tr>
                  )}
                  {t.rows.map((r) => (
                    <TemplateRow key={r.jobTitle.id} row={r} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
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
          with.{buildsKpiTemplates(user) ? ' Open a job title to build its template, from a sample or another job title’s if you like.' : ''}
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
      <section aria-labelledby="kpi-job-titles" className="space-y-3">
        <h2 id="kpi-job-titles" className="text-lg font-semibold">
          Job Titles
        </h2>
        <Suspense fallback={<Loading />}>
          <TemplatesList />
        </Suspense>
      </section>
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
