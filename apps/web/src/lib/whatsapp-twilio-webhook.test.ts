import { describe, expect, it } from 'vitest';
import { EMPTY_TWIML, TWILIO_API_PATHS, TWILIO_BODY_MAX, twilioWebhookPost } from './whatsapp-twilio-webhook';
import type { ApiCall } from './whatsapp-webhook';

// Twilio's WhatsApp calls on the website (owner, 25 October 2026: "Add Twilio as a choice"): passed on to the API as
// they came, the bytes, the signature and the query string untouched; the API's answer given back as TwiML.

function fakeApi(answer: () => Response) {
  const calls: { path: string; method: string; headers: Headers; body: Uint8Array | null }[] = [];
  const call: ApiCall = async (path, init) => {
    const body = init.body ? new Uint8Array(init.body as ArrayBuffer) : null;
    calls.push({ path, method: init.method ?? 'GET', headers: new Headers(init.headers), body });
    return answer();
  };
  return { call, calls };
}

const form = 'AccountSid=AC123&MessageSid=SM456&MessageStatus=delivered&Body=%D8%AA%D9%88%D9%82%D9%81+now';

describe('a Twilio call (POST)', () => {
  it('passes the exact bytes, the signature and the query string on, and answers an empty TwiML', async () => {
    const api = fakeApi(() => new Response('{"statuses":1}', { status: 200 }));
    const res = await twilioWebhookPost(
      new Request('https://people.trendlix.com/whatsapp/twilio/status?attempt=1', {
        method: 'POST',
        body: form,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': '0/KCTR6DLpKmkAf8muzZqo1nDgQ=' },
      }),
      'status',
      api.call,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_TWIML);
    expect(res.headers.get('content-type')).toMatch(/^text\/xml/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const sent = api.calls[0];
    expect(sent).toMatchObject({ path: `${TWILIO_API_PATHS.status}?attempt=1`, method: 'POST' });
    expect(new TextDecoder().decode(sent.body!)).toBe(form);
    expect(sent.headers.get('x-twilio-signature')).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(sent.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
  });

  it('sends the incoming messages to their own address', async () => {
    const api = fakeApi(() => new Response(null, { status: 200 }));
    await twilioWebhookPost(new Request('https://people.trendlix.com/whatsapp/twilio/incoming', { method: 'POST', body: 'From=whatsapp%3A%2B201001234567&Body=STOP' }), 'incoming', api.call);
    expect(api.calls[0].path).toBe(TWILIO_API_PATHS.incoming);
  });

  it('gives a bad signature’s refusal back without words, 503 when the API can’t be reached, and refuses a body too long', async () => {
    const refused = await twilioWebhookPost(new Request('https://x/whatsapp/twilio/status', { method: 'POST', body: form }), 'status', fakeApi(() => new Response('{"message":"no"}', { status: 403 })).call);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe('');
    const down = await twilioWebhookPost(new Request('https://x/whatsapp/twilio/status', { method: 'POST', body: form }), 'status', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(down.status).toBe(503);
    const api = fakeApi(() => new Response(null, { status: 200 }));
    const big = await twilioWebhookPost(new Request('https://x/whatsapp/twilio/status', { method: 'POST', body: 'x'.repeat(TWILIO_BODY_MAX + 1) }), 'status', api.call);
    expect(big.status).toBe(413);
    const longQuery = await twilioWebhookPost(new Request(`https://x/whatsapp/twilio/status?${'q'.repeat(2000)}`, { method: 'POST', body: form }), 'status', api.call);
    expect(longQuery.status).toBe(400);
    expect(api.calls).toEqual([]);
  });
});
