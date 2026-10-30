import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Pill } from '@/components/design';
import type { AttendanceDay } from '@/lib/attendance-types';
import { addMonths, monthName } from '../payroll/list';
import { dayStatusText, dayTone } from '../payroll/[id]/attendance/attendance';
import { correctedNote, dayPairs, dayRow, daySourceText, hoursText, type DayEnd, type FigureTile, type PunchRow } from '../attendance/attendance';
import { AllPresses, FlagBadges, MapLink, OdPressMark } from '../attendance/punch-ui';
import { CompensatoryHoursBadge, DayPairsLine, ExemptBadge, FirstDayLine, OdDayBadge, OpenPressLine, WfhDayBadge } from '../attendance/ui';
import { dayBalance, dayLabel, figureColumns, glanceOf, type GlanceKind } from './my-days';

// My Attendance's parts in the owner's design (30 October 2026, Figma "PeopleTrendlix", desktop), built here from the
// Attendance pages' own pieces (attendance/ui.tsx, punch-ui.tsx), which the other attendance pages keep as they are: the
// month switch in a pill, the month at a glance, the month's figures as cards, and the days as the design's table. No
// hooks, nothing server-only.

const TONE = { danger: 'text-danger', warn: 'text-warn' } as const;
const NONE = <span className="text-muted">—</span>;

/** The month, with the month before and after a click away, in the design's pill (real links; the month is said in full). */
export function MonthSwitch({ month, hrefFor }: { month: string; hrefFor: (month: string) => string }) {
  const [before, after] = [addMonths(month, -1), addMonths(month, 1)];
  const step = 'flex size-9 items-center justify-center rounded-full text-ink no-underline transition-colors hover:bg-raised';
  return (
    <nav aria-label="Month" className="inline-flex items-center gap-1 rounded-full border border-line bg-card p-1">
      <Link href={hrefFor(before)} className={step}>
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.6} />
        <span className="sr-only">{monthName(before)}</span>
      </Link>
      <p aria-current="page" className="min-w-28 text-center text-xs text-ink tabular-nums">
        {monthName(month)}
      </p>
      <Link href={hrefFor(after)} className={step}>
        <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.6} />
        <span className="sr-only">{monthName(after)}</span>
      </Link>
    </nav>
  );
}

/** A dot's look by what the day was: worked filled, rest quiet, a holiday round, leave a ring; absent in red. */
const DOT: Record<GlanceKind, string> = {
  worked: 'rounded-[2px] bg-ink',
  rest: 'rounded-[2px] bg-line',
  holiday: 'rounded-full bg-muted',
  leave: 'rounded-full border border-ink',
  zoho_leave: 'rounded-full border border-warn',
  absent: 'rounded-[2px] bg-danger',
  no_check_in: 'rounded-[2px] border border-warn',
};

/**
 * The month at a glance (the design's): the days worked, large, and a dot for each day on record with its legend. The
 * design's attendance rate is left out (my-days.ts).
 */
export function MonthGlance({ month, daysWorked, days, className = '' }: { month: string; daysWorked: number; days: readonly AttendanceDay[]; className?: string }) {
  const glance = glanceOf(days);
  return (
    <section aria-labelledby="glance-heading" className={`card p-[22px] ${className}`}>
      <h2 id="glance-heading" className="eyebrow">
        Month at a glance
      </h2>
      <p className="mt-5 flex items-center gap-3">
        <span className="text-[2.9rem] leading-none font-normal tracking-[-0.065em] tabular-nums">{daysWorked}</span>
        <span className="text-xs leading-tight text-muted">
          {daysWorked === 1 ? 'day' : 'days'}
          <br />
          worked
        </span>
      </p>
      {glance.dots.length > 0 && (
        <>
          <div role="img" aria-label={`Your days in ${monthName(month)}: ${glance.summary}`} className="mt-6 grid grid-cols-[repeat(13,minmax(0,1fr))] gap-y-[5px]">
            {glance.dots.map((d) => (
              <span key={d.date} title={d.title} className={`block size-2 ${DOT[d.kind]}`} />
            ))}
          </div>
          <ul aria-hidden="true" className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted">
            {glance.legend.map((l) => (
              <li key={l.kind} className="flex items-center gap-1.5">
                <span className={`block size-2 ${DOT[l.kind]}`} />
                {l.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The month's figures as the design's cards: what it is, the figure, a note at the foot (in its colour when it needs a look). */
export function FigureCards({ tiles, label }: { tiles: FigureTile[]; label: string }) {
  return (
    <dl
      aria-label={label}
      style={{ '--cols': figureColumns(tiles.length) } as React.CSSProperties}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
    >
      {tiles.map((t) => (
        <div key={t.key} className="card flex min-h-[112px] flex-col p-[15px]">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className={`mt-2 text-[1.6rem] leading-tight font-normal tracking-[-0.04em] tabular-nums ${t.tone ? TONE[t.tone] : ''}`}>{t.value}</dd>
          {t.note && <dd className="mt-auto pt-2 text-[11px] leading-snug text-muted">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** What a day was: worked and leave as the design's badges, the rest in words (absent in red, for HR to check in amber). */
function StatusView({ status }: { status: AttendanceDay['status'] }) {
  if (status === 'worked') return <Pill strong>{dayStatusText(status)}</Pill>;
  if (status === 'leave') return <Pill className="text-ink">{dayStatusText(status)}</Pill>;
  const tone = dayTone(status);
  return <span className={tone ? `font-medium ${TONE[tone]}` : undefined}>{dayStatusText(status)}</span>;
}

/** A day's check-in or check-out as the design's cell: its time (or Missing, in amber), its place under it with OD and Map, its flags. */
function EndCell({ end }: { end: DayEnd }) {
  if (end.shown === 'none') return NONE;
  const badge = end.badge;
  return (
    <span className="block space-y-1">
      {end.shown === 'missing' ? <span className="block font-medium text-warn">Missing</span> : <span className="block whitespace-nowrap tabular-nums">{end.time}</span>}
      {(badge || end.press) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {badge && (
            <span title={badge.title ?? undefined}>
              {badge.label}
              {badge.title && <span className="sr-only"> ({badge.title})</span>}
            </span>
          )}
          <OdPressMark press={end.press} />
          <MapLink press={end.press} />
        </span>
      )}
      <FlagBadges flags={end.flags} />
    </span>
  );
}

/**
 * Every day of the month, read only, as the design's table: the day, what it was (with working from home, official duty,
 * exempt, hours off, its pairs, a correction's note, every press, and where it came from when not the month's usual), the check-in and check-out
 * with their place, the hours, the balance (over or short, and the permission), what Zoho says, and the day's correction.
 */
export function MyDaysTable({
  days,
  punches,
  wfhDays,
  usual,
  action,
}: {
  days: readonly AttendanceDay[];
  punches: readonly PunchRow[];
  wfhDays: readonly string[];
  /** Where most days came from (said under the table): a row says its own only when it differs. */
  usual: string | null;
  action?: (day: AttendanceDay) => React.ReactNode;
}) {
  return (
    <div className="relative overflow-x-auto rounded-[13px] border border-line">
      <table className="table [&_tr:last-child_td]:border-b-0">
        <caption className="sr-only">Your days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">What it was</th>
            <th scope="col">Check-in</th>
            <th scope="col">Check-out</th>
            <th scope="col">Hours</th>
            <th scope="col">Balance</th>
            <th scope="col">Zoho says</th>
            {action && <th scope="col">Correction</th>}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const row = dayRow(d, punches);
            const corrected = correctedNote(d);
            const pairs = dayPairs(d);
            const label = dayLabel(d.date);
            const balance = dayBalance(d);
            const source = daySourceText(d);
            return (
              <tr key={d.date} className="align-top">
                <td className="whitespace-nowrap">
                  <span className="block">{label.day}</span>
                  <span className="block text-[11px] text-muted tabular-nums">{label.rest}</span>
                </td>
                <td className="min-w-36">
                  <StatusView status={d.status} />
                  {wfhDays.includes(d.date) && <WfhDayBadge className="mt-1 block w-fit" />}
                  {d.od && <OdDayBadge od={d.od} className="mt-1 block w-fit" />}
                  <ExemptBadge of={d} className="mt-1 block w-fit" />
                  {/* hours off for part of a rest day worked (27 October 2026) */}
                  <CompensatoryHoursBadge day={d} className="mt-1 block w-fit" />
                  {/* its pairs and break (25 October 2026: "the working hours to be calculated between the checkin and out only") */}
                  <DayPairsLine pairs={pairs} />
                  {corrected && <span className="mt-0.5 block text-xs text-muted">{corrected}</span>}
                  {row.more && <AllPresses presses={row.presses} />}
                  {/* where the day came from (Zoho People, checked in on the system, a device, corrected), when not the month's usual */}
                  {source !== usual && <span className="mt-1 block text-[11px] text-muted">{source}</span>}
                </td>
                <td className="min-w-32">
                  <EndCell end={row.checkIn} />
                  {/* a first day counted from the shift's start (27 October 2026): the press itself shown, the note under it */}
                  <FirstDayLine day={d} />
                </td>
                <td className="min-w-32">
                  <EndCell end={row.checkOut} />
                  {/* a last check-in without a check-out (25 October 2026: "flag the open one") */}
                  <OpenPressLine pairs={pairs} exempt={d.exempt} />
                </td>
                <td className="tabular-nums">{d.status === 'worked' ? hoursText(d.hoursCounted) : NONE}</td>
                <td className="tabular-nums">
                  {balance ? (
                    <span
                      title={balance.kind === 'short' ? 'Short of the shift’s hours, after the day’s permission' : 'Extra time past the shift’s hours'}
                      className={balance.kind === 'short' ? 'font-medium text-warn' : 'text-ok'}
                    >
                      {balance.text}
                      <span className="sr-only"> {balance.kind === 'short' ? 'short' : 'extra'}</span>
                    </span>
                  ) : (
                    NONE
                  )}
                  {d.permissionHours > 0 && <span className="block text-xs whitespace-nowrap text-muted">{hoursText(d.permissionHours)} permission</span>}
                </td>
                <td>{d.zohoStatus ?? NONE}</td>
                {action && <td className="[&_a]:text-xs [&_a]:font-normal [&_a]:underline [&_a]:underline-offset-4">{action(d)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
