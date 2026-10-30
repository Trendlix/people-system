import { cache } from 'react';
import { PanelHead } from '@/components/design';
import type { CheckInTodayView } from '@/lib/attendance-types';
import { loadJson } from '../payroll/load';
import { checkInShows, dayTitle, longDayTitle } from './check-in';
import { CheckInPanel, TodayCard, TodayHeadButton } from './check-in-panel';

// Today's check-in as a card (owner, 19 October 2026: "Check-in through the system (phone or web with the office
// location check, or a device) to replace Zoho"): first on the employee's Dashboard, at the top of My Attendance, and a
// compact one on the home page of HR, the CEO and Finance with an employee profile (`home`: only when they check in,
// with the way to My Attendance, which their sidebar doesn't list). GET /me/attendance/today says whether they check in:
// someone with no employee profile or no current employment gets nothing; a freelancer, or someone without a shift yet,
// the reason, quietly. Nothing from an API from before it (404). Inside a Suspense boundary: it reads with the session.
// `big`: first on the phone pages' Home (owner, 20 October 2026: the employee app, "to enable them to check in and
// out"), the larger button and a larger check-in counter (owner, 20 October 2026: "employees need to see a checkin
// counter after their checkin": check-in-counter.tsx, inside the panel).
// The owner's design (30 October 2026, Figma "PeopleTrendlix", desktop; check-in-panel.tsx TodayCard): `variant`
// "dashboard" (the default, and the staff home page's) is the Dashboard's Today card, "TODAY" over the day, its badge,
// the work time in a ring, the work location and Check in now →; "attendance" is My Attendance's "Ready to start?".
// The phone pages' `big` keeps the panel as it was. `className` goes on the card (e.g. h-full in a grid). The Dashboard
// head's "Check in for work" (TodayCheckInButton) is the same press; today is read once for both.

/** Today's check-in, read once a request for the card and the head's button. */
const loadToday = cache(() => loadJson<CheckInTodayView>('/me/attendance/today'));

export async function TodayCheckIn({
  home = false,
  big = false,
  variant = 'dashboard',
  className = '',
}: {
  home?: boolean;
  big?: boolean;
  variant?: 'dashboard' | 'attendance';
  className?: string;
}) {
  const loaded = await loadToday();
  if (loaded.kind === 'unavailable' || loaded.kind === 'forbidden') return null;
  if (loaded.kind === 'failed') {
    if (home) return null;
    return (
      <section aria-label="Today's check-in" className={`card ${big ? 'p-5' : 'p-[22px]'} ${className}`}>
        {big ? <h2 className="font-semibold">Today</h2> : <PanelHead eyebrow="Today" title="Today’s check-in" />}
        <p className="mt-3 text-sm text-muted">Today&apos;s check-in couldn&apos;t be loaded. {loaded.messages.join(' ')}</p>
      </section>
    );
  }
  const view = loaded.value;
  const shows = checkInShows(view);
  if (shows === 'hidden' || (home && shows !== 'panel')) return null;
  if (big) {
    return (
      <section aria-label="Today's check-in" className={`card p-5 ${className}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="font-semibold">Today</h2>
          <span className="text-xs text-muted tabular-nums">{dayTitle(view.date)}</span>
        </div>
        <div className="mt-3">{shows === 'refusal' ? <p className="text-sm text-muted">{view.refusal}</p> : <CheckInPanel initial={view} big />}</div>
      </section>
    );
  }
  // a freelancer, or no shift yet: the reason, quietly, in the card's place (never on the staff home page: `home` above)
  if (shows === 'refusal') {
    return (
      <section aria-label="Today's check-in" className={`card p-[22px] ${className}`}>
        <PanelHead eyebrow={variant === 'attendance' ? `Today · ${dayTitle(view.date)}` : 'Today'} title={variant === 'attendance' ? 'Checking in' : longDayTitle(view.date)} />
        <p className="mt-4 text-sm text-muted">{view.refusal}</p>
      </section>
    );
  }
  return <TodayCard initial={view} variant={variant} compact={home} home={home} className={className} />;
}

/**
 * The Dashboard head's button (the owner's design, 30 October 2026): "Check in for work", or "Checked in · 8:57 AM";
 * only when they check in today (no refusal); nothing when today couldn't be read (the card says so). Inside a Suspense
 * boundary, as the card.
 */
export async function TodayCheckInButton() {
  const loaded = await loadToday();
  if (loaded.kind !== 'ok' || checkInShows(loaded.value) !== 'panel') return null;
  return <TodayHeadButton initial={loaded.value} />;
}
