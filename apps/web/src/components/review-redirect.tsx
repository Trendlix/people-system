'use client';

import { redirect, usePathname } from 'next/navigation';
import { openDuringReview, reviewHref } from '@/app/(app)/employees/confirmation';

/**
 * The review gate's part in the browser (components/review-gate.tsx): the layout stays as one moves between its pages,
 * so the address is checked here on every page, the first one included (on the server too); anything but the review's
 * own pages goes to the review. The layout reads again once they confirm or ask for a change, and this goes.
 */
export function ReviewRedirect({ employeeId }: { employeeId: string }) {
  const path = usePathname();
  if (!openDuringReview(path, employeeId)) redirect(reviewHref(employeeId));
  return null;
}
