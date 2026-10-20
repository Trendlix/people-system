import Link from 'next/link';
import type { AttendanceDay, AttendanceSource } from '@/lib/attendance-types';
import { formatDate } from '@/lib/format';
import { weekdayOf } from '../organization/holidays/holidays';
import { addMonths, monthName } from '../payroll/list';
import { attendanceReviewHref, cairoTime, dayStatusText, dayTone, placeText } from '../payroll/[id]/attendance/attendance';
import { checkInCell, correctedNote, dayFlagTexts, daySourceText, extraHoursText, hoursText, punchesText, sourceText, type FigureTile, type PunchRow } from './attendance';

// The Attendance pages' parts (owner, 19 October 2026: "the attendance is not active in the side menu"): the month with
// the one before and after, a month's figures as tiles, a person's days, and where the days came from. No hooks and
// nothing server-only, so the client table (people-table.tsx) shows the days with the same. Checking in on the system
// (owner, 19 October 2026: "Check-in through the system (phone or web with the office location check, or a device) to
// replace Zoho"): each day says where it came from, a check-in that broke the work arrangement's rule is flagged in
// amber, a place may be location unknown, and a check-out without a check-in shows "Missing" like a missing check-out.
// A day counted past the shift's hours a day (owner, 20 October 2026: make-up hours) says its extra time, "+1:30 extra".

const LINK = 'btn btn-secondary min-h-9 px-3 no-underline';
const TONE = { danger: 'text-danger', warn: 'text-warn' } as const;

/** The month, with the month before and after a click away (the address keeps everything else). */
export function MonthNav({ month, hrefFor }: { month: string; hrefFor: (month: string) => string }) {
  const [before, after] = [addMonths(month, -1), addMonths(month, 1)];
  return (
    <nav aria-label="Month" className="flex flex-wrap items-center gap-2">
      <Link href={hrefFor(before)} className={LINK}>
        ← <span className="sr-only">{monthName(before)}</span>
        <span aria-hidden="true">{monthName(before).slice(0, 3)}</span>
      </Link>
      <h2 aria-current="page" className="px-2 text-lg font-semibold tabular-nums">
        {monthName(month)}
      </h2>
      <Link href={hrefFor(after)} className={LINK}>
        <span aria-hidden="true">{monthName(after).slice(0, 3)}</span>
        <span className="sr-only">{monthName(after)}</span> →
      </Link>
    </nav>
  );
}

/** A month's figures as tiles. */
export function FigureTiles({ tiles, label }: { tiles: FigureTile[]; label: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {tiles.map((t) => (
        <div key={t.key} className="card px-4 py-3">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className={`mt-1 text-lg font-semibold tabular-nums ${t.tone ? TONE[t.tone] : ''}`}>{t.value}</dd>
          {t.note && <dd className="text-xs text-muted">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

const MISSING = <span className="font-medium text-warn">Missing</span>;
const NONE = <span className="text-muted">—</span>;

/** Every day kept of a person's month, read only: where each came from, its flags. */
export function DaysTable({
  days,
  name,
  punches = [],
  action,
}: {
  days: readonly AttendanceDay[];
  name: string;
  /** Every press of the month, shown under its day (a person's month only). */
  punches?: readonly PunchRow[];
  /**
   * A day's correction (owner, 19 October 2026: "Attendance corrections with approval"): Ask for a correction on the
   * employee's own month, HR's Correct on a person's, or the correction being decided; none: no column.
   */
  action?: (day: AttendanceDay) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <caption className="sr-only">The days of {name}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">What It Was</th>
            <th scope="col">Check-in</th>
            <th scope="col">Check-out</th>
            <th scope="col" className="text-right">
              Hours Counted
            </th>
            <th scope="col" className="text-right">
              Short
            </th>
            <th scope="col">Where</th>
            <th scope="col" className="text-right">
              Permission
            </th>
            <th scope="col">From</th>
            <th scope="col">Zoho Says</th>
            {action && <th scope="col">Correction</th>}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const tone = dayTone(d.status);
            const checkIn = checkInCell(d);
            const flags = dayFlagTexts(d);
            const corrected = correctedNote(d);
            const pressed = punchesText(punches, d.date);
            const extra = extraHoursText(d);
            return (
              <tr key={d.date} className="align-top">
                <td className="whitespace-nowrap tabular-nums">
                  {weekdayOf(d.date)} {formatDate(d.date)}
                </td>
                <td className="min-w-32">
                  <span className={tone ? `font-medium ${TONE[tone]}` : undefined}>{dayStatusText(d.status)}</span>
                  {corrected && <span className="mt-0.5 block text-xs text-muted">{corrected}</span>}
                  {pressed && <span className="mt-0.5 block max-w-64 text-xs text-muted">{pressed}</span>}
                </td>
                <td className="whitespace-nowrap tabular-nums">{checkIn === 'time' ? cairoTime(d.checkIn) : checkIn === 'missing' ? MISSING : NONE}</td>
                <td className="whitespace-nowrap tabular-nums">{d.checkOut ? cairoTime(d.checkOut) : d.missingCheckOut ? MISSING : NONE}</td>
                <td className="text-right tabular-nums">
                  {d.status === 'worked' ? hoursText(d.hoursCounted) : NONE}
                  {extra && <span className="block text-xs whitespace-nowrap text-ok">{extra}</span>}
                </td>
                <td className={`text-right tabular-nums ${d.shortHours > 0 ? 'font-medium text-warn' : ''}`}>{d.shortHours > 0 ? hoursText(d.shortHours) : NONE}</td>
                <td className="min-w-32">
                  {placeText(d.place)}
                  {flags.map((f) => (
                    <span key={f} className="mt-1 block w-fit max-w-56 badge bg-warn-soft whitespace-normal text-warn">
                      {f}
                    </span>
                  ))}
                </td>
                <td className="text-right tabular-nums">{d.permissionHours > 0 ? hoursText(d.permissionHours) : NONE}</td>
                <td className="text-sm whitespace-nowrap text-muted">{daySourceText(d)}</td>
                <td className="text-sm text-muted">{d.zohoStatus ?? '—'}</td>
                {action && <td>{action(d)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Where the days shown came from: each import, when read and applied and by whom; its review for those who open it. */
export function SourcesNote({ sources, reviews }: { sources: readonly AttendanceSource[]; reviews: boolean }) {
  if (!sources.length) return null;
  return (
    <section aria-label="Where these days came from" className="space-y-1 text-sm text-muted">
      <p className="font-medium text-ink">From Zoho People</p>
      <ul className="space-y-0.5">
        {sources.map((s) => (
          <li key={s.importId}>
            {sourceText(s)}
            {reviews && (
              <>
                {' · '}
                <Link href={attendanceReviewHref(s.runId, s.importId)} className="font-semibold">
                  Review<span className="sr-only"> the import read {s.createdAt.slice(0, 10)}</span>
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
