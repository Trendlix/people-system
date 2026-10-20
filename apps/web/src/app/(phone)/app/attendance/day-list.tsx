import Link from 'next/link';
import type { MonthCorrectable, MonthCorrection } from '@/lib/correction-types';
import type { AttendanceDay } from '@/lib/attendance-types';
import { formatDate } from '@/lib/format';
import { appCorrectionHref, appItemHref } from '@/lib/surface';
import { checkInCell, correctedNote, dayFlagTexts, daySourceText, hoursText, punchesText, type PunchRow } from '../../../(app)/attendance/attendance';
import { dayCorrection } from '../../../(app)/attendance/corrections/corrections';
import { leaveStatusLabel } from '../../../(app)/leave/list';
import { weekdayOf } from '../../../(app)/organization/holidays/holidays';
import { cairoTime, dayStatusText, dayTone, placeText } from '../../../(app)/payroll/[id]/attendance/attendance';

// A month's days on the phone pages (owner, 20 October 2026: the employee app, "My attendance … a day → Ask for a
// correction"): My Attendance's table (attendance/ui.tsx, DaysTable) as a list a phone can read, each day a card with
// what it was, the check-in and check-out, the hours counted and short, where, the permission, the flags, what it was
// corrected from and every press; and the day's correction: Ask for a correction (a day gone by or today, not of leave,
// in a month whose payroll isn't approved, as the site says it: dayCorrection), or the correction being decided.

const TONE = { danger: 'text-danger', warn: 'text-warn' } as const;

function Figure({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${tone ?? ''}`}>{children}</dd>
    </div>
  );
}

function DayAction({ day, corrections, correctable, today }: { day: AttendanceDay; corrections: readonly MonthCorrection[]; correctable: MonthCorrectable | null | undefined; today: string }) {
  const c = dayCorrection(day, corrections, correctable, today, appCorrectionHref);
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
}: {
  days: readonly AttendanceDay[];
  punches: readonly PunchRow[];
  /** The month's corrections; none (an API from before them): no way to ask. */
  corrections: readonly MonthCorrection[] | undefined;
  correctable: MonthCorrectable | null | undefined;
  today: string;
}) {
  return (
    <ol aria-label="Your days" className="space-y-2">
      {days.map((d) => {
        const tone = dayTone(d.status);
        const inCell = checkInCell(d);
        const flags = dayFlagTexts(d);
        const corrected = correctedNote(d);
        const pressed = punchesText(punches, d.date);
        return (
          <li key={d.date} className="card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold tabular-nums">
                {weekdayOf(d.date)} {formatDate(d.date)}
              </h3>
              <span className={`text-sm font-medium ${tone ? TONE[tone] : 'text-muted'}`}>{dayStatusText(d.status)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 min-[380px]:grid-cols-4">
              <Figure label="Check-in" tone={inCell === 'missing' ? 'text-warn' : undefined}>
                {inCell === 'time' ? cairoTime(d.checkIn) : inCell === 'missing' ? 'Missing' : '—'}
              </Figure>
              <Figure label="Check-out" tone={!d.checkOut && d.missingCheckOut ? 'text-warn' : undefined}>
                {d.checkOut ? cairoTime(d.checkOut) : d.missingCheckOut ? 'Missing' : '—'}
              </Figure>
              <Figure label="Hours counted">{d.status === 'worked' ? hoursText(d.hoursCounted) : '—'}</Figure>
              <Figure label="Short" tone={d.shortHours > 0 ? 'text-warn' : undefined}>
                {d.shortHours > 0 ? hoursText(d.shortHours) : '—'}
              </Figure>
            </dl>
            <p className="mt-2 text-xs text-muted">
              {[d.place ? placeText(d.place) : null, d.permissionHours > 0 ? `Permission ${hoursText(d.permissionHours)}` : null, daySourceText(d)].filter(Boolean).join(' · ')}
            </p>
            {corrected && <p className="mt-1 text-xs text-muted">{corrected}</p>}
            {pressed && <p className="mt-1 text-xs text-muted">{pressed}</p>}
            {flags.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1.5">
                {flags.map((f) => (
                  <span key={f} className="badge bg-warn-soft whitespace-normal text-warn">
                    {f}
                  </span>
                ))}
              </p>
            )}
            {corrections && (
              <div className="mt-3 empty:hidden">
                <DayAction day={d} corrections={corrections} correctable={correctable} today={today} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
