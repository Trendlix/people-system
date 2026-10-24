// Meta's WhatsApp webhook on the website (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to
// Meta"): https://people.trendlix.com/whatsapp/webhook, the Callback URL pasted in Meta. Meta can't reach the API (its
// certificate is the server's own authority's, DEPLOY.md), so the website passes each call on, as it came, to the API's
// public address, which decides everything: the verification (GET, hub.challenge with the verify token) and each event
// (POST, its X-Hub-Signature-256 checked against the app secret on the exact bytes Meta signed, so the body goes on
// untouched). Nothing is kept, logged or cached here. Pure code (no "@/" imports): the route gives it the call to the
// API. Tested (whatsapp-webhook.test.ts).

/** A request to the API (`path` under /api), as the route makes it: the API's address and certificate are its own. */
export type ApiCall = (path: string, init: RequestInit) => Promise<Response>;

/** The API's address for the webhook. */
export const WEBHOOK_API_PATH = '/public/whatsapp/webhook';

/** The longest event body passed on (Meta's are a few kilobytes; a batch of statuses well under this). */
export const WEBHOOK_BODY_MAX = 1024 * 1024;

/** The longest query passed on (hub.mode, hub.verify_token and hub.challenge). */
const QUERY_MAX = 2048;

const NO_STORE = { 'cache-control': 'no-store' } as const;

const plain = (status: number, body = '') => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE } });

/** GET: Meta's verification, its query passed on; the API's answer (the challenge, or a refusal) given back as text. */
export async function webhookGet(request: Request, call: ApiCall): Promise<Response> {
  const query = new URL(request.url).search;
  if (query.length > QUERY_MAX) return plain(400);
  let res: Response;
  try {
    res = await call(`${WEBHOOK_API_PATH}${query}`, { method: 'GET', cache: 'no-store' });
  } catch {
    return plain(503);
  }
  const text = res.ok ? await res.text() : '';
  return plain(res.status, text);
}

/**
 * POST: an event, its bytes and its signature passed on unchanged; the API's status given back with no body (Meta reads
 * only the status: anything but 200 is sent again later). A body too long is refused here.
 */
export async function webhookPost(request: Request, call: ApiCall): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > WEBHOOK_BODY_MAX) return plain(413);
  const body = await request.arrayBuffer();
  if (body.byteLength > WEBHOOK_BODY_MAX) return plain(413);
  const headers = new Headers({ 'content-type': request.headers.get('content-type') || 'application/json' });
  const signature = request.headers.get('x-hub-signature-256');
  if (signature) headers.set('x-hub-signature-256', signature);
  let res: Response;
  try {
    res = await call(WEBHOOK_API_PATH, { method: 'POST', headers, body, cache: 'no-store' });
  } catch {
    return plain(503);
  }
  // read and dropped, so the connection is freed
  await res.arrayBuffer().catch(() => undefined);
  return plain(res.status);
}
