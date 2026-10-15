import type { NoticeUnit } from '@trendlix/shared';
import { addDays, addMonths, weekday } from '../common/date-only.js';

// How notice periods are counted (owner's decisions, 15 October 2026, checked against Labour Law 14/2025): in days,
// weeks, calendar months (the same day number, or the month's last day) or working days. Working days follow the
// employee's shift; public holidays aren't modelled yet, so a working day is any day of the shift's working week.

/** Sunday to Thursday: the working week of someone with no shift (or a shift that lists no days). */
export const DEFAULT_WORKING_DAYS: readonly number[] = [0, 1, 2, 3, 4];

/** The working week notice is counted in: the shift's days (0 = Sunday … 6 = Saturday), else Sunday to Thursday. */
export function workingWeek(shiftDays: readonly number[] | null | undefined): readonly number[] {
  return shiftDays?.length ? shiftDays : DEFAULT_WORKING_DAYS;
}

/**
 * The day a notice given on `givenOn` runs out: `amount` days, weeks or calendar months later, or the `amount`-th
 * working day after `givenOn` (the day the notice is given is not counted). No notice: the day it is given.
 */
export function noticeEnds(givenOn: string, amount: number, unit: NoticeUnit, shiftDays?: readonly number[] | null): string {
  if (amount <= 0) return givenOn;
  switch (unit) {
    case 'days':
      return addDays(givenOn, amount);
    case 'weeks':
      return addDays(givenOn, amount * 7);
    case 'months':
      return addMonths(givenOn, amount);
    case 'working_days': {
      const week = workingWeek(shiftDays);
      let day = givenOn;
      for (let counted = 0; counted < amount; ) {
        day = addDays(day, 1);
        if (week.includes(weekday(day))) counted++;
      }
      return day;
    }
  }
}

/**
 * The last day a notice can be given and still run out by `endDate`: the notice counted back from it. The latest day
 * for which noticeEnds(day, …) is on or before `endDate`, e.g. the last day to give 45 working days' notice that a
 * fixed term won't be renewed (contract clause 2).
 */
export function latestNoticeDay(endDate: string, amount: number, unit: NoticeUnit, shiftDays?: readonly number[] | null): string {
  if (amount <= 0) return endDate;
  switch (unit) {
    case 'days':
      return addDays(endDate, -amount);
    case 'weeks':
      return addDays(endDate, -7 * amount);
    case 'months': {
      // several days can run out on a month's last day (30 and 31 January both give 28 February): the latest of them
      let day = addMonths(endDate, -amount);
      while (addMonths(addDays(day, 1), amount) <= endDate) day = addDays(day, 1);
      return day;
    }
    case 'working_days': {
      // the amount-th working day counting back from the end date (itself included); notice is given the day before
      const week = workingWeek(shiftDays);
      let day = endDate;
      for (let counted = 0; ; day = addDays(day, -1)) {
        if (week.includes(weekday(day)) && ++counted === amount) return addDays(day, -1);
      }
    }
  }
}

/**
 * The law's minimum for resignation and for a company ending with notice: three months (Arts. 156 and 161); notice can
 * be longer, not shorter. Other units are compared with three months as roughly 90 days, 13 weeks or 65 working days
 * (13 weeks of five working days): an approximation, since a month has no fixed number of days.
 */
export const LEGAL_MINIMUM_NOTICE: Readonly<Record<NoticeUnit, number>> = { months: 3, days: 90, weeks: 13, working_days: 65 };

/** Whether a notice is at least the law's three months (see LEGAL_MINIMUM_NOTICE). */
export function meetsLegalMinimum(amount: number, unit: NoticeUnit): boolean {
  return amount >= LEGAL_MINIMUM_NOTICE[unit];
}
