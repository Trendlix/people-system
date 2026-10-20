import type { OfferShownStatus } from '@trendlix/shared';

// The candidate's page of a job offer (pure code, tested; relative imports for the tests): the link's token, what the
// page shows for each status, the answer forms as the API takes them, and who answered (the IP address and browser,
// recorded with the answer). The page is public: the token in the link is its only key (owner's request, 15 October 2026).

/** A token as the API makes them: URL-safe letters, digits, - and _. Anything else is an invalid link, without asking the API. */
export const isOfferToken = (token: string) => /^[A-Za-z0-9_-]{16,200}$/.test(token);

/** What the page shows: the offer to answer, a thank-you, or why it can't be answered. */
export type CandidateView = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'invalid';

/** A sent offer is open; a draft has no link yet, so a draft's token is treated as invalid. */
export function candidateView(status: OfferShownStatus | string): CandidateView {
  switch (status) {
    case 'sent':
      return 'open';
    case 'accepted':
    case 'declined':
    case 'withdrawn':
    case 'expired':
      return status;
    default:
      return 'invalid';
  }
}

type HeaderSource = Pick<Headers, 'get'>;

// The candidate's IP address, recorded with their answer, is read by lib/client-ip.ts (shared with the sign-in and the
// check-ins since 20 October 2026).

/** The candidate's browser (its user agent), up to 500 characters; undefined without one. */
export function userAgentOf(h: HeaderSource): string | undefined {
  const ua = h.get('user-agent')?.trim();
  return ua ? ua.slice(0, 500) : undefined;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** Accepting: the full name typed, and the box ticked agreeing to the offer's terms. */
export function acceptBody(fd: FormData, errors: string[]): { name: string } {
  const name = text(fd, 'name').replace(/\s+/g, ' ');
  if (!name) errors.push('Type your full name as it is written on the offer.');
  if (fd.get('agree') !== 'yes') errors.push('Tick the box to confirm that you accept the offer and its terms.');
  return { name };
}

/** Declining: the reason, if the candidate gives one. */
export function declineBody(fd: FormData): { reason?: string } {
  const reason = text(fd, 'reason');
  return reason ? { reason: reason.slice(0, 1000) } : {};
}

/** What the API's dates (YYYY-MM-DD) look like on screen, in its messages: DD/MM/YYYY. */
export const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));
