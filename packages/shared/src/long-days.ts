// A freelancer's long day on a shift (owner, 3 November 2026: "can i add markup or if passed several hours count as ?";
// asked, "After N hours, count as", "Freelancers only", "set per shift", "if more than N Hours Count as Y Hours"; "this
// rule may be enables or disabled in a specific shift"): a shift may say that a day a freelancer is counted more than N
// hours (N "over hours") counts as Y hours ("counts as"), both set on the shift, the rule switched on or off there (its
// hours kept while it is off). Read with the days as they are counted (the shift's window, "Count hours until"), never stored, so a
// change of the shift applies to every month read after it, as the payroll's draft refills; the days kept keep their own
// hours. Employees on the shift are counted as before. Pure code, tested in apps/api/src/common/long-days.spec.ts.

/** The limits: N in half hours from 0.5 to 24, Y in half hours more than N and at most 48. */
export const LONG_DAY_LIMITS = { overMin: 0.5, overMax: 24, countsAsMax: 48 } as const;

/** A shift's long-day rule: a freelancer's day counted more than `overHours` counts as `countsAs` hours. */
export interface LongDayRule {
  overHours: number;
  countsAs: number;
}

/** A shift's long-day settings: the switch and the two hours. */
export interface LongDaySettings {
  longDayOn?: boolean | null;
  longDayOverHours?: number | null;
  longDayCountsAs?: number | null;
}

/** A shift's rule from its settings; null while it is off, or without both hours. */
export function longDayRuleOf(shift: LongDaySettings | null | undefined): LongDayRule | null {
  const over = shift?.longDayOverHours;
  const countsAs = shift?.longDayCountsAs;
  return shift?.longDayOn && typeof over === 'number' && typeof countsAs === 'number' ? { overHours: over, countsAs } : null;
}

const halfHours = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v * 2);

/**
 * What is wrong with a shift's long-day rule as it will be, each in words (none: it can be saved): switched on, both hours
 * given; given, N in half hours from 0.5 to 24 and Y in half hours, more than N, at most 48.
 */
export function longDayProblems(on: unknown, over: unknown, countsAs: unknown): string[] {
  const none = (v: unknown) => v === null || v === undefined;
  if (none(over) && none(countsAs)) return on === true ? ['Freelancers’ long day: give the hours and what they count as, or switch it off.'] : [];
  if (none(over) || none(countsAs)) return ['Freelancers’ long day: give both the hours and what they count as, or leave both empty.'];
  const L = LONG_DAY_LIMITS;
  const problems: string[] = [];
  if (!halfHours(over) || over < L.overMin || over > L.overMax) problems.push(`Freelancers’ long day: give the hours in half hours from ${L.overMin} to ${L.overMax}, e.g. 10.`);
  if (!halfHours(countsAs) || countsAs > L.countsAsMax) problems.push(`Freelancers’ long day: give what they count as in half hours up to ${L.countsAsMax}, e.g. 14.`);
  else if (halfHours(over) && countsAs <= over) problems.push('Freelancers’ long day: it must count as more hours than it takes.');
  return problems;
}

/** A day's hours counted under the rule: more than its hours, what they count as; else as they are. */
export const longDayHours = (hours: number, rule: LongDayRule | null | undefined): number => (rule && hours > rule.overHours ? rule.countsAs : hours);

/** The rule in words: "More than 10:00 a day counts as 14:00". */
export function longDayText(rule: LongDayRule): string {
  const hm = (h: number) => `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`;
  return `More than ${hm(rule.overHours)} a day counts as ${hm(rule.countsAs)}`;
}
