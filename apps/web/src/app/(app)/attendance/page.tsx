import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ATTENDANCE_FILTER_LABELS, ATTENDANCE_FILTERS, averageHoursADay } from '@trendlix/shared';
import { Select } from '@/components/select';
import type { AttendancePersonMonth } from '@/lib/attendance-types';
import { groupByPlace, placeOrder, type PlaceRef } from '@/lib/place-groups';
import { loadPlaces } from '@/lib/places';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { StaffOnly } from '../staff-only';
import { monthName } from '../payroll/list';
import {
  seesPeoplesAttendance,
  dailyHref,
  figureTiles,
  filtered,
  importsAttendance,
  importWay,
  noAttendanceText,
  readAttendanceMonth,
  readFilters,
  issueCount,
  issueDays,
  issueOfTile,
  reviewsImports,
  runWay,
  searchedMonth,
} from './attendance';
import { SEARCH_MAX } from '@/lib/name-search';
import { loadMonth } from './data';
import { notLoaded } from './not-loaded';
import { PeopleTable } from './people-table';
import { ATTENDANCE_PATH } from './sections';
import { FigureTiles, IssueList, MonthNav, SourcesNote } from './ui';
import { seesAllWfh, WFH_PATH } from './wfh/wfh';
import { OD_PATH, seesAllOd } from './official-duty/od';
import { shownCode, withCode } from '@/lib/hidden';

// Daily Attendance (owner, 19 October 2026: "is the attendance module active?", then "the attendance is not active in the
// side menu"): a month (this month unless the address asks for another, a click to the month before or after) of
// everyone's days kept from Zoho People's imports, one row a person with the month's figures (days worked, hours
// counted, absent days, short hours, permission hours, remote days, leave days, missing check-outs), grouped by
// department, then team, in Organization's order, each opening to their days; filtered by department or team, person
// and "only with …". Where the month's days came from (each import, who read and applied it, when), and for a month
// without any "No attendance imported for … yet" with the way to import it (HR: the Import page; the CEO and Finance:
// the month's run, or Payroll). The month's totals of those listed on top. A C-level person (owner, 19 October 2026:
// "make C level Employees details not visible to HR") is one hidden row for all but the CEO and the Super Admin. HR,
// the CEO and Finance (Finance read only: nothing here changes anything); the API checks it again. Checking in on the
// system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location check, or a
// device) to replace Zoho"): the days of those who check in come from their check-ins (a working day gone by without
// one absent), with the flagged ones for HR to see ("Only with flagged check-ins"). Working from home (owner, 21 October
// 2026: "think about how should we handle the working from home in out erp"): a day worked from home shows so, and HR
// and the CEO reach every request and day from Work from home.

export const metadata: Metadata = { title: 'Daily Attendance · People System' };

/** The department filter's choices: each department in Organization's order, then its teams as "Department › Team". */
function placeChoices(places: readonly PlaceRef[]): { id: string; label: string }[] {
  return places
    .filter((p) => p.parentId === null)
    .flatMap((d) => [{ id: d.id, label: d.nameEn }, ...places.filter((t) => t.parentId === d.id).map((t) => ({ id: t.id, label: `${d.nameEn} › ${t.nameEn}` }))]);
}

function Filters({ month, places, people, chosen }: { month: string; places: readonly PlaceRef[]; people: readonly AttendancePersonMonth[]; chosen: ReturnType<typeof readFilters> }) {
  const choices = [...people].sort((a, b) => a.employee.fullNameEn.localeCompare(b.employee.fullNameEn));
  return (
    <form key={`${month}-${chosen.departmentId}-${chosen.employeeId}-${chosen.only}-${chosen.q ?? ''}`} action={ATTENDANCE_PATH} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="month" value={month} />
      {/* a name or a code (owner, 31 October 2026: "allow me to search by name"), searched on Enter or Show */}
      <div className="min-w-56">
        <label htmlFor="attendance-q" className="label">
          Search
        </label>
        <input id="attendance-q" name="q" type="search" defaultValue={chosen.q ?? ''} maxLength={SEARCH_MAX} placeholder="A name or code" autoComplete="off" className="input" />
      </div>
      <div className="min-w-56">
        <label htmlFor="attendance-department" className="label">
          Department or team
        </label>
        <Select id="attendance-department" name="department" defaultValue={chosen.departmentId ?? ''} className="input">
          <option value="">Everyone</option>
          {placeChoices(places).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-56">
        <label htmlFor="attendance-employee" className="label">
          Employee
        </label>
        <Select id="attendance-employee" name="employee" defaultValue={chosen.employeeId ?? ''} className="input">
          <option value="">Everyone</option>
          {choices.map((p) => (
            <option key={p.employee.id} value={p.employee.id}>
              {withCode(p.employee.fullNameEn, p.employee.employeeCode)}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-56">
        <label htmlFor="attendance-only" className="label">
          Show
        </label>
        <Select id="attendance-only" name="only" defaultValue={chosen.only ?? ''} className="input">
          <option value="">Everyone with attendance</option>
          {ATTENDANCE_FILTERS.map((f) => (
            <option key={f} value={f}>
              {ATTENDANCE_FILTER_LABELS[f]}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      {filtered(chosen) && (
        <Link href={dailyHref(month)} className="min-h-11 content-center text-sm font-semibold">
          Clear the filters
        </Link>
      )}
    </form>
  );
}

async function Daily({ searchParams }: { searchParams: PageProps<'/attendance'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!seesPeoplesAttendance(user)) return <Empty>Only HR, Finance, the CEO and Super Admins see everyone&apos;s attendance.</Empty>;
  const query = await searchParams;
  const month = readAttendanceMonth(query, todayInCairo());
  const chosen = readFilters(query);
  const [all, places] = await Promise.all([loadMonth(month), loadPlaces()]);
  if (all.kind !== 'ok') return <Empty>{notLoaded(all, 'attendance')}</Empty>;
  // the API's filters (the search is the page's own, below)
  const asked = { departmentId: chosen.departmentId, employeeId: chosen.employeeId, only: chosen.only };
  const loaded = asked.departmentId || asked.employeeId || asked.only ? await loadMonth(month, asked) : all;
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'attendance')}</Empty>;
  // a name searched: only the people it matches, their figures together
  const view = searchedMonth(loaded.value, chosen.q);
  const none = all.value.people.length === 0 && !all.value.hidden;
  const way = importWay(user, month, view.run);
  const groups = groupByPlace(view.people, (p) => p.employee.department, placeOrder(places));
  const missing = view.withoutDays;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <MonthNav month={month} hrefFor={(m) => dailyHref(m, chosen)} />
        <div className="flex flex-wrap gap-2">
          {seesAllWfh(user) && (
            <Link href={WFH_PATH} className="btn btn-secondary no-underline">
              Work from home
            </Link>
          )}
          {/* the official duties beside it (owner, 23 October 2026: "Official duty (OD) requests") */}
          {seesAllOd(user) && (
            <Link href={OD_PATH} className="btn btn-secondary no-underline">
              Official duty
            </Link>
          )}
          {importsAttendance(user) && !none && (
            <Link href={way.href} className="btn btn-secondary no-underline">
              Import attendance
            </Link>
          )}
        </div>
      </div>

      {none ? (
        <div className="card space-y-3 px-6 py-8 text-center">
          <p className="text-muted">{noAttendanceText(month)}</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href={way.href} className="btn btn-primary no-underline">
              {way.label}
            </Link>
            {importsAttendance(user) && (
              <Link href={runWay(month, view.run).href} className="text-sm font-semibold">
                {runWay(month, view.run).label}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <Filters month={month} places={places} people={all.value.people} chosen={chosen} />
          <FigureTiles
            label={`Everyone listed in ${monthName(month)}`}
            // a figure stating an issue opens the list of its days (owner, 31 October 2026: "when i click on flagged days
            // list me the employee and the days, and this for all cards that states issues")
            tiles={figureTiles(view.totals, { averageHours: averageHoursADay(view.totals), checksIn: view.people.some((p) => p.checksIn) }).map((t) => {
              const issue = issueOfTile(t.key, view.totals);
              return issue && issueCount(view.totals, issue) > 0 ? { ...t, href: `${dailyHref(month, { ...chosen, issue: chosen.issue === issue ? undefined : issue })}#issue`, current: chosen.issue === issue } : t;
            })}
          />
          {chosen.issue && <IssueList kind={chosen.issue} rows={issueDays(view.people, chosen.issue)} month={month} closeHref={dailyHref(month, { ...chosen, issue: undefined })} />}
          {view.people.length === 0 && !view.hidden ? (
            <div className="card px-6 py-8 text-center text-sm text-muted">Nobody matches these filters in {monthName(month)}.</div>
          ) : (
            <PeopleTable groups={groups} month={month} link="attendance" hidden={view.hidden?.label ?? null} />
          )}
          <SourcesNote sources={view.sources} reviews={reviewsImports(user)} />
        </>
      )}

      {!none && missing.length > 0 && (
        <details className="card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            {missing.length} {missing.length === 1 ? 'person' : 'people'} employed in {monthName(month)} with no attendance kept
          </summary>
          <p className="mt-2 text-muted">
            They haven&apos;t checked in on the system, and aren&apos;t in Zoho People&apos;s imported files or weren&apos;t matched to their
            profile: check the import&apos;s review.
          </p>
          <ul className="mt-2 columns-1 gap-6 sm:columns-2">
            {missing.map((e) => (
              <li key={e.id}>
                {e.fullNameEn} {shownCode(e.employeeCode) && <span className="text-muted">· {e.employeeCode}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function DailyAttendancePage({ searchParams }: PageProps<'/attendance'>) {
  return (
    <StaffOnly>
      {/* the page's whole width (owner, 31 October 2026: "fill the page") */}
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Daily Attendance</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Everyone&apos;s days, from their check-ins on the system and Zoho People&apos;s imports, counted by the system&apos;s rules: the hours
            within each person&apos;s shift, at most its hours a day; a working day without a check-in is absent; leave from the Leave module. A
            check-in outside the work arrangement&apos;s rule is flagged. Open a row for its days.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Daily searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
