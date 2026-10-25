// Job offers (owner's request, 15 October 2026): a candidate is not an employee until they accept. HR drafts the offer,
// sends it by email or as a link, and the candidate accepts (typing their name) or declines on the offer's page; HR can
// also record an answer given another way. Accepting makes the profile, the employment and a draft contract.

export const OFFER_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** As shown: a sent offer past its last day is Expired (worked out, not stored). */
export const OFFER_SHOWN_STATUSES = [...OFFER_STATUSES, 'expired'] as const;
export type OfferShownStatus = (typeof OFFER_SHOWN_STATUSES)[number];
export const OFFER_STATUS_LABELS: Record<OfferShownStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

/** How long an offer stays open unless HR sets another last day. */
export const OFFER_VALID_DAYS = 7;

/** How an offer was sent: by the system's email, or as a link HR sent. */
export const OFFER_SEND_WAYS = ['email', 'link'] as const;
export type OfferSendWay = (typeof OFFER_SEND_WAYS)[number];

// ---------- earlier offers (owner, 25 October 2026) ----------
// "allow the HR to add for now job offers with a past duedate to enter the previous data": while the switch "Entering
// earlier offers" is on (Organization → Recruitment Settings; on for now, the owner switches it off once the old offers
// are in), an offer can be saved with a past last day (it is then an earlier one), recorded as sent outside the system on
// the day HR picks, and its answer recorded with the day it was given. Nothing is emailed, linked or told to the
// candidate for such an offer; emailing or linking one past its last day stays refused.

/**
 * How a sent offer went: by the system's email, as a link HR sent, or outside the system before it was entered here
 * ("Record as sent earlier": no email and no link).
 */
export const OFFER_SENT_WAYS = [...OFFER_SEND_WAYS, 'outside'] as const;
export type OfferSentWay = (typeof OFFER_SENT_WAYS)[number];

/** The switch's name, as Recruitment Settings shows it. */
export const EARLIER_OFFERS_SWITCH = 'Entering earlier offers';

/** What the offer form says under a last day that has passed, while the switch is on. */
export const EARLIER_OFFER_NOTE = 'Last day passed: this offer is recorded as an earlier one.';

/** The small mark an earlier offer carries in the lists and on its page. */
export const RECORDED_EARLIER_MARK = 'Recorded earlier';

/** Said when something only earlier offers may do is asked with the switch off. */
export const EARLIER_OFFERS_OFF = 'Entering earlier offers is switched off (Organization → Recruitment Settings).';

/** GET /recruitment/settings/earlier-offers: the switch, and who changed it last. */
export interface EarlierOffersSetting {
  on: boolean;
  updatedAt: string | null;
  updatedBy: { email: string; name: string | null } | null;
}

/**
 * The job offer template for an employment type: its slot in the template library. The slots kept their keys when the
 * types changed (owner, 18 October 2026): one paid by commission (full-time only) is offer_sales, which is used only when
 * it has a published version (offerSlotFor). Since 19 October 2026 an intern's (the unpaid internship) is
 * offer_internship, the owner's internship offer.
 */
export function offerSlotKey(employmentType: string, paidByCommission = false): string {
  if (paidByCommission && employmentType === 'full_time') return 'offer_sales';
  return `offer_${employmentType === 'intern' ? 'internship' : employmentType}`;
}

/** The job offer slot an offer is filled from: the commission one when paid by commission and it is published, else the type's. */
export const offerSlotFor = (employmentType: string, paidByCommission: boolean, published: (slotKey: string) => boolean): string =>
  paidByCommission && employmentType === 'full_time' && published('offer_sales') ? 'offer_sales' : offerSlotKey(employmentType);

/** What the candidate agrees to by accepting, on the offer's page (shown in both languages). */
export const OFFER_ACCEPTANCE = {
  en: 'By typing my full name and pressing Accept, I accept this job offer and its terms.',
  ar: 'بكتابة اسمي الكامل والضغط على "قبول"، أوافق على عرض العمل هذا وشروطه.',
} as const;
