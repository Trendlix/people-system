import { KPI_FINAL_CAP, kpiMonthAdd, kpiMonthOnly, type KpiLevel, type KpiScorecardSummary, type KpiSettings } from '@trendlix/shared';

// My KPIs as the owner's design words it (Figma "PeopleTrendlix", the desktop version, 30 October 2026): the day the
// next scorecards open, the latest score shown to the employee for the ring, and the four steps of a month's review with
// the day each is due by. Only what the rules say (packages/shared kpis.ts): a month's scorecard opens on the 1st of the
// next month (owner, 21 October 2026: "Last month's KPI, this pay"), the steps "Self, manager, HR, sign-off", each due
// by its day of that month in the KPI settings. Pure code, tested; relative imports, as vitest doesn't know the "@/"
// paths.

/**
 * The day the next scorecards open (YYYY-MM-DD): the 1st of the month after `today` (Cairo's day, YYYY-MM-DD). The API
 * opens last month's on the 1st, so on the 1st itself the next ones are a month away.
 */
export const nextOpeningDay = (today: string): string => `${kpiMonthAdd(today.slice(0, 7), 1)}-01`;

/** The page head's badge (the design's "Next cycle · 01 November"). */
export const nextCycleText = (today: string): string => `Next cycle · 01 ${kpiMonthOnly(nextOpeningDay(today))}`;

/** A day of the month in words: "1st", "2nd", "3rd", "4th", "11th", "21st", "28th". */
export function ordinalDay(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const unit = day % 10;
  return `${day}${unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'}`;
}

/** A scorecard with its final % and level shown. */
export type Shown<S> = S & { finalPercent: number; level: KpiLevel };

/** The newest scorecard whose final % the employee sees (from the sign-off on); null while none is shown. Newest first in. */
export const latestShown = <S extends Pick<KpiScorecardSummary, 'finalPercent' | 'level'>>(list: readonly S[]): Shown<S> | null =>
  list.find((s): s is Shown<S> => s.finalPercent !== null && s.level !== null) ?? null;

/** How much of the ring a final % fills: up to the 110% cap, as the history's bars. */
export const ringShare = (percent: number): number => Math.max(0, Math.min(1, percent / KPI_FINAL_CAP));

/** A step of the month's review, as "How it works" shows it. */
export interface ReviewStep {
  title: string;
  text: string;
  /** "By the 3rd" (of the next month), from the KPI settings; null when they couldn't be read. */
  due: string | null;
}

/**
 * The four steps (owner, 21 October 2026: "Self, manager, HR, sign-off"): the self-rating, the manager's scoring (seeing
 * the self-rating), HR's calibration (a changed pick needs a reason) and the sign-off by both, where the employee first
 * sees the score; each with the day it is due by.
 */
export function reviewSteps(settings: Pick<KpiSettings, 'selfRatingDay' | 'managerDay' | 'hrDay' | 'signOffDay'> | null): ReviewStep[] {
  const due = (day: number | undefined) => (typeof day === 'number' ? `By the ${ordinalDay(day)}` : null);
  return [
    {
      title: 'Self-rating',
      text: 'From the 1st of the next month, you pick how you did on each metric, with a comment if you like.',
      due: due(settings?.selfRatingDay),
    },
    { title: 'Manager’s scoring', text: 'Your manager scores the month, seeing your self-rating.', due: due(settings?.managerDay) },
    { title: 'HR calibration', text: 'HR checks the scoring and may change a pick, giving the reason.', due: due(settings?.hrDay) },
    { title: 'Sign-off', text: 'You see the score, then you both sign that you have read it.', due: due(settings?.signOffDay) },
  ];
}
