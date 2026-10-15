'use server';

// The candidate's answer to a job offer, from its public page: accepting (typing their full name and agreeing to the
// terms) or declining (with a reason, if they give one). Sent to the API's public addresses with the link's token, the
// candidate's IP address and browser, which are recorded with the answer; the API checks the token and that the offer is
// still open, and accepting makes the profile, the employment and a draft contract (owner's request, 15 October 2026).
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { ApiError } from '@/lib/api';
import { publicSend } from '@/lib/public-api';
import type { FormState } from '@/lib/types';
import { acceptBody, asShown, clientIp, declineBody, isOfferToken, userAgentOf } from './candidate';

const INVALID = "This link isn't valid. Please use the latest link you received.";

/** Who is answering: their IP address and browser, from the request. */
async function answeredFrom(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers();
  const ip = clientIp(h);
  const userAgent = userAgentOf(h);
  return { ...(ip && { ip }), ...(userAgent && { userAgent }) };
}

/**
 * Sends the answer, then shows the page again with it (the thank-you). A refusal says why: a name that isn't the offer's
 * (400), or an offer no longer open (409: already answered, past its last day, withdrawn), when the page is shown again
 * too, as it now stands; a link no longer valid (404).
 */
async function answer(token: string, path: 'accept' | 'decline', body: object, values: Record<string, string>): Promise<FormState> {
  try {
    await publicSend(`/offers/${encodeURIComponent(token)}/${path}`, { ...body, ...(await answeredFrom()) });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 409 || err.status === 404) refresh();
    const said = asShown(err.messages);
    return { errors: err.status === 404 && said.length === 0 ? [INVALID] : said, values };
  }
  refresh();
  return { message: path === 'accept' ? 'Accepted.' : 'Declined.' };
}

export async function acceptOffer(token: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!isOfferToken(token)) return { errors: [INVALID] };
  const errors: string[] = [];
  const body = acceptBody(fd, errors);
  if (errors.length) return { errors, values: { name: body.name } };
  return answer(token, 'accept', body, { name: body.name });
}

export async function declineOffer(token: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!isOfferToken(token)) return { errors: [INVALID] };
  const body = declineBody(fd);
  return answer(token, 'decline', body, { reason: body.reason ?? '' });
}
