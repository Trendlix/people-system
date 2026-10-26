import { formatHours } from '@trendlix/shared';

// Recount past days (owner, 26 October 2026, after changing the MORNING shift to 8:00 AM–8:00 PM, 9 hours, grace 0,
// counting until 8:00 PM: "i want to recount previous payrolls on the new shift run"; asked earlier, "Months not yet
// paid"): Organization → Shifts. The months to choose from, and the preview's and the result's sentences. Pure code,
// tested; relative imports, as vitest doesn't know the @/ paths.

/** The most months one recount takes (the API's limit). */
export const RECOUNT_MONTHS_MAX = 12;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09" → "September 2026". */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** "2026-09" shifted by n months. */
export function monthsAfter(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** The months to choose from, this month first, back so many. */
export function recountMonths(thisMonth: string, back = 24): string[] {
  return Array.from({ length: back + 1 }, (_, i) => monthsAfter(thisMonth, -i));
}

/** What is wrong with a From–To choice, in words; null when it is fine. */
export function recountRangeProblem(from: string, to: string, thisMonth: string): string | null {
  if (!from || !to) return 'Choose the first and the last month.';
  if (to > thisMonth) return 'Choose months up to this month.';
  if (from > to) return 'The first month can’t be after the last.';
  if (monthsAfter(from, RECOUNT_MONTHS_MAX - 1) < to) return `Recount at most ${RECOUNT_MONTHS_MAX} months at a time.`;
  return null;
}

/** The API's answer to a preview and to a run. */
export interface RecountView {
  from: string;
  to: string;
  shiftId: string | null;
  months: string[];
  skipped: { month: string; status: string }[];
  days: number;
  people: number;
  zohoDays: number;
  daysChanged: number;
  hoursChanged: number;
  peopleChanged: number;
  hoursBefore: number;
  hoursAfter: number;
  correctedDays: number;
  linesRefilled: number;
}

const STATUS_WORDS: Record<string, string> = { pending_ceo: 'with the CEO', approved: 'approved', paid: 'paid' };

/** "September (approved), August (paid)": the months left as they are. */
export function skippedText(skipped: readonly { month: string; status: string }[]): string {
  return skipped.map((s) => `${MONTH_NAMES[Number(s.month.slice(5, 7)) - 1]} ${s.month.slice(0, 4)} (${STATUS_WORDS[s.status] ?? s.status})`).join(', ');
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The preview: "412 days in 3 months for 57 people (31 days would change); months skipped: …". */
export function previewText(v: RecountView): string {
  const base = `${plural(v.days, 'day')} in ${plural(v.months.length, 'month')} for ${plural(v.people, 'person', 'people')}`;
  const change = v.daysChanged
    ? `${plural(v.daysChanged, 'day')} would change (${formatHours(v.hoursBefore)} → ${formatHours(v.hoursAfter)} hours)`
    : 'nothing would change';
  return `${base}: ${change}.${v.skipped.length ? ` Months skipped: ${skippedText(v.skipped)}.` : ''}`;
}

/** The result: "Recounted 412 days (57 changed: 401:30 → 418:15 hours), 23 draft lines refilled. Skipped: August (paid)." */
export function resultText(v: RecountView): string {
  const changed = v.daysChanged ? ` (${v.daysChanged} changed: ${formatHours(v.hoursBefore)} → ${formatHours(v.hoursAfter)} hours)` : ' (none changed)';
  const lines = `${plural(v.linesRefilled, 'draft line')} refilled`;
  return `Recounted ${plural(v.days, 'day')}${changed}, ${lines}.${v.skipped.length ? ` Skipped: ${skippedText(v.skipped)}.` : ''}`;
}
