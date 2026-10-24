import { createHmac } from 'node:crypto';
import { createTemplateRequest, listedTemplatesOf, listTemplatesRequest, PROBLEMS, sendRequest, signatureOk, wamidOf, webhookEventsOf, whatsappProblem } from './graph.js';
import { newVerifyToken, openWhatsAppSecret, sameWhatsAppKey, sealWhatsAppSecret, whatsappKeyIdOf, whatsappKeyOf } from './whatsapp-secret.js';

// The WhatsApp Cloud API as the system calls it (owner, 24 October 2026: "Directly to Meta"): the signature of Meta's
// webhook calls, what Meta's refusals mean in plain words, what is read from a webhook call (statuses and replies only),
// the requests, and the sealing of the token and the app secret.

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('the webhook’s signature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [] }], note: 'وصل' });
  const raw = Buffer.from(body, 'utf8');

  it('is the HMAC-SHA256 of the exact bytes with the app secret', () => {
    expect(signatureOk(raw, sign(body), SECRET)).toBe(true);
    // upper-case hex is the same signature
    expect(signatureOk(raw, sign(body).toUpperCase().replace('SHA256=', 'sha256='), SECRET)).toBe(true);
  });

  it('is refused for another secret, a changed body, another form, or nothing at all', () => {
    expect(signatureOk(raw, sign(body, 'another-secret'), SECRET)).toBe(false);
    expect(signatureOk(Buffer.from(`${body} `), sign(body), SECRET)).toBe(false);
    // the body read as JSON and written again isn't what Meta signed (its escapes differ)
    expect(signatureOk(Buffer.from(JSON.stringify(JSON.parse(body)).replace('وصل', '\\u0648\\u0635\\u0644')), sign(body), SECRET)).toBe(false);
    expect(signatureOk(raw, sign(body).replace('sha256=', 'sha1='), SECRET)).toBe(false);
    expect(signatureOk(raw, 'sha256=abc', SECRET)).toBe(false);
    expect(signatureOk(raw, undefined, SECRET)).toBe(false);
    expect(signatureOk(raw, sign(body), null)).toBe(false);
    expect(signatureOk(undefined, sign(body), SECRET)).toBe(false);
  });
});

describe('Meta’s refusals in plain words', () => {
  const refused = (status: number, code: number, extra: object = {}) => whatsappProblem({ status, body: { error: { message: 'x', type: 'OAuthException', code, ...extra } } });

  it('say the token expired or is invalid, the number isn’t registered, the template isn’t approved, the recipient isn’t on WhatsApp, a billing problem', () => {
    expect(refused(401, 190, { error_subcode: 463 })).toEqual({ kind: 'token', message: PROBLEMS.token, retry: false, code: 190 });
    expect(refused(400, 133010)).toMatchObject({ kind: 'number', message: PROBLEMS.number, retry: false });
    expect(refused(400, 132001)).toMatchObject({ kind: 'template', message: PROBLEMS.template, retry: false });
    expect(refused(400, 132015)).toMatchObject({ kind: 'template' });
    expect(refused(400, 131026)).toMatchObject({ kind: 'recipient', message: PROBLEMS.recipient, retry: false });
    expect(refused(400, 131030)).toMatchObject({ kind: 'recipient', message: PROBLEMS.testList });
    expect(refused(400, 131042)).toMatchObject({ kind: 'billing', message: PROBLEMS.billing, retry: false });
    expect(refused(403, 10)).toMatchObject({ kind: 'permission', message: PROBLEMS.permission });
    expect(refused(400, 100, { error_subcode: 33 })).toMatchObject({ kind: 'ids', message: PROBLEMS.ids });
    expect(refused(400, 131047)).toMatchObject({ kind: 'window' });
  });

  it('try again later for a rate limit, Meta’s own trouble, or Meta not reached', () => {
    expect(refused(429, 130429)).toMatchObject({ kind: 'rate', retry: true });
    expect(refused(400, 131056)).toMatchObject({ kind: 'rate', retry: true });
    expect(refused(500, 131000)).toMatchObject({ kind: 'meta', retry: true });
    expect(whatsappProblem({ status: 503, body: null })).toMatchObject({ kind: 'meta', retry: true, code: null });
    expect(whatsappProblem(null)).toEqual({ kind: 'unreachable', message: PROBLEMS.unreachable, retry: true, code: null });
  });

  it('a failed status from the webhook reads the same; an unknown one gives Meta’s own words and its code', () => {
    expect(whatsappProblem({ error: { code: 131026, title: 'Message undeliverable' } })).toMatchObject({ kind: 'recipient', retry: false });
    expect(whatsappProblem({ status: 400, body: { error: { message: 'Something odd\nhappened', code: 999999, error_data: { details: 'More about it' } } } })).toEqual({
      kind: 'other',
      message: 'Meta refused it: More about it (code 999999).',
      retry: false,
      code: 999999,
    });
  });
});

describe('what a webhook call says', () => {
  const call = (value: object, field = 'messages') => ({ object: 'whatsapp_business_account', entry: [{ id: '123', changes: [{ field, value }] }] });

  it('the messages’ statuses, with a failure’s error', () => {
    const { statuses, replies } = webhookEventsOf(
      call({
        statuses: [
          { id: 'wamid.A', status: 'delivered', timestamp: '1792900000', recipient_id: '201012345678' },
          { id: 'wamid.B', status: 'failed', timestamp: '1792900001', recipient_id: '201012345678', errors: [{ code: 131026, title: 'Message undeliverable' }] },
          { id: 'wamid.C', status: 'deleted' },
          { status: 'read' },
        ],
      }),
    );
    expect(replies).toEqual([]);
    expect(statuses).toEqual([
      { wamid: 'wamid.A', status: 'delivered', at: new Date(1792900000 * 1000), recipient: '201012345678', error: null },
      { wamid: 'wamid.B', status: 'failed', at: new Date(1792900001 * 1000), recipient: '201012345678', error: { code: 131026, title: 'Message undeliverable' } },
    ]);
  });

  it('what people wrote (a text or a button’s words); nothing else, and nothing from other fields or objects', () => {
    const { replies } = webhookEventsOf(
      call({
        messages: [
          { from: '201012345678', id: 'wamid.in1', timestamp: '1792900000', type: 'text', text: { body: 'STOP' } },
          { from: '201012345679', type: 'button', button: { text: 'Stop' } },
          { from: '201012345670', type: 'image', image: { id: 'm' } },
          { from: 'not-a-number', type: 'text', text: { body: 'STOP' } },
        ],
      }),
    );
    expect(replies.map((r) => [r.from, r.text])).toEqual([
      ['201012345678', 'STOP'],
      ['201012345679', 'Stop'],
    ]);
    expect(webhookEventsOf(call({ messages: [{ from: '201012345678', type: 'text', text: { body: 'STOP' } }] }, 'message_template_status_update'))).toEqual({ statuses: [], replies: [] });
    expect(webhookEventsOf({ object: 'page', entry: [] })).toEqual({ statuses: [], replies: [] });
    expect(webhookEventsOf(null)).toEqual({ statuses: [], replies: [] });
  });
});

describe('the requests to Meta', () => {
  it('go to the Graph API with the token in their header only', () => {
    const send = sendRequest('1234567890', 'EAAtoken', { to: '20100' });
    expect(send).toEqual({ method: 'POST', url: 'https://graph.facebook.com/v24.0/1234567890/messages', headers: { authorization: 'Bearer EAAtoken', 'content-type': 'application/json' }, body: '{"to":"20100"}' });
    expect(createTemplateRequest('987', 'EAAtoken', { name: 'x' }).url).toBe('https://graph.facebook.com/v24.0/987/message_templates');
    const list = new URL(listTemplatesRequest('987', 'EAAtoken', 'CURSOR').url);
    expect(list.pathname).toBe('/v24.0/987/message_templates');
    expect(list.searchParams.get('after')).toBe('CURSOR');
    expect(list.searchParams.get('fields')).toContain('rejected_reason');
  });

  it('read a message’s id, and the templates with their statuses and the next page', () => {
    expect(wamidOf({ messaging_product: 'whatsapp', contacts: [{ input: '20100', wa_id: '20100' }], messages: [{ id: 'wamid.HBg' }] })).toBe('wamid.HBg');
    expect(wamidOf({ error: {} })).toBeNull();
    expect(
      listedTemplatesOf({
        data: [
          { id: '1', name: 'people_payslip_ready', language: 'en', status: 'APPROVED' },
          { id: '2', name: 'people_payslip_ready', language: 'ar', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' },
          { name: 'broken' },
        ],
        paging: { cursors: { after: 'NEXT' }, next: 'https://graph.facebook.com/…' },
      }),
    ).toEqual({
      items: [
        { id: '1', name: 'people_payslip_ready', language: 'en', status: 'approved', reason: null },
        { id: '2', name: 'people_payslip_ready', language: 'ar', status: 'rejected', reason: 'Meta found its format invalid.' },
      ],
      next: 'NEXT',
    });
  });
});

describe('the sealed token and app secret', () => {
  const key = whatsappKeyOf('the-jwt-secret');

  it('open with the same key and purpose only; the fingerprint tells the key without opening', () => {
    const sealed = sealWhatsAppSecret('EAAG-permanent-token', key, 'access_token');
    expect(sealed).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(sealed).not.toContain('EAAG');
    expect(sealWhatsAppSecret('EAAG-permanent-token', key, 'access_token')).not.toBe(sealed);
    expect(openWhatsAppSecret(sealed, key, 'access_token')).toBe('EAAG-permanent-token');
    expect(openWhatsAppSecret(sealed, key, 'app_secret')).toBeNull();
    expect(openWhatsAppSecret(sealed, whatsappKeyOf('another-jwt-secret'), 'access_token')).toBeNull();
    expect(openWhatsAppSecret('v1:broken', key, 'access_token')).toBeNull();
    expect(sameWhatsAppKey(whatsappKeyIdOf(key), key)).toBe(true);
    expect(sameWhatsAppKey(whatsappKeyIdOf(whatsappKeyOf('another')), key)).toBe(false);
    // its own key: not the email password's nor the meetings'
    expect(whatsappKeyOf('the-jwt-secret').equals(Buffer.from(key))).toBe(true);
  });

  it('a verify token is 32 URL-safe characters, new each time', () => {
    const t = newVerifyToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newVerifyToken()).not.toBe(t);
  });
});
