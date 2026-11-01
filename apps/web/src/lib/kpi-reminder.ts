import type { KpiReminderView } from '@trendlix/shared';

// The KPI reminder's popup (owner, 1 November 2026: "when there is a KPI Scoring Pending make it in a floater, can be
// postponed for 1 day only"; "and can be done before the postponed date"; "in a popup reminder on each login"): once on
// each sign-in while scorecards wait, unless postponed (the API keeps that, for every device). Pure, tested.

/** Where "Score now" goes: the one scorecard waiting, else the list of those waiting. */
export function kpiReminderHref(v: Pick<KpiReminderView, 'only' | 'counts'>): string {
  if (v.only) return `/kpis/scorecards/${encodeURIComponent(v.only)}`;
  return v.counts.team > 0 || v.counts.hr > 0 ? '/approvals#kpi-scorecards' : '/kpis';
}

/** "3 scorecards are waiting for you." */
export const kpiReminderLine = (v: Pick<KpiReminderView, 'waiting'>): string =>
  v.waiting === 1 ? '1 scorecard is waiting for you.' : `${v.waiting} scorecards are waiting for you.`;

/** The browser's note of the sign-in the popup was shown in: once a sign-in. */
const SEEN_KEY = 'kpi-reminder-seen';

/** Whether the popup was shown already in this sign-in (`sessionId`). */
export function seenThisSignIn(storage: Pick<Storage, 'getItem'> | null, sessionId: string): boolean {
  try {
    return storage?.getItem(SEEN_KEY) === sessionId;
  } catch {
    return false;
  }
}

/** Notes that it was shown in this sign-in. */
export function markSeen(storage: Pick<Storage, 'setItem'> | null, sessionId: string): void {
  try {
    storage?.setItem(SEEN_KEY, sessionId);
  } catch {
    // storage blocked: it may show again on the next page load, nothing worse
  }
}
