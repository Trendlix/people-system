import { RECORDED_EARLIER_MARK, type OfferShownStatus } from '@trendlix/shared';
import { OFFER_STATUS_STYLE, statusLabel } from './list';

// Small building blocks of the Offers pages.

/** An offer's status, as shown (a sent offer past its last day is Expired). */
export function OfferStatusBadge({ status }: { status: OfferShownStatus }) {
  return <span className={`badge ${OFFER_STATUS_STYLE[status] ?? ''}`}>{statusLabel(status)}</span>;
}

/** The small mark of an earlier offer (25 October 2026), entered after it was given: "Recorded earlier". */
export function RecordedEarlierMark() {
  return <span className="badge bg-line-soft text-muted">{RECORDED_EARLIER_MARK}</span>;
}
