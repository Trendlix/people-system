import { createHmac, timingSafeEqual } from 'node:crypto';
import { WHATSAPP_GRAPH, WHATSAPP_GRAPH_VERSION, templateReasonText, templateStatusOf, type WhatsAppTemplateStatus } from '@trendlix/shared';

// The WhatsApp Cloud API as the system calls it (owner, 24 October 2026: "Directly to Meta"; graph.facebook.com): the
// requests (send a message, submit a template, read the templates' statuses), what a refusal means in plain words (the
// brief: "token expired or invalid, number not registered, template not approved, recipient not on WhatsApp, pay or
// billing problem"), and the webhook: its signature (X-Hub-Signature-256, HMAC-SHA256 of the raw body with the app
// secret) and the two things read from it, the messages' statuses and the replies (for STOP). Pure code, tested in
// whatsapp.spec.ts; whatsapp-http.ts sends.

/** A request to Meta, as WhatsAppHttp sends it. The token is in its header only: never logged, never in an answer. */
export interface GraphRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Meta's answer: its status and its JSON (null when none, or not JSON). */
export interface GraphAnswer {
  status: number;
  body: unknown;
}

const base = (path: string) => `${WHATSAPP_GRAPH}/${WHATSAPP_GRAPH_VERSION}/${path.replace(/^\/+/, '')}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** POST /{phone-number-id}/messages: a template or a text. */
export const sendRequest = (phoneNumberId: string, token: string, message: Record<string, unknown>): GraphRequest => ({
  method: 'POST',
  url: base(`${encodeURIComponent(phoneNumberId)}/messages`),
  headers: { ...auth(token), 'content-type': 'application/json' },
  body: JSON.stringify(message),
});

/** POST /{waba-id}/message_templates: a template in a language, submitted for Meta's review. */
export const createTemplateRequest = (businessAccountId: string, token: string, template: Record<string, unknown>): GraphRequest => ({
  method: 'POST',
  url: base(`${encodeURIComponent(businessAccountId)}/message_templates`),
  headers: { ...auth(token), 'content-type': 'application/json' },
  body: JSON.stringify(template),
});

/** GET /{waba-id}/message_templates: every template's status (a page; `after`, the next page's cursor). */
export function listTemplatesRequest(businessAccountId: string, token: string, after?: string | null): GraphRequest {
  const q = new URLSearchParams({ fields: 'id,name,language,status,category,rejected_reason', limit: '100' });
  if (after) q.set('after', after);
  return { method: 'GET', url: `${base(`${encodeURIComponent(businessAccountId)}/message_templates`)}?${q.toString()}`, headers: auth(token) };
}

/** The message id Meta gave a message sent ("wamid.…"), or null. */
export function wamidOf(body: unknown): string | null {
  const id = (body as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
  return typeof id === 'string' && id ? id : null;
}

/** A template as GET /message_templates lists it. */
export interface ListedTemplate {
  id: string | null;
  name: string;
  language: string;
  status: WhatsAppTemplateStatus;
  reason: string | null;
}

/** The templates of a page of GET /message_templates, and the next page's cursor (null: the last). */
export function listedTemplatesOf(body: unknown): { items: ListedTemplate[]; next: string | null } {
  const b = (body ?? {}) as { data?: unknown[]; paging?: { cursors?: { after?: unknown }; next?: unknown } };
  const items: ListedTemplate[] = [];
  for (const raw of Array.isArray(b.data) ? b.data : []) {
    const t = (raw ?? {}) as Record<string, unknown>;
    if (typeof t.name !== 'string' || typeof t.language !== 'string') continue;
    items.push({ id: typeof t.id === 'string' ? t.id : null, name: t.name, language: t.language, status: templateStatusOf(t.status), reason: templateReasonText(t.rejected_reason) });
  }
  const after = typeof b.paging?.next === 'string' && typeof b.paging?.cursors?.after === 'string' ? b.paging.cursors.after : null;
  return { items, next: after };
}

/** A template created: its id and status as Meta answered. */
export function createdTemplateOf(body: unknown): { id: string | null; status: WhatsAppTemplateStatus } {
  const b = (body ?? {}) as { id?: unknown; status?: unknown };
  return { id: typeof b.id === 'string' ? b.id : null, status: b.status ? templateStatusOf(b.status) : 'pending' };
}

// ---------- what a refusal means ----------

/** Meta's error, as its answers carry it ({ error: { … } }), or a status's ({ code, title, message, error_data }). */
export interface GraphError {
  code?: number;
  error_subcode?: number;
  message?: string;
  title?: string;
  type?: string;
  error_data?: { details?: string };
}

/** What went wrong, in plain words: its kind, whether trying again later may work, and Meta's code. */
export interface WhatsAppProblem {
  kind: 'token' | 'permission' | 'ids' | 'number' | 'template' | 'recipient' | 'billing' | 'policy' | 'rate' | 'meta' | 'unreachable' | 'window' | 'other';
  message: string;
  retry: boolean;
  code: number | null;
}

export const PROBLEMS = {
  token: 'The access token expired or is invalid: make a new permanent token for the system user in Meta and paste it in WhatsApp Settings.',
  permission:
    'The access token can’t send for this number: give the system user the WhatsApp Business Account (full control) and the permissions whatsapp_business_messaging and whatsapp_business_management.',
  ids: 'Meta doesn’t know the phone number ID or the WhatsApp Business Account ID (or the token can’t reach them): copy both again from WhatsApp → API Setup.',
  number: 'The business number isn’t registered with the WhatsApp Cloud API: finish adding and verifying it in WhatsApp Manager → Phone numbers.',
  template: 'The template isn’t approved in this language yet (or Meta paused it): press Sync status in WhatsApp Settings, and it goes once Meta approves it.',
  recipient: 'The recipient isn’t on WhatsApp, or can’t receive messages from businesses yet.',
  testList: 'The recipient isn’t on the app’s list of test numbers: add it in WhatsApp → API Setup, or finish putting the app live.',
  self: 'That is the business number itself: send to another number.',
  billing: 'Meta refused it for a payment problem: add or fix the payment method in WhatsApp Manager → Billing.',
  locked: 'The WhatsApp Business Account is locked or restricted: check WhatsApp Manager.',
  policy: 'Meta limited the number for now (its quality or spam rules): check the number’s quality in WhatsApp Manager.',
  rate: 'Too many messages at once: it will be tried again.',
  healthy: 'Meta chose not to deliver it now, to keep the person’s experience healthy (too many business messages): it isn’t sent again.',
  window: 'More than 24 hours since they last wrote: only an approved template can be sent.',
  meta: 'Meta’s service had a problem: it will be tried again.',
  unreachable: 'Meta could not be reached: it will be tried again.',
} as const;

const RETRY_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131056, 133004]);

/** Meta's own words for a failure the mapping doesn't know, short and on one line, with its code. */
function metaWords(e: GraphError, status: number | null): string {
  const text = (e.error_data?.details || e.message || e.title || 'no answer').replace(/\s+/g, ' ').trim();
  const words = text.length > 200 ? `${text.slice(0, 199)}…` : text;
  return `Meta refused it: ${words}${e.code ? ` (code ${e.code})` : status ? ` (HTTP ${status})` : ''}.`;
}

/** The error in Meta's answer, or a status's first error. */
export function graphErrorOf(body: unknown): GraphError | null {
  const b = body as { error?: GraphError } | GraphError | null;
  if (!b || typeof b !== 'object') return null;
  if ('error' in b && b.error && typeof b.error === 'object') return b.error;
  if ('code' in b && typeof b.code === 'number') return b as GraphError;
  return null;
}

/**
 * What a failure means in plain words (the brief: "token expired or invalid, number not registered, template not
 * approved, recipient not on WhatsApp, pay or billing problem"), and whether it is worth trying again: an answer with
 * Meta's error (a refused request, or a failed status from the webhook), or none (Meta not reached).
 */
export function whatsappProblem(answer: GraphAnswer | null | { error: GraphError; status?: null }): WhatsAppProblem {
  if (!answer) return { kind: 'unreachable', message: PROBLEMS.unreachable, retry: true, code: null };
  const status = 'status' in answer && typeof answer.status === 'number' ? answer.status : null;
  const e = 'body' in answer ? graphErrorOf(answer.body) : (answer as { error: GraphError }).error;
  const code = typeof e?.code === 'number' ? e.code : null;
  const sub = typeof e?.error_subcode === 'number' ? e.error_subcode : null;
  const out = (kind: WhatsAppProblem['kind'], message: string, retry = false): WhatsAppProblem => ({ kind, message, retry, code });
  if (code === 190 || code === 102 || (status === 401 && !code)) return out('token', PROBLEMS.token);
  if (code === 10 || code === 200 || code === 294 || code === 3 || (code !== null && code >= 200 && code <= 299)) return out('permission', PROBLEMS.permission);
  if (code === 100 && (sub === 33 || /does not exist|Unsupported (get|post) request|nonexisting field/i.test(e?.message ?? ''))) return out('ids', PROBLEMS.ids);
  if (code === 133010 || code === 133000 || code === 131045 || code === 133005 || code === 133006) return out('number', PROBLEMS.number);
  if (code === 132001 || code === 132000 || code === 132012 || code === 132015 || code === 132016 || code === 132007 || code === 132005 || code === 132068 || code === 132069) {
    return out('template', PROBLEMS.template);
  }
  if (code === 131026) return out('recipient', PROBLEMS.recipient);
  if (code === 131030) return out('recipient', PROBLEMS.testList);
  if (code === 131021) return out('recipient', PROBLEMS.self);
  if (code === 131042) return out('billing', PROBLEMS.billing);
  if (code === 131031) return out('policy', PROBLEMS.locked);
  if (code === 368 || code === 131048) return out('policy', PROBLEMS.policy);
  if (code === 131049) return out('policy', PROBLEMS.healthy);
  if (code === 131047) return out('window', PROBLEMS.window);
  if (code === 130429 || code === 131056 || code === 4 || code === 80007 || code === 17 || code === 341) return out('rate', PROBLEMS.rate, true);
  if ((code !== null && RETRY_CODES.has(code)) || (status !== null && status >= 500)) return out('meta', PROBLEMS.meta, true);
  if (status === 429) return out('rate', PROBLEMS.rate, true);
  if (!e && status !== null && status >= 200 && status < 300) return out('other', 'Meta answered without a message id.', false);
  return out('other', metaWords(e ?? {}, status));
}

// ---------- the webhook ----------

/**
 * Whether the X-Hub-Signature-256 header ("sha256=<hex>") is the HMAC-SHA256 of the raw body with the app secret,
 * compared in constant time. Anything else (no header, another form, no body or secret) is false.
 */
export function signatureOk(rawBody: Buffer | null | undefined, header: unknown, appSecret: string | null | undefined): boolean {
  if (!rawBody || !appSecret || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A message's status as the webhook says it. */
export interface WebhookStatus {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
  recipient: string | null;
  error: GraphError | null;
}

/** Something someone wrote to the business number: who (digits, as Meta gives "from") and their words. */
export interface WebhookReply {
  from: string;
  text: string;
  at: Date;
}

const momentOf = (ts: unknown): Date => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

/**
 * The two things read from a webhook call (the brief: "for statuses and STOP. … nothing else is processed from it"): the
 * statuses of the messages sent, and what people wrote (a text, or a button's words). Everything else is left aside.
 * Only the changes of the field "messages" are read.
 */
export function webhookEventsOf(body: unknown): { statuses: WebhookStatus[]; replies: WebhookReply[] } {
  const statuses: WebhookStatus[] = [];
  const replies: WebhookReply[] = [];
  const b = (body ?? {}) as { object?: unknown; entry?: unknown };
  if (b.object !== 'whatsapp_business_account' || !Array.isArray(b.entry)) return { statuses, replies };
  for (const entry of b.entry.slice(0, 50)) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes.slice(0, 50)) {
      const c = (change ?? {}) as { field?: unknown; value?: { statuses?: unknown; messages?: unknown } };
      if (c.field !== 'messages' || !c.value) continue;
      for (const raw of Array.isArray(c.value.statuses) ? c.value.statuses.slice(0, 500) : []) {
        const s = (raw ?? {}) as { id?: unknown; status?: unknown; timestamp?: unknown; recipient_id?: unknown; errors?: unknown };
        if (typeof s.id !== 'string' || !['sent', 'delivered', 'read', 'failed'].includes(String(s.status))) continue;
        const errors = Array.isArray(s.errors) ? (s.errors as GraphError[]) : [];
        statuses.push({ wamid: s.id, status: s.status as WebhookStatus['status'], at: momentOf(s.timestamp), recipient: typeof s.recipient_id === 'string' ? s.recipient_id : null, error: errors[0] ?? null });
      }
      for (const raw of Array.isArray(c.value.messages) ? c.value.messages.slice(0, 500) : []) {
        const m = (raw ?? {}) as { from?: unknown; timestamp?: unknown; type?: unknown; text?: { body?: unknown }; button?: { text?: unknown }; interactive?: { button_reply?: { title?: unknown } } };
        if (typeof m.from !== 'string' || !/^\d{6,20}$/.test(m.from)) continue;
        const text = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? m.interactive?.button_reply?.title : null;
        if (typeof text !== 'string') continue;
        replies.push({ from: m.from, text, at: momentOf(m.timestamp) });
      }
    }
  }
  return { statuses, replies };
}
