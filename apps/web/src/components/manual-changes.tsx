import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { ManualChangesPopup } from './manual-changes-popup';

/**
 * The manual changes popup (owner, 4 November 2026: "when HR corrects something manually, her manager has to be notified
 * in a popup"), in the site's layout and the phone pages': for anyone signed in as themself with an employee profile
 * (never while a Super Admin views as someone, nor in the developer view, nor on Hold). Nothing when the API can't be
 * reached. Put in a layout, inside a Suspense boundary.
 */
export async function ManualChanges({ big = false, surface }: { big?: boolean; surface: 'site' | 'app' }) {
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  if (!user || user.viewAs || user.developer || user.hold || !user.employeeId) return null;
  return <ManualChangesPopup big={big} surface={surface} />;
}
