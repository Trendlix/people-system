'use server';

// The manual changes popup (owner, 4 November 2026: "when HR corrects something manually, her manager has to be notified
// in a popup"; asked, "Shows until marked seen"): the changes made by hand for employees by the people the person
// manages (GET /me/manual-changes, a background request, so it never keeps an idle session alive), and Seen (POST
// /me/manual-changes/seen: read on the bell too). Signed out or unreachable: null.
import type { ManualChangesView } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend } from './api';

export async function askManualChanges(): Promise<ManualChangesView | null> {
  let res: Response;
  try {
    res = await apiFetch('/me/manual-changes', undefined, { background: true });
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  if (!res.ok) return null;
  return ((await res.json().catch(() => null)) as ManualChangesView | null) ?? null;
}

export async function markManualChangesSeen(): Promise<{ errors?: string[] }> {
  try {
    await apiSend('POST', '/me/manual-changes/seen');
    return {};
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}
