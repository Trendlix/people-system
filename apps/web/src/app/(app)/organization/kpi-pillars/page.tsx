import type { KpiDepartmentPillarsView, KpiFrameworkView, KpiSettingsView } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { KPI_API, KPI_PATHS } from '@/lib/kpi-paths';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { NotLoaded } from '../payroll/section';
import { Empty, Loading } from '../ui';
import { saveKpiFramework, updateAttendanceInKpi } from '../../kpis/templates/actions';
import { loadKpi } from '../../kpis/templates/data';
import { attendanceInKpiOf, departmentPillarsText, hasOwnPillars, inForceText, jobTitlesCount, nextText } from '../../kpis/templates/framework';
import { KpiFrameworkForm } from '../../kpis/templates/framework-form';
import { buildsKpiTemplates, readsKpiTemplates, settingsChangedText } from '../../kpis/templates/templates';
import { AttendanceInKpiForm } from './attendance-form';
import { FrameworkVersion } from './ui';

// KPI Pillars, under KPIs in the sidebar (owner, 22 October 2026: "but i need pillars to each department / wights can
// be changed for each department and Job title"): the company's pillars, the default, in force and next, changed here
// by HR and the Super Admin as they were at the foot of KPI Templates (owner, 21 October 2026: "Fully flexible"); then
// each department, with the pillars it takes (its own, or the company's) and its next change, opening its own page to
// set its own or go back to the company's. Each department's teams under it (owner, 22 October 2026: "where is the
// pillars for team?", then "Yes, add team pillars"): a team's own pillars, or its department's. The CEO and an Admin,
// whom the API answers too, may read it. The API checks every request again.
// Attendance in the KPI (owner, 25 October 2026, on the badge "Attendance counts here": "if there is an attendance
// deduction, with this means there will be double deduction?", then "Fixed cut only"): a section over the company's
// pillars with the switch, HR's and the Super Admin's, off from then: the KPI performance only, attendance cut on the
// fixed part alone. While it is off, no pillar is marked as the Attendance metric's.

export const metadata: Metadata = { title: 'KPI Pillars · People System' };

/** A department's row, or a team's under it (indented), with what it takes, its next change and its link. */
function PillarsRow({ row: d, builds }: { row: KpiDepartmentPillarsView; builds: boolean }) {
  const text = departmentPillarsText(d);
  const own = hasOwnPillars(d);
  const team = d.parent !== null && d.parent !== undefined;
  return (
    <tr className="align-top">
      <td className={team ? 'min-w-40 pl-8' : 'min-w-40'}>
        {team && <span className="block text-xs text-muted">Team</span>}
        <span className={team ? 'font-medium' : 'font-semibold'}>{d.department.nameEn}</span>
        {d.oldTemplates > 0 && (
          <span className="badge mt-1 bg-warn-soft text-warn">
            {d.oldTemplates === 1 ? '1 template uses the old pillars' : `${d.oldTemplates} templates use the old pillars`}
          </span>
        )}
      </td>
      <td className="min-w-56 text-sm">
        {d.inForce ? (
          <>
            <span className="badge bg-accent-soft text-accent">Own</span>
            <span className="mt-1 block">{text.now}</span>
          </>
        ) : (
          <span className="text-muted">{text.now}</span>
        )}
      </td>
      <td className="min-w-48 text-sm">{text.next ?? <span className="text-muted">—</span>}</td>
      <td className="text-right whitespace-nowrap tabular-nums">{jobTitlesCount(d.jobTitles)}</td>
      <td className="text-right whitespace-nowrap">
        <Link href={KPI_PATHS.departmentPillars(d.department.id)} className="font-semibold">
          {builds ? (own ? 'Change' : 'Set own pillars') : 'View'}
          <span className="sr-only"> for {d.department.nameEn}</span>
        </Link>
      </td>
    </tr>
  );
}

/**
 * Attendance in the KPI (25 October 2026: "Fixed cut only"): on or off, what that means, and the switch for HR and the
 * Super Admin; an API from before then has no such setting, and says so.
 */
function AttendanceInKpi({ settings, framework, builds }: { settings: KpiSettingsView | null; framework: KpiFrameworkView; builds: boolean }) {
  const known = settings?.attendanceInKpi ?? framework.attendanceInKpi;
  const on = attendanceInKpiOf({ attendanceInKpi: known });
  const changed = settings ? settingsChangedText(settings) : null;
  return (
    <section aria-labelledby="attendance-in-kpi-heading" className="card space-y-4 p-6">
      <h2 id="attendance-in-kpi-heading" className="text-lg font-semibold">
        Attendance In The KPI
      </h2>
      {known === undefined ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Not available yet.</p>
      ) : builds ? (
        <AttendanceInKpiForm action={updateAttendanceInKpi} on={on} />
      ) : (
        <p className="text-sm font-semibold">{on ? 'On' : 'Off'}</p>
      )}
      {changed && <p className="text-xs text-muted">{changed}.</p>}
    </section>
  );
}

function CompanyPillars({ view, builds }: { view: KpiFrameworkView; builds: boolean }) {
  return (
    <section id="company-pillars" aria-labelledby="company-pillars-heading" className="card scroll-mt-6 space-y-5 p-6">
      <h2 id="company-pillars-heading" className="text-lg font-semibold">
        Company Pillars
      </h2>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <FrameworkVersion title="In Force" version={view.inForce} note={inForceText(view.inForce)} attendance={attendanceInKpiOf(view)} />
        {view.next ? (
          <FrameworkVersion title="Next" version={view.next} note={nextText(view.next)} attendance={attendanceInKpiOf(view)} />
        ) : (
          <p className="text-sm text-muted lg:pt-8">No change of the pillars is coming.</p>
        )}
      </div>
      {builds && (
        <div className="border-t border-line-soft pt-5">
          <KpiFrameworkForm view={view} action={saveKpiFramework} today={todayInCairo()} />
        </div>
      )}
    </section>
  );
}

function DepartmentPillars({ view, builds }: { view: KpiFrameworkView; builds: boolean }) {
  const departments = view.departments;
  return (
    <section aria-labelledby="department-pillars-heading" className="space-y-3">
      <h2 id="department-pillars-heading" className="text-lg font-semibold">
        Department Pillars
      </h2>
      {!departments ? (
        <p className="rounded-lg bg-line-soft px-4 py-3 text-sm text-muted">Not available yet.</p>
      ) : departments.length === 0 ? (
        <Empty>No departments yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Department or team</th>
                <th scope="col">Pillars</th>
                <th scope="col">Next change</th>
                <th scope="col" className="text-right">
                  Job titles
                </th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {departments.flatMap((d) => [d, ...(d.teams ?? [])]).map((d) => (
                <PillarsRow key={d.department.id} row={d} builds={builds} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function KpiPillars() {
  const user = await getCurrentUser();
  if (!readsKpiTemplates(user)) return <Empty>Only HR and the Super Admin set the KPI pillars.</Empty>;
  const [loaded, settings] = await Promise.all([loadKpi<KpiFrameworkView>(KPI_API.framework), loadKpi<KpiSettingsView>(KPI_API.settings)]);
  if (loaded.kind !== 'ok') return <NotLoaded what="the KPI pillars" loaded={loaded} />;
  const builds = buildsKpiTemplates(user);
  return (
    <div className="space-y-8">
      <AttendanceInKpi settings={settings.kind === 'ok' ? settings.value : null} framework={loaded.value} builds={builds} />
      <CompanyPillars view={loaded.value} builds={builds} />
      <DepartmentPillars view={loaded.value} builds={builds} />
    </div>
  );
}

// Under Organization since 23 October 2026 (owner: "Check-in Setup, KPI Pillars and deadlines, Recruitment and
// checklists, Templates"), in the setup menu's Performance, which gives the heading.
export default function KpiPillarsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <KpiPillars />
    </Suspense>
  );
}
