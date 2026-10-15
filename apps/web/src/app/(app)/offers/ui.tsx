import type { OfferShownStatus } from '@trendlix/shared';
import { OFFER_STATUS_STYLE, statusLabel } from './list';

// Small building blocks of the Offers pages.

/** An offer's status, as shown (a sent offer past its last day is Expired). */
export function OfferStatusBadge({ status }: { status: OfferShownStatus }) {
  return <span className={`badge ${OFFER_STATUS_STYLE[status] ?? ''}`}>{statusLabel(status)}</span>;
}
