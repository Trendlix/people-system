import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import type { MonthCorrectionsPart } from '@/lib/correction-types';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { appAttendanceHref, appCorrectionHref, appRequestsHref } from '@/lib/surface';
import { figureTiles, notImportedYetText, readAttendanceMonth, type PunchRow } from '../../../(app)/attendance/attendance';
import { loadMine } from '../../../(app)/attendance/data';
import { notLoaded } from '../../../(app)/attendance/not-loaded';
import { FigureTiles, MonthNav } from '../../../(app)/attendance/ui';
import { NoProfile } from '../../../(app)/dashboard/cards';
import { todayInCairo } from '../../../(app)/employees/ui';
import { monthName } from '../../../(app)/payroll/list';
import { PageTitle, PhoneLoading } from '../ui';
import { DayList } from './day-list';

// Attendance on the phone pages (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to
// enable them to check in and out, and apply for their requests"; first version: "My attendance and payslips"): My
// Attendance's month (GET /attendance/me, the API's for the caller alone), its figures as tiles and its days as a list,
// with the month before and after; each day's Ask for a correction, or the correction being decided. A C-level person
// sees their own as everyone does.

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
        <p className="rounded-lg bg-white px-4 py-3 text-sm text-muted">{view.correctable.reason}</p>
      )}
      {p.days.length === 0 ? (
        <div className="card px-4 py-8 text-center text-sm text-muted">{notImportedYetText(month)}</div>
      ) : (
        <>
          <FigureTiles label={`Your attendance in ${monthName(month)}`} tiles={figureTiles(p.figures, p)} />
          <section aria-labelledby="phone-days-heading" className="space-y-2">
            <h2 id="phone-days-heading" className="font-semibold">
              Your Days
            </h2>
            <DayList days={p.days} punches={view.punches ?? []} corrections={view.corrections} correctable={view.correctable} today={today} />
          </section>
          <p className="text-xs text-muted">
            {imported && `Days from Zoho People imported by HR on ${formatDate(imported)}. `}
            {view.corrections
              ? 'A day that isn’t right? Ask for a correction on it: your manager, then HR, decide it.'
              : 'Something wrong? Ask HR to check it.'}
          </p>
        </>
      )}
    </div>
  );
}

export default function PhoneAttendancePage({ searchParams }: PageProps<'/app/attendance'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="Attendance">Your check-ins and check-outs, counted by the company&apos;s rules.</PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Month searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
