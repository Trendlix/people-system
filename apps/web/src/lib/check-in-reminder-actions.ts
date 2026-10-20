'use server';

// The check-in reminder's popup (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave
// every 10 minutes. like a popup"): whether it is due for the person signed in now (GET /me/check-in-reminder), asked on
// load and every 10 minutes as a background request, so a page left open never keeps an idle session alive (HR, Admin
// and Super Admin are signed out after 15 minutes without activity). The API alone decides; this only asks. Signed out,
// an older API or the server unreachable: null, and nothing shows (the idle warning takes care of a session that ended).
import type { CheckInReminderView } from '@trendlix/shared';
import { ApiError, apiFetch } from './api';
import { checkInReminderOf } from './check-in-reminder';

export async function askCheckInReminder(): Promise<CheckInReminderView | null> {
  let res: Response;
  try {
    res = await apiFetch('/me/check-in-reminder', undefined, { background: true });
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  if (!res.ok) return null;
  return checkInReminderOf(await res.json().catch(() => null));
}
