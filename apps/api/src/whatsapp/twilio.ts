import { createHmac, timingSafeEqual } from 'node:crypto';
import { TWILIO_API, TWILIO_CONTENT_API, TWILIO_CONTENT_SID, TWILIO_MESSAGE_SID, templateReasonText, twilioTemplateStatusOf, type WhatsAppTemplateStatus } from '@trendlix/shared';
import type { GraphAnswer, GraphRequest } from './graph.js';

// Twilio as the system calls it for WhatsApp (owner, 25 October 2026: "Add Twilio as a choice"; "No, WhatsApp only"):
// the requests (a message through the Messages API; a template made as Content, submitted for WhatsApp's approval, its
// approval read), what a refusal means in plain words (the brief: "authentication failed, sender not WhatsApp-enabled,
// template not approved (63016 outside the 24-hour window), recipient not on WhatsApp, account suspended or funds"),
// and Twilio's calls to the website: their signature (X-Twilio-Signature: HMAC-SHA1, with the Auth Token, of the full
// public URL Twilio called followed by the POST parameters sorted by name, each name then its value; base64), a
// message's status, and what someone wrote (for STOP; WhatsApp only, never SMS). Pure code, tested in twilio.spec.ts;
// WhatsAppHttp sends, as it does Meta's (the same one door, faked in the tests).

/** A request to Twilio, as WhatsAppHttp sends it. The Auth Token is in its header only: never logged, never answered. */
export type TwilioRequest = GraphRequest;

/** Twilio's answer: its status and its JSON (null when none, or not JSON). */
export type TwilioAnswer = GraphAnswer;

const basic = (accountSid: string, token: string) => ({ authorization: `Basic ${Buffer.from(`${accountSid}:${token}`, 'utf8').toString('base64')}` });
const ok = (a: TwilioAnswer | null): a is TwilioAnswer => !!a && a.status >= 200 && a.status < 300;

// ---------- the Messages API ----------

/** A message through Twilio: to whom (+201…), from which sender, an approved template's Content and its variables, or a text. */
export interface TwilioMessage {
  to: string;
  /** whatsapp:+20…, sent as From; or a Messaging Service SID (MG…), sent as MessagingServiceSid. */
  sender: string;
  content?: { sid: string; variables: string } | null;
  /** A plain text (the STOP answer, within the 24 hours after the person wrote; the test until ours is approved). */
  text?: string | null;
  /** Where Twilio tells what became of it. */
  statusCallback?: string | null;
}

/** The Messages API's form fields: To, From or MessagingServiceSid, ContentSid and ContentVariables (or Body), StatusCallback. */
export function twilioMessageForm(m: TwilioMessage): Record<string, string> {
  const form: Record<string, string> = { To: `whatsapp:${m.to.startsWith('+') ? m.to : `+${m.to.replace(/\D/g, '')}`}` };
  if (m.sender.startsWith('MG')) form.MessagingServiceSid = m.sender;
  else form.From = m.sender;
  if (m.content) {
    form.ContentSid = m.content.sid;
    form.ContentVariables = m.content.variables;
  } else {
    form.Body = m.text ?? '';
  }
  if (m.statusCallback) form.StatusCallback = m.statusCallback;
  return form;
}

/** POST /2010-04-01/Accounts/{AccountSid}/Messages.json, the form url-encoded, with basic auth. */
export const twilioSendRequest = (accountSid: string, token: string, form: Record<string, string>): TwilioRequest => ({
  method: 'POST',
  url: `${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
  headers: { ...basic(accountSid, token), 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(form).toString(),
});

/** The SID Twilio gave a message it took (SM…, MM…), or null. */
export function twilioMessageSidOf(answer: TwilioAnswer | null): string | null {
  if (!ok(answer)) return null;
  const sid = (answer.body as { sid?: unknown } | null)?.sid;
  return typeof sid === 'string' && TWILIO_MESSAGE_SID.test(sid) ? sid : null;
}

// ---------- the Content API ----------

const contentJson = (accountSid: string, token: string, url: string, body?: Record<string, unknown>): TwilioRequest =>
  body ? { method: 'POST', url, headers: { ...basic(accountSid, token), 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method: 'GET', url, headers: basic(accountSid, token) };

/** POST /v1/Content: a template in a language, made as Twilio Content (packages/shared twilioContentRequest). */
export const twilioCreateContentRequest = (accountSid: string, token: string, content: Record<string, unknown>): TwilioRequest => contentJson(accountSid, token, `${TWILIO_CONTENT_API}/Content`, content);

/** GET /v1/Content: the account's Content, a page; `pageUrl`, the next page's address as Twilio gave it. */
export const twilioListContentRequest = (accountSid: string, token: string, pageUrl?: string | null): TwilioRequest => contentJson(accountSid, token, pageUrl || `${TWILIO_CONTENT_API}/Content?PageSize=100`);

/** POST /v1/Content/{sid}/ApprovalRequests/whatsapp: submitted for WhatsApp's approval (packages/shared twilioApprovalRequest). */
export const twilioSubmitApprovalRequest = (accountSid: string, token: string, contentSid: string, approval: Record<string, unknown>): TwilioRequest =>
  contentJson(accountSid, token, `${TWILIO_CONTENT_API}/Content/${encodeURIComponent(contentSid)}/ApprovalRequests/whatsapp`, approval);

/** GET /v1/Content/{sid}/ApprovalRequests: WhatsApp's approval of it now. */
export const twilioFetchApprovalRequest = (accountSid: string, token: string, contentSid: string): TwilioRequest =>
  contentJson(accountSid, token, `${TWILIO_CONTENT_API}/Content/${encodeURIComponent(contentSid)}/ApprovalRequests`);

/** The SID of a Content made (HX…), or null. */
export function contentSidOf(answer: TwilioAnswer | null): string | null {
  if (!ok(answer)) return null;
  const sid = (answer.body as { sid?: unknown } | null)?.sid;
  return typeof sid === 'string' && TWILIO_CONTENT_SID.test(sid) ? sid : null;
}

/** A Content as GET /v1/Content lists it. */
export interface ListedContent {
  sid: string;
  name: string;
  language: string | null;
  createdAt: string | null;
}

/**
 * The Content of a page of GET /v1/Content, and the next page's address (null: the last). The next address is followed
 * only on Twilio's Content API (it carries the Auth Token).
 */
export function listedContentsOf(body: unknown): { items: ListedContent[]; next: string | null } {
  const b = (body ?? {}) as { contents?: unknown; meta?: { next_page_url?: unknown } };
  const items: ListedContent[] = [];
  for (const raw of Array.isArray(b.contents) ? b.contents.slice(0, 1000) : []) {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (typeof c.sid !== 'string' || !TWILIO_CONTENT_SID.test(c.sid) || typeof c.friendly_name !== 'string') continue;
    items.push({ sid: c.sid, name: c.friendly_name, language: typeof c.language === 'string' ? c.language : null, createdAt: typeof c.date_created === 'string' ? c.date_created : null });
  }
  const next = typeof b.meta?.next_page_url === 'string' && b.meta.next_page_url.startsWith(`${TWILIO_CONTENT_API}/`) ? b.meta.next_page_url : null;
  return { items, next };
}

/** WhatsApp's approval of a Content: as the GET answers it ({ whatsapp: { status, rejection_reason } }), or the POST. */
export function approvalOf(body: unknown): { status: WhatsAppTemplateStatus; reason: string | null } {
  const b = (body ?? {}) as { whatsapp?: unknown; status?: unknown; rejection_reason?: unknown };
  const w = (b.whatsapp && typeof b.whatsapp === 'object' ? b.whatsapp : b) as { status?: unknown; rejection_reason?: unknown };
  const status = twilioTemplateStatusOf(w.status);
  return { status, reason: status === 'rejected' ? (templateReasonText(w.rejection_reason) ?? 'Rejected for WhatsApp, without a reason given.') : null };
}

// ---------- what a refusal means ----------

/** What went wrong with Twilio, in plain words: its kind, whether trying again later may work, and Twilio's code. */
export interface TwilioProblem {
  kind: 'auth' | 'account' | 'sender' | 'service' | 'window' | 'template' | 'recipient' | 'self' | 'policy' | 'rate' | 'twilio' | 'unreachable' | 'other';
  message: string;
  retry: boolean;
  code: number | null;
}

export const TWILIO_PROBLEMS = {
  auth: 'Twilio refused the Account SID and Auth Token (authentication failed): copy both again from the Twilio Console’s home page, and paste the Auth Token again.',
  account: 'The Twilio account is suspended or out of funds: check the Twilio Console (Billing: add funds, or upgrade a trial account).',
  trial: 'A trial Twilio account sends only to numbers verified in its Console: upgrade the account, or verify the number there.',
  sender:
    'The sender isn’t a WhatsApp sender of this Twilio account: check Messaging → Senders → WhatsApp senders (it must be Online), and write it here as whatsapp:+… or the SID of the Messaging Service that holds it.',
  service: 'The Messaging Service doesn’t exist on this Twilio account, or holds no WhatsApp sender: check Messaging → Services.',
  window:
    'Outside the 24-hour window only an approved template can be sent (Twilio’s error 63016): the template isn’t approved on Twilio yet, or the person hasn’t written to the business number in the last 24 hours.',
  template: 'The template isn’t approved on Twilio in this language yet (or its variables don’t match it): press Sync status in WhatsApp Settings, and it goes once approved.',
  recipient: 'The recipient isn’t on WhatsApp, or can’t receive messages from businesses yet.',
  self: 'That is the business number itself: send to another number.',
  policy: 'WhatsApp refused it under Meta’s rules (the number’s quality, spam or its daily limit): check the sender in the Twilio Console.',
  rate: 'Too many messages at once: it will be tried again.',
  twilio: 'Twilio’s service had a problem: it will be tried again.',
  unreachable: 'Twilio could not be reached: it will be tried again.',
} as const;

const ACCOUNT = new Set([10001, 10002, 20005, 30002]);
const SENDER = new Set([63007, 21212, 21606, 21659, 21660, 63112]);
const SERVICE = new Set([21701, 21702, 21703, 21704, 21705]);
const TEMPLATE = new Set([21655, 21656, 63027, 63028]);
const RECIPIENT = new Set([63003, 63024, 21211, 21614, 30003, 30005, 30006]);
const POLICY = new Set([63013, 63038, 63049, 30007]);
const RATE = new Set([20429, 63018, 30001, 14107]);
const DOWN = new Set([20500, 20503]);

/** Twilio's error: an answer's ({ code, message, more_info, status }), or a status callback's ErrorCode. */
export function twilioErrorOf(body: unknown): { code: number | null; message: string | null } | null {
  const b = body as { code?: unknown; message?: unknown } | null;
  if (!b || typeof b !== 'object') return null;
  const code = typeof b.code === 'number' ? b.code : typeof b.code === 'string' && /^\d+$/.test(b.code) ? Number(b.code) : null;
  const message = typeof b.message === 'string' ? b.message : null;
  return code === null && message === null ? null : { code, message };
}

/** Twilio's own words for a failure the mapping doesn't know, short and on one line, with its code. */
function twilioWords(e: { code: number | null; message: string | null } | null, status: number | null): string {
  const text = (e?.message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return e?.code ? `Twilio couldn’t send or deliver it (error ${e.code}, twilio.com/docs/errors/${e.code}).` : `Twilio refused it${status ? ` (HTTP ${status})` : ''}.`;
  const words = text.length > 200 ? `${text.slice(0, 199)}…` : text;
  return `Twilio refused it: ${words}${e?.code ? ` (code ${e.code})` : status ? ` (HTTP ${status})` : ''}.`;
}

/**
 * What a failure means in plain words, and whether it is worth trying again: Twilio's answer to a request (its error),
 * a failed status from its callback ({ code }), or none (Twilio not reached).
 */
export function twilioProblem(answer: TwilioAnswer | null | { code: number | null; message?: string | null }): TwilioProblem {
  if (!answer) return { kind: 'unreachable', message: TWILIO_PROBLEMS.unreachable, retry: true, code: null };
  const status = 'body' in answer ? answer.status : null;
  const e = 'body' in answer ? twilioErrorOf(answer.body) : { code: answer.code, message: answer.message ?? null };
  const code = e?.code ?? null;
  const out = (kind: TwilioProblem['kind'], message: string, retry = false): TwilioProblem => ({ kind, message, retry, code });
  if (code === 20003 || (status === 401 && !code)) return out('auth', TWILIO_PROBLEMS.auth);
  if (code === 21608) return out('account', TWILIO_PROBLEMS.trial);
  if ((code !== null && ACCOUNT.has(code)) || /\b(suspended|insufficient funds|balance)\b/i.test(e?.message ?? '')) return out('account', TWILIO_PROBLEMS.account);
  if (code !== null && SENDER.has(code)) return out('sender', TWILIO_PROBLEMS.sender);
  if (code !== null && SERVICE.has(code)) return out('service', TWILIO_PROBLEMS.service);
  if (code === 63016) return out('window', TWILIO_PROBLEMS.window);
  if (code !== null && TEMPLATE.has(code)) return out('template', TWILIO_PROBLEMS.template);
  if (code !== null && RECIPIENT.has(code)) return out('recipient', TWILIO_PROBLEMS.recipient);
  if (code === 63031) return out('self', TWILIO_PROBLEMS.self);
  if (code !== null && POLICY.has(code)) return out('policy', TWILIO_PROBLEMS.policy);
  if ((code !== null && RATE.has(code)) || status === 429) return out('rate', TWILIO_PROBLEMS.rate, true);
  if ((code !== null && DOWN.has(code)) || (status !== null && status >= 500)) return out('twilio', TWILIO_PROBLEMS.twilio, true);
  if (!e && status !== null && status >= 200 && status < 300) return out('other', 'Twilio answered without a message SID.');
  return out('other', twilioWords(e, status));
}

// ---------- Twilio's calls to the website ----------

/** A call's POST parameters (application/x-www-form-urlencoded) as they came, in order; at most 200. */
export function formParamsOf(raw: Buffer | null | undefined): [string, string][] {
  if (!raw?.length) return [];
  return [...new URLSearchParams(raw.toString('utf8'))].slice(0, 200);
}

/**
 * The X-Twilio-Signature of a call: HMAC-SHA1 with the Auth Token of the full URL Twilio called (its query too)
 * followed by every POST parameter sorted by name (a repeated name by its values), each name then its value; base64.
 */
export function twilioSignature(url: string, params: readonly (readonly [string, string])[], token: string): string {
  const sorted = [...params].sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const data = sorted.reduce((acc, [k, v]) => acc + k + v, url);
  return createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
}

/** The URL as signed, and with its default port written (or left out): Twilio signs either, as its own libraries check. */
export function twilioUrlVariants(url: string): string[] {
  const m = /^(https?):\/\/([^/:?#]+)(:\d+)?(.*)$/i.exec(url);
  if (!m) return [url];
  const port = m[1].toLowerCase() === 'https' ? ':443' : ':80';
  return m[3] ? (m[3] === port ? [url, `${m[1]}://${m[2]}${m[4]}`] : [url]) : [url, `${m[1]}://${m[2]}${port}${m[4]}`];
}

/** Whether a call's X-Twilio-Signature is the Auth Token's for the public URL and these parameters (constant time). */
export function twilioSignatureOk(url: string, params: readonly (readonly [string, string])[], header: unknown, token: string | null | undefined): boolean {
  if (!token || typeof header !== 'string' || !header.trim() || header.length > 200) return false;
  const given = Buffer.from(header.trim(), 'utf8');
  return twilioUrlVariants(url).some((u) => {
    const expected = Buffer.from(twilioSignature(u, params, token), 'utf8');
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

const paramOf = (params: readonly (readonly [string, string])[], name: string): string | null => params.find(([k]) => k === name)?.[1] ?? null;

/** A message's status, as a status callback says it, in the log's words. */
export interface TwilioStatus {
  sid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: number | null;
}

/**
 * A status callback's MessageStatus in the log's words: sent, delivered, read; failed and undelivered both failed, with
 * the ErrorCode. Those before sending (queued, accepted, sending, scheduled) and the rest are left aside: null.
 */
export function twilioStatusOf(params: readonly (readonly [string, string])[]): TwilioStatus | null {
  const sid = paramOf(params, 'MessageSid') ?? paramOf(params, 'SmsSid');
  if (!sid || !TWILIO_MESSAGE_SID.test(sid)) return null;
  const s = (paramOf(params, 'MessageStatus') ?? paramOf(params, 'SmsStatus') ?? '').toLowerCase();
  const status = s === 'sent' || s === 'delivered' || s === 'read' ? s : s === 'failed' || s === 'undelivered' ? 'failed' : null;
  if (!status) return null;
  const code = paramOf(params, 'ErrorCode');
  return { sid, status, errorCode: code && /^\d{1,6}$/.test(code) && Number(code) > 0 ? Number(code) : null };
}

/**
 * What someone wrote to the business number, as Twilio passes it on: who (digits) and their words (a text, or a
 * button's). WhatsApp only (From "whatsapp:+…"): an SMS is never read (owner, 25 October 2026: "No, WhatsApp only").
 */
export function twilioIncomingOf(params: readonly (readonly [string, string])[]): { from: string; text: string } | null {
  const from = paramOf(params, 'From') ?? '';
  if (!/^whatsapp:\+?\d{6,20}$/i.test(from)) return null;
  const text = paramOf(params, 'Body') || paramOf(params, 'ButtonText');
  if (typeof text !== 'string') return null;
  return { from: from.replace(/\D/g, ''), text };
}

/** The answer to a call: nothing to say back (an empty TwiML; the STOP answer goes through the Messages API, in the queue). */
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
