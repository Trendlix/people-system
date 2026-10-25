import { trainingEndsText } from '@trendlix/shared';
import type { ExpiringContract } from '../../../lib/types';

// A contract ending soon, as the home page's Contracts Ending Soon and the Contracts page's Ending Soon word it, under the
// person and the end date: a fixed term's non-renewal notice due date; an intern's agreement, which has none (owner, 19
// October 2026: "or can be only renewed 1 time, after that it should be converted to a full time contract"), what
// follows it instead ("Internship ends on 31/03/2027: renew it once, or convert to full-time."); and what
// is already drafted after it. A developer gets the end date as null (owner, 23 October 2026: a person's contract dates
// are hidden from them): an agreement's way forward is then worded without it. Pure code, tested; relative imports for
// the tests.

/** The line under a contract ending soon: the non-renewal notice due, an agreement's way forward, or nothing. */
export type ExpiringLine = { kind: 'notice'; by: string } | { kind: 'training'; text: string } | { kind: 'none' };

export function expiringLine(c: Pick<ExpiringContract, 'endDate' | 'nonRenewalNoticeBy' | 'training'>, today: string): ExpiringLine {
  if (c.training) {
    if (c.endDate) return { kind: 'training', text: trainingEndsText(c.endDate, c.training.next, today) };
    return { kind: 'training', text: c.training.next === 'renew_or_convert' ? 'Renew it once, or convert to full-time.' : 'Convert to full-time, or end the internship.' };
  }
  return c.nonRenewalNoticeBy ? { kind: 'notice', by: c.nonRenewalNoticeBy } : { kind: 'none' };
}

/** What is drafted after it, as badges: its renewal, or its conversion to full-time (an older API: the renewal alone). */
export function draftedBadges(c: Pick<ExpiringContract, 'renewalDraft' | 'conversionDraft'>): string[] {
  return [c.renewalDraft && 'Renewal drafted', c.conversionDraft && 'Conversion drafted'].filter((b): b is string => !!b);
}
