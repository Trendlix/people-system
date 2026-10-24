import type { WhatsAppFetch } from '../src/whatsapp/whatsapp-http.js';

// Meta's Graph API as the WhatsApp tests see it (owner, 24 October 2026: "Directly to Meta"): one fake in WhatsAppHttp's
// place, as the meetings' (fake-meetings.ts), answering the WhatsApp Cloud API's three calls the system makes as the real
// one does (its shapes and its errors): send a message (POST /{phone-number-id}/messages), submit a template (POST
// /{waba-id}/message_templates) and list them (GET, 20 a page, with Meta's cursors). It keeps every message sent and
// every template submitted; the tests approve or reject the templates, and refuse the next messages. No request leaves
// the machine. Its token is distinctive, so the tests can search every answer and audit entry for it.

export interface FakeSent {
  to: string;
  type: 'template' | 'text';
  template: string | null;
  language: string | null;
  body: string[];
  button: string | null;
  text: string | null;
  wamid: string;
}

export interface FakeTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  reason: string | null;
  components: unknown[];
}

export interface FakeGraph {
  fetch: WhatsAppFetch;
  /** Every call made: its method and address (never its headers). */
  calls: { method: string; url: string }[];
  sent: FakeSent[];
  templates: Map<string, FakeTemplate>;
  /** The next `n` messages are refused with this answer (status and body). */
  refuse(status: number, body: unknown, n?: number): void;
  /** Meta approves (or rejects) a template in a language: by name, or every one submitted. */
  review(status: 'APPROVED' | 'REJECTED' | 'PAUSED', which?: { name: string; language: string } | null, reason?: string): void;
  /** The ids Meta knows, and the token it takes. */
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly token: string;
}

const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const authError = () => json(401, { error: { message: 'Error validating access token: Session has expired.', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'Atrace' } });

export function fakeWhatsAppGraph(run: string): FakeGraph {
  const phoneNumberId = `10${String(Date.now()).slice(-11)}`;
  const wabaId = `20${String(Date.now()).slice(-11)}`;
  const token = `EAAG${run}PermanentSystemUserToken`;
  const calls: { method: string; url: string }[] = [];
  const sent: FakeSent[] = [];
  const templates = new Map<string, FakeTemplate>();
  const refusals: { status: number; body: unknown }[] = [];
  let n = 0;

  async function handle(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
    const u = new URL(url);
    calls.push({ method: init.method, url });
    if (u.host !== 'graph.facebook.com') return json(599, { error: `The fake has no ${u.host}` });
    if (init.headers.authorization !== `Bearer ${token}`) return authError();
    const parts = u.pathname.split('/').filter(Boolean); // v24.0, {id}, messages|message_templates
    if (parts[0] !== 'v24.0') return json(400, { error: { message: 'Unknown path components', type: 'OAuthException', code: 2500 } });
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (parts[2] === 'messages' && init.method === 'POST') {
      if (parts[1] !== phoneNumberId) return json(400, { error: { message: "Unsupported post request. Object with ID 'x' does not exist", type: 'GraphMethodException', code: 100, error_subcode: 33 } });
      const r = refusals.shift();
      if (r) return json(r.status, r.body);
      const to = String(body.to);
      const wamid = `wamid.${run}.${++n}`;
      if (body.type === 'text') {
        sent.push({ to, type: 'text', template: null, language: null, body: [], button: null, text: ((body.text as { body?: unknown } | undefined)?.body as string | undefined) ?? '', wamid });
      } else {
        const t = body.template as { name: string; language: { code: string }; components?: { type: string; parameters: { text: string }[] }[] };
        const known = t.name === 'hello_world' ? t.language.code === 'en_US' : templates.get(`${t.name}:${t.language.code}`)?.status === 'APPROVED';
        if (!known) return json(404, { error: { message: '(#132001) Template name does not exist in the translation', type: 'OAuthException', code: 132001, error_data: { messaging_product: 'whatsapp', details: `template name (${t.name}) does not exist in ${t.language.code}` } } });
        const comps = t.components ?? [];
        sent.push({
          to,
          type: 'template',
          template: t.name,
          language: t.language.code,
          body: comps.find((c) => c.type === 'body')?.parameters.map((p) => p.text) ?? [],
          button: comps.find((c) => c.type === 'button')?.parameters[0]?.text ?? null,
          text: null,
          wamid,
        });
      }
      return json(200, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: wamid, message_status: 'accepted' }] });
    }

    if (parts[2] === 'message_templates') {
      if (parts[1] !== wabaId) return json(400, { error: { message: "Unsupported get request. Object with ID 'x' does not exist", type: 'GraphMethodException', code: 100, error_subcode: 33 } });
      if (init.method === 'POST') {
        const key = `${String(body.name)}:${String(body.language)}`;
        if (templates.has(key)) return json(400, { error: { message: 'Message template already exists', type: 'OAuthException', code: 100, error_subcode: 2388024 } });
        const id = `tpl${run}${++n}`;
        templates.set(key, { id, name: String(body.name), language: String(body.language), category: String(body.category), status: 'PENDING', reason: null, components: body.components as unknown[] });
        return json(200, { id, status: 'PENDING', category: body.category });
      }
      const all = [...templates.values()];
      const start = Number(u.searchParams.get('after') ?? 0);
      const page = all.slice(start, start + 20);
      const next = start + 20 < all.length ? String(start + 20) : null;
      return json(200, {
        data: page.map((t) => ({ id: t.id, name: t.name, language: t.language, status: t.status, category: t.category, ...(t.reason && { rejected_reason: t.reason }) })),
        paging: { cursors: { before: String(start), after: next ?? String(start) }, ...(next && { next: `https://graph.facebook.com/v24.0/${wabaId}/message_templates?after=${next}` }) },
      });
    }
    return json(400, { error: { message: `The fake has no ${init.method} ${u.pathname}`, code: 100 } });
  }

  return {
    fetch: (url, init) => handle(url, init),
    calls,
    sent,
    templates,
    phoneNumberId,
    wabaId,
    token,
    refuse(status, body, count = 1) {
      for (let i = 0; i < count; i++) refusals.push({ status, body });
    },
    review(status, which = null, reason = 'INVALID_FORMAT') {
      for (const t of templates.values()) {
        if (which && (t.name !== which.name || t.language !== which.language)) continue;
        t.status = status;
        t.reason = status === 'REJECTED' ? reason : null;
      }
    },
  };
}
