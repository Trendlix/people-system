import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { cLevelTitle } from '@/lib/confidential';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading, UUID } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import { monthName } from '../../payroll/list';
import { canSeeAttendance, dailyHref, figureTiles, importWay, personHref, readAttendanceMonth, reviewsImports } from '../attendance';
import { loadPerson } from '../data';
import { notLoaded } from '../not-loaded';
import { DaysTable, FigureTiles, MonthNav, SourcesNote } from '../ui';

// A person's month (owner's brief, 19 October 2026: Daily Attendance, "A person's month also as a page"): their figures
// and every day kept from Zoho People's imports, with the month before and after a click away, and where the days came
// from. HR, the CEO and Finance; a C-level person's only the CEO and the Super Admin (the API answers 404 for the rest,
// as for anyone not there).

export const metadata: Metadata = { title: 'Attendance · People System' };

async function PersonMonth({ params, searchParams }: { params: PageProps<'/attendance/[employeeId]'>['params']; searchParams: PageProps<'/attendance/[employeeId]'>['searchParams'] }) {
  const { employeeId } = await params;
  if (!UUID.test(employeeId)) notFound();
  const user = await getCurrentUser();
  if (!canSeeAttendance(user)) return <Empty>Only HR, Finance and the CEO see everyone&apos;s attendance.</Empty>;
  const month = readAttendanceMonth(await searchParams, todayInCairo());
  const loaded = await loadPerson(employeeId, month);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'attendance')}</Empty>;
  const { person: p, sources, run } = loaded.value;
  const way = importWay(user, month, run);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={dailyHref(month)}>Daily Attendance</BackLink>
        <h1 className="text-2xl font-semibold">
          {p.employee.fullNameEn}
          {p.employee.confidential && <CLevelBadge title={cLevelTitle(false)} className="ml-2 align-middle" />}
        </h1>
        <p className="text-muted">
          {p.employee.employeeCode}
          {p.employee.jobTitle && ` · ${p.employee.jobTitle}`}
          {p.employee.department && ` · ${p.employee.department}`} ·{' '}
          <Link href={`/employees/${p.employee.id}`} className="font-semibold">
            Profile
          </Link>
        </p>
      </div>
      <MonthNav month={month} hrefFor={(m) => personHref(p.employee.id, m)} />
      {p.days.length === 0 ? (
        <div className="card space-y-3 px-6 py-8 text-center">
          <p className="text-muted">
            No attendance of {p.employee.fullNameEn} kept for {monthName(month)}: the month isn&apos;t imported yet, or they weren&apos;t matched in its
            files. Import it on the month&apos;s payroll run.
          </p>
          <Link href={way.href} className="btn btn-secondary no-underline">
            {way.label}
          </Link>
        </div>
      ) : (
        <>
          <FigureTiles label={`${p.employee.fullNameEn} in ${monthName(month)}`} tiles={figureTiles(p.figures, p)} />
          <section aria-labelledby="days-heading" className="space-y-3">
            <h2 id="days-heading" className="text-lg font-semibold">
              Days
            </h2>
            <div className="card">
              <DaysTable days={p.days} name={p.employee.fullNameEn} />
            </div>
          </section>
          <SourcesNote sources={sources} reviews={reviewsImports(user)} />
        </>
      )}
    </div>
  );
}

export default function AttendancePersonPage({ params, searchParams }: PageProps<'/attendance/[employeeId]'>) {
  return (
    <StaffOnly>
      <div className="max-w-6xl">
        <Suspense fallback={<Loading />}>
          <PersonMonth params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
