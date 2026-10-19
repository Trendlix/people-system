import Link from 'next/link';
import { MY_ATTENDANCE } from '@/components/nav';
import type { CheckInTodayView } from '@/lib/attendance-types';
import { loadJson } from '../payroll/load';
import { checkInShows, dayTitle } from './check-in';
import { CheckInPanel } from './check-in-panel';

// Today's check-in as a card (owner, 19 October 2026: "Check-in through the system (phone or web with the office
// location check, or a device) to replace Zoho"): first on the employee's Dashboard, at the top of My Attendance, and a
// compact one on the home page of HR, the CEO and Finance with an employee profile (`home`: only when they check in,
// with the way to My Attendance, which their sidebar doesn't list). GET /me/attendance/today says whether they check in:
// someone with no employee profile or no current employment gets nothing; a freelancer, or someone without a shift yet,
// the reason, quietly. Nothing from an API from before it (404). Inside a Suspense boundary: it reads with the session.

export async function TodayCheckIn({ home = false, className = '' }: { home?: boolean; className?: string }) {
  const loaded = await loadJson<CheckInTodayView>('/me/attendance/today');
  if (loaded.kind === 'unavailable' || loaded.kind === 'forbidden') return null;
  if (loaded.kind === 'failed') {
    if (home) return null;
    return (
      <section className={`card p-5 ${className}`}>
        <h2 className="font-semibold">Today</h2>
        <p className="mt-3 text-sm text-muted">Today&apos;s check-in couldn&apos;t be loaded. {loaded.messages.join(' ')}</p>
      </section>
    );
  }
  const view = loaded.value;
  const shows = checkInShows(view);
  if (shows === 'hidden' || (home && shows !== 'panel')) return null;
  return (
    <section aria-label="Today's check-in" className={`card p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold">Today</h2>
        <span className="text-xs text-muted tabular-nums">{dayTitle(view.date)}</span>
      </div>
      <div className="mt-3">
        {shows === 'refusal' ? <p className="text-sm text-muted">{view.refusal}</p> : <CheckInPanel initial={view} compact={home} />}
      </div>
      {home && (
        <p className="mt-4 text-sm">
          <Link href={MY_ATTENDANCE} className="font-semibold">
            Open my attendance
          </Link>
        </p>
      )}
    </section>
  );
}
