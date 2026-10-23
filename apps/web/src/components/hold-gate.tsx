import { HOLD_PATH } from '@trendlix/shared';
import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';

/**
 * Someone whose access is on hold (owner, 23 October 2026: "Access should be on hold with a 7 days grace period one time
 * granted by the hr"; on Hold "Check-in/out only", on the website and in the app): every page sends them to the Hold
 * page, with the check-in panel and sign out (the API refuses everything else meanwhile). A Super Admin viewing as them
 * goes there too, as they would; its banner takes them back. Put in a layout, inside a Suspense boundary; renders nothing.
 */
export async function HoldGate() {
  try {
    if ((await getCurrentUser()).hold) redirect(HOLD_PATH);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  return null;
}
