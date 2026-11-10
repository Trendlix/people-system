import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { DayPingsPerson, DayPingsView } from '@trendlix/shared';
import { recordsHref } from '@/lib/attendance-records';
import { formatDate } from '@/lib/format';
import { joinShown } from '@/lib/hidden';
import { weekdayOf } from '../organization/holidays/holidays';
import { hourlyDayNav, hourlySummary, noPingsText, opensFlagged, pingChip, stayText } from './hourly-location';

// The hourly location on Daily Attendance (owner, 10 November 2026: "can it be embeded in the attendance page?";
// hourly-location.ts): one day, closed to a line ("14 checked in · 3 flagged · 9 without pings") unless something is
// flagged; each person's pings as chips, the flagged in the warning colour, their name opening the day's records (the
// points on a map there); the day before and after a click away.

export const HOURLY_LOCATION_ID = 'hourly-location';

const TONES = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', muted: 'bg-raised text-muted' } as const;

export function HourlyLocation({
  view,
  people,
  month,
  day,
  today,
  hrefFor,
  setupHref,
}: {
  view: DayPingsView;
  /** Those shown: everyone's, or those the page's filters list. */
  people: DayPingsPerson[];
  month: string;
  day: string;
  today: string;
  /** Daily Attendance showing another day's. */
  hrefFor: (day: string) => string;
  /** Check-in Setup, where it is switched on (HR's); null: not theirs. */
  setupHref: string | null;
}) {
  const nav = hourlyDayNav(month, day, today);
  return (
    <details id={HOURLY_LOCATION_ID} className="card group scroll-mt-24" open={opensFlagged(people)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <h2 className="text-lg font-semibold">
            Hourly Location · {weekdayOf(day)} {formatDate(day)}
          </h2>
          <span className="block text-sm text-muted">{view.enabled ? hourlySummary(people) : 'Switched off'}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" strokeWidth={1.6} />
      </summary>
      <div className="space-y-4 border-t border-line-soft px-6 pt-4 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex gap-4">
            {nav.prev && (
              <Link href={hrefFor(nav.prev)} className="font-semibold" scroll={false}>
                ‹ {weekdayOf(nav.prev)} {formatDate(nav.prev)}
              </Link>
            )}
            {nav.next && (
              <Link href={hrefFor(nav.next)} className="font-semibold" scroll={false}>
                {weekdayOf(nav.next)} {formatDate(nav.next)} ›
              </Link>
            )}
          </div>
          {!view.enabled && (
            <p className="text-muted">
              The app doesn’t read the location every hour while it’s off.
              {setupHref && (
                <>
                  {' '}
                  <Link href={setupHref} className="font-semibold">
                    Switch it on in Check-in Setup
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        {people.length === 0 ? (
          <p className="text-sm text-muted">Nobody checked in on the system on this day.</p>
        ) : (
          <ul className="divide-y divide-line">
            {people.map((p) => {
              const about = joinShown([p.employee.employeeCode, p.employee.department]);
              return (
                <li key={p.employee.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3">
                  <div className="min-w-48">
                    <Link href={recordsHref(p.employee.id, day)} className="font-semibold">
                      {p.employee.fullNameEn}
                    </Link>
                    {about && <p className="text-xs text-muted">{about}</p>}
                    {p.checkIn && <p className="text-xs text-muted tabular-nums">{stayText(p)}</p>}
                  </div>
                  {/* under the name on a phone, beside it from a small screen up */}
                  <div className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:flex-1 sm:justify-end">
                    {p.pings.length ? (
                      p.pings.map((x) => {
                        const chip = pingChip(x);
                        return (
                          <span key={x.at} className={`badge tabular-nums ${TONES[chip.tone]}`}>
                            {chip.text}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-sm text-muted">{noPingsText(p)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">
          The app reads the location every hour while someone is checked in, on Android once they allow it &ldquo;all the time&rdquo;. iPhones read it at
          check-in and check-out only, for now. A name opens the day&apos;s records, each point on a map.
        </p>
      </div>
    </details>
  );
}
