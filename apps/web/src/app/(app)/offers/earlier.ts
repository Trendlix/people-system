import { EARLIER_OFFER_NOTE, type OfferShownStatus, type Role } from '@trendlix/shared';
import { parseDate } from '../../../lib/format';
import { hasRole } from '../../../lib/roles';
import type { OfferView } from '../../../lib/types';

// Earlier job offers on the offers' pages (owner, 25 October 2026: "allow the HR to add for now job offers with a past
// duedate to enter the previous data"; pure code, tested; relative imports for the tests). While Recruitment Settings'
// "Entering earlier offers" is on, a draft can have a past last day (it is then an earlier one), be recorded as sent
// earlier (no email, no link) and have its answer recorded with the day it was given, past its last day too. The API
// checks every rule again; off, the pages are as before.

type WithRoles = { roles: readonly Role[] };

/** Who records an earlier offer as sent and its answer: HR, the CEO and a Super Admin. */
export function recordsEarlier(user: WithRoles): boolean {
  return hasRole(user, 'hr', 'ceo', 'super_admin');
}

/** The note under the last day typed (DD/MM/YYYY) when it has passed and the switch is on; null otherwise. */
export function earlierNote(typedLastDay: string, today: string, on: boolean): string | null {
  const day = parseDate(typedLastDay);
  return on && day && day < today ? EARLIER_OFFER_NOTE : null;
}

/** Whether "Record as sent earlier" is offered: for a draft, while the switch is on. */
export function canRecordSent(o: Pick<OfferView, 'status' | 'earlierOffers'>): boolean {
  return o.status === 'draft' && o.earlierOffers === true;
}

/** Whether the answer may come past the last day and be dated another day: an earlier offer, while the switch is on. */
export function answerLeeway(o: Pick<OfferView, 'recordedEarlier' | 'earlierOffers'>): boolean {
  return o.recordedEarlier === true && o.earlierOffers === true;
}

/**
 * Whether the candidate's answer can be recorded now (`status`: as shown), and by this user: a draft or a sent offer
 * before its last day has passed, by HR; an earlier one's past it too, also by the CEO or a Super Admin.
 */
export function answersNow(o: Pick<OfferView, 'expiresOn' | 'recordedEarlier' | 'earlierOffers'>, status: OfferShownStatus, today: string, user: WithRoles): boolean {
  if (status !== 'draft' && status !== 'sent' && status !== 'expired') return false;
  const leeway = answerLeeway(o);
  if (o.expiresOn < today && !leeway) return false;
  return leeway ? recordsEarlier(user) : hasRole(user, 'hr');
}

/** What the Record as sent earlier form says about the document, by the template's standing. */
export function recordSentDocumentHint(o: Pick<OfferView, 'template'>): string {
  return o.template.status === 'published'
    ? 'Nothing is emailed and no link is made. Its document is filled in as of that day and kept, as when an offer is sent.'
    : `Nothing is emailed and no link is made. The ${o.template.name} template isn’t published, so no document is kept with it.`;
}
