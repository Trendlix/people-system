import Link from 'next/link';
import type { AttendanceDay, AttendanceSource } from '@/lib/attendance-types';
import { formatDate } from '@/lib/format';
import { weekdayOf } from '../organization/holidays/holidays';
import { addMonths, monthName } from '../payroll/list';
import { attendanceReviewHref, dayStatusText, dayTone } from '../payroll/[id]/attendance/attendance';
import {
  COMPENSATORY_HOURS_TITLE,
  compensatoryHoursText,
  correctedNote,
  dayPairs,
  dayRow,
  daySourceText,
  exemptBadge,
  exemptionsText,
  extraHoursText,
  firstDayNote,
  hoursText,
  ISSUE_TITLES,
  personHref,
  sourceText,
  type DayPairs,
  type FigureTile,
  type IssueDay,
  type IssueKind,
  type PunchRow,
} from './attendance';
import { recordsHref } from '@/lib/attendance-records';
import { AllPresses, DayEndView } from './punch-ui';
import { WFH_DAY_BADGE } from './wfh/wfh';
import { OD_DAY_BADGE, odDayTitle, odHref } from './official-duty/od';

// The Attendance pages' parts (owner, 19 October 2026: "the attendance is not active in the side menu"): the month with
// the one before and after, a month's figures as tiles, a person's days, and where the days came from. No hooks and
// nothing server-only, so the client table (people-table.tsx) shows the days with the same. Checking in on the system
// (owner, 19 October 2026: "Check-in through the system (phone or web with the office location check, or a device) to
// replace Zoho"): each day says where it came from, a check-in that broke the work arrangement's rule is flagged in
// amber, a place may be location unknown, and a check-out without a check-in shows "Missing" like a missing check-out.
// A day counted past the shift's hours a day (owner, 20 October 2026: make-up hours) says its extra time, "+1:30 extra".
// Simpler rows (owner, 20 October 2026: "simplify this, i want to view if it is remote or office, and location link"):
// the check-in and the check-out each with its place as a badge and Map (punch-ui.tsx), the flags in a word or two by
// them, "What It Was" the day's status with every press collapsed under it, and no Where column (the badges say it: a
// day from Zoho People has its place on the check-in). A day worked from home (owner, 21 October 2026: "think about how
// should we handle the working from home in out erp"): "Working from home" by its status, a dashed badge, not leave's.
// A day of official duty (owner, 23 October 2026: "Official duty (OD) requests"; "OD counted as attended"): "On official
// duty" by its status in its own colour, opening its request. A day as the sum of its pairs (owner, 25 October 2026: "the
// working hours to be calculated between the checkin and out only, not the first and last"; "Count the closed pairs,
// flag the open one"): a day of several pairs lists them and its break under what it was, and an open last check-in
// says so in amber under the check-out (counted as half a day until corrected, owner, 27 October 2026: "open check ins
// with half day"; short by the rest). An exempt day (owner,
// 25 October 2026: "trat them as if they achived their full working hours") carries an "Exempt" badge, its presses
// still shown for reference. A new employee's first day (owner, 27 October 2026: "a new employee when checked in in his
// first day move the checkin to 9am automatically to prevent delay in instructions"; "Counted from the shift start"):
// the day is counted from the shift's start whatever time they pressed, so under its check-in (the press itself) a quiet
// line says "First day: counted from the shift start (checked in 10:40 AM)" (FirstDayLine).

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
/**
 * The figures: what each counts and the number, no description under it (owner, 31 October 2026: "remove the
 * description below the number"): it shows on hover, and a screen reader says it.
 */
export function FigureTiles({
  tiles,
  label,
}: {
  tiles: (Omit<FigureTile, 'tone'> & { tone: 'danger' | 'warn' | 'ok' | null; href?: string; current?: boolean })[];
  label: string;
}) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {tiles.map((t) => {
        const body = (
          <>
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${t.tone ? FIGURE_TONE[t.tone] : ''}`}>{t.value}</dd>
            {t.note && <dd className="sr-only">{t.note}</dd>}
          </>
        );
        // a figure stating an issue opens its days (owner, 31 October 2026: "when i click on flagged days list me the
        // employee and the days")
        return t.href ? (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            aria-current={t.current ? 'true' : undefined}
            title={t.current ? 'Hide the days' : `${t.note ? `${t.note}. ` : ''}Click to list the days`}
            className={`card block px-4 py-3 no-underline transition-colors hover:border-ink ${t.current ? 'border-ink' : ''}`}
          >
            <div>{body}</div>
          </Link>
        ) : (
          <div key={t.key} className="card px-4 py-3" title={t.note ?? undefined}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}

/** The days behind an issue's figure (owner, 31 October 2026): whose, when, what happened, each day's records a click away. */
export function IssueList({ kind, rows, month, closeHref }: { kind: IssueKind; rows: readonly IssueDay[]; month: string; closeHref: string }) {
  return (
    <section id="issue" aria-labelledby="issue-heading" className="card scroll-mt-6 overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <h2 id="issue-heading" className="font-semibold">
          {ISSUE_TITLES[kind]} · {rows.length} {rows.length === 1 ? 'day' : 'days'}
        </h2>
        <Link href={closeHref} scroll={false} className="text-sm font-semibold">
          Close
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No days of this kind among those listed.</p>
      ) : (
        <table className="table mt-3">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Day</th>
              <th scope="col">What happened</th>
              <th scope="col">
                <span className="sr-only">Records</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.employeeId}:${r.date}`}>
                <td>
                  <Link href={personHref(r.employeeId, month)} className="font-semibold">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted">{r.code}</div>
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {weekdayOf(r.date).slice(0, 3)} {formatDate(r.date)}
                </td>
                <td className="text-sm">{r.detail}</td>
                <td className="text-right">
                  <Link href={recordsHref(r.employeeId, r.date)} className="text-sm whitespace-nowrap">
                    Records<span className="sr-only"> of {r.name} on {r.date}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const FIGURE_TONE = { danger: 'text-danger', warn: 'text-warn', ok: 'text-ok' } as const;

const NONE = <span className="text-muted">—</span>;

/** "Exempt" (owner, 25 October 2026): on an exempt day, or a person's month with exempt days; nothing otherwise. */
export function ExemptBadge({ of, className = '' }: { of: Parameters<typeof exemptBadge>[0]; className?: string }) {
  const badge = exemptBadge(of);
  if (!badge) return null;
  return (
    <span className={`badge border border-line bg-card text-ink ${className}`} title={badge.title}>
      {badge.label}
      <span className="sr-only"> ({badge.title})</span>
    </span>
  );
}

/**
 * "Compensatory hours off: 4 h" (owner, 27 October 2026: "Hours off for hours worked"): on a working day with hours off
 * approved for part of a rest day worked, counted as worked; nothing on any other day.
 */
export function CompensatoryHoursBadge({ day, className = '' }: { day: Parameters<typeof compensatoryHoursText>[0]; className?: string }) {
  const text = compensatoryHoursText(day);
  if (!text) return null;
  return (
    <span className={`badge border border-line bg-card text-ink ${className}`} title={COMPENSATORY_HOURS_TITLE}>
      {text}
      <span className="sr-only"> ({COMPENSATORY_HOURS_TITLE})</span>
    </span>
  );
}

/** A person's month's periods exempt from check-in, at its top (25 October 2026); nothing without any. */
export function ExemptionNote({ periods, self = false, className = '' }: { periods: Parameters<typeof exemptionsText>[0]; self?: boolean; className?: string }) {
  const text = exemptionsText(periods);
  if (!text) return null;
  return (
    <p className={`flex flex-wrap items-center gap-2 text-sm ${className}`}>
      <ExemptBadge of={{ exempt: true }} />
      <span>
        {text}. {self ? 'Your working days count as full hours; checking in is optional.' : 'Their working days count as full hours; any presses are kept for reference.'}
      </span>
    </p>
  );
}

/** A day's pairs and break (25 October 2026), under what the day was; nothing for a day of one pair. */
export function DayPairsLine({ pairs, className = 'mt-1' }: { pairs: DayPairs | null; className?: string }) {
  if (!pairs) return null;
  return (
    <span className={`block text-xs ${className}`}>
      {pairs.pairs && <span className="block tabular-nums">{pairs.pairs}</span>}
      {pairs.break && <span className="block text-muted">{pairs.break}</span>}
    </span>
  );
}

/** An open last check-in after the day's pairs, in amber (muted on an exempt day, where nothing is missing). */
export function OpenPressLine({ pairs, exempt = false, className = 'mt-1' }: { pairs: DayPairs | null; exempt?: boolean; className?: string }) {
  if (!pairs?.open) return null;
  return <span className={`block text-xs ${exempt ? 'text-muted' : 'font-medium text-warn'} ${className}`}>{pairs.open}</span>;
}

/**
 * A new employee's first day, counted from the shift's start (owner, 27 October 2026), under its check-in: "First day:
 * counted from the shift start (checked in 10:40 AM)"; nothing for any other day.
 */
export function FirstDayLine({ day, className = 'mt-1' }: { day: Parameters<typeof firstDayNote>[0]; className?: string }) {
  const note = firstDayNote(day);
  if (!note) return null;
  return <span className={`block text-xs text-muted ${className}`}>{note}</span>;
}

/** The badge of a day worked from home (approved for them), a distinct style from leave: a dashed outline. */
export function WfhDayBadge({ className = '' }: { className?: string }) {
  return <span className={`badge border border-dashed border-accent bg-card text-accent ${className}`}>{WFH_DAY_BADGE}</span>;
}

/** The badge of a day of official duty approved for them, in its own colour, opening its request (23 October 2026). */
export function OdDayBadge({ od, className = '' }: { od: { requestId: string; fullDay: boolean; fromTime: string | null; toTime: string | null }; className?: string }) {
  return (
    <Link href={odHref(od.requestId)} prefetch={false} title={odDayTitle(od)} className={`badge border border-ok bg-ok-soft text-ok no-underline ${className}`}>
      {OD_DAY_BADGE}
      <span className="sr-only">: open the official duty request</span>
    </Link>
  );
}

/** Every day kept of a person's month, read only: where each came from, its flags. */
export function DaysTable({
  days,
  name,
  punches = [],
  wfhDays = [],
  action,
}: {
  days: readonly AttendanceDay[];
  name: string;
  /** Every press of the month: each day's check-in and check-out are among them, the rest collapsed under the day. */
  punches?: readonly PunchRow[];
  /** The month's work from home days approved for them (21 October 2026): each says "Working from home". */
  wfhDays?: readonly string[];
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
            const row = dayRow(d, punches);
            const corrected = correctedNote(d);
            const extra = extraHoursText(d);
            const pairs = dayPairs(d);
            return (
              <tr key={d.date} className="align-top">
                <td className="whitespace-nowrap tabular-nums">
                  {weekdayOf(d.date)} {formatDate(d.date)}
                </td>
                <td className="min-w-32">
                  <span className={tone ? `font-medium ${TONE[tone]}` : undefined}>{dayStatusText(d.status)}</span>
                  {wfhDays.includes(d.date) && <WfhDayBadge className="mt-1 block w-fit" />}
                  {d.od && <OdDayBadge od={d.od} className="mt-1 block w-fit" />}
                  <ExemptBadge of={d} className="mt-1 block w-fit" />
                  {/* hours off for part of a rest day worked (27 October 2026) */}
                  <CompensatoryHoursBadge day={d} className="mt-1 block w-fit" />
                  {/* its pairs and break (25 October 2026: "the working hours to be calculated between the checkin and out only") */}
                  <DayPairsLine pairs={pairs} />
                  {corrected && <span className="mt-0.5 block text-xs text-muted">{corrected}</span>}
                  {row.more && <AllPresses presses={row.presses} />}
                </td>
                <td className="min-w-36">
                  <DayEndView end={row.checkIn} />
                  {/* a first day counted from the shift's start (27 October 2026): the press itself shown, the note under it */}
                  <FirstDayLine day={d} />
                </td>
                <td className="min-w-36">
                  <DayEndView end={row.checkOut} />
                  {/* a last check-in without a check-out (25 October 2026: "flag the open one") */}
                  <OpenPressLine pairs={pairs} exempt={d.exempt} />
                </td>
                <td className="text-right tabular-nums">
                  {d.status === 'worked' ? hoursText(d.hoursCounted) : NONE}
                  {extra && <span className="block text-xs whitespace-nowrap text-ok">{extra}</span>}
                </td>
                <td className={`text-right tabular-nums ${d.shortHours > 0 ? 'font-medium text-warn' : ''}`}>{d.shortHours > 0 ? hoursText(d.shortHours) : NONE}</td>
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
