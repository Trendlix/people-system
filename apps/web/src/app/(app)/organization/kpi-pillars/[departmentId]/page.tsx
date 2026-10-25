import { kpiMonthName, type KpiFrameworkView } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { formatDate, titleCase } from '@/lib/format';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../../employees/ui';
import { NotLoaded } from '../../payroll/section';
import { BackLink, Empty, Loading, UUID } from '../../ui';
import { saveKpiFramework } from '../../../kpis/templates/actions';
import { loadKpi } from '../../../kpis/templates/data';
import { aboveRow, attendanceInKpiOf, companyNewest, departmentRow, effectiveNewest, inForceText, jobTitlesCount, nextText } from '../../../kpis/templates/framework';
import { buildsKpiTemplates, readsKpiTemplates } from '../../../kpis/templates/templates';
import { DepartmentPillarsChoice } from '../department-choice';
import { FrameworkVersion, PillarsList } from '../ui';

// A department's KPI pillars (owner, 22 October 2026: "but i need pillars to each department / wights can be changed
// for each department and Job title"): those it takes now (its own, or the company's) and its next change, then, for HR
// and the Super Admin, its own pillars to set or change (the same form as the company's, from a month, next month
// unless chosen) or going back to the company's from a month. Its job titles' templates place their metrics in them;
// a team's job titles take its pillars unless the team has its own. A team's page the same way (owner, 22 October 2026:
// "Yes, add team pillars"), with its department's pillars in place of the company's. The API checks every request again.

export const metadata: Metadata = { title: 'Department KPI Pillars · People System' };

async function DepartmentPillars({ params }: { params: PageProps<'/organization/kpi-pillars/[departmentId]'>['params'] }) {
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
        <Empty>This department or team could not be found among the departments.</Empty>
      </div>
    );
  }
  const name = titleCase(row.department.nameEn);
  // a team's department (whose pillars it takes otherwise), else none: the company's
  const parent = aboveRow(view, row);
  const parentName = row.parent ? titleCase(row.parent.nameEn) : null;
  const above = parent ? effectiveNewest(view, parent) : companyNewest(view);
  const aboveInForce = parent ? (parent.inForce ?? view.inForce) : view.inForce;
  const aboveText = parentName ? `${parentName}’s pillars` : 'the company’s pillars';
  // the Attendance metric's pillar marked only while it counts in the KPI (owner, 25 October 2026: "Fixed cut only")
  const attendance = attendanceInKpiOf(view);
  return (
    <div className="space-y-6">
      <BackLink href={KPI_PATHS.pillars}>KPI Pillars</BackLink>
      <div>
        <p className="text-sm text-muted">{parentName ? `KPI pillars · a team of ${parentName}` : 'KPI pillars'}</p>
        <h2 className="text-xl font-semibold">{name}</h2>
        <p className="mt-1 text-sm text-muted">
          {jobTitlesCount(row.jobTitles)}
          {parentName ? '' : ', those of its teams without their own included'}
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
            <FrameworkVersion title="In Force" version={row.inForce} note={`Its own. ${inForceText(row.inForce)}`} attendance={attendance} />
          ) : (
            <div className="space-y-2">
              <h3 className="font-semibold">In Force</h3>
              <p className="text-sm text-muted">{parentName ? `The department’s pillars (${parentName}).` : 'The company’s pillars.'}</p>
              <PillarsList version={aboveInForce} attendance={attendance} />
            </div>
          )}
          {row.next ? (
            row.next.followsCompany ? (
              <div className="space-y-2">
                <h3 className="font-semibold">Next</h3>
                <p className="text-sm text-muted">
                  Back to {aboveText} from {kpiMonthName(row.next.appliesFrom)}’s scorecards, which open on {formatDate(row.next.opensFrom)}. It can be changed
                  until then.
                </p>
                <PillarsList version={above} attendance={attendance} />
              </div>
            ) : (
              <FrameworkVersion title="Next" version={row.next} note={`Its own. ${nextText(row.next)}`} attendance={attendance} />
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
              {parentName
                ? `Its own pillars replace ${parentName}’s for its job titles.`
                : 'Its own pillars replace the company’s for its job titles, and its teams’ unless they have their own.'}{' '}
              Each template of its job titles must then place its metrics in them; until it does, its scorecards keep opening on its old version and old pillars.
            </p>
          </div>
          <DepartmentPillarsChoice
            view={view}
            department={{ id: row.department.id, name, row, above: parentName ? { possessive: `${parentName}’s`, newest: above } : null }}
            action={saveKpiFramework}
            today={todayInCairo()}
          />
        </section>
      )}
    </div>
  );
}

export default function DepartmentPillarsPage({ params }: PageProps<'/organization/kpi-pillars/[departmentId]'>) {
  return (
    <Suspense fallback={<Loading />}>
      <DepartmentPillars params={params} />
    </Suspense>
  );
}
