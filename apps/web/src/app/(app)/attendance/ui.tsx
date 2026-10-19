import Link from 'next/link';
import type { AttendanceDay, AttendanceSource } from '@/lib/attendance-types';
import { formatDate } from '@/lib/format';
import { weekdayOf } from '../organization/holidays/holidays';
import { addMonths, monthName } from '../payroll/list';
import { attendanceReviewHref, cairoTime, dayStatusText, dayTone, placeText } from '../payroll/[id]/attendance/attendance';
import { hoursText, sourceText, type FigureTile } from './attendance';

// The Attendance pages' parts (owner, 19 October 2026: "the attendance is not active in the side menu"): the month with
// the one before and after, a month's figures as tiles, a person's days, and where the days came from. No hooks and
// nothing server-only, so the client table (people-table.tsx) shows the days with the same.

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

/** Every day kept of a person's month, read only. */
export function DaysTable({ days, name }: { days: readonly AttendanceDay[]; name: string }) {
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
            <th scope="col">Zoho Says</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const tone = dayTone(d.status);
            return (
              <tr key={d.date}>
                <td className="whitespace-nowrap tabular-nums">
                  {weekdayOf(d.date)} {formatDate(d.date)}
                </td>
                <td className={tone ? `font-medium ${TONE[tone]}` : undefined}>{dayStatusText(d.status)}</td>
                <td className="whitespace-nowrap tabular-nums">{d.checkIn ? cairoTime(d.checkIn) : <span className="text-muted">—</span>}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {d.checkOut ? cairoTime(d.checkOut) : d.missingCheckOut ? <span className="font-medium text-warn">Missing</span> : <span className="text-muted">—</span>}
                </td>
                <td className="text-right tabular-nums">{d.status === 'worked' ? hoursText(d.hoursCounted) : <span className="text-muted">—</span>}</td>
                <td className={`text-right tabular-nums ${d.shortHours > 0 ? 'font-medium text-warn' : ''}`}>{d.shortHours > 0 ? hoursText(d.shortHours) : <span className="text-muted">—</span>}</td>
                <td>{placeText(d.place)}</td>
                <td className="text-right tabular-nums">{d.permissionHours > 0 ? hoursText(d.permissionHours) : <span className="text-muted">—</span>}</td>
                <td className="text-sm text-muted">{d.zohoStatus ?? '—'}</td>
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
