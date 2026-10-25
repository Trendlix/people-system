import type { WhatsAppFetch } from '../src/whatsapp/whatsapp-http.js';

// Twilio as the WhatsApp tests see it (owner, 25 October 2026: "Add Twilio as a choice"): one fake in WhatsAppHttp's
// place beside the fake Graph API (fake-whatsapp.ts), answering the calls the system makes as Twilio does (its shapes
// and its errors): a message through the Messages API (POST /2010-04-01/Accounts/{sid}/Messages.json, form-encoded),
// and the Content API: make a Content (POST /v1/Content), list them (GET, 20 a page, with Twilio's next page), submit
// one for WhatsApp's approval (POST …/ApprovalRequests/whatsapp) and read it (GET …/ApprovalRequests). Basic auth with
// the Account SID and Auth Token, as Twilio checks. It keeps every message and Content; the tests approve or reject the
// Content, and refuse the next messages. No request leaves the machine. Its Auth Token is distinctive, so the tests can
// search every answer and audit entry for it.

export interface FakeTwilioSent {
  sid: string;
  to: string;
  from: string | null;
  messagingServiceSid: string | null;
  contentSid: string | null;
  variables: Record<string, string> | null;
  body: string | null;
  statusCallback: string | null;
}

export interface FakeContent {
  sid: string;
  friendlyName: string;
  language: string;
  variables: Record<string, string>;
  types: Record<string, { body: string; actions?: { type: string; title: string; url: string }[] }>;
  createdAt: string;
  approval: { name: string; category: string; status: string; reason: string } | null;
}

export interface FakeTwilio {
  fetch: WhatsAppFetch;
  /** Every call made: its method and address (never its headers). */
  calls: { method: string; url: string }[];
  sent: FakeTwilioSent[];
  contents: Map<string, FakeContent>;
  /** The next `n` messages are refused with this answer (status and body). */
  refuse(status: number, body: unknown, n?: number): void;
  /** WhatsApp approves (or rejects, or pauses) a Content's approval request: by its name, or every one submitted. */
  review(status: 'approved' | 'rejected' | 'paused', which?: { name: string } | null, reason?: string): void;
  byName(name: string): FakeContent | undefined;
  /** What Twilio knows: the account, its Auth Token, the WhatsApp sender, a Messaging Service holding it. */
  readonly accountSid: string;
  readonly authToken: string;
  readonly sender: string;
  readonly messagingServiceSid: string;
}

const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const error = (status: number, code: number, message: string) => json(status, { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status });
const hex = (n: number, salt: string) => `${salt}${n.toString(16)}`.replace(/[^0-9a-f]/g, '').padStart(32, '0').slice(-32);

export function fakeTwilio(run: string): FakeTwilio {
  const salt = Buffer.from(run).toString('hex').slice(0, 12);
  const accountSid = `AC${hex(1, salt)}`;
  const authToken = `tw${run}AuthToken`.replace(/[^A-Za-z0-9]/g, '').padEnd(32, '7').slice(0, 32);
  const sender = 'whatsapp:+201000005555';
  const messagingServiceSid = `MG${hex(2, salt)}`;
  const calls: { method: string; url: string }[] = [];
  const sent: FakeTwilioSent[] = [];
  const contents = new Map<string, FakeContent>();
  const refusals: { status: number; body: unknown }[] = [];
  let n = 10;

  async function handle(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
    const u = new URL(url);
    calls.push({ method: init.method, url });
    if (u.host !== 'api.twilio.com' && u.host !== 'content.twilio.com') return json(599, { message: `The fake has no ${u.host}` });
    if (init.headers.authorization !== `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`) return error(401, 20003, 'Authenticate');

    if (u.host === 'api.twilio.com') {
      const m = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(u.pathname);
      if (!m || init.method !== 'POST') return error(404, 20404, 'The requested resource was not found');
      if (m[1] !== accountSid) return error(401, 20003, 'Authenticate');
      if (init.headers['content-type'] !== 'application/x-www-form-urlencoded') return error(400, 21601, 'Bad content type');
      const form = new URLSearchParams(init.body ?? '');
      const r = refusals.shift();
      if (r) return json(r.status, r.body);
      const to = form.get('To') ?? '';
      if (!/^whatsapp:\+\d{8,15}$/.test(to)) return error(400, 21211, `The 'To' number ${to} is not a valid phone number.`);
      const from = form.get('From');
      const service = form.get('MessagingServiceSid');
      if (from ? from !== sender : service !== messagingServiceSid) return from ? error(400, 63007, 'Twilio could not find a Channel with the specified From address') : error(400, 21705, 'Invalid Messaging Service');
      const contentSid = form.get('ContentSid');
      let variables: Record<string, string> | null = null;
      if (contentSid) {
        const c = contents.get(contentSid);
        if (!c || c.approval?.status !== 'approved') return error(400, 63027, 'Template does not exist for a language and locale');
        try {
          variables = JSON.parse(form.get('ContentVariables') ?? '{}') as Record<string, string>;
        } catch {
          return error(400, 21656, 'The ContentVariables Parameter is invalid.');
        }
        if (Object.keys(variables).sort().join() !== Object.keys(c.variables).sort().join()) return error(400, 21656, 'The ContentVariables Parameter is invalid.');
      } else if (!form.get('Body')) {
        return error(400, 21619, 'A text message body or media urls must be specified.');
      }
      const sid = `SM${hex(++n, salt)}`;
      sent.push({ sid, to, from, messagingServiceSid: service, contentSid, variables, body: form.get('Body'), statusCallback: form.get('StatusCallback') });
      return json(201, { sid, account_sid: accountSid, to, from: from ?? null, messaging_service_sid: service ?? null, status: service ? 'accepted' : 'queued', error_code: null, error_message: null });
    }

    // the Content API
    const parts = u.pathname.split('/').filter(Boolean); // v1, Content, {sid}, ApprovalRequests, whatsapp
    if (parts[0] !== 'v1' || parts[1] !== 'Content') return error(404, 20404, 'The requested resource was not found');
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (parts.length === 2 && init.method === 'POST') {
      const types = body.types as FakeContent['types'] | undefined;
      if (typeof body.friendly_name !== 'string' || typeof body.language !== 'string' || !types || Object.keys(types).length !== 1) return error(400, 20001, 'Invalid content');
      const sid = `HX${hex(++n, salt)}`;
      const c: FakeContent = { sid, friendlyName: body.friendly_name, language: body.language, variables: (body.variables ?? {}) as Record<string, string>, types, createdAt: new Date(Date.now() + n).toISOString(), approval: null };
      contents.set(sid, c);
      return json(201, { sid, account_sid: accountSid, friendly_name: c.friendlyName, language: c.language, variables: c.variables, types, date_created: c.createdAt });
    }
    if (parts.length === 2 && init.method === 'GET') {
      const all = [...contents.values()];
      const page = Number(u.searchParams.get('Page') ?? 0);
      const items = all.slice(page * 20, page * 20 + 20);
      const next = (page + 1) * 20 < all.length ? `https://content.twilio.com/v1/Content?PageSize=20&Page=${page + 1}&PageToken=PT${page + 1}` : null;
      return json(200, {
        contents: items.map((c) => ({ sid: c.sid, account_sid: accountSid, friendly_name: c.friendlyName, language: c.language, date_created: c.createdAt, types: c.types })),
        meta: { page, page_size: 20, key: 'contents', next_page_url: next },
      });
    }
    const c = contents.get(parts[2] ?? '');
    if (!c) return error(404, 20404, 'The requested resource was not found');
    if (parts[3] === 'ApprovalRequests' && parts[4] === 'whatsapp' && init.method === 'POST') {
      if (c.approval) return error(400, 20001, 'An approval request already exists for this content and channel');
      c.approval = { name: String(body.name), category: String(body.category), status: 'received', reason: '' };
      return json(201, { name: c.approval.name, category: c.approval.category, content_type: Object.keys(c.types)[0], status: 'received', rejection_reason: '', allow_category_change: true });
    }
    if (parts[3] === 'ApprovalRequests' && parts.length === 4 && init.method === 'GET') {
      const a = c.approval;
      return json(200, { sid: c.sid, account_sid: accountSid, whatsapp: a ? { type: 'whatsapp', name: a.name, category: a.category, content_type: Object.keys(c.types)[0], status: a.status, rejection_reason: a.reason } : {} });
    }
    return error(404, 20404, 'The requested resource was not found');
  }

  return {
    fetch: (url, init) => handle(url, init),
    calls,
    sent,
    contents,
    accountSid,
    authToken,
    sender,
    messagingServiceSid,
    refuse(status, body, count = 1) {
      for (let i = 0; i < count; i++) refusals.push({ status, body });
    },
    review(status, which = null, reason = 'The template doesn’t follow WhatsApp’s rules.') {
      for (const c of contents.values()) {
        if (!c.approval || (which && c.approval.name !== which.name)) continue;
        c.approval.status = status;
        c.approval.reason = status === 'rejected' ? reason : '';
      }
    },
    byName: (name) => [...contents.values()].find((c) => c.friendlyName === name),
  };
}
