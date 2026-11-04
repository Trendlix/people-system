import { timesheetHoursText, type TimesheetWeekView } from '@trendlix/shared';
import { formatDateTime } from '@/lib/format';
import { dayHead, lineWhat } from '../../(app)/timesheets/timesheets';

// A week of hours on the phone pages (owner, 4 November 2026: "Timesheet in app/website"; the phone pages in a browser
// since the same day): its lines day by day in one column, each day's hours beside it, and the week's total; and where
// it stands in words (who approves it, who decided it and when, why it was rejected). The person's own week (My
// Timesheet) and the one waiting for the approver (To Approve) both show them. No hooks.

/** The week's lines, day by day: what each was for, its note and its hours; a day without any said as such. */
export function PhoneWeekLines({ view }: { view: Pick<TimesheetWeekView, 'days' | 'entries' | 'totalHours'> }) {
  return (
    <section aria-label="The week’s hours" className="card divide-y divide-line-soft">
      {view.days.map((d) => {
        const lines = view.entries.filter((e) => e.date === d.date);
        return (
          <div key={d.date} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold tabular-nums">{dayHead(d.date)}</h3>
              <span className="text-sm text-muted tabular-nums">{d.hours ? timesheetHoursText(d.hours) : 'No hours'}</span>
            </div>
            {lines.length > 0 && (
              <ul className="mt-2 space-y-2">
                {lines.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words">
                      {lineWhat(e)}
                      {e.note && <span className="block text-xs whitespace-pre-line text-muted">{e.note}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{timesheetHoursText(e.hours)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{timesheetHoursText(view.totalHours)}</span>
      </div>
    </section>
  );
}

/**
 * Where the week stands, in words: waiting for whom (not said to the one it waits for), approved or rejected by whom and
 * when, and why it was rejected.
 */
export function WeekStanding({ view }: { view: Pick<TimesheetWeekView, 'status' | 'approver' | 'decidedBy' | 'decidedAt' | 'rejectReason' | 'can'> }) {
  return (
    <>
      {view.status === 'submitted' && !view.can.decide && <p className="text-sm text-muted">Waiting for {view.approver ? view.approver.fullNameEn : 'HR'} to approve it.</p>}
      {(view.status === 'approved' || view.status === 'rejected') && view.decidedBy && (
        <p className="text-sm text-muted">
          {view.status === 'approved' ? 'Approved' : 'Rejected'} by {view.decidedBy}
          {view.decidedAt && `, ${formatDateTime(view.decidedAt)}`}
        </p>
      )}
      {view.status === 'rejected' && view.rejectReason && (
        <p role="note" className="rounded-lg bg-danger-soft px-4 py-3 text-sm whitespace-pre-line text-danger">
          {view.rejectReason}
        </p>
      )}
    </>
  );
}
