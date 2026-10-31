import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { reviewDueFor } from '@/app/(app)/own-profile';
import { ReviewRedirect } from './review-redirect';

/**
 * The review at sign-in (owner, 31 October 2026: "make the data review obligatory upon the signin for employees"): while
 * an employee's details wait for their review (never confirmed, or changed by HR since, and no change request of theirs
 * waiting), every page sends them to it, keeping open only the review and what it leads to (asking HR for a change,
 * sending HR a new photo); Sign out stays in the header. In place of the banner that said so on every page. Only a page
 * gate: the API answers them as before (an older app must still check in). Put in a layout, inside a Suspense boundary;
 * renders nothing else.
 */
export async function ReviewGate() {
  let due: string | null;
  try {
    due = await reviewDueFor(await getCurrentUser());
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  return due ? <ReviewRedirect employeeId={due} /> : null;
}
