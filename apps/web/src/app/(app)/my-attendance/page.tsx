import type { Metadata } from 'next';
import Link from 'next/link';
import { cache, Suspense } from 'react';
import { PageHead, PanelHead } from '@/components/design';
import type { MonthCorrectionsPart } from '@/lib/correction-types';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../dashboard/cards';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { monthName } from '../payroll/list';
import { daySourceText, figureTiles, myAttendanceHref, notImportedYetText, readAttendanceMonth, type PunchRow } from '../attendance/attendance';
import { askCorrectionHref, MY_CORRECTIONS_HREF } from '../attendance/corrections/corrections';
import { DayCorrectionCell } from '../attendance/corrections/day-cell';
import { loadMine } from '../attendance/data';
import { notLoaded } from '../attendance/not-loaded';
import { ExemptionNote } from '../attendance/ui';
import { TodayCheckIn } from './check-in-card';
import { usualSource } from './my-days';
import { FigureCards, MonthGlance, MonthSwitch, MyDaysTable } from './ui';

// My Attendance (owner, 19 October 2026: "the attendance is not active in the side menu"): the employee's own month, in
// their sidebar after My Requests: their figures (days worked, hours counted, absent days, short hours, permission and
// leave) and every day kept, read only, with the month before and after a click away. A C-level person sees their own as
// everyone does. The API answers only with the caller's own. Checking in on the system (owner, 19 October 2026: "Check-in
// through the system (phone or web with the office location check, or a device) to replace Zoho"): Today's Check in /
// Check out at the top, above the month, and the days from their check-ins as well as Zoho People's imports. Attendance
// corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"): each day's
// Ask for a correction (or the correction being decided), a corrected day shown "corrected from …", and every press of
// the day under it.
// The owner's design (30 October 2026, Figma "PeopleTrendlix", desktop): the head with the month switch on its right;
// today ("Ready to start?") beside the month at a glance; the month's figures as cards; "Your days" as a card with My
// corrections and Ask for a correction in its head, the days' table and the notes under it. The month's data is read
// once for the glance and the rest (loadMonth).

export const metadata: Metadata = { title: 'My Attendance · People System' };

type Query = PageProps<'/my-attendance'>['searchParams'];

/** The caller's month, read once for the page's parts. */
const loadMonth = cache(loadMine);

/** The month asked for (?month=), else this month. */
const monthOf = async (searchParams: Query) => readAttendanceMonth(await searchParams, todayInCairo());

/** The month switch in the head: for someone with an employee profile, whose month this is. */
async function HeadMonth({ searchParams }: { searchParams: Query }) {
  // the session first: the month reads the clock, which Next.js allows only after the request's data
  const user = await getCurrentUser();
  if (!user.employeeId) return null;
  return <MonthSwitch month={await monthOf(searchParams)} hrefFor={myAttendanceHref} />;
}

/** The month at a glance, beside today: once the month has days. */
async function Glance({ searchParams }: { searchParams: Query }) {
  const user = await getCurrentUser();
  if (!user.employeeId) return null;
  const month = await monthOf(searchParams);
  const loaded = await loadMonth(month);
  if (loaded.kind !== 'ok' || loaded.value.person.days.length === 0) return null;
  const p = loaded.value.person;
  return <MonthGlance month={month} daysWorked={p.figures.daysWorked} days={p.days} className="min-w-0 xl:flex-1" />;
}

async function Mine({ searchParams }: { searchParams: Query }) {
  const user = await getCurrentUser();
  if (!user.employeeId) return <NoProfile user={user} />;
  const month = await monthOf(searchParams);
  const loaded = await loadMonth(month);
  if (loaded.kind === 'unavailable') return <NoProfile user={user} />;
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'attendance')}</Empty>;
  const view = loaded.value as typeof loaded.value & MonthCorrectionsPart & { punches?: PunchRow[] };
  const p = view.person;
  const imported = view.sources.map((s) => s.appliedAt ?? s.createdAt).sort().at(-1);
  const today = todayInCairo();
  // attendance corrections (19 October 2026): an API from before them has none of these, and no column shows
  const corrections = view.corrections;
  // where most days came from, said once under the table
  const usual = usualSource(p.days.map(daySourceText));
  return (
    <div className="space-y-3">
      {/* exempt from check-in (25 October 2026): the month's periods */}
      <ExemptionNote periods={p.exemptions} self className="px-1" />
      {p.days.length > 0 && <FigureCards label={`Your attendance in ${monthName(month)}`} tiles={figureTiles(p.figures, p)} />}
      <section aria-labelledby="my-days-heading" className="card p-[22px]">
        <PanelHead
          eyebrow={monthName(month)}
          title={<span id="my-days-heading">Your days</span>}
          aside={
            corrections && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Link href={MY_CORRECTIONS_HREF} className="btn btn-secondary min-h-10 rounded-[10px] px-3.5 text-xs font-normal">
                  My corrections
                </Link>
                {view.correctable?.allowed && (
                  <Link href={askCorrectionHref(null)} className="btn btn-primary min-h-10 rounded-[10px] px-3.5 text-xs font-normal">
                    Ask for a correction
                  </Link>
                )}
              </div>
            )
          }
        />
        {corrections && view.correctable && !view.correctable.allowed && view.correctable.reason && (
          <p className="mt-4 rounded-lg bg-raised px-4 py-3 text-sm text-muted">{view.correctable.reason}</p>
        )}
        {p.days.length === 0 ? (
          <p className="mt-5 rounded-[13px] border border-line px-6 py-8 text-center text-sm text-muted">{notImportedYetText(month)}</p>
        ) : (
          <>
            <div className="mt-5">
              <MyDaysTable
                days={p.days}
                punches={view.punches ?? []}
                // working from home (21 October 2026): those days say so
                wfhDays={p.wfhDays ?? []}
                usual={usual}
                action={
                  corrections
                    ? (d) => <DayCorrectionCell day={d} corrections={corrections} correctable={view.correctable} today={today} href={askCorrectionHref} label="Ask for a correction" />
                    : undefined
                }
              />
            </div>
            <div className="mt-4 space-y-1 text-xs text-muted">
              <p>
                {corrections
                  ? 'A day that isn’t right (a check-in or check-out forgotten, a time wrong, work away from the office)? Ask for a correction on its row: your manager, then HR, decide it.'
                  : 'Something wrong? Ask HR to check it.'}
              </p>
              {usual && <p>Where the days came from: {usual}, unless a day says otherwise.</p>}
              <p>Balance: the time over (+) or short (−) of your shift&apos;s hours that day, after its permission.</p>
              {imported && <p>Days from Zoho People imported by HR on {formatDate(imported)}.</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function MyAttendancePage({ searchParams }: PageProps<'/my-attendance'>) {
  return (
    <div>
      <PageHead
        eyebrow="People System · Attendance"
        title="My Attendance"
        intro={
          <>
            Your check-ins and check-outs, on the system and from Zoho People&apos;s imports, counted by the company&apos;s rules: the hours within your
            shift, at most its hours a day; a working day without a check-in is an absent day; leave from your approved requests.
          </>
        }
        actions={
          <Suspense fallback={null}>
            <HeadMonth searchParams={searchParams} />
          </Suspense>
        }
      />
      {/* checking in on the system (19 October 2026): today's, above the month; beside it the month at a glance */}
      <div className="mt-7 flex flex-col gap-3 xl:flex-row">
        <Suspense fallback={null}>
          <TodayCheckIn variant="attendance" className="min-w-0 xl:flex-[2.3]" />
        </Suspense>
        <Suspense fallback={null}>
          <Glance searchParams={searchParams} />
        </Suspense>
      </div>
      <div className="mt-3">
        <Suspense fallback={<Loading />}>
          <Mine searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
