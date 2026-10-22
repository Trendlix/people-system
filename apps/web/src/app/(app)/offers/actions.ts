'use server';

// Job offer actions (owner's request, 15 October 2026): drafting and changing an offer, sending it (by the system's
// email, or as a link HR copies), extending, withdrawing, recording an answer given another way, making the profile
// once accepted, and deleting (a Super Admin only). Each one forwards to the API, which checks the session and the role
// (HR; a Super Admin for deleting), so calling these directly can't bypass permissions. Dates are typed as DD/MM/YYYY
// and sent as YYYY-MM-DD.
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, apiSend } from '@/lib/api';
import { allowancesFrom } from '@/lib/allowances';
import { deleteRefusal } from '@/lib/session';
import type { FormState, OfferSendResult, OfferView } from '@/lib/types';
import { answerBody, emailSendBody, extendBody, offerBody, sentOfferBody, submitted, withdrawBody } from './form-body';
import { offerHref } from './list';
import { EMAIL_NOT_SET_UP, originFrom, type OfferSendState } from './sending';

/** The API's messages, with its dates (YYYY-MM-DD) as the screens show them (DD/MM/YYYY). */
const asShown = (messages: string[]) => messages.map((m) => m.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'));

/** An API from before job offers (October 2026) answers "Cannot POST /api/…" for their addresses. */
function messagesOf(err: ApiError): string[] {
  if (err.status === 404 && err.messages.some((m) => /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m))) {
    return ['Not available yet: the server does not have job offers yet. Please try again after its next update.'];
  }
  return asShown(err.messages);
}

/** Sends the request unless reading the form already found mistakes, then opens the offer's page. */
async function save(fd: FormData, errors: string[], request: () => Promise<OfferView | undefined>, fallbackId?: string): Promise<FormState> {
  if (errors.length) return { errors, values: submitted(fd) };
  let offer: OfferView | undefined;
  try {
    offer = await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: submitted(fd) };
    throw err;
  }
  const id = offer?.id ?? fallbackId;
  redirect(id ? offerHref(id) : '/offers');
}

/** Sends the request and shows the change in place (the page is rendered again); `message` closes a small form. */
async function act(request: () => Promise<unknown>, message: string, fd?: FormData): Promise<FormState> {
  try {
    await request();
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: fd && submitted(fd) };
    throw err;
  }
  refresh();
  return { message };
}

/** Drafts an offer. Nothing is sent until HR sends it from the offer's page. */
export async function createOffer(_prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const allowances = allowancesFrom(fd, errors);
  const body = offerBody(fd, errors, { draft: false, allowances });
  // made from an applicant (recruitment, 22 October 2026: Make offer)
  const applicationId = fd.get('applicationId');
  const sent = typeof applicationId === 'string' && /^[0-9a-f-]{36}$/i.test(applicationId) ? { ...body, applicationId } : body;
  return save(fd, errors, () => apiSend<OfferView>('POST', '/offers', sent));
}

/** Changes a draft: any of its fields. */
export async function updateOffer(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const allowances = allowancesFrom(fd, errors);
  const body = offerBody(fd, errors, { draft: true, allowances });
  return save(fd, errors, () => apiSend<OfferView>('PATCH', `/offers/${id}`, body), id);
}

/** Changes a sent (or expired) offer: only its last day to accept and its note. */
export async function updateSentOffer(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = sentOfferBody(fd, errors);
  return save(fd, errors, () => apiSend<OfferView>('PATCH', `/offers/${id}`, body), id);
}

/** Extend: a new last day to accept (an expired offer opens again until then). */
export async function extendOffer(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = extendBody(fd, errors);
  if (errors.length) return { errors, values: submitted(fd) };
  return act(() => apiSend('PATCH', `/offers/${id}`, body), 'Extended.', fd);
}

/** The web app's address as the browser reached it, for the candidate's link. */
async function webOrigin(): Promise<string> {
  return originFrom(await headers());
}

/** Sends the offer by the system's email, to the address typed. A 503: the server has no email set up. */
export async function emailOffer(id: string, _prev: OfferSendState, fd: FormData): Promise<OfferSendState> {
  const errors: string[] = [];
  const body = emailSendBody(fd, await webOrigin(), errors);
  if (errors.length) return { errors, values: submitted(fd) };
  try {
    const sent = await apiSend<OfferSendResult>('POST', `/offers/${id}/send`, body);
    refresh();
    return { message: `Sent to ${body.to}.`, link: sent?.link, via: 'email', to: body.to };
  } catch (err) {
    // 503: no email set up on the server (said plainly here), or the email provider refused it (the API says so)
    if (err instanceof ApiError) return { errors: err.status === 503 ? [emailRefusal(err.messages)] : messagesOf(err), values: submitted(fd) };
    throw err;
  }
}

/** Why the email wasn't sent (a 503): email not set up on the server, else the API's reason (the provider refused it). */
function emailRefusal(messages: string[]): string {
  const said = messages.join(' ');
  return !said || /not set up|isn't set up|Cannot reach/i.test(said) ? EMAIL_NOT_SET_UP : said;
}

/** Makes the candidate's link for HR to send from their own email (the offer counts as sent). */
export async function linkOffer(id: string): Promise<OfferSendState> {
  try {
    const sent = await apiSend<OfferSendResult>('POST', `/offers/${id}/send`, { via: 'link', origin: await webOrigin() });
    refresh();
    return { message: 'The link is ready. Copy it and send it to the candidate.', link: sent?.link, via: 'link' };
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err) };
    throw err;
  }
}

/** Withdraws the offer, with the reason if HR gives one: its link stops working. */
export async function withdrawOffer(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return act(() => apiSend('POST', `/offers/${id}/withdraw`, withdrawBody(fd)), 'Withdrawn.', fd);
}

/**
 * Records the candidate's answer given another way (by phone, in person, on paper). Accepting makes the profile, as
 * online; when that fails the acceptance still stands (`hireError` says why), and the offer's page shows the reason
 * beside Make the profile: carried in its address, since the answer form is gone once the offer is accepted.
 */
export async function answerOffer(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const errors: string[] = [];
  const body = answerBody(fd, errors);
  if (errors.length) return { errors, values: submitted(fd) };
  let answered: (OfferView & { hireError?: string | null }) | undefined;
  try {
    answered = await apiSend<OfferView & { hireError?: string | null }>('POST', `/offers/${id}/answer`, body);
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err), values: submitted(fd) };
    throw err;
  }
  if (answered?.hireError) redirect(`${offerHref(id)}?${new URLSearchParams({ hireError: answered.hireError.slice(0, 500) })}`);
  refresh();
  return { message: body.answer === 'accepted' ? 'Recorded as accepted.' : 'Recorded as declined.' };
}

/** Tries again to make the profile, the employment and the draft contract of an accepted offer; then the offer's page, without the earlier error. */
export async function hireFromOffer(id: string): Promise<FormState> {
  try {
    await apiSend('POST', `/offers/${id}/hire`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err) };
    throw err;
  }
  redirect(offerHref(id));
}

/** Deletes an offer that wasn't accepted: a Super Admin only (owner's decision, 15 October 2026). */
export async function deleteOffer(id: string): Promise<FormState> {
  const refused = await deleteRefusal();
  if (refused) return { errors: refused };
  try {
    await apiSend('DELETE', `/offers/${id}`);
  } catch (err) {
    if (err instanceof ApiError) return { errors: messagesOf(err) };
    throw err;
  }
  redirect('/offers');
}
