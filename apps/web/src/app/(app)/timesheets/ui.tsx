import Link from 'next/link';
import { TIMESHEET_STATUS_LABELS, timesheetHoursText, timesheetWeekText, type TimesheetListItem, type TimesheetStatus, type TimesheetWeekView } from '@trendlix/shared';
import { formatDateTime } from '@/lib/format';
import { joinShown } from '@/lib/hidden';
import { dayHead, lineWhat, timesheetHref, timesheetTone } from './timesheets';

// Timesheets in lists and on their pages (owner, 4 November 2026): where a week stands as a badge, the weeks in a table
// (who, the week, the hours, where it stands, opening its page; Decide when it waits for the user), and a week's lines
// day by day with each day's hours. No hooks.

export function TimesheetStatusBadge({ status }: { status: TimesheetStatus | null }) {
  return <span className={`badge ${timesheetTone(status)}`}>{status ? TIMESHEET_STATUS_LABELS[status] : TIMESHEET_STATUS_LABELS.draft}</span>;
}

export function TimesheetTable({ weeks, who = true }: { weeks: readonly TimesheetListItem[]; who?: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {who && <th scope="col">Employee</th>}
            <th scope="col">Week</th>
            <th scope="col" className="text-right">
              Hours
            </th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.id} className="align-top">
              {who && (
                <td className="min-w-44">
                  <span className="font-semibold">{w.employee.fullNameEn}</span>
                  <div className="text-xs text-muted">{joinShown([w.employee.employeeCode])}</div>
                </td>
              )}
              <td className="whitespace-nowrap tabular-nums">{timesheetWeekText(w.weekStart)}</td>
              <td className="text-right tabular-nums">{timesheetHoursText(w.totalHours)}</td>
              <td>
                <TimesheetStatusBadge status={w.status} />
                {w.submittedAt && <div className="mt-1 text-xs text-muted">Sent {formatDateTime(w.submittedAt)}</div>}
              </td>
              <td className="text-right">
                <Link href={timesheetHref(w.id)} className={`btn min-h-9 px-3 no-underline ${w.waitingForYou ? 'btn-primary' : 'btn-secondary'}`}>
                  {w.waitingForYou ? 'Decide' : 'Open'}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A week's lines, day by day with each day's hours; a day without lines said as such. */
export function WeekLines({ view }: { view: Pick<TimesheetWeekView, 'days' | 'entries' | 'totalHours'> }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Client or task</th>
            <th scope="col" className="text-right">
              Hours
            </th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {view.days.map((d) => {
            const lines = view.entries.filter((e) => e.date === d.date);
            if (!lines.length) {
              return (
                <tr key={d.date}>
                  <td className="whitespace-nowrap tabular-nums">{dayHead(d.date)}</td>
                  <td colSpan={3} className="text-sm text-muted">
                    No hours
                  </td>
                </tr>
              );
            }
            return lines.map((e, i) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap tabular-nums">
                  {i === 0 && (
                    <>
                      {dayHead(d.date)}
                      <span className="block text-xs text-muted">{timesheetHoursText(d.hours)}</span>
                    </>
                  )}
                </td>
                <td>{lineWhat(e)}</td>
                <td className="text-right tabular-nums">{timesheetHoursText(e.hours)}</td>
                <td className="text-sm whitespace-pre-line text-muted">{e.note ?? ''}</td>
              </tr>
            ));
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2} className="text-left">
              Total
            </th>
            <td className="text-right font-semibold tabular-nums">{timesheetHoursText(view.totalHours)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
