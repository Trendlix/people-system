import Link from 'next/link';
import type { MonthCorrectable, MonthCorrection } from '@/lib/correction-types';
import type { AttendanceDay } from '@/lib/attendance-types';
import { formatDate } from '@/lib/format';
import { appCorrectionHref, appItemHref } from '@/lib/surface';
import { correctedNote, dayPairs, dayRow, daySourceText, extraHoursText, hoursText, type PunchRow } from '../../../(app)/attendance/attendance';
import { dayCorrection } from '../../../(app)/attendance/corrections/corrections';
import { isWfhDay, WFH_DAY_BADGE } from '../../../(app)/attendance/wfh/wfh';
import { OD_DAY_BADGE } from '../../../(app)/attendance/official-duty/od';
import { leaveStatusLabel } from '../../../(app)/leave/list';
import { AllPresses, DayEndView } from '../../../(app)/attendance/punch-ui';
import { CompensatoryHoursBadge, DayPairsLine, ExemptBadge, FirstDayLine, OpenPressLine } from '../../../(app)/attendance/ui';
import { weekdayOf } from '../../../(app)/organization/holidays/holidays';
import { dayStatusText, dayTone } from '../../../(app)/payroll/[id]/attendance/attendance';

// A month's days on the phone pages (owner, 20 October 2026: the employee app, "My attendance … a day → Ask for a
// correction"): My Attendance's table (attendance/ui.tsx, DaysTable) as a list a phone can read, each day a card with
// what it was, the check-in and check-out, the hours counted and short (or extra, owner, 20 October 2026: make-up
// hours), the permission, what it was corrected from; and the day's correction: Ask for a correction (a day gone by or
// today, not of leave, in a month whose payroll isn't approved, as the site says it: dayCorrection), or the correction
// being decided.
// Simpler (owner, 20 October 2026: "simplify this, i want to view if it is remote or office, and location link"): the
// check-in and the check-out each with its place as a badge, a Map link to where it was pressed (their own spot) and the
// flags in a word or two, and every press of the day collapsed in "All presses (14)" (punch-ui.tsx). A work from home day
// approved for them (owner, 21 October 2026: "think about how should we handle the working from home in out erp") says
// "Working from home" beside what the day was. A day of several check-in → check-out pairs (owner, 25 October 2026: "the
// working hours to be calculated between the checkin and out only, not the first and last") lists them with its break,
// and an open last check-in says "Checked in 6:30 PM · not checked out" under the check-out ("Count the closed pairs,
// flag the open one"); an exempt day (owner, 25 October 2026) carries an "Exempt" badge, its presses kept for reference.
// A compensatory day off approved (owner, 26 October 2026: "WFH and compensatory pages in the phone app") carries the
// site's "Compensatory day off" badge in its place (ExemptBadge, attendance.ts exemptBadge): a full paid day, its hours
// counted, never absent or short. Hours off for part of a rest day worked (owner, 27 October 2026: "Hours off for hours
// worked") say "Compensatory hours off: 4 h" on the working day they are taken, counted as worked.

const TONE = { danger: 'text-danger', warn: 'text-warn' } as const;

function Figure({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${tone ?? ''}`}>{children}</dd>
    </div>
  );
}

function DayAction({
  day,
  corrections,
  correctable,
  today,
  askFrom,
}: {
  day: AttendanceDay;
  corrections: readonly MonthCorrection[];
  correctable: MonthCorrectable | null | undefined;
  today: string;
  askFrom: string | null;
}) {
  const c = dayCorrection(day, corrections, correctable, today, appCorrectionHref, askFrom);
  if (!c) return null;
  if (c.kind === 'open') {
    return (
      <Link href={appItemHref('requests', 'correction', c.id)} className="btn btn-secondary min-h-11 w-full">
        Correction {leaveStatusLabel(c.status).toLowerCase()}
        <span className="sr-only"> for {formatDate(day.date)}</span>
      </Link>
    );
  }
  return (
    <Link href={c.href} className="btn btn-secondary min-h-11 w-full">
      Ask for a correction<span className="sr-only"> for {formatDate(day.date)}</span>
    </Link>
  );
}

export function DayList({
  days,
  punches,
  corrections,
  correctable,
  today,
  wfhDays,
  askFrom = null,
}: {
  days: readonly AttendanceDay[];
  punches: readonly PunchRow[];
  /** The month's corrections; none (an API from before them): no way to ask. */
  corrections: readonly MonthCorrection[] | undefined;
  correctable: MonthCorrectable | null | undefined;
  today: string;
  /** The month's work from home days approved for them; none (an API from before them): none shown. */
  wfhDays?: readonly string[];
  /** The earliest day they can still ask to correct (owner, 31 October 2026: "locked after 2 working days"). */
  askFrom?: string | null;
}) {
  return (
    <ol aria-label="Your days" className="space-y-2">
      {days.map((d) => {
        const tone = dayTone(d.status);
        const row = dayRow(d, punches);
        const corrected = correctedNote(d);
        const pairs = dayPairs(d);
        return (
          <li key={d.date} className="card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold tabular-nums">
                {weekdayOf(d.date)} {formatDate(d.date)}
              </h3>
              <span className="flex flex-wrap items-baseline justify-end gap-2">
                {isWfhDay({ wfhDays }, d.date) && <span className="badge bg-accent-soft text-accent">{WFH_DAY_BADGE}</span>}
                {/* "Exempt", or "Compensatory day off" (26 October 2026) */}
                <ExemptBadge of={d} />
                {/* hours off for part of a rest day worked (27 October 2026: "Hours off for hours worked") */}
                <CompensatoryHoursBadge day={d} />
                {/* a day of official duty (23 October 2026), opening its request */}
                {d.od && (
                  <Link href={appItemHref('requests', 'od', d.od.requestId)} className="badge bg-ok-soft text-ok no-underline">
                    {OD_DAY_BADGE}
                  </Link>
                )}
                <span className={`text-sm font-medium ${tone ? TONE[tone] : 'text-muted'}`}>{dayStatusText(d.status)}</span>
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              <Figure label="Check-in">
                <DayEndView end={row.checkIn} />
                {/* a first day counted from the shift's start (27 October 2026) */}
                <FirstDayLine day={d} />
              </Figure>
              <Figure label="Check-out">
                <DayEndView end={row.checkOut} />
                <OpenPressLine pairs={pairs} exempt={d.exempt} />
              </Figure>
              <Figure label="Hours counted">
                {d.status === 'worked' ? hoursText(d.hoursCounted) : '—'}
                {/* make-up hours (owner, 20 October 2026): counted past the shift's hours a day */}
                {extraHoursText(d) && <span className="block text-xs font-normal text-ok">{extraHoursText(d)}</span>}
              </Figure>
              <Figure label="Short" tone={d.shortHours > 0 ? 'text-warn' : undefined}>
                {d.shortHours > 0 ? hoursText(d.shortHours) : '—'}
              </Figure>
            </dl>
            <DayPairsLine pairs={pairs} className="mt-2" />
            <p className="mt-2 text-xs text-muted">{[d.permissionHours > 0 ? `Permission ${hoursText(d.permissionHours)}` : null, daySourceText(d)].filter(Boolean).join(' · ')}</p>
            {corrected && <p className="mt-1 text-xs text-muted">{corrected}</p>}
            {row.more && <AllPresses presses={row.presses} className="mt-2" />}
            {corrections && (
              <div className="mt-3 empty:hidden">
                <DayAction day={d} corrections={corrections} correctable={correctable} today={today} askFrom={askFrom} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
