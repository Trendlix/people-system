import { describe, expect, it } from 'vitest';
import { kpiReminderHref, kpiReminderLine, markSeen, seenThisSignIn } from './kpi-reminder';

// The KPI reminder's popup (owner, 1 November 2026: "in a popup reminder on each login").

const counts = (self: number, team: number, hr: number) => ({ self, team, hr });

describe('the KPI reminder', () => {
  it('opens the one scorecard waiting, else the list of those waiting', () => {
    expect(kpiReminderHref({ only: 'abc', counts: counts(0, 1, 0) })).toBe('/kpis/scorecards/abc');
    expect(kpiReminderHref({ only: null, counts: counts(0, 3, 0) })).toBe('/approvals#kpi-scorecards');
    expect(kpiReminderHref({ only: null, counts: counts(0, 0, 2) })).toBe('/approvals#kpi-scorecards');
    expect(kpiReminderHref({ only: null, counts: counts(2, 0, 0) })).toBe('/kpis');
  });

  it('says how many wait', () => {
    expect(kpiReminderLine({ waiting: 1 })).toBe('1 scorecard is waiting for you.');
    expect(kpiReminderLine({ waiting: 4 })).toBe('4 scorecards are waiting for you.');
  });

  it('shows once a sign-in: a new sign-in is a new session', () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(seenThisSignIn(storage, 's1')).toBe(false);
    markSeen(storage, 's1');
    expect(seenThisSignIn(storage, 's1')).toBe(true);
    expect(seenThisSignIn(storage, 's2')).toBe(false);
    expect(seenThisSignIn(null, 's1')).toBe(false);
  });
});
