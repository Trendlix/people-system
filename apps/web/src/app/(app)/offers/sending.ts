import type { OfferSendWay } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import type { FormState } from '../../../lib/types';

// Sending an offer (pure code, tested; relative imports for the tests). HR sends it by the system's email, or copies the
// candidate's link to send from their own email (owner's request, 15 October 2026). The API makes the link from the web
// app's address, which the web server reads from the request; each send makes a new link and the earlier one stops
// working (the API keeps only the newest link's fingerprint), so the link is shown right after sending, and not later.

/** What sending answers: the link to copy, how it was sent, and to whom; or why it was refused. */
export interface OfferSendState extends FormState {
  link?: string;
  via?: OfferSendWay;
  to?: string;
}

/** Said when the server has no email set up (OfferView.emailConfigured, or a 503 when sending). */
export const EMAIL_NOT_SET_UP = "Email isn't set up on the server yet: copy the link and send it from your own email.";

type HeaderSource = Pick<Headers, 'get'>;

/** The first value of a header that proxies may fill with a list ("https, http"). */
const first = (value: string | null) => value?.split(',')[0]?.trim() || '';

/**
 * The web app's own address as the browser reached it, e.g. https://people.trendlix.com: behind the deployment's proxy,
 * from x-forwarded-proto and x-forwarded-host, else the Host header (http on localhost, https elsewhere). '' when the
 * request names no host.
 */
export function originFrom(h: HeaderSource): string {
  const host = first(h.get('x-forwarded-host')) || first(h.get('host'));
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return '';
  const proto = first(h.get('x-forwarded-proto')).toLowerCase();
  const scheme = proto === 'http' || proto === 'https' ? proto : /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https';
  return `${scheme}://${host}`;
}

/** What the email HR sends themselves says: the offer's words, the link and the last day. */
export interface OfferMailParts {
  to: string;
  /** The candidate's English name. */
  name: string;
  /** The job title, or null when the offer has none. */
  jobTitle: string | null;
  company: string;
  /** YYYY-MM-DD. */
  expiresOn: string;
  /** HR's words to the candidate, if any. */
  message: string | null;
  link: string;
}

export function offerMailSubject(p: Pick<OfferMailParts, 'jobTitle' | 'company'>): string {
  return p.jobTitle ? `Job offer: ${p.jobTitle} at ${p.company}` : `Job offer from ${p.company}`;
}

export function offerMailBody(p: OfferMailParts): string {
  const firstName = p.name.trim().split(/\s+/)[0] || p.name.trim();
  return [
    `Dear ${firstName},`,
    '',
    p.message?.trim() || `We are pleased to offer you ${p.jobTitle ? `the position of ${p.jobTitle}` : 'a position'} at ${p.company}.`,
    '',
    'You can read the offer, and accept or decline it, here:',
    p.link,
    '',
    `The offer is open until ${formatDate(p.expiresOn)}.`,
    '',
    'Best regards,',
    p.company,
  ].join('\n');
}

/**
 * A mailto: link that opens HR's own email with the message ready: the candidate's address, the subject and the body
 * (line breaks as CRLF, as mail programs expect).
 */
export function offerMailto(p: OfferMailParts): string {
  const body = offerMailBody(p).replace(/\n/g, '\r\n');
  return `mailto:${encodeURIComponent(p.to).replace(/%40/g, '@')}?subject=${encodeURIComponent(offerMailSubject(p))}&body=${encodeURIComponent(body)}`;
}

/** Asked before a new link is made for an offer sent before: the earlier link stops working. */
export function newLinkConfirm(sentCount: number): string | undefined {
  return sentCount > 0 ? 'A new link replaces the one sent before: the earlier link will stop working. Make a new link?' : undefined;
}
