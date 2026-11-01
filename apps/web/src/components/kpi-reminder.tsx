import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { KpiReminderPopup } from './kpi-reminder-popup';

/**
 * The KPI reminder's popup (owner, 1 November 2026: "in a popup reminder on each login"), in the site's layout and the
 * phone pages': for anyone signed in as themself (never while a Super Admin views as someone, nor in the developer
 * view, nor on Hold). Nothing when the API can't be reached. Put in a layout, inside a Suspense boundary.
 */
export async function KpiReminder({ big = false }: { big?: boolean }) {
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  if (!user || user.viewAs || user.developer || user.hold || !user.session?.id) return null;
  return <KpiReminderPopup sessionId={user.session.id} big={big} />;
}
