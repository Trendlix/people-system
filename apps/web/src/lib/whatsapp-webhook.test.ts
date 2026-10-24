import { describe, expect, it } from 'vitest';
import { WEBHOOK_API_PATH, WEBHOOK_BODY_MAX, webhookGet, webhookPost, type ApiCall } from './whatsapp-webhook';

// Meta's WhatsApp webhook on the website (owner, 24 October 2026: "how to make whatsapp notifications?"): passed on to
// the API as it came, the bytes and the signature untouched; the API's answer given back.

/** A fake API: keeps what it was sent, answers `answer`. */
function fakeApi(answer: () => Response) {
  const calls: { path: string; method: string; headers: Headers; body: Uint8Array | null }[] = [];
  const call: ApiCall = async (path, init) => {
    const body = init.body ? new Uint8Array(init.body as ArrayBuffer) : null;
    calls.push({ path, method: init.method ?? 'GET', headers: new Headers(init.headers), body });
    return answer();
  };
  return { call, calls };
}

describe('the verification (GET)', () => {
  it('passes Meta’s query on and gives the challenge back as text', async () => {
    const api = fakeApi(() => new Response('1158201444', { status: 200 }));
    const res = await webhookGet(new Request('https://people.trendlix.com/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=1158201444'), api.call);
    expect(api.calls[0]).toMatchObject({ path: `${WEBHOOK_API_PATH}?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=1158201444`, method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('gives a refusal back without the API’s words, and 503 when the API can’t be reached', async () => {
    const refused = await webhookGet(new Request('https://x/whatsapp/webhook?hub.verify_token=wrong'), fakeApi(() => new Response('{"message":"no"}', { status: 403 })).call);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe('');
    const down = await webhookGet(new Request('https://x/whatsapp/webhook'), async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(down.status).toBe(503);
  });
});

describe('an event (POST)', () => {
  it('passes the exact bytes and the signature on, and gives the API’s status back with no body', async () => {
    const api = fakeApi(() => new Response('{"ok":true}', { status: 200 }));
    // Meta escapes non-Latin letters (ا) and the signature is over these bytes exactly
    const raw = '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"text":{"body":"\\u062a\\u0648\\u0642\\u0641"}}]}}]}]}';
    const res = await webhookPost(
      new Request('https://people.trendlix.com/whatsapp/webhook', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=abc123' } }),
      api.call,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    const sent = api.calls[0];
    expect(sent).toMatchObject({ path: WEBHOOK_API_PATH, method: 'POST' });
    expect(new TextDecoder().decode(sent.body!)).toBe(raw);
    expect(sent.headers.get('x-hub-signature-256')).toBe('sha256=abc123');
    expect(sent.headers.get('content-type')).toBe('application/json');
  });

  it('gives a bad signature’s refusal back, and refuses a body too long', async () => {
    const refused = await webhookPost(new Request('https://x/whatsapp/webhook', { method: 'POST', body: '{}' }), fakeApi(() => new Response(null, { status: 401 })).call);
    expect(refused.status).toBe(401);
    const api = fakeApi(() => new Response(null, { status: 200 }));
    const big = await webhookPost(new Request('https://x/whatsapp/webhook', { method: 'POST', body: 'x'.repeat(WEBHOOK_BODY_MAX + 1) }), api.call);
    expect(big.status).toBe(413);
    expect(api.calls).toEqual([]);
  });
});
