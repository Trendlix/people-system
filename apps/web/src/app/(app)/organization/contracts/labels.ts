// Plain helpers for contracts and endings, usable on the server and in forms: how a rule's notice, who starts an
// ending and an approaching date are worded. Used by Organization → Contracts & Endings, Approvals and the home page.
import { NOTICE_UNIT_LABELS, type Initiator, type NoticeUnit } from '@trendlix/shared';

/** Who starts an ending (a rule's initiator, or who started an ending that was recorded). */
export const INITIATOR_LABELS: Record<Initiator, string> = {
  employee: 'Employee',
  company: 'Company',
  either: 'Employee or company',
  none: 'No one',
};

/** "3 months", "45 working days", "1 week"; "None" for no notice. */
export function noticeLabel(amount: number, unit: NoticeUnit): string {
  if (!amount) return 'None';
  const units = NOTICE_UNIT_LABELS[unit];
  return `${amount} ${amount === 1 ? units.replace(/s$/, '') : units}`;
}

/** "12 months", "1 month"; `none` (e.g. "No probation") for 0. */
export function monthsLabel(months: number, none = 'None'): string {
  if (!months) return none;
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

/** A date this close (or closer) is highlighted on the home page. */
export const DUE_SOON_DAYS = 7;

/** Whole days from `today` to `date` (both YYYY-MM-DD): 0 today, negative once it has passed. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

/**
 * How near a date is, when it needs attention: passed, or within a week ("today", "tomorrow", "in 3 days"). Null when
 * it is further off (or missing).
 */
export function dueNote(date: string | null | undefined, today: string): { tone: 'passed' | 'soon'; text: string } | null {
  if (!date) return null;
  const days = daysUntil(date, today);
  if (Number.isNaN(days) || days > DUE_SOON_DAYS) return null;
  if (days < 0) return { tone: 'passed', text: 'Passed' };
  if (days === 0) return { tone: 'soon', text: 'Today' };
  if (days === 1) return { tone: 'soon', text: 'Tomorrow' };
  return { tone: 'soon', text: `In ${days} days` };
}
