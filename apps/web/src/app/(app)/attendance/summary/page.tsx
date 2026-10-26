import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import type { AttendanceSummaryRow } from '@trendlix/shared';
import { Select } from '@/components/select';
import { formatDateTime, titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { todayInCairo } from '../../employees/ui';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import {
  attendanceMonthChoices,
  attendancePeriodTitle,
  canSeeAttendance,
  COMPENSATORY_DAY_TITLE,
  EXEMPT_DAY_TITLE,
  compensatoryDaysText,
  exemptDaysText,
  filledText,
  hoursText,
  quickSummaryPeriods,
  readSummaryPeriod,
  summaryExcelHref,
  summaryHref,
} from '../attendance';
import { loadSummary } from '../data';
import { notLoaded } from '../not-loaded';
import { ATTENDANCE_SUMMARY_PATH } from '../sections';

// The attendance Summary (owner's brief, 19 October 2026: "by department and team — absent days, short hours,
// permission hours, remote days, average hours a day — with Excel export"): a month (this month unless asked) or a
// range of months, each department with everyone who worked in it or its teams that month, then each team, in
// Organization's order, those without a department last, and everyone together; with the workbook (by department and
// team, by person, each day). The C-level people are left out for anyone but the CEO and the Super Admin (owner, 19
// October 2026), the workbook too, and the page says so. HR, the CEO and Finance; the API checks it again. Days exempt
// from check-in (owner, 25 October 2026: "trat them as if they achived their full working hours") are said under the
// days worked, an "Exempt" badge: "3 exempt days".

export const metadata: Metadata = { title: 'Attendance Summary · People System' };

const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';

function PeriodPicker({ period, today }: { period: { from: string; to: string }; today: string }) {
  const months = attendanceMonthChoices(today, period.from, period.to);
  return (
    <form key={`${period.from}-${period.to}`} action={ATTENDANCE_SUMMARY_PATH} className="flex flex-wrap items-end gap-3">
      {(['from', 'to'] as const).map((end) => (
        <div key={end}>
          <label htmlFor={`attendance-summary-${end}`} className="label">
            {end === 'from' ? 'From' : 'To'}
          </label>
          <Select id={`attendance-summary-${end}`} name={end} defaultValue={period[end]} className="input min-w-44">
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <button type="submit" className="btn btn-secondary">
        Show
      </button>
      <ul className="flex flex-wrap gap-2" aria-label="Quick periods">
        {quickSummaryPeriods(today).map((q) => {
          const active = q.period.from === period.from && q.period.to === period.to;
          return (
            <li key={q.key}>
              <Link
                href={summaryHref(q.period)}
                aria-current={active ? 'page' : undefined}
                className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
              >
                {q.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </form>
  );
}

/** A row's figures. */
function Cells({ r, strong = false }: { r: AttendanceSummaryRow; strong?: boolean }) {
  const f = r.figures;
  const cell = `text-right whitespace-nowrap tabular-nums ${strong ? 'font-semibold' : ''}`;
  return (
    <>
      <td className={cell}>{r.people}</td>
      <td className={cell}>
        {f.daysWorked}
        {exemptDaysText(f) && (
          <div className="mt-0.5">
            <span className="badge border border-line bg-card text-xs font-normal text-ink" title={EXEMPT_DAY_TITLE}>
              {exemptDaysText(f)}
            </span>
          </div>
        )}
        {compensatoryDaysText(f) && (
          <div className="mt-0.5">
            <span className="badge border border-line bg-card text-xs font-normal text-ink" title={COMPENSATORY_DAY_TITLE}>
              {compensatoryDaysText(f)}
            </span>
          </div>
        )}
      </td>
      <td className={cell}>{hoursText(f.hoursCounted)}</td>
      <td className={cell}>{hoursText(r.averageHours)}</td>
      <td className={`${cell} ${f.absentDays ? 'text-danger' : ''}`}>{f.absentDays}</td>
      <td className={`${cell} ${f.shortHours ? 'text-warn' : ''}`}>
        {hoursText(f.shortHours, true)}
        {/* make-up hours (owner, 20 October 2026): the short hours the extra time filled, month by month */}
        {filledText(f) && <div className="text-xs font-normal text-ok">{filledText(f)}</div>}
      </td>
      <td className={cell}>{hoursText(f.permissionHours, true)}</td>
      <td className={cell}>{f.officeDays}</td>
      <td className={cell}>{f.remoteDays}</td>
      <td className={cell}>{f.leaveDays}</td>
      <td className={cell}>{f.missingCheckOuts}</td>
    </>
  );
}

async function Summary({ searchParams }: { searchParams: PageProps<'/attendance/summary'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!canSeeAttendance(user)) return <Empty>Only HR, Finance and the CEO see the attendance summary.</Empty>;
  const today = todayInCairo();
  const period = readSummaryPeriod(await searchParams, today);
  const loaded = await loadSummary(period);
  const title = attendancePeriodTitle(period);
  return (
    <div className="space-y-6">
      <PeriodPicker period={period} today={today} />
      {loaded.kind !== 'ok' ? (
        <Empty>{notLoaded(loaded, 'attendance summary')}</Empty>
      ) : (
        <section aria-labelledby="summary-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 id="summary-heading" className="text-lg font-semibold">
                {titleCase(title)} by Department and Team
              </h2>
              <p className="text-xs text-muted">
                As of {formatDateTime(loaded.value.generatedAt)} · a team is counted in its department too · each person where they worked that month
              </p>
            </div>
            {/* a plain link, never prefetched: the workbook is made on the API */}
            <a href={summaryExcelHref(period)} className="btn btn-secondary no-underline">
              Download Excel
            </a>
          </div>
          {loaded.value.hidden && <p className="text-sm text-muted">{loaded.value.hidden.label}</p>}
          {loaded.value.groups.length === 0 ? (
            <div className="card px-6 py-8 text-center text-sm text-muted">No attendance imported for {title} yet.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Department</th>
                    <th scope="col" className="text-right">
                      People
                    </th>
                    <th scope="col" className="text-right">
                      Days Worked
                    </th>
                    <th scope="col" className="text-right">
                      Hours Counted
                    </th>
                    <th scope="col" className="text-right">
                      Average a Day
                    </th>
                    <th scope="col" className="text-right">
                      Absent Days
                    </th>
                    <th scope="col" className="text-right">
                      Short Hours
                    </th>
                    <th scope="col" className="text-right">
                      Permission Hours
                    </th>
                    <th scope="col" className="text-right">
                      Office Days
                    </th>
                    <th scope="col" className="text-right">
                      Remote Days
                    </th>
                    <th scope="col" className="text-right">
                      Leave Days
                    </th>
                    <th scope="col" className="text-right">
                      Missing Check-outs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.value.groups.map((g) => (
                    <Fragment key={g.id ?? ''}>
                      <tr className="bg-canvas">
                        <th scope="row" className="text-left text-sm tracking-normal text-ink normal-case">
                          {g.name === null ? 'No Department' : titleCase(g.name)}
                        </th>
                        <Cells r={g} strong />
                      </tr>
                      {g.teams.map((t) => (
                        <tr key={t.id ?? ''}>
                          <th scope="row" className="pl-8 text-left text-sm font-medium tracking-normal text-muted normal-case">
                            {titleCase(t.name ?? '')}
                          </th>
                          <Cells r={t} />
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  <tr className="border-t-2 border-line">
                    <th scope="row" className="text-left text-sm tracking-normal text-ink normal-case">
                      Everyone
                    </th>
                    <Cells r={loaded.value.totals} strong />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function AttendanceSummaryPage({ searchParams }: PageProps<'/attendance/summary'>) {
  return (
    <StaffOnly>
      <div className="max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Attendance Summary</h1>
          <p className="mt-1 max-w-3xl text-muted">
            The attendance, from check-ins on the system and Zoho People&apos;s imports, by department and team: absent days, short hours against
            each shift, permission hours, remote days and the hours worked a day on average.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <Summary searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
