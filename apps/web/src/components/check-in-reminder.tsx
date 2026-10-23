import { ApiError } from '@/lib/api';
import type { ReminderSurface } from '@/lib/check-in-reminder';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { CheckInReminderPopup } from './check-in-reminder-popup';

/**
 * The check-in reminder's popup (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave
 * every 10 minutes. like a popup"), in the site's layout and the phone pages': for someone with an employee profile (the
 * reminder is about their shift), never while a Super Admin views as someone. Nothing when the API can't be reached. Put
 * in a layout, inside a Suspense boundary.
 */
export async function CheckInReminder({ surface }: { surface: ReminderSurface }) {
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  // not in the developer view either: it changes nothing, checking in included (as themselves they check in; 22 October 2026)
  if (!user || user.viewAs || user.developer || !user.employeeId) return null;
  // on Hold (23 October 2026: "Check-in/out only") it keeps working: Check in opens the Hold page
  return <CheckInReminderPopup surface={surface} held={!!user.hold} />;
}
