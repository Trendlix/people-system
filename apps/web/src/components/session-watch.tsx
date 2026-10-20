import { ApiError } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import type { Session } from '@/lib/view-as';
import { IdleWatcher } from './idle-watcher';

/**
 * The idle warning, for those signed out after 15 minutes without activity (owner, 20 October 2026: HR, Admin and Super
 * Admin, on the website and the app; the Super Admin's own while they view as someone, as the API says on /auth/me).
 * Nothing for anyone else, or when the API can't be reached. Put in a layout, inside a Suspense boundary.
 */
export async function SessionWatch() {
  let user: Session | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const timeoutMs = user?.session?.idleTimeoutMs;
  return timeoutMs ? <IdleWatcher timeoutMs={timeoutMs} /> : null;
}
