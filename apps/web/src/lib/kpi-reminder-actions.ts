'use server';

// The KPI reminder's popup (owner, 1 November 2026: "in a popup reminder on each login"): what waits for the person
// signed in (GET /kpis/reminder, a background request, so it never keeps an idle session alive), and "Postpone 1 day"
// (POST /kpis/reminder/postpone, once a month's round; the API refuses a second). Signed out or unreachable: null.
import type { KpiReminderView } from '@trendlix/shared';
import { ApiError, apiFetch, apiSend } from './api';

export async function askKpiReminder(): Promise<KpiReminderView | null> {
  let res: Response;
  try {
    res = await apiFetch('/kpis/reminder', undefined, { background: true });
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
  if (!res.ok) return null;
  return ((await res.json().catch(() => null)) as KpiReminderView | null) ?? null;
}

export async function postponeKpiReminder(): Promise<{ view?: KpiReminderView; errors?: string[] }> {
  try {
    return { view: (await apiSend<KpiReminderView>('POST', '/kpis/reminder/postpone'))! };
  } catch (err) {
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
}
