import type { ApiCall } from './whatsapp-webhook';

// Twilio's WhatsApp calls on the website (owner, 25 October 2026: "Add Twilio as a choice"; "No, WhatsApp only"):
// https://people.trendlix.com/whatsapp/twilio/status (each message's StatusCallback) and …/incoming (the sender's "When
// a message comes in", for STOP). Twilio can't reach the API (its certificate is the server's own authority's,
// DEPLOY.md), so the website passes each call on as it came to the API's public address, which decides everything: the
// X-Twilio-Signature is checked there against the Auth Token, over the PUBLIC URL Twilio called (the API knows it from
// WEB_ORIGIN; the query string is passed on for it) and the exact parameters, so the body and the signature go on
// untouched. Nothing is kept, logged or cached here. Pure code (no "@/" imports): the routes give it the call to the API.
// Tested (whatsapp-twilio-webhook.test.ts).

/** The API's addresses for Twilio's two calls. */
export const TWILIO_API_PATHS = {
  status: '/public/whatsapp/twilio/status',
  incoming: '/public/whatsapp/twilio/incoming',
} as const;

export type TwilioCall = keyof typeof TWILIO_API_PATHS;

/** The longest body passed on: Twilio's calls are a few kilobytes. */
export const TWILIO_BODY_MAX = 64 * 1024;

/** The longest query string passed on (Twilio's own calls have none, unless one was pasted with the URL). */
const SEARCH_MAX = 1024;

/** The answer to a call Twilio made: nothing to say back (the STOP answer goes through Twilio's Messages API). */
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const NO_STORE = { 'cache-control': 'no-store' } as const;

const plain = (status: number) => new Response('', { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE } });

/**
 * POST: a call, its bytes, its signature and its query string passed on unchanged; the API's yes answered with an empty
 * TwiML, its refusal with its status and no body (Twilio logs anything but 2xx as the webhook's error).
 */
export async function twilioWebhookPost(request: Request, kind: TwilioCall, call: ApiCall): Promise<Response> {
  const search = new URL(request.url).search;
  if (search.length > SEARCH_MAX) return plain(400);
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > TWILIO_BODY_MAX) return plain(413);
  const body = await request.arrayBuffer();
  if (body.byteLength > TWILIO_BODY_MAX) return plain(413);
  const headers = new Headers({ 'content-type': request.headers.get('content-type') || 'application/x-www-form-urlencoded' });
  const signature = request.headers.get('x-twilio-signature');
  if (signature) headers.set('x-twilio-signature', signature);
  let res: Response;
  try {
    res = await call(`${TWILIO_API_PATHS[kind]}${search}`, { method: 'POST', headers, body, cache: 'no-store' });
  } catch {
    return plain(503);
  }
  // read and dropped, so the connection is freed
  await res.arrayBuffer().catch(() => undefined);
  if (!res.ok) return plain(res.status);
  return new Response(EMPTY_TWIML, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8', ...NO_STORE } });
}
