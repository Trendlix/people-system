import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import type { MonthCorrectionsPart } from '@/lib/correction-types';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { APP_PATHS, appAttendanceHref, appCorrectionHref, appRequestsHref } from '@/lib/surface';
import { figureTiles, notImportedYetText, readAttendanceMonth, type PunchRow } from '../../../(app)/attendance/attendance';
import { loadMine } from '../../../(app)/attendance/data';
import { notLoaded } from '../../../(app)/attendance/not-loaded';
import { ExemptionNote, FigureTiles, MonthNav } from '../../../(app)/attendance/ui';
import { NoProfile } from '../../../(app)/dashboard/cards';
import { todayInCairo } from '../../../(app)/employees/ui';
import { loadOwnProfile } from '../../../(app)/own-profile';
import { monthName } from '../../../(app)/payroll/list';
import { PageTitle, PhoneLoading } from '../ui';
import { DayList } from './day-list';

// Attendance on the phone pages (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to
// enable them to check in and out, and apply for their requests"; first version: "My attendance and payslips"): My
// Attendance's month (GET /attendance/me, the API's for the caller alone), its figures as tiles and its days as a list,
// with the month before and after; each day's Ask for a correction, or the correction being decided. A C-level person
// sees their own as everyone does. A work from home day approved for them shows "Working from home" (owner, 21 October
// 2026: "think about how should we handle the working from home in out erp"). A compensatory day off (owner, 26 October
// 2026: "WFH and compensatory pages in the phone app") shows as on the site: "Compensatory day off" on the day, and the
// month's "Compensatory days off" among the tiles (figureTiles). Someone HR switched to timesheets (owner, 4 November
// 2026) gets their timesheet first: their days here aren't counted.

export const metadata: Metadata = { title: 'Attendance · Trendlix People' };

async function Month({ searchParams }: { searchParams: PageProps<'/app/attendance'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!user.employeeId) return <NoProfile user={user} />;
  const today = todayInCairo();
  const month = readAttendanceMonth(await searchParams, today);
  const loaded = await loadMine(month);
  if (loaded.kind === 'unavailable') return <NoProfile user={user} />;
  if (loaded.kind !== 'ok') return <div className="card px-4 py-8 text-center text-sm text-muted">{notLoaded(loaded, 'attendance')}</div>;
  const view = loaded.value as typeof loaded.value & MonthCorrectionsPart & { punches?: PunchRow[] };
  const p = view.person;
  const imported = view.sources.map((s) => s.appliedAt ?? s.createdAt).sort().at(-1);
  return (
    <div className="space-y-4">
      <MonthNav month={month} hrefFor={appAttendanceHref} />
      {view.corrections && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {view.correctable?.allowed && (
            <Link href={appCorrectionHref(null)} className="btn btn-secondary min-h-11 flex-1">
              Ask for a correction
            </Link>
          )}
          <Link href={appRequestsHref('correction')} className="text-sm font-semibold">
            My corrections
          </Link>
        </div>
      )}
      {view.corrections && view.correctable && !view.correctable.allowed && view.correctable.reason && (
        <p className="rounded-lg bg-card px-4 py-3 text-sm text-muted">{view.correctable.reason}</p>
      )}
      {/* exempt from check-in (25 October 2026): the month's periods */}
      <ExemptionNote periods={p.exemptions} self />
      {p.days.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">{notImportedYetText(month)}</div>
      ) : (
        <>
          <FigureTiles label={`Your attendance in ${monthName(month)}`} tiles={figureTiles(p.figures, p)} />
          <section aria-labelledby="phone-days-heading" className="space-y-2">
            <h2 id="phone-days-heading" className="font-semibold">
              Your Days
            </h2>
            <DayList days={p.days} punches={view.punches ?? []} corrections={view.corrections} correctable={view.correctable} today={today} wfhDays={p.wfhDays} askFrom={view.ask?.from ?? null} />
          </section>
          {imported && <p className="text-xs text-muted">Days from Zoho People imported on {formatDate(imported)}.</p>}
        </>
      )}
    </div>
  );
}

/** The way to their timesheet, first, for someone on timesheets. */
async function TimesheetLink() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile?.employment?.worksOnTimesheets) return null;
  return (
    <Link href={APP_PATHS.timesheet} className="card flex min-h-16 items-center justify-between gap-3 border-accent/40 bg-accent-soft px-4 py-3 text-ink no-underline">
      <span className="min-w-0">
        <span className="block font-semibold">My Timesheet</span>
        <span className="block text-xs text-muted">Log your hours there, by client or task, and send each week for approval.</span>
      </span>
      <span aria-hidden="true" className="text-lg text-accent">
        ›
      </span>
    </Link>
  );
}

export default function PhoneAttendancePage({ searchParams }: PageProps<'/app/attendance'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="Attendance" />
      <Suspense fallback={null}>
        <TimesheetLink />
      </Suspense>
      <Suspense fallback={<PhoneLoading />}>
        <Month searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
