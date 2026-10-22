import { kpiMonthName, type KpiFrameworkView } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { formatDate, titleCase } from '@/lib/format';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../../employees/ui';
import { NotLoaded } from '../../../organization/payroll/section';
import { BackLink, Empty, Loading, UUID } from '../../../organization/ui';
import { saveKpiFramework } from '../../templates/actions';
import { loadKpi } from '../../templates/data';
import { companyNewest, departmentRow, inForceText, jobTitlesCount, nextText } from '../../templates/framework';
import { buildsKpiTemplates, readsKpiTemplates } from '../../templates/templates';
import { DepartmentPillarsChoice } from '../department-choice';
import { FrameworkVersion, PillarsList } from '../ui';

// A department's KPI pillars (owner, 22 October 2026: "but i need pillars to each department / wights can be changed
// for each department and Job title"): those it takes now (its own, or the company's) and its next change, then, for HR
// and the Super Admin, its own pillars to set or change (the same form as the company's, from a month, next month
// unless chosen) or going back to the company's from a month. Its job titles' templates place their metrics in them;
// a team's job titles take its pillars. The API checks every request again.

export const metadata: Metadata = { title: 'Department KPI Pillars · People System' };

async function DepartmentPillars({ params }: { params: PageProps<'/kpis/pillars/[departmentId]'>['params'] }) {
  const { departmentId } = await params;
  if (!UUID.test(departmentId)) notFound();
  const user = await getCurrentUser();
  if (!readsKpiTemplates(user)) return <Empty>Only HR and the Super Admin set the KPI pillars.</Empty>;
  const loaded = await loadKpi<KpiFrameworkView>(KPI_API.framework);
  if (loaded.kind !== 'ok') return <NotLoaded what="the KPI pillars" loaded={loaded} />;
  const view = loaded.value;
  const row = departmentRow(view, departmentId);
  if (!row) {
    return (
      <div className="space-y-4">
        <BackLink href={KPI_PATHS.pillars}>KPI Pillars</BackLink>
        <Empty>This department could not be found among the departments. A team takes its department’s pillars.</Empty>
      </div>
    );
  }
  const name = titleCase(row.department.nameEn);
  const company = companyNewest(view);
  return (
    <div className="space-y-6">
      <BackLink href={KPI_PATHS.pillars}>KPI Pillars</BackLink>
      <div>
        <p className="text-sm text-muted">KPI pillars</p>
        <h1 className="text-2xl font-semibold">{name}</h1>
        <p className="mt-1 text-sm text-muted">
          {jobTitlesCount(row.jobTitles)}, its teams’ included
          {row.oldTemplates > 0 ? `; ${row.oldTemplates === 1 ? '1 template uses' : `${row.oldTemplates} templates use`} the old pillars` : ''}.{' '}
          <Link href={KPI_PATHS.templates}>KPI Templates</Link>
        </p>
      </div>

      <section aria-labelledby="department-pillars-now" className="card space-y-5 p-6">
        <h2 id="department-pillars-now" className="text-lg font-semibold">
          Its Pillars
        </h2>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {row.inForce ? (
            <FrameworkVersion title="In Force" version={row.inForce} note={`Its own. ${inForceText(row.inForce)}`} />
          ) : (
            <div className="space-y-2">
              <h3 className="font-semibold">In Force</h3>
              <p className="text-sm text-muted">The company’s pillars.</p>
              <PillarsList version={view.inForce} />
            </div>
          )}
          {row.next ? (
            row.next.followsCompany ? (
              <div className="space-y-2">
                <h3 className="font-semibold">Next</h3>
                <p className="text-sm text-muted">
                  Back to the company’s pillars from {kpiMonthName(row.next.appliesFrom)}’s scorecards, which open on {formatDate(row.next.opensFrom)}. It can be
                  changed until then.
                </p>
                <PillarsList version={company} />
              </div>
            ) : (
              <FrameworkVersion title="Next" version={row.next} note={`Its own. ${nextText(row.next)}`} />
            )
          ) : (
            <p className="text-sm text-muted lg:pt-8">No change of its pillars is coming.</p>
          )}
        </div>
      </section>

      {buildsKpiTemplates(user) && (
        <section aria-labelledby="department-pillars-change" className="card space-y-5 p-6">
          <div>
            <h2 id="department-pillars-change" className="text-lg font-semibold">
              Change Its Pillars
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              Its own pillars replace the company’s for its job titles, its teams’ included. Each template of its job titles must then place its metrics in
              them; until it does, its scorecards keep opening on its old version and old pillars.
            </p>
          </div>
          <DepartmentPillarsChoice view={view} department={{ id: row.department.id, name, row }} action={saveKpiFramework} today={todayInCairo()} />
        </section>
      )}
    </div>
  );
}

export default function DepartmentPillarsPage({ params }: PageProps<'/kpis/pillars/[departmentId]'>) {
  return (
    <div className="max-w-6xl">
      <Suspense fallback={<Loading />}>
        <DepartmentPillars params={params} />
      </Suspense>
    </div>
  );
}
