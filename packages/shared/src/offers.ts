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

/**
 * The job offer template for an employment type: its slot in the template library. The slots kept their keys when the
 * types changed (owner, 18 October 2026): a trainee's is offer_internship; one paid by commission (full-time only) is
 * offer_sales, which is used only when it has a published version (offerSlotFor).
 */
export function offerSlotKey(employmentType: string, paidByCommission = false): string {
  if (paidByCommission && employmentType === 'full_time') return 'offer_sales';
  return `offer_${employmentType === 'trainee' ? 'internship' : employmentType}`;
}

/** The job offer slot an offer is filled from: the commission one when paid by commission and it is published, else the type's. */
export const offerSlotFor = (employmentType: string, paidByCommission: boolean, published: (slotKey: string) => boolean): string =>
  paidByCommission && employmentType === 'full_time' && published('offer_sales') ? 'offer_sales' : offerSlotKey(employmentType);

/** What the candidate agrees to by accepting, on the offer's page (shown in both languages). */
export const OFFER_ACCEPTANCE = {
  en: 'By typing my full name and pressing Accept, I accept this job offer and its terms.',
  ar: 'بكتابة اسمي الكامل والضغط على "قبول"، أوافق على عرض العمل هذا وشروطه.',
} as const;
