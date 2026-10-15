import { LABELS, OFFER_STATUS_LABELS, type OfferShownStatus, type Role } from '@trendlix/shared';
import { hasRole } from '../../../lib/roles';
import type { OfferListItem, OfferView } from '../../../lib/types';

// Plain helpers for the Offers pages (no server-only, so they are unit tested): who sees and changes offers, the list's
// filters as read from the address and sent on to GET /api/offers, and how a status is shown. Relative imports: the
// tests run without the "@/" alias.
//
// Job offers (owner's request, 15 October 2026): a candidate is not an employee until they accept. HR drafts and sends
// offers; the CEO follows them; the API checks every request again.

type WithRoles = { roles: readonly Role[] };

/** HR and the CEO see the offers (GET /offers); the sidebar shows them the link. */
export const OFFERS_ROLES: readonly Role[] = ['hr', 'ceo'];

export function canSeeOffers(user: WithRoles): boolean {
  return hasRole(user, ...OFFERS_ROLES);
}

/** Only HR drafts, sends, withdraws and records answers. */
export function managesOffers(user: WithRoles): boolean {
  return hasRole(user, 'hr');
}

export const WHO_SEES = 'Only HR and the CEO can see job offers.';
export const WHO_CHANGES = 'Only HR can draft and change job offers.';

// ---------- the filters ----------

/** 'open' = drafts, and sent offers not past their last day (the default); 'all' = every status. */
export type OfferStatusFilter = 'open' | 'draft' | 'sent' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'all';

/** The status choices, in the order the list offers them. */
export const OFFER_STATUS_FILTERS: readonly { value: OfferStatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: OFFER_STATUS_LABELS.accepted },
  { value: 'declined', label: OFFER_STATUS_LABELS.declined },
  { value: 'withdrawn', label: OFFER_STATUS_LABELS.withdrawn },
  { value: 'expired', label: OFFER_STATUS_LABELS.expired },
  { value: 'all', label: 'All' },
];

export interface OfferFilters {
  q: string;
  status: OfferStatusFilter;
}

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** The filters in the page's address; anything it doesn't know is left out (Open, no search). */
export function readOfferFilters(query: Query): OfferFilters {
  const status = one(query.status);
  return {
    q: one(query.q).trim().slice(0, 100),
    status: OFFER_STATUS_FILTERS.some((s) => s.value === status) ? (status as OfferStatusFilter) : 'open',
  };
}

/** Whether anything but the default (Open, no search) is chosen. */
export function isFiltered(f: OfferFilters): boolean {
  return f.q !== '' || f.status !== 'open';
}

/** The page's address for these filters, without the defaults: "/offers?status=accepted&q=omar". */
export function offersHref(f: OfferFilters): string {
  const params = new URLSearchParams();
  if (f.status !== 'open') params.set('status', f.status);
  if (f.q) params.set('q', f.q);
  const qs = params.toString();
  return qs ? `/offers?${qs}` : '/offers';
}

/** What to ask GET /api/offers for (a path under /api): All is asked without a status. */
export function offersListPath(f: OfferFilters): string {
  const params = new URLSearchParams();
  if (f.status !== 'all') params.set('status', f.status);
  if (f.q) params.set('q', f.q);
  const qs = params.toString();
  return qs ? `/offers?${qs}` : '/offers';
}

/** "1 offer", "12 offers". */
export function countLabel(n: number): string {
  return `${n} ${n === 1 ? 'offer' : 'offers'}`;
}

// ---------- status ----------

/** The badge's colours: waiting on HR (draft), waiting on the candidate (sent), done, or closed. */
export const OFFER_STATUS_STYLE: Record<OfferShownStatus, string> = {
  draft: 'bg-warn-soft text-warn',
  sent: '', // the badge's own accent colours
  accepted: 'bg-ok-soft text-ok',
  declined: 'bg-danger-soft text-danger',
  withdrawn: 'bg-line-soft text-muted',
  expired: 'bg-line-soft text-muted',
};

/** The status as shown: a sent offer past its last day (YYYY-MM-DD, in Cairo) is Expired, whether or not the API said so. */
export function shownStatus(status: OfferShownStatus, expiresOn: string | null, today: string): OfferShownStatus {
  return status === 'sent' && expiresOn && expiresOn < today ? 'expired' : status;
}

export function statusLabel(status: OfferShownStatus): string {
  return OFFER_STATUS_LABELS[status] ?? status;
}

// ---------- what an offer says ----------

/** "Senior Content Creator", or the employment type when no job title is set. */
export function positionTitle(o: Pick<OfferListItem, 'jobTitle' | 'employmentType'>): string {
  return o.jobTitle?.titleEn ?? LABELS.employmentType[o.employmentType] ?? o.employmentType;
}

/** "Marketing › Content Team" for an offer's team, "Marketing" for a department; null without one. */
export function placeName(d: OfferView['department']): string | null {
  if (!d) return null;
  return d.parent ? `${d.parent.nameEn} › ${d.nameEn}` : d.nameEn;
}

/** The offer's page. */
export const offerHref = (id: string) => `/offers/${encodeURIComponent(id)}`;

/**
 * Where the browser opens the offer's document, or saves it (`download`): the web server fetches it from the API with
 * the session. It is only ever a protected PDF (owner's request, 15 October 2026: "No doc file export, just a protected
 * PDF").
 */
export const offerDocumentHref = (id: string, download = false) => `/offers/${encodeURIComponent(id)}/document${download ? '?download=1' : ''}`;
