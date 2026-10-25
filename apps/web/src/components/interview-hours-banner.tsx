import type { InterviewHoursReminder } from '@trendlix/shared';
import Link from 'next/link';
import { ApiError, apiFetch } from '@/lib/api';
import { MY_INTERVIEW_HOURS_PATH } from '@/lib/calendars';

// The home page's reminder (owner, 25 October 2026: "Hours + calendar"; the brief: "a banner on the dashboard of anyone
// who is a hiring manager of an open vacancy or on an upcoming panel and has no hours: 'Set your interview hours so HR
// can book you'"). The API says whether to show it (GET /me/interview-hours/reminder); anything else (no employee profile,
// an API from before it, the API down) shows nothing, so the home page never fails for it. Asked in the background, as
// the sidebar's counts are: it isn't the person's own activity.

export async function InterviewHoursBanner() {
  let show = false;
  try {
    const res = await apiFetch('/me/interview-hours/reminder', undefined, { background: true });
    if (res.ok) show = ((await res.json()) as InterviewHoursReminder)?.show === true;
  } catch (err) {
    // the API unreachable, or an answer that isn't JSON: nothing shown (anything else, e.g. Next's own, goes on)
    if (!(err instanceof ApiError) && !(err instanceof SyntaxError)) throw err;
  }
  if (!show) return null;
  return (
    <p role="status" className="mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-accent-soft px-4 py-3 text-sm font-semibold text-accent">
      Set your interview hours so HR can book you.
      <Link href={MY_INTERVIEW_HOURS_PATH} className="btn btn-secondary min-h-9 px-3">
        Set my interview hours
      </Link>
    </p>
  );
}
