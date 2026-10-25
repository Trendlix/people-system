import { isTrainingType } from '@trendlix/shared';
import { daysBetween } from '../employees/[id]/contracts/dates';
import { isOpenRaise } from '../my-requests/requests';
import type { RaiseRequest } from '../../../lib/raise-types';
import type { Employment } from '../../../lib/types';

// My Team (owner's decisions, 17 October 2026): a direct manager's direct reports, on the dashboard and a page of their
// own, so the manager reaches their profiles; with each one's job title and status, a probation ending soon, and the
// raise requests the manager is told about (the manager is told, not asked, and sees no figure: the API leaves them
// out). Pure code, tested. Relative imports: the tests run without the "@/" alias. Dates are YYYY-MM-DD; today is
// Cairo's.

/** A probation ending within this many days is shown as ending soon. */
export const PROBATION_SOON_DAYS = 30;

/** Raise requests decided within this many days are still news on the dashboard; open ones always are. */
export const RAISE_NEWS_DAYS = 30;

/**
 * My Team's line under its heading: their raise requests named only to a manager who sees them (owner, 20 October 2026:
 * "raises not to be visible to employee level for now", then "Hide from managers too"; seesRaiseRequests).
 */
export const myTeamIntro = (seesRaises: boolean) =>
  'The people who report to you now, their leave and permission requests, attendance corrections and reimbursement claims waiting for you, ' +
  `their attendance, and who is off this month. Open a profile to see their details${seesRaises ? ' and their raise requests' : ''}.`;

/**
 * A report's probation while they are on it: when it ends, how many days from today (negative once passed), and whether
 * that is soon (within PROBATION_SOON_DAYS, or passed while they are still on probation). Null when they aren't on
 * probation, or it has no end date; and for an intern, whose agreement has none (19 October 2026), even with a Probation
 * from before then.
 */
export function probationOf(
  e: (Pick<Employment, 'status' | 'probationEnd'> & { employmentType?: Employment['employmentType'] }) | null | undefined,
  today: string,
): { end: string; days: number; soon: boolean } | null {
  if (!e || e.status !== 'probation' || !e.probationEnd || isTrainingType(e.employmentType)) return null;
  const days = daysBetween(today, e.probationEnd.slice(0, 10));
  if (Number.isNaN(days)) return null;
  return { end: e.probationEnd.slice(0, 10), days, soon: days <= PROBATION_SOON_DAYS };
}

/** A moment (ISO) as the day it was in Cairo, YYYY-MM-DD. */
const cairoDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(iso));

/**
 * The raise requests a manager is told about on the dashboard: the open ones, and those decided (declined or done)
 * within RAISE_NEWS_DAYS, newest first.
 */
export function raiseNews(requests: readonly RaiseRequest[], today: string): RaiseRequest[] {
  return requests
    .filter((r) => isOpenRaise(r) || (!Number.isNaN(Date.parse(r.updatedAt)) && daysBetween(cairoDay(r.updatedAt), today) <= RAISE_NEWS_DAYS))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** A report's latest raise request (the API sends them newest first, but any order will do); null when none. */
export function latestRaise(requests: readonly RaiseRequest[]): RaiseRequest | null {
  return requests.reduce<RaiseRequest | null>((latest, r) => (!latest || Date.parse(r.createdAt) > Date.parse(latest.createdAt) ? r : latest), null);
}

/** Who asked, as the manager reads it: "you", "the employee", "HR" (another manager: "their direct manager"). */
export function askedByText(r: Pick<RaiseRequest, 'requester' | 'requestedBy'>, email: string): string {
  if (r.requester === 'manager') return r.requestedBy?.email.toLowerCase() === email.trim().toLowerCase() ? 'you' : 'their direct manager';
  return r.requester === 'self' ? 'the employee' : 'HR';
}
